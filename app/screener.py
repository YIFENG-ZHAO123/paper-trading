from __future__ import annotations

from typing import Any

import httpx

from .codes import normalize_code
from .config import TIMEOUT, USER_AGENT

# 东财字段：涨跌幅 f3、最新价 f2、成交额 f6、换手 f8、量比 f10(可选)、代码 f12、名称 f14
STOCK_FS = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23"  # 深A/创业/沪A/科创粗筛
CB_FS = "b:MK0354"
FIELDS = "f12,f14,f2,f3,f4,f5,f6,f8,f15,f16,f17,f18"


def _headers() -> dict:
    return {
        "User-Agent": USER_AGENT,
        "Referer": "https://quote.eastmoney.com/",
    }


async def _fetch_clist(fs: str, page: int, page_size: int, sort_fid: str = "f3") -> dict:
    url = (
        "https://push2.eastmoney.com/api/qt/clist/get"
        f"?pn={page}&pz={page_size}&po=1&np=1&fltt=2&invt=2"
        f"&fid={sort_fid}&fs={fs}&fields={FIELDS}"
    )
    async with httpx.AsyncClient(timeout=TIMEOUT, headers=_headers()) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.json()


def _f(v: Any) -> float:
    try:
        if v is None or v == "" or v == "-":
            return 0.0
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _row_to_item(row: dict, market_hint: str | None = None) -> dict | None:
    code = str(row.get("f12") or "").strip()
    if not code:
        return None
    try:
        market, code6 = normalize_code(code)
    except Exception:
        market, code6 = (market_hint or "SZ"), code
    price = _f(row.get("f2"))
    if price <= 0:
        return None
    return {
        "code": code6,
        "name": str(row.get("f14") or code6),
        "market": market,
        "price": price,
        "change_pct": _f(row.get("f3")),
        "change": _f(row.get("f4")),
        "volume": _f(row.get("f5")),
        "amount": _f(row.get("f6")),
        "turnover": _f(row.get("f8")),
        "high": _f(row.get("f15")),
        "low": _f(row.get("f16")),
        "open": _f(row.get("f17")),
        "prev_close": _f(row.get("f18")),
    }


async def screen_market(
    *,
    universe: str = "stock",
    min_change_pct: float | None = None,
    max_change_pct: float | None = None,
    min_amount: float | None = None,
    min_turnover: float | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    sort: str = "change_pct",
    limit: int = 30,
) -> dict:
    """从东财榜单拉取后本地过滤。amount 单位为元。"""
    universe = (universe or "stock").lower()
    if universe not in {"stock", "cb", "all"}:
        raise ValueError("universe 仅支持 stock / cb / all")

    limit = max(5, min(int(limit), 100))
    page_size = 100
    # 多取几页再过滤，避免涨幅榜顶部全被滤掉
    pages = 3 if universe == "all" else 2

    sort_map = {
        "change_pct": "f3",
        "amount": "f6",
        "turnover": "f8",
        "price": "f2",
    }
    sort_fid = sort_map.get(sort, "f3")

    pools: list[tuple[str, str]] = []
    if universe in {"stock", "all"}:
        pools.append(("stock", STOCK_FS))
    if universe in {"cb", "all"}:
        pools.append(("cb", CB_FS))

    raw_items: list[dict] = []
    errors: list[str] = []
    for kind, fs in pools:
        for pn in range(1, pages + 1):
            try:
                payload = await _fetch_clist(fs, pn, page_size, sort_fid)
                rows = (payload.get("data") or {}).get("diff") or []
                if isinstance(rows, dict):
                    rows = list(rows.values())
                for row in rows:
                    item = _row_to_item(row)
                    if not item:
                        continue
                    item["type"] = kind
                    raw_items.append(item)
                if len(rows) < page_size:
                    break
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{kind}p{pn}:{exc}")
                break

    # 去重
    seen: set[str] = set()
    uniq: list[dict] = []
    for it in raw_items:
        if it["code"] in seen:
            continue
        seen.add(it["code"])
        uniq.append(it)

    def ok(it: dict) -> bool:
        chg = it["change_pct"]
        amt = it["amount"]
        turn = it["turnover"]
        px = it["price"]
        if min_change_pct is not None and chg < min_change_pct:
            return False
        if max_change_pct is not None and chg > max_change_pct:
            return False
        if min_amount is not None and amt < min_amount:
            return False
        if min_turnover is not None and turn < min_turnover:
            return False
        if min_price is not None and px < min_price:
            return False
        if max_price is not None and px > max_price:
            return False
        return True

    filtered = [it for it in uniq if ok(it)]

    reverse = True
    key_name = {
        "change_pct": "change_pct",
        "amount": "amount",
        "turnover": "turnover",
        "price": "price",
    }.get(sort, "change_pct")
    filtered.sort(key=lambda x: x.get(key_name, 0.0), reverse=reverse)
    items = filtered[:limit]

    return {
        "universe": universe,
        "count": len(items),
        "scanned": len(uniq),
        "items": items,
        "source": "eastmoney",
        "errors": errors,
    }
