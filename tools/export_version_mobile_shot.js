// 多版本导出页验收：指定视口打开导出 HTML，量布局、切版本、出截图
// 用法：node tools/export_version_mobile_shot.js <绝对路径.html> <tag> [宽] [高] [起点版本v1|v2...]
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9436;
const OUT = path.join(__dirname, "mobile_shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const file = process.argv[2];
const tag = process.argv[3] || "s56";
const W = Number(process.argv[4] || 402);
const H = Number(process.argv[5] || 874);
if (!file) { console.error("need html path"); process.exit(2); }

const profile = path.join(os.tmpdir(), "edge-diag-s56-mobile");
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
  const evalIn = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const until = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await evalIn(expr).catch(() => false); if (v) return v; await sleep(300); } return false; };

  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: W <= 500 });
  if (W <= 500) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Page.reload", {});
  await until('!!(document.getElementById("expVerTabs") && document.querySelector("#expVerTabs button"))', 20000);
  await sleep(2500);

  const metrics = () => evalIn(`(function(){
    function box(sel){var e=document.querySelector(sel);if(!e)return null;var r=e.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top),left:Math.round(r.left)};}
    function shown(sel){var e=document.querySelector(sel);if(!e)return null;var cs=getComputedStyle(e);return cs.display==='none'?false:true;}
    var doc=document.documentElement;
    var vers=[].map.call(document.querySelectorAll('#expVerTabs button'),function(b){return b.textContent});
    var subs=[].map.call(document.querySelectorAll('#expSubTabs button'),function(b){return b.textContent});
    var steps=[].map.call(document.querySelectorAll('#expSteps button'),function(b){return b.textContent});
    var ctrls=[].map.call(document.querySelectorAll('#expCtrls label'),function(l){return l.textContent});
    var api=window.GGB3D&&GGB3D.getApi?GGB3D.getApi():null;
    return {
      viewport:{w:innerWidth,h:innerHeight,dpr:devicePixelRatio},
      horizontalOverflow:doc.scrollWidth>doc.clientWidth+1,
      docScrollW:doc.scrollWidth,docClientW:doc.clientWidth,scrollH:doc.scrollHeight,
      stage:box('#stage'),side:box('.side'),
      verTabs:box('#expVerTabs'),subTabs:box('#expSubTabs'),
      stepsBox:box('#expSteps'),ctrlsBox:box('#expCtrls'),
      verActive:(document.querySelector('#expVerTabs .on')||{}).textContent||'',
      vers:vers,subs:subs,steps:steps.slice(0,8),ctrls:ctrls,
      stepsDisplay:shown('#expSteps'),ctrlsDisplay:shown('#expCtrls'),
      hasBoard:!!(window.board&&window.board.objects&&Object.keys(window.board.objects).length),
      has3d:!!(api&&api.byId),
      canvases:document.querySelectorAll('canvas').length,
      currentVid:(window.HJ_REC||{}).currentVid
    };
  })()`);

  const shot = async (name) => {
    const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, tag + "_" + name + ".png"), Buffer.from(s.result.data, "base64"));
  };
  const fullShot = async (name, h) => {
    const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: W, height: Math.min(h || H, 6000), scale: 1 } });
    fs.writeFileSync(path.join(OUT, tag + "_" + name + "_full.png"), Buffer.from(s.result.data, "base64"));
  };

  const m0 = await metrics();
  console.log("INITIAL " + JSON.stringify(m0));
  await shot("initial");

  for (const v of m0.vers) {
    await evalIn(`(function(){var bs=[].slice.call(document.querySelectorAll('#expVerTabs button'));var b=bs.filter(function(x){return x.textContent===${JSON.stringify(v)}})[0];if(b)b.click();return 1})()`);
    await sleep(2000);
    console.log("AFTER " + v + " " + JSON.stringify(await metrics()));
    await shot(v);
  }

  const h = (await metrics()).scrollH;
  await fullShot("all", h);
  console.log("saved to " + OUT);
  try { await fetch("http://127.0.0.1:" + PORT + "/json/close/" + t.id); } catch (e) {}
  proc.kill();
  process.exit(0);
}
main().catch((e) => { console.log("FATAL", e.stack || e.message); try { proc.kill(); } catch (x) {} process.exit(1); });
