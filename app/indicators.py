from __future__ import annotations

from typing import Iterable


def _sma(values: list[float], window: int) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    if window <= 0 or len(values) < window:
        return out
    s = sum(values[:window])
    out[window - 1] = s / window
    for i in range(window, len(values)):
        s += values[i] - values[i - window]
        out[i] = s / window
    return out


def _ema(values: list[float], window: int) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    if window <= 0 or not values:
        return out
    alpha = 2 / (window + 1)
    # seed with SMA
    if len(values) < window:
        return out
    seed = sum(values[:window]) / window
    out[window - 1] = seed
    prev = seed
    for i in range(window, len(values)):
        prev = alpha * values[i] + (1 - alpha) * prev
        out[i] = prev
    return out


def compute_indicators(bars: list[dict], names: Iterable[str]) -> dict:
    """基于 K 线 bars 计算指标。bars 需含 time/open/high/low/close。"""
    wanted = {n.strip().lower() for n in names if n and n.strip()}
    if not bars:
        return {}

    closes = [float(b["close"]) for b in bars]
    highs = [float(b["high"]) for b in bars]
    lows = [float(b["low"]) for b in bars]
    times = [b["time"] for b in bars]
    result: dict = {}

    if "ma" in wanted or "ma5" in wanted or "ma10" in wanted or "ma20" in wanted:
        result["ma5"] = [
            {"time": t, "value": v}
            for t, v in zip(times, _sma(closes, 5))
            if v is not None
        ]
        result["ma10"] = [
            {"time": t, "value": v}
            for t, v in zip(times, _sma(closes, 10))
            if v is not None
        ]
        result["ma20"] = [
            {"time": t, "value": v}
            for t, v in zip(times, _sma(closes, 20))
            if v is not None
        ]

    if "macd" in wanted:
        ema12 = _ema(closes, 12)
        ema26 = _ema(closes, 26)
        dif: list[float | None] = [None] * len(closes)
        for i in range(len(closes)):
            if ema12[i] is not None and ema26[i] is not None:
                dif[i] = ema12[i] - ema26[i]  # type: ignore[operator]
        # DEA = EMA(DIF, 9); seed where dif becomes available
        dif_vals = [d if d is not None else 0.0 for d in dif]
        # only meaningful after both emas exist (index 25+)
        dea = _ema(dif_vals, 9)
        macd_hist = []
        dif_series = []
        dea_series = []
        for i, t in enumerate(times):
            if dif[i] is None or dea[i] is None:
                continue
            d = float(dif[i])  # type: ignore[arg-type]
            e = float(dea[i])  # type: ignore[arg-type]
            dif_series.append({"time": t, "value": round(d, 4)})
            dea_series.append({"time": t, "value": round(e, 4)})
            macd_hist.append(
                {
                    "time": t,
                    "value": round(2 * (d - e), 4),
                    "color": "rgba(191,72,0,0.45)" if d >= e else "rgba(0,128,9,0.45)",
                }
            )
        result["macd"] = {"dif": dif_series, "dea": dea_series, "hist": macd_hist}

    if "rsi" in wanted:
        period = 14
        rsi_series = []
        gains = [0.0]
        losses = [0.0]
        for i in range(1, len(closes)):
            ch = closes[i] - closes[i - 1]
            gains.append(max(ch, 0.0))
            losses.append(max(-ch, 0.0))
        if len(closes) > period:
            avg_gain = sum(gains[1 : period + 1]) / period
            avg_loss = sum(losses[1 : period + 1]) / period
            for i in range(period, len(closes)):
                if i > period:
                    avg_gain = (avg_gain * (period - 1) + gains[i]) / period
                    avg_loss = (avg_loss * (period - 1) + losses[i]) / period
                if avg_loss == 0:
                    val = 100.0
                else:
                    rs = avg_gain / avg_loss
                    val = 100 - (100 / (1 + rs))
                rsi_series.append({"time": times[i], "value": round(val, 2)})
        result["rsi"] = rsi_series

    if "boll" in wanted or "bollinger" in wanted:
        window = 20
        mid = _sma(closes, window)
        upper = []
        lower = []
        mid_s = []
        for i in range(len(closes)):
            if mid[i] is None:
                continue
            slice_ = closes[i - window + 1 : i + 1]
            mean = mid[i]
            var = sum((x - mean) ** 2 for x in slice_) / window  # type: ignore[operator]
            std = var**0.5
            t = times[i]
            m = float(mean)  # type: ignore[arg-type]
            mid_s.append({"time": t, "value": round(m, 4)})
            upper.append({"time": t, "value": round(m + 2 * std, 4)})
            lower.append({"time": t, "value": round(m - 2 * std, 4)})
        result["boll"] = {"mid": mid_s, "upper": upper, "lower": lower}

    # silence unused
    _ = highs, lows
    return result
