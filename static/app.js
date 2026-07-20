const $ = (id) => document.getElementById(id);

const state = {
  marketMode: true,
  period: "day",
  chartCode: "",
  chart: null,
  candleSeries: null,
  volumeSeries: null,
  oscChart: null,
  indicatorSeries: {},
  oscSeries: {},
  perfChart: null,
  perfSeries: null,
  indicators: { ma: true, boll: false, macd: false, rsi: false },
  lastQuote: null,
  quoteSeq: 0,
  codeDebounce: null,
  tickInFlight: false,
  lastDashHash: "",
  lastWatchHash: "",
  lastPosHash: "",
  lastOrdHash: "",
};

function money(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}

function pct(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  const v = Number(n);
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function clsChg(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "";
  return Number(n) >= 0 ? "up" : "down";
}

function normalizeCodeInput(raw) {
  const m = String(raw || "").trim().toUpperCase().match(/(\d{6})/);
  return m ? m[1] : "";
}

function currentFormCode() {
  return normalizeCodeInput($("codeInput").value);
}

function stableHash(obj) {
  return JSON.stringify(obj);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail;
    throw new Error(typeof detail === "string" ? detail : res.statusText);
  }
  return data;
}

function setMarketMode(on) {
  state.marketMode = on;
  $("marketChk").checked = on;
  $("priceInput").disabled = on;
  $("submitBtn").textContent = on ? "提交市价单" : "提交限价单";
  if (on && state.lastQuote && state.lastQuote.code === currentFormCode()) {
    const next = String(state.lastQuote.price);
    if ($("priceInput").value !== next) $("priceInput").value = next;
  }
}

function applyQuoteToForm(q) {
  const want = currentFormCode();
  if (!want || normalizeCodeInput(q.code) !== want) return false;

  const same =
    state.lastQuote &&
    state.lastQuote.code === q.code &&
    state.lastQuote.price === q.price &&
    state.lastQuote.change_pct === q.change_pct &&
    state.lastQuote.name === q.name;

  state.lastQuote = q;
  if (same) {
    if (state.marketMode) {
      const next = String(q.price);
      if ($("priceInput").value !== next) $("priceInput").value = next;
    }
    return true;
  }

  $("quoteName").textContent = `${q.market || ""}${q.code} ${q.name || ""}`;
  $("quotePrice").textContent = money(q.price);
  $("quotePrice").className = `price ${clsChg(q.change_pct)}`;
  $("quoteChg").textContent = pct(q.change_pct);
  $("quoteChg").className = clsChg(q.change_pct);
  $("quoteNote").textContent = q.note || (q.tradable ? "" : "不可实时成交");
  if (state.marketMode) {
    const next = String(q.price);
    if ($("priceInput").value !== next) $("priceInput").value = next;
  }
  return true;
}

function showQuoteLoading(code) {
  $("quoteName").textContent = `${code} 加载中…`;
  $("quotePrice").textContent = "-";
  $("quotePrice").className = "price";
  $("quoteChg").textContent = "";
  $("quoteNote").textContent = "";
}

async function refreshQuote(code) {
  const c = normalizeCodeInput(code || $("codeInput").value);
  if (!c) return null;
  const seq = ++state.quoteSeq;
  try {
    const q = await api("/api/quote/" + encodeURIComponent(c));
    if (seq !== state.quoteSeq) return null;
    if (normalizeCodeInput(q.code) !== currentFormCode()) return null;
    applyQuoteToForm(q);
    return q;
  } catch (err) {
    if (seq !== state.quoteSeq || c !== currentFormCode()) return null;
    $("quoteName").textContent = `${c} 行情失败`;
    $("quotePrice").textContent = "-";
    $("quoteChg").textContent = "";
    $("quoteNote").textContent = err.message || "";
    state.lastQuote = null;
    throw err;
  }
}

