// 把一条记录种子进模拟器里的 App 存储（验收 2D 等场景用）。
// 用法：node tools/emu-seed-record.mjs ../../.tmp/rec2d.json
import fs from "fs";
const file = process.argv[2];
if (!file) { console.error("用法: node tools/emu-seed-record.mjs <record.json>"); process.exit(1); }
const rec = JSON.parse(fs.readFileSync(file, "utf8"));

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
const expr = `fetch('/api/store/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify({ record: rec, thumb: null })})}).then(r=>r.json()).then(j=>JSON.stringify(j))`;
const out = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
const r = out.result;
if (r && r.exceptionDetails) { console.error("EXCEPTION", r.exceptionDetails); process.exit(2); }
console.log(typeof r?.result?.value === "string" ? r.result.value : JSON.stringify(r?.result?.value ?? out));
ws.close();
process.exit(0);
