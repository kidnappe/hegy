// 在模拟器里的 WebView 上执行一段 JS（走 adb forward + CDP）。
// 前置：adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
// 用法：node tools/emu-eval.mjs "JSON.stringify(location.href)"
const expr = process.argv[2] || "JSON.stringify(location.href)";
const list = await (await fetch("http://127.0.0.1:9333/json/list")).json();
const target = list.find((t) => t.type === "page") || list[0];
if (!target) { console.error("没有可调试的页面"); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
const out = await new Promise((resolve, reject) => {
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) resolve(m); };
  ws.onerror = reject;
  setTimeout(() => reject(new Error("timeout")), 60000);
});
ws.close();
const r = out.result;
if (r && r.exceptionDetails) { console.error("EXCEPTION:", JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails)); process.exit(2); }
console.log(typeof r?.result?.value === "string" ? r.result.value : JSON.stringify(r?.result?.value ?? out, null, 2));
process.exit(0);
