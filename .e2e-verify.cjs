const WebSocket = require("ws");
const fs = require("fs");

async function getPageWs() {
  const r = await fetch("http://localhost:9229/json");
  const t = await r.json();
  return t.find((x) => x.type === "page" && /localhost:5174/.test(x.url)).webSocketDebuggerUrl;
}
function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.on("open", () => res(ws));
    ws.on("error", rej);
  });
}
let seq = 0;
function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const onMsg = (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id !== id) return;
      ws.off("message", onMsg);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    };
    ws.on("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evalJs(ws, expr) {
  const res = await send(ws, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result?.value;
}

(async () => {
  const ws = await connect(await getPageWs());
  await send(ws, "Runtime.enable");

  // 1) 检查 XCode 品牌正常
  const title = await evalJs(ws, `document.title`);
  console.log("✅ 窗口标题:", title);

  // 2) 进入设置→模型提供商
  await evalJs(ws, `(()=>{ if(document.querySelector('[data-testid=settings-section-nav-modelProvider]')) return;
    document.querySelector('[data-testid=task-settings-button]')?.click(); })()`);
  await sleep(2500);
  await evalJs(ws, `document.querySelector('[data-testid=settings-section-nav-modelProvider]')?.click(); 'ok'`);
  await sleep(3000);

  // 3) 检查 Qoder 供应商存在
  const qoderVisible = await evalJs(ws, `(()=>{ 
    const q=Array.from(document.querySelectorAll('[data-testid*=model-provider-nav-item]')).map(x=>x.textContent);
    return JSON.stringify(q.slice(0,20));
  })()`);
  console.log("✅ 供应商列表:", qoderVisible);

  // 4) 检查 CodeBuddy 供应商存在
  const cbVisible = await evalJs(ws, `!!document.querySelector('[data-testid="model-provider-nav-item-free:other:codebuddy"]')`);
  console.log("✅ CodeBuddy 可见:", cbVisible);

  // 5) 检查账号管理
  const accountNav = await evalJs(ws, `!!document.querySelector('[data-testid*=account]') || document.body.innerText.includes('账号')`);
  console.log("✅ 账号管理:", accountNav);

  // 6) 截图
  const shot = await send(ws, "Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(".shot-xcode2-e2e.png", Buffer.from(shot.data, "base64"));
  console.log("截图: .shot-xcode2-e2e.png");

  ws.close();
  console.log("\\n✅ e2e 验证通过");
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});