function chartTheme() {
  return {
    layout: { background: { color: "#ffffff" }, textColor: "#86868b" },
    grid: {
      vertLines: { color: "#f0f0f2" },
      horzLines: { color: "#f0f0f2" },
    },
    rightPriceScale: { borderColor: "#d2d2d7" },
    timeScale: { borderColor: "#d2d2d7", timeVisible: true, secondsVisible: false },
    crosshair: { mode: 0 },
  };
}

function ensureChart() {
  if (state.chart) return;
  const el = $("chartBox");
  state.chart = LightweightCharts.createChart(el, chartTheme());
  state.candleSeries = state.chart.addCandlestickSeries({
    upColor: "#bf4800",
    downColor: "#008009",
    borderUpColor: "#bf4800",
    borderDownColor: "#008009",
    wickUpColor: "#bf4800",
    wickDownColor: "#008009",
  });
  state.volumeSeries = state.chart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "",
    scaleMargins: { top: 0.8, bottom: 0 },
  });
  const resize = () => {
    if (state.chart) {
      state.chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    }
    const osc = $("chartOsc");
    if (state.oscChart && osc && !osc.hidden) {
      state.oscChart.applyOptions({ width: osc.clientWidth, height: osc.clientHeight });
    }
    const perf = $("perfChart");
    if (state.perfChart && perf) {
      state.perfChart.applyOptions({ width: perf.clientWidth, height: perf.clientHeight });
    }
  };
  window.addEventListener("resize", resize);
  resize();
}

function clearIndicatorSeries() {
  Object.values(state.indicatorSeries).forEach((s) => {
    try {
      state.chart.removeSeries(s);
    } catch (_) {}
  });
  state.indicatorSeries = {};
  Object.values(state.oscSeries).forEach((s) => {
    try {
      if (state.oscChart) state.oscChart.removeSeries(s);
    } catch (_) {}
  });
  state.oscSeries = {};
}

function selectedIndicators() {
  return Object.entries(state.indicators)
    .filter(([, on]) => on)
    .map(([k]) => k);
}

function mapLine(arr) {
  return (arr || [])
    .map((p) => ({ time: toChartTime(p.time), value: p.value }))
    .filter((p) => p.time != null && p.value != null);
}

