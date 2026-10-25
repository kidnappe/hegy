// 用真实应用链路导出离线 HTML（2D + 3D），供移动端呈现对比
// 用法: node export_snapshot.js <tag>
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9402;
const APP = process.env.APP_URL || "http://127.0.0.1:8099/solver/index.html";
const OUT = path.join(__dirname, "exports");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const tag = process.argv[2] || "before";

const profile = path.join(require("os").tmpdir(), "edge-diag-export");
const proc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + profile,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json(); break; } catch (e) { await sleep(250); } }
  if (!ver) throw new Error("no devtools");
  const t = await (await fetch("http://127.0.0.1:" + PORT + "/json/new?" + encodeURIComponent(APP), { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  await new Promise((r) => ws.addEventListener("open", r));
  const send = (method, params) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evalIn = async (expr, ms = 30000) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const until = async (expr, ms, step) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await evalIn(expr).catch(() => false); if (v) return v; await sleep(step || 400); } return false; };

  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 860, deviceScaleFactor: 1, mobile: false });
  await send("Page.reload");
  await sleep(2500);

  // 配置 mock 模型
  await evalIn(`localStorage.setItem('solver_cfg_v1', JSON.stringify({baseUrl:'http://127.0.0.1:8098/v1',apiKey:'mock',model:'mock',temperature:0.2}));1`);
  await evalIn(`fetch('/api/cfg',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:{baseUrl:'http://127.0.0.1:8098/v1',apiKey:'mock',model:'mock',temperature:0.2}})}).then(r=>r.json()).then(j=>!!j.ok)`).catch(() => 0);
  const ready = "!!(window.JXG&&window.HexMath&&document.getElementById('go'))";
  await until("(" + ready + ")", 30000);

  // 拦截下载
  await evalIn("window.__exp=null;(function(){var _c=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__exp=this.href;};return 1;})()");

  async function solveAndExport(q, name) {
    await evalIn(`(function(){var a=document.getElementById('q');a.value=${JSON.stringify(q)};document.getElementById('go').click();return 1;})()`);
    const ok = await until("!!(document.querySelector('#answer .katex')||document.querySelector('#answer').textContent.trim().length>4)", 90000);
    if (!ok) throw new Error("solve timeout: " + name);
    await sleep(2500);
    await evalIn("window.__exp=null;1");
    await evalIn("document.getElementById('btnHtml').click();1");
    const got = await until("!!(window.__exp&&window.__exp.indexOf('blob:')===0)", 90000, 500);
    if (!got) throw new Error("export timeout: " + name);
    const html = await evalIn("fetch(window.__exp).then(r=>r.text())", 60000);
    const file = path.join(OUT, tag + "_" + name + ".html");
    fs.writeFileSync(file, html);
    console.log("saved", file, html.length, "bytes");
    return file;
  }

  await solveAndExport("如图，AD 平分∠BAC，求∠DFE。", "2d");
  await sleep(500);
  await solveAndExport("正方体中，求体对角线 AC1 的长度。", "3d");

  try { await fetch("http://127.0.0.1:" + PORT + "/json/close/" + t.id); } catch (e) {}
  proc.kill(); process.exit(0);
}
main().catch((e) => { console.log("FATAL", e.message); try { proc.kill(); } catch (x) {} process.exit(1); });
