// 移动端导出 HTML 呈现诊断：在 402x874（iPhone 尺寸）下渲染导出页，出图 + 结构度量
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9401;
const OUT = path.join(__dirname, "mobile_shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const file = process.argv[2];
const tag = process.argv[3] || "before";
const W = Number(process.argv[4] || 402);
const H = Number(process.argv[5] || 874);

const profile = path.join(require("os").tmpdir(), "edge-diag-mobile");
const proc = spawn(EDGE, [
  "--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + profile,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { ver = await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json(); break; } catch (e) { await sleep(250); }
  }
  if (!ver) throw new Error("no devtools");
  const t = await (await fetch("http://127.0.0.1:" + PORT + "/json/new?" + encodeURIComponent("file:///" + file.replace(/\\/g, "/")), { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  await new Promise((r) => ws.addEventListener("open", r));
  const send = (method, params) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evalIn = async (expr, ms = 20000) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return "ERR:" + JSON.stringify(r.result.exceptionDetails.text || "");
    return r.result && r.result.result ? r.result.result.value : null;
  };
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Page.reload", {});
  await sleep(3500);

  const metrics = await evalIn(`(function(){
    function box(sel){var e=document.querySelector(sel);if(!e)return null;var r=e.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top),left:Math.round(r.left)};}
    var doc=document.documentElement;
    var sw=document.querySelector('.sw'), side=document.querySelector('.side');
    var kat=[].slice.call(document.querySelectorAll('.katex')).slice(0,6).map(function(k){var r=k.getBoundingClientRect();return Math.round(r.width);});
    var wide=[].slice.call(document.querySelectorAll('.side *')).filter(function(el){return el.scrollWidth>el.clientWidth+2;}).slice(0,6).map(function(el){return el.className+'|'+el.scrollWidth+'/'+el.clientWidth;});
    return {
      viewport:{w:innerWidth,h:innerHeight,dpr:devicePixelRatio},
      docScrollW:doc.scrollWidth, docClientW:doc.clientWidth, horizontalOverflow:doc.scrollWidth>doc.clientWidth+1,
      scrollH:doc.scrollHeight,
      stage:box('#stage'), sw:box('.sw'), side:box('.side'),
      sideScroll:{h:side?side.scrollHeight:0, ch:side?side.clientHeight:0},
      katexWidths:kat, overflowingKids:wide,
      ansChars:(document.querySelector('.ans')||{}).textContent?document.querySelector('.ans').textContent.length:0,
      anaChars:(document.querySelector('.ana')||{}).textContent?document.querySelector('.ana').textContent.length:0,
      canvases:document.querySelectorAll('canvas').length
    };
  })()`);
  console.log(JSON.stringify(metrics, null, 2));

  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, tag + "_viewport.png"), Buffer.from(shot.result.data, "base64"));

  // 整页（含下方解析）
  const full = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: W, height: Math.min(metrics.scrollH || H, 6000), scale: 1 } });
  fs.writeFileSync(path.join(OUT, tag + "_full.png"), Buffer.from(full.result.data, "base64"));

  // 滚到解析下部，看长公式换行
  await evalIn("(document.querySelector('.side')||window).scrollTop=0;(function(){var s=document.querySelector('.side');if(s)s.scrollTop=520;window.scrollTo(0,520);return 1;})()");
  await sleep(400);
  const shot2 = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, tag + "_scroll.png"), Buffer.from(shot2.result.data, "base64"));
  console.log("saved to " + OUT);
  try { await fetch("http://127.0.0.1:" + PORT + "/json/close/" + t.id); } catch (e) {}
  proc.kill();
  process.exit(0);
}
main().catch((e) => { console.log("FATAL", e.message); try { proc.kill(); } catch (x) {} process.exit(1); });