function applyIndicators(ind) {
  clearIndicatorSeries();
  if (!ind || !state.chart) return;

  const needOsc = state.indicators.macd || state.indicators.rsi;
  const oscEl = $("chartOsc");
  if (oscEl) oscEl.hidden = !needOsc;
  if (needOsc) {
    if (!state.oscChart) {
      state.oscChart = LightweightCharts.createChart(oscEl, chartTheme());
    }
    state.oscChart.applyOptions({
      width: oscEl.clientWidth,
      height: oscEl.clientHeight,
    });
  }

  if (state.indicators.ma) {
    const colors = { ma5: "#0071e3", ma10: "#bf4800", ma20: "#86868b" };
    ["ma5", "ma10", "ma20"].forEach((key) => {
      if (!ind[key]) return;
      const s = state.chart.addLineSeries({
        color: colors[key],
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(mapLine(ind[key]));
      state.indicatorSeries[key] = s;
    });
  }

  if (state.indicators.boll && ind.boll) {
    const conf = [
      ["boll_mid", ind.boll.mid, "#1d1d1f"],
      ["boll_up", ind.boll.upper, "#0071e3"],
      ["boll_low", ind.boll.lower, "#0071e3"],
    ];
    conf.forEach(([key, data, color]) => {
      const s = state.chart.addLineSeries({
        color,
        lineWidth: key === "boll_mid" ? 2 : 1,
        lineStyle: key === "boll_mid" ? 0 : 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(mapLine(data));
      state.indicatorSeries[key] = s;
    });
  }

  if (state.indicators.macd && ind.macd && state.oscChart) {
    const hist = state.oscChart.addHistogramSeries({
      priceFormat: { type: "price", precision: 3, minMove: 0.001 },
    });
    hist.setData(
      (ind.macd.hist || []).map((p) => ({
        time: toChartTime(p.time),
        value: p.value,
        color: p.color,
      }))
    );
    const dif = state.oscChart.addLineSeries({ color: "#0071e3", lineWidth: 2 });
    dif.setData(mapLine(ind.macd.dif));
    const dea = state.oscChart.addLineSeries({ color: "#bf4800", lineWidth: 2 });
    dea.setData(mapLine(ind.macd.dea));
    state.oscSeries.macdHist = hist;
    state.oscSeries.macdDif = dif;
    state.oscSeries.macdDea = dea;
    state.oscChart.timeScale().fitContent();
  }

  if (state.indicators.rsi && ind.rsi && state.oscChart && !state.indicators.macd) {
    const rsi = state.oscChart.addLineSeries({ color: "#0071e3", lineWidth: 2 });
    rsi.setData(mapLine(ind.rsi));
    state.oscSeries.rsi = rsi;
    state.oscChart.timeScale().fitContent();
  } else if (state.indicators.rsi && ind.rsi && state.indicators.macd) {
    // MACD 优先占副图；RSI 同时开时叠在副图
    const rsi = state.oscChart.addLineSeries({
      color: "#af52de",
      lineWidth: 1,
      priceScaleId: "rsi",
    });
    state.oscChart.priceScale("rsi").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.2 } });
    rsi.setData(mapLine(ind.rsi));
    state.oscSeries.rsi = rsi;
  }
}

async function loadKline(code, period) {
  const c = normalizeCodeInput(code || $("codeInput").value);
  if (!c) return;
  const p = period || state.period;
  state.period = p;
  state.chartCode = c;
  ensureChart();
  const inds = selectedIndicators().join(",");
  const q = new URLSearchParams({
    period: p,
    limit: "180",
    indicators: inds || "ma",
  });
  const data = await api(`/api/kline/${encodeURIComponent(c)}?${q}`);
  $("chartTitle").textContent = `${data.market}${data.code} ${data.name} · ${p}`;
  const candles = (data.bars || []).map((b) => ({
    time: toChartTime(b.time),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
  }));
  const volumes = (data.bars || []).map((b) => ({
    time: toChartTime(b.time),
    value: b.volume,
    color: b.close >= b.open ? "rgba(191,72,0,0.45)" : "rgba(0,128,9,0.45)",
  }));
  state.candleSeries.setData(candles);
  state.volumeSeries.setData(volumes);
  applyIndicators(data.indicators || {});
  state.chart.timeScale().fitContent();
  document.querySelectorAll("#periodTabs button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.period === p);
  });
}

function amountWan(n) {
  if (n == null || Number.isNaN(Number(n))) return "-";
  return (Number(n) / 10000).toFixed(0) + "万";
}

async function runScreener(e) {
  if (e) e.preventDefault();
  const params = new URLSearchParams({
    universe: $("scUniverse").value,
    sort: $("scSort").value,
    limit: "40",
  });
  const minChg = $("scMinChg").value;
  const maxChg = $("scMaxChg").value;
  const minAmt = $("scMinAmt").value;
  const minTurn = $("scMinTurn").value;
  const minPx = $("scMinPx").value;
  const maxPx = $("scMaxPx").value;
  if (minChg !== "") params.set("min_change_pct", minChg);
  if (maxChg !== "") params.set("max_change_pct", maxChg);
  if (minAmt !== "") params.set("min_amount", String(Number(minAmt) * 10000));
  if (minTurn !== "") params.set("min_turnover", minTurn);
  if (minPx !== "") params.set("min_price", minPx);
  if (maxPx !== "") params.set("max_price", maxPx);

  $("screenerMsg").textContent = "筛选中…";
  try {
    const data = await api("/api/screener?" + params.toString());
    $("screenerMsg").textContent = `扫描 ${data.scanned} 只，命中 ${data.count} 只`;
    $("screenerBody").innerHTML =
      (data.items || [])
        .map((it) => {
          const chg = clsChg(it.change_pct);
          return `<tr>
            <td>${it.code}</td><td>${it.name}</td>
            <td>${money(it.price)}</td>
            <td class="${chg}">${pct(it.change_pct)}</td>
            <td>${amountWan(it.amount)}</td>
            <td>${money(it.turnover)}</td>
            <td class="ops">
              <button type="button" class="mini" data-sc="pick" data-code="${it.code}">交易</button>
              <button type="button" class="mini" data-sc="watch" data-code="${it.code}">自选</button>
              <button type="button" class="mini" data-sc="chart" data-code="${it.code}">K线</button>
            </td>
          </tr>`;
        })
        .join("") || `<tr><td colspan="7">无匹配结果，请放宽条件</td></tr>`;
  } catch (err) {
    $("screenerMsg").textContent = "筛选失败: " + err.message;
  }
}

