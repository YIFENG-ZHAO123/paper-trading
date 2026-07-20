# 模拟盘交易网（HTML 网站）

这是一个在浏览器里打开的模拟交易网站，不是桌面软件。

## 一键启动

双击：

`C:\Users\36128\paper-trading\启动网站.bat`

会自动启动服务并打开浏览器页面：

**http://127.0.0.1:8765**

## 网站功能

- 两屏：欢迎说明 → 开始交易
- 独立模拟账户（Cookie）
- 条件选股（A股/可转债）
- K 线 + MA / BOLL / MACD / RSI
- 账户绩效（收益、回撤、胜率、权益曲线）
- 自选、市价下单、持仓盈亏刷新

## 手动启动

```powershell
cd C:\Users\36128\paper-trading
python -m app.main
```

然后浏览器访问 http://127.0.0.1:8765

## 说明

- 前端：`static/index.html`（网站页面）
- 后端：`app/`（行情与模拟撮合 API）
- 仅供学习演示，非真实券商交易

## 上线注意

**不要用 Netlify**（会 Page not Found）。本项目需要 Python 服务，请看 `部署说明.md`，推荐 Render / Railway。
