from __future__ import annotations

import aiosqlite

from . import db as store
from .config import COMMISSION_RATE, DB_PATH, MIN_COMMISSION
from .codes import normalize_code
from .quotes import Quote, get_quote, get_quotes


def calc_commission(amount: float) -> float:
    return max(amount * COMMISSION_RATE, MIN_COMMISSION)


async def place_order(
    *,
    user_id: str,
    side: str,
    raw_code: str,
    qty: float,
    limit_price: float | None = None,
) -> dict:
    side = side.lower().strip()
    if side not in {"buy", "sell"}:
        raise ValueError("side 只能是 buy 或 sell")
    if qty <= 0:
        raise ValueError("数量必须大于 0")

    quote: Quote = await get_quote(raw_code)
    market = quote.market
    code = quote.code

    price = float(limit_price) if limit_price and limit_price > 0 else quote.price
    if price <= 0:
        raise RuntimeError("无有效价格，无法撮合")

    amount = price * qty
    commission = calc_commission(amount)

    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute("BEGIN")
        try:
            await store.ensure_user(conn, user_id)
            cash = await store.get_cash(conn, user_id)
            pos = await store.get_position(conn, user_id, code)

            if side == "buy":
                total = amount + commission
                if total > cash + 1e-6:
                    raise RuntimeError(
                        f"资金不足：需要 {total:.2f}，可用 {cash:.2f}"
                    )
                new_cash = cash - total
                old_qty = float(pos["qty"]) if pos else 0.0
                old_cost = float(pos["cost"]) if pos else 0.0
                new_qty = old_qty + qty
                new_cost = (
                    (old_cost * old_qty + amount) / new_qty if new_qty else 0.0
                )
                await store.set_cash(conn, user_id, new_cash)
                await store.upsert_position(
                    conn,
                    user_id,
                    code=code,
                    name=quote.name,
                    market=market,
                    qty=new_qty,
                    cost=new_cost,
                )
            else:
                hold = float(pos["qty"]) if pos else 0.0
                if qty > hold + 1e-9:
                    raise RuntimeError(f"持仓不足：持有 {hold}，卖出 {qty}")
                new_cash = cash + amount - commission
                new_qty = hold - qty
                cost = float(pos["cost"]) if pos else price
                await store.set_cash(conn, user_id, new_cash)
                await store.upsert_position(
                    conn,
                    user_id,
                    code=code,
                    name=quote.name,
                    market=market,
                    qty=new_qty,
                    cost=cost,
                )

            order_id = await store.insert_order(
                conn,
                user_id,
                {
                    "side": side,
                    "code": code,
                    "name": quote.name,
                    "market": market,
                    "qty": qty,
                    "price": price,
                    "amount": amount,
                    "commission": commission,
                    "source": quote.source,
                    "note": quote.note,
                },
            )
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise

        cash_after = await store.get_cash(conn, user_id)

    return {
        "order_id": order_id,
        "user_id": user_id,
        "side": side,
        "code": code,
        "name": quote.name,
        "market": market,
        "qty": qty,
        "price": round(price, 4),
        "amount": round(amount, 2),
        "commission": round(commission, 4),
        "cash": round(cash_after, 2),
        "quote_source": quote.source,
        "tradable": quote.tradable,
        "note": quote.note,
    }


async def portfolio_snapshot(user_id: str) -> dict:
    async with aiosqlite.connect(DB_PATH) as conn:
        await store.ensure_user(conn, user_id)
        await conn.commit()
        cash = await store.get_cash(conn, user_id)
        positions = await store.list_positions(conn, user_id)
        orders = await store.list_orders(conn, user_id, limit=30)

    codes = [p["code"] for p in positions]
    quote_map = {
        q["code"]: q
        for q in await get_quotes(codes)
        if "code" in q and "error" not in q
    }

    marked = []
    market_value = 0.0
    for p in positions:
        q = quote_map.get(p["code"])
        if q:
            last = float(q["price"])
            source = q.get("source", "")
            name = q.get("name") or p["name"]
            note = q.get("note") or ""
        else:
            last = p["cost"]
            source = "n/a"
            name = p["name"]
            note = "行情失败"
        mv = last * p["qty"]
        market_value += mv
        pnl = (last - p["cost"]) * p["qty"]
        marked.append(
            {
                **p,
                "name": name,
                "last": round(last, 4),
                "market_value": round(mv, 2),
                "pnl": round(pnl, 2),
                "pnl_pct": round((last / p["cost"] - 1) * 100, 2) if p["cost"] else 0.0,
                "source": source,
                "note": note,
            }
        )

    return {
        "user_id": user_id,
        "cash": round(cash, 2),
        "market_value": round(market_value, 2),
        "equity": round(cash + market_value, 2),
        "positions": marked,
        "orders": orders,
    }


async def dashboard_snapshot(
    user_id: str, focus_code: str | None = None
) -> dict:
    async with aiosqlite.connect(DB_PATH) as conn:
        await store.ensure_user(conn, user_id)
        await conn.commit()
        cash = await store.get_cash(conn, user_id)
        positions = await store.list_positions(conn, user_id)
        orders = await store.list_orders(conn, user_id, limit=20)
        watch = await store.list_watchlist(conn, user_id)

    codes: list[str] = []
    for p in positions:
        codes.append(p["code"])
    for w in watch:
        codes.append(w["code"])
    if focus_code:
        try:
            _, fc = normalize_code(focus_code)
            codes.append(fc)
        except Exception:
            fc = None
    else:
        fc = None

    quote_map = {
        q["code"]: q
        for q in await get_quotes(codes)
        if "code" in q and "error" not in q
    }

    marked = []
    market_value = 0.0
    for p in positions:
        q = quote_map.get(p["code"])
        last = float(q["price"]) if q else p["cost"]
        name = (q or {}).get("name") or p["name"]
        mv = last * p["qty"]
        market_value += mv
        pnl = (last - p["cost"]) * p["qty"]
        marked.append(
            {
                **p,
                "name": name,
                "last": round(last, 4),
                "market_value": round(mv, 2),
                "pnl": round(pnl, 2),
                "pnl_pct": round((last / p["cost"] - 1) * 100, 2) if p["cost"] else 0.0,
                "source": (q or {}).get("source", "n/a"),
                "note": (q or {}).get("note", ""),
            }
        )

    watch_items = []
    for item in watch:
        q = quote_map.get(item["code"])
        watch_items.append(
            {
                **item,
                "name": (q or {}).get("name") or item["name"] or item["code"],
                "price": (q or {}).get("price"),
                "change_pct": (q or {}).get("change_pct"),
                "tradable": (q or {}).get("tradable"),
                "note": (q or {}).get("note", ""),
            }
        )

    focus = quote_map.get(fc) if fc else None
    return {
        "user_id": user_id,
        "cash": round(cash, 2),
        "market_value": round(market_value, 2),
        "equity": round(cash + market_value, 2),
        "positions": marked,
        "orders": orders,
        "watchlist": watch_items,
        "focus": focus,
    }