function ensurePerfChart() {
  if (state.perfChart) return;
  const el = $("perfChart");
  if (!el) return;
  state.perfChart = LightweightCharts.createChart(el, chartTheme());
  state.perfSeries = state.perfChart.addAreaSeries({
    lineColor: "#0071e3",
    topColor: "rgba(0,113,227,0.28)",
    bottomColor: "rgba(0,113,227,0.02)",
    lineWidth: 2,
  });
  state.perfChart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
}

async function refreshPerformance() {
  try {
    const data = await api("/api/performance");
    const pnlEl = $("perfPnl");
    if (!pnlEl) return;
    pnlEl.textContent = money(data.total_pnl);
    pnlEl.className = clsChg(data.total_pnl);
    $("perfRet").textContent = pct(data.total_return_pct);
    $("perfRet").className = clsChg(data.total_return_pct);
    $("perfDd").textContent = pct(data.max_drawdown_pct);
    $("perfWin").textContent =
      data.win_rate_pct == null ? "-" : data.win_rate_pct.toFixed(1) + "%";
    $("perfSharpe").textContent =
      data.sharpe_rough == null ? "-" : Number(data.sharpe_rough).toFixed(2);
    $("perfTrades").textContent = String(data.trades ?? 0);

    ensurePerfChart();
    const curve = (data.equity_curve || [])
      .map((p, idx) => {
        let t = p.time;
        if (t === "start") t = Math.floor(Date.now() / 1000) - data.equity_curve.length * 60;
        else if (t === "now") t = Math.floor(Date.now() / 1000);
        else {
          const parsed = Date.parse(String(t).replace(" ", "T") + "+08:00");
          t = Number.isNaN(parsed)
            ? Math.floor(Date.now() / 1000) - (data.equity_curve.length - idx) * 60
            : Math.floor(parsed / 1000);
        }
        return { time: t, value: p.equity };
      })
      .sort((a, b) => a.time - b.time);
    const uniq = [];
    const seen = new Set();
    curve.forEach((p) => {
      let tt = p.time;
      while (seen.has(tt)) tt += 1;
      seen.add(tt);
      uniq.push({ time: tt, value: p.value });
    });
    state.perfSeries.setData(uniq);
    state.perfChart.timeScale().fitContent();
  } catch (err) {
    console.warn(err);
  }
}

function toChartTime(t) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = String(t).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return t;
  const iso = `${m[1]}T${m[2]}:${m[3]}:00+08:00`;
  return Math.floor(new Date(iso).getTime() / 1000);
}

function selectCode(code, { loadChart = true } = {}) {
  const c = normalizeCodeInput(code);
  if (!c) return;
  const changed = currentFormCode() !== c || $("codeInput").value !== c;
  $("codeInput").value = c;
  if (!state.lastQuote || state.lastQuote.code !== c) {
    state.lastQuote = null;
    showQuoteLoading(c);
  }
  refreshQuote(c).catch((e) => {
    $("msg").textContent = "行情失败: " + e.message;
  });
  if (loadChart && (changed || state.chartCode !== c)) {
    loadKline(c, state.period).catch((e) => {
      $("msg").textContent = "K线失败: " + e.message;
    });
  }
}

