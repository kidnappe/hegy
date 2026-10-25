// 在模拟器的 WebView 里按 CSS 坐标点一下（走 CDP Input，生成真实的 pointer 事件）。
// 用法：node tools/emu-tap.mjs X Y
const x = Number(process.argv[2]);
const y = Number(process.argv[3]);
if (!isFinite(x) || !isFinite(y)) { console.error("用法: node tools/emu-tap.mjs X Y"); process.exit(1); }

const list = await (await fetch("http://127.0.0.1:9333/json/list")).json();
const target = list.find((t) => t.type === "page") || list[0];
if (!target) { console.error("没有可调试的页面"); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener("open", r));
function send(method, params) {
  return new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
console.log(JSON.stringify({ tap: { x, y } }));
ws.close();
process.exit(0);
