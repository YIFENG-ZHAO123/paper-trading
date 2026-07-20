from __future__ import annotations

import re


def normalize_code(raw: str) -> tuple[str, str]:
    """Return (market, code6). market is SH or SZ."""
    s = raw.strip().upper().replace(" ", "")
    s = (
        s.replace(".SH", "")
        .replace(".SZ", "")
        .replace("SH", "")
        .replace("SZ", "")
    )
    m = re.search(r"(\d{6})", s)
    if not m:
        raise ValueError(f"无法识别代码: {raw}")
    code = m.group(1)

    # Convertible bonds
    if code.startswith(("110", "111", "113", "118", "132")):
        return "SH", code
    if code.startswith(("120", "123", "127", "128")):
        return "SZ", code
    if code.startswith("11"):
        return "SH", code
    if code.startswith("12"):
        return "SZ", code

    # Equities / ETFs
    if code.startswith(("50", "51", "56", "58", "60", "68")):
        return "SH", code
    if code.startswith(("00", "15", "16", "18", "30")):
        return "SZ", code

    return ("SH" if code[0] in "569" else "SZ"), code