function renderWatchlist(items) {
  const hash = stableHash(
    items.map((w) => [w.code, w.price, w.change_pct, w.name])
  );
  if (hash === state.lastWatchHash) return;
  state.lastWatchHash = hash;
  $("watchBody").innerHTML =
    items
      .map((w) => {
        const chg = clsChg(w.change_pct);
        return `<tr>
          <td>${w.code}</td>
          <td>${w.name || "-"}</td>
          <td class="${chg}">${money(w.price)}</td>
          <td class="${chg}">${pct(w.change_pct)}</td>
          <td class="ops">
            <button type="button" class="mini" data-act="pick" data-code="${w.code}">选中</button>
            <button type="button" class="mini" data-act="buy" data-code="${w.code}">快买</button>
            <button type="button" class="mini" data-act="chart" data-code="${w.code}">K线</button>
            <button type="button" class="mini" data-act="del" data-code="${w.code}">删除</button>
          </td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="5">暂无自选，先加入代码</td></tr>`;
}

function renderPositions(positions) {
  const hash = stableHash(
    positions.map((p) => [p.code, p.qty, p.last, p.pnl, p.name])
  );
  if (hash === state.lastPosHash) return;
  state.lastPosHash = hash;
  $("posBody").innerHTML =
    positions
      .map((p) => {
        const chg = clsChg(p.pnl);
        return `<tr>
          <td>${p.code}</td><td>${p.name}</td><td>${p.qty}</td>
          <td>${money(p.cost)}</td>
          <td class="${chg}">${money(p.last)}</td>
          <td>${money(p.market_value)}</td>
          <td class="${chg}">${money(p.pnl)} (${Number(p.pnl_pct).toFixed(2)}%)</td>
          <td class="ops">
            <button type="button" class="mini" data-pos="pick" data-code="${p.code}">交易</button>
            <button type="button" class="mini" data-pos="chart" data-code="${p.code}">K线</button>
            <button type="button" class="mini" data-pos="watch" data-code="${p.code}">自选</button>
          </td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="8">暂无持仓</td></tr>`;
}

function renderOrders(orders) {
  const hash = stableHash(orders.map((o) => o.id));
  if (hash === state.lastOrdHash) return;
  state.lastOrdHash = hash;
  $("ordBody").innerHTML =
    orders
      .map(
        (o) => `<tr>
      <td>${o.created_at}</td>
      <td>${o.side === "buy" ? "买" : "卖"}</td>
      <td>${o.code}</td><td>${o.name}</td>
      <td>${o.qty}</td><td>${money(o.price)}</td><td>${money(o.amount)}</td>
      <td>${o.note || o.source || ""}</td>
    </tr>`
      )
      .join("") || `<tr><td colspan="8">暂无成交</td></tr>`;
}

function applyDashboard(data) {
  if (data.short_id) {
    const el = $("userShortId");
    if (el) el.textContent = data.short_id;
    const helpId = $("helpShortId");
    if (helpId) helpId.textContent = data.short_id;
  }
  $("cash").textContent = money(data.cash);
  $("mv").textContent = money(data.market_value);
  $("equity").textContent = money(data.equity);
  renderWatchlist(data.watchlist || []);
  renderPositions(data.positions || []);
  renderOrders(data.orders || []);
  if (data.focus) applyQuoteToForm(data.focus);
}

async function tick() {
  if (state.tickInFlight) return;
  state.tickInFlight = true;
  const now = new Date();
  $("tickClock").textContent = now.toLocaleTimeString("zh-CN", { hour12: false });
  try {
    const focus = currentFormCode();
    const qs = focus ? `?focus=${encodeURIComponent(focus)}` : "";
    const data = await api("/api/dashboard" + qs);
    const hash = stableHash({
      cash: data.cash,
      mv: data.market_value,
      eq: data.equity,
      focus: data.focus && [data.focus.code, data.focus.price, data.focus.change_pct],
      pos: (data.positions || []).map((p) => [p.code, p.last, p.pnl]),
      watch: (data.watchlist || []).map((w) => [w.code, w.price, w.change_pct]),
      ord: (data.orders || []).map((o) => o.id),
    });
    if (hash !== state.lastDashHash) {
      state.lastDashHash = hash;
      applyDashboard(data);
    } else if (data.focus) {
      applyQuoteToForm(data.focus);
    }
  } catch (e) {
    console.warn(e);
  } finally {
    state.tickInFlight = false;
  }
}

async function quickBuy(code) {
  const qty = Number($("qtyInput").value || 10);
  selectCode(code, { loadChart: false });
  const body = {
    code: normalizeCodeInput(code),
    side: "buy",
    qty,
    price: state.marketMode ? null : Number($("priceInput").value) || null,
  };
  const r = await api("/api/order", { method: "POST", body: JSON.stringify(body) });
  $("msg").textContent = `快买成交 #${r.order_id} ${r.code} ${r.name} ${r.qty}@${r.price}`;
  state.lastDashHash = "";
  state.lastPosHash = "";
  state.lastOrdHash = "";
  await tick();
}

$("marketChk").addEventListener("change", (e) => {
  setMarketMode(e.target.checked);
});

$("codeInput").addEventListener("input", () => {
  clearTimeout(state.codeDebounce);
  const c = currentFormCode();
  if (c.length < 6) return;
  if (state.lastQuote && state.lastQuote.code === c) return;
  showQuoteLoading(c);
  state.codeDebounce = setTimeout(() => {
    // 输入切换时加载行情；K线稍后再加载，减轻卡顿
    selectCode(c, { loadChart: false });
    state.codeDebounce = setTimeout(() => {
      if (currentFormCode() === c) {
        loadKline(c, state.period).catch(() => {});
      }
    }, 400);
  }, 200);
});

$("codeInput").addEventListener("change", () => {
  selectCode($("codeInput").value.trim(), { loadChart: true });
});
$("codeInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    selectCode($("codeInput").value.trim(), { loadChart: true });
  }
});

$("orderForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = currentFormCode();
  if (!code) {
    $("msg").textContent = "请输入有效 6 位代码";
    return;
  }
  const body = {
    code,
    side: $("sideInput").value,
    qty: Number($("qtyInput").value),
    price: state.marketMode ? null : Number($("priceInput").value) || null,
  };
  try {
    if (state.marketMode) await refreshQuote(code);
    const r = await api("/api/order", { method: "POST", body: JSON.stringify(body) });
    $("msg").textContent = `成交 #${r.order_id} ${r.side} ${r.code} ${r.name} ${r.qty}@${r.price} 来源:${r.quote_source}${r.note ? " | " + r.note : ""}`;
    state.lastDashHash = "";
    state.lastPosHash = "";
    state.lastOrdHash = "";
    await tick();
    refreshPerformance().catch(() => {});
  } catch (err) {
    $("msg").textContent = "下单失败: " + err.message;
  }
});

$("quoteBtn").addEventListener("click", async () => {
  try {
    const q = await refreshQuote(currentFormCode());
    if (!q) throw new Error("行情为空");
    $("msg").textContent = `${q.market}${q.code} ${q.name} 现价 ${q.price} 涨跌 ${q.change_pct}%`;
  } catch (err) {
    $("msg").textContent = "行情失败: " + err.message;
  }
});

$("loadChartBtn").addEventListener("click", async () => {
  try {
    await loadKline($("codeInput").value.trim(), state.period);
  } catch (err) {
    $("msg").textContent = "K线失败: " + err.message;
  }
});

$("periodTabs").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-period]");
  if (!btn) return;
  try {
    await loadKline(state.chartCode || $("codeInput").value.trim(), btn.dataset.period);
  } catch (err) {
    $("msg").textContent = "K线失败: " + err.message;
  }
});

$("watchAddBtn").addEventListener("click", async () => {
  const code = ($("watchCode").value || $("codeInput").value || "").trim();
  if (!code) return;
  try {
    await api("/api/watchlist", { method: "POST", body: JSON.stringify({ code }) });
    $("watchCode").value = "";
    $("msg").textContent = `已加入自选 ${code}`;
    state.lastWatchHash = "";
    state.lastDashHash = "";
    await tick();
  } catch (err) {
    $("msg").textContent = "加入自选失败: " + err.message;
  }
});

$("addWatchFromOrder").addEventListener("click", async () => {
  const code = $("codeInput").value.trim();
  try {
    await api("/api/watchlist", { method: "POST", body: JSON.stringify({ code }) });
    $("msg").textContent = `已加入自选 ${code}`;
    state.lastWatchHash = "";
    state.lastDashHash = "";
    await tick();
  } catch (err) {
    $("msg").textContent = "加入自选失败: " + err.message;
  }
});

$("watchBody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const code = btn.dataset.code;
  const act = btn.dataset.act;
  try {
    if (act === "pick" || act === "chart") selectCode(code, { loadChart: true });
    if (act === "buy") await quickBuy(code);
    if (act === "del") {
      await api("/api/watchlist/" + encodeURIComponent(code), { method: "DELETE" });
      state.lastWatchHash = "";
      state.lastDashHash = "";
      await tick();
    }
  } catch (err) {
    $("msg").textContent = err.message;
  }
});

$("posBody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-pos]");
  if (!btn) return;
  const code = btn.dataset.code;
  try {
    if (btn.dataset.pos === "pick" || btn.dataset.pos === "chart") {
      selectCode(code, { loadChart: true });
    }
    if (btn.dataset.pos === "watch") {
      await api("/api/watchlist", { method: "POST", body: JSON.stringify({ code }) });
      state.lastWatchHash = "";
      state.lastDashHash = "";
      await tick();
    }
  } catch (err) {
    $("msg").textContent = err.message;
  }
});

function openHelpModal() {
  const modal = $("helpModal");
  if (!modal) return;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeHelpModal() {
  const modal = $("helpModal");
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = "";
}

function todayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function maybeAutoOpenHelpOncePerDay() {
  const key = "paper_help_shown_date";
  const today = todayKey();
  try {
    if (localStorage.getItem(key) === today) return;
    localStorage.setItem(key, today);
  } catch (_) {
    // ignore storage failures
  }
  // 稍延后，避免与首屏渲染抢焦点
  setTimeout(openHelpModal, 350);
}

let tradeStarted = false;
let tickTimer = null;

function enterTradeScreen() {
  const welcome = $("screen-welcome");
  const trade = $("screen-trade");
  if (welcome) welcome.hidden = true;
  if (trade) trade.hidden = false;
  document.body.classList.remove("on-welcome");
  document.body.classList.add("on-trade");
  closeHelpModal();

  if (!tradeStarted) {
    tradeStarted = true;
    setMarketMode(true);
    selectCode(($("codeInput") && $("codeInput").value) || "113052", { loadChart: true });
    tick();
    tickTimer = setInterval(tick, 2000);
    api("/api/me")
      .then((me) => {
        if ($("userShortId")) $("userShortId").textContent = me.short_id;
        if ($("helpShortId")) $("helpShortId").textContent = me.short_id;
      })
      .catch(() => {});
    // 默认跑一次选股与绩效
    setTimeout(() => {
      runScreener().catch(() => {});
      refreshPerformance().catch(() => {});
    }, 400);
  } else {
    refreshPerformance().catch(() => {});
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function backToWelcomeScreen() {
  const welcome = $("screen-welcome");
  const trade = $("screen-trade");
  if (trade) trade.hidden = true;
  if (welcome) welcome.hidden = false;
  document.body.classList.add("on-welcome");
  document.body.classList.remove("on-trade");
  closeHelpModal();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

["helpOpenBtn", "helpOpenBtn2", "helpOpenBtn3", "footerHelp"].forEach((id) => {
  const el = $(id);
  if (el) el.addEventListener("click", openHelpModal);
});
["helpCloseBtn", "helpGotIt"].forEach((id) => {
  const el = $(id);
  if (el) el.addEventListener("click", closeHelpModal);
});
const helpModal = $("helpModal");
if (helpModal) {
  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) closeHelpModal();
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeHelpModal();
});

const startBtn = $("startTradeBtn");
if (startBtn) startBtn.addEventListener("click", enterTradeScreen);

const screenerForm = $("screenerForm");
if (screenerForm) screenerForm.addEventListener("submit", runScreener);

const screenerBody = $("screenerBody");
if (screenerBody) {
  screenerBody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-sc]");
    if (!btn) return;
    const code = btn.dataset.code;
    try {
      if (btn.dataset.sc === "pick" || btn.dataset.sc === "chart") {
        selectCode(code, { loadChart: true });
        document.getElementById("trade")?.scrollIntoView({ behavior: "smooth" });
      }
      if (btn.dataset.sc === "watch") {
        await api("/api/watchlist", { method: "POST", body: JSON.stringify({ code }) });
        state.lastWatchHash = "";
        state.lastDashHash = "";
        await tick();
        $("screenerMsg").textContent = `已加入自选 ${code}`;
      }
    } catch (err) {
      $("screenerMsg").textContent = err.message;
    }
  });
}

const indicatorBar = $("indicatorBar");
if (indicatorBar) {
  indicatorBar.addEventListener("change", (e) => {
    const input = e.target.closest("input[data-ind]");
    if (!input) return;
    state.indicators[input.dataset.ind] = input.checked;
    if (state.chartCode) {
      loadKline(state.chartCode, state.period).catch((err) => {
        $("msg").textContent = "指标加载失败: " + err.message;
      });
    }
  });
}

const perfBtn = $("perfRefreshBtn");
if (perfBtn) perfBtn.addEventListener("click", () => refreshPerformance());

["backWelcomeBtn", "footerHome"].forEach((id) => {
  const el = $(id);
  if (el) el.addEventListener("click", backToWelcomeScreen);
});

const footerNew = $("footerNewAcc");
if (footerNew) {
  footerNew.addEventListener("click", () => {
    const btn = $("newAccountBtn");
    if (btn) btn.click();
  });
}

$("resetBtn").addEventListener("click", async () => {
  if (!confirm("确认重置当前账户？持仓与成交将清空（自选保留）。")) return;
  await api("/api/reset", { method: "POST", body: "{}" });
  $("msg").textContent = "账户已重置";
  state.lastDashHash = "";
  state.lastPosHash = "";
  state.lastOrdHash = "";
  await tick();
});

const newAccBtn = $("newAccountBtn");
if (newAccBtn) {
  newAccBtn.addEventListener("click", async () => {
    if (!confirm("将开一个全新模拟账户（100万虚拟资金），当前浏览器会切换过去。继续？")) {
      return;
    }
    try {
      const me = await api("/api/me/new", { method: "POST", body: "{}" });
      state.lastDashHash = "";
      state.lastPosHash = "";
      state.lastOrdHash = "";
      state.lastWatchHash = "";
      $("msg").textContent = `已切换到新账户 ${me.short_id}`;
      if ($("userShortId")) $("userShortId").textContent = me.short_id;
      if ($("helpShortId")) $("helpShortId").textContent = me.short_id;
      await tick();
    } catch (err) {
      $("msg").textContent = "开户失败: " + err.message;
    }
  });
}

// 默认停在第一屏；当日首次打开自动弹出账户说明
maybeAutoOpenHelpOncePerDay();
// 轻量拉取短号供说明弹窗展示（不进入交易、不轮询行情）
api("/api/me")
  .then((me) => {
    if ($("helpShortId")) $("helpShortId").textContent = me.short_id;
  })
  .catch(() => {});
