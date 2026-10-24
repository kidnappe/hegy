// 无头 Edge 实测：把「何解」导出的 HTML 拖进应用 → 还原成历史记录（含 3D 渲染自检）
// 用法: node import_drop_test.js <导出html1> [导出html2 ...]
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9403;
const APP = "http://127.0.0.1:8099/solver/index.html";
const API = "http://127.0.0.1:8099";
const SOLVER = path.join(__dirname, "..", "solver");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonOnPage(src, name) {
  const key = "var " + name + "=", i = src.indexOf(key);
  if (i < 0) return null;
  const j = i + key.length;
  let raw = null;
  if (src[j] === '"') {
    let esc = false;
    for (let k = j + 1; k < src.length; k++) {
      const c = src[k];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { raw = src.slice(j, k + 1); break; }
    }
  } else if (src[j] === "{" || src[j] === "[") {
    let depth = 0, inStr = false, esc2 = false;
    for (let k = j; k < src.length; k++) {
      const c = src[k];
      if (inStr) {
        if (esc2) { esc2 = false; continue; }
        if (c === "\\") { esc2 = true; continue; }
        if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") { depth--; if (!depth) { raw = src.slice(j, k + 1); break; } }
    }
  }
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
const api = async (p) => (await (await fetch(API + p)).json());
function footTs(txt) {
  const m = txt.match(/<p class="foot">([\s\S]*?)<\/p>/);
  if (!m) return 0;
  const d = m[1].replace(/<[^>]+>/g, "").match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/);
  if (!d) return 0;
  return new Date(+d[1], +d[2] - 1, +d[3], +d[4], +d[5], +d[6]).getTime();
}

async function main() {
  const copies = [];
  process.argv.slice(2).forEach((src, i) => {
    const isJson = /\.json$/i.test(src);
    const name = "_drop_test_" + i + (isJson ? ".json" : ".html");
    fs.copyFileSync(src, path.join(SOLVER, name));
    const txt = fs.readFileSync(src, "utf8");
    const hj = isJson ? null : jsonOnPage(txt, "HJ_REC");
    let expectId = hj && hj.id ? hj.id : null;
    let expectTs = isJson ? 0 : footTs(txt);
    let expectQ = hj ? String(hj.question || "") : "";
    if (isJson) {
      // 记录文件：普通 JSON / 备份包 / JSONL（第1行 meta + 第2行 body）
      let rec = null;
      try { rec = JSON.parse(txt); } catch (e) {
        const lines = txt.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length >= 2) { try { rec = Object.assign({}, JSON.parse(lines[1]), { id: JSON.parse(lines[0]).id, ts: JSON.parse(lines[0]).ts }); } catch (e2) {} }
      }
      if (Array.isArray(rec)) rec = rec[0];
      if (rec && rec.records) rec = rec.records[0];
      if (rec) { expectId = rec.id || null; expectTs = rec.ts || 0; expectQ = String(rec.question || ""); }
    }
    copies.push({ name, src, isJson, expectId, expectTs, expectQ, newFmt: !!hj });
  });

  const profile = path.join(require("os").tmpdir(), "edge-diag-drop");
  const proc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + profile,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });

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
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, timeout: ms });
    if (r.result && r.result.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.result.exceptionDetails.exception));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const until = async (expr, ms, step) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await evalIn(expr).catch(() => false); if (v) return v; await sleep(step || 400); } return false; };

  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 860, deviceScaleFactor: 1, mobile: false });
  await send("Page.reload");
  if (!await until("!!(window.mathHTML&&document.getElementById('go'))", 30000)) throw new Error("app not ready");

  const idx0 = (await api("/api/store/index")).items.map((x) => x.id);
  console.log("导入前记录数:", idx0.length);

  let lastId = null;
  for (let i = 0; i < copies.length; i++) {
    const c = copies[i];
    const before = lastId ? await api("/api/store/index") : null;
    const n = await evalIn(`(async function(){
      var txt = await (await fetch('/solver/${c.name}')).text();
      var dt = new DataTransfer();
      dt.items.add(new File([txt], ${JSON.stringify(c.isJson ? "record.json" : "exported.html")}, { type: ${JSON.stringify(c.isJson ? "application/json" : "text/html")} }));
      document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return txt.length;
    })()`, 30000);
    // 等最终回执 toast（已导入 X 条记录）
    const done = await until(`(function(){var h=document.getElementById('toastHost');if(!h)return '';var a=h.querySelectorAll('.toast');for(var i=a.length-1;i>=0;i--){var s=a[i].textContent.trim();if(s.indexOf('已导入')>=0)return s;}return '';})()`, 20000, 300);
    console.log(`[${i}] ${path.basename(c.src)} (${n} bytes) → toast: ${done || "(未见已导入回执)"}`);
    await sleep(1500); // 等自动打开动作尘埃落定

    // 确定受影响记录 id：新格式用文件里的 id；旧格式（无 id）按页脚时间戳匹配
    let rid = c.expectId;
    let idsNow = (await api("/api/store/index")).items;
    if (!rid && c.expectTs) rid = (idsNow.filter((x) => x.ts === c.expectTs && String(x.model).indexOf("导入") >= 0)[0] || {}).id || null;
    if (!rid) {
      const ids = idsNow.map((x) => x.id);
      rid = ids.filter((x) => idx0.indexOf(x) < 0 && (!before || (before.items || []).map((y) => y.id).indexOf(x) < 0))[0] || null;
    }
    if (!rid) { console.log("   !! 找不到导入的记录"); continue; }
    lastId = rid;
    const meta = (await api("/api/store/index")).items.filter((x) => x.id === rid)[0] || {};
    const rec = await api("/api/store/record/" + encodeURIComponent(rid));
    console.log("   记录:", JSON.stringify({ id: rid, q: (meta.question || "").slice(0, 30), model: meta.model, has3d: meta.has3d, hasCode: meta.hasCode }));
    console.log("   正文:", JSON.stringify({
      ans: (rec.answer || "").slice(0, 40), ana: (rec.analysis || "").slice(0, 55),
      sceneKeys: rec.render3d ? Object.keys(rec.render3d).length : 0,
      steps: rec.render3d && rec.render3d.steps ? rec.render3d.steps.length : 0,
      codeLen: (rec.renderCode || "").length, images: (rec.images || []).length, imported: !!rec.imported
    }));
    // 渲染自检：点开这条历史记录，图必须出来、解析内容正确
    const matchQ = c.expectQ ? c.expectQ : "(空)";
    const clicked = await evalIn(`(function(){
      var items=document.querySelectorAll('#histList .hist-item');
      for(var i=0;i<items.length;i++){
        var q=items[i].querySelector('.qtext');
        if(q&&q.textContent===${JSON.stringify(matchQ)}){items[i].click();return q.textContent;}
      }
      return null;
    })()`);
    if (clicked != null) {
      await sleep(1600);
      const view = await evalIn(`(function(){
        var g=document.getElementById('g3d'), cv=g?g.querySelector('canvas'):null;
        var gc=document.getElementById('ggb-canvas');
        var st=(document.getElementById('status')||{}).textContent||'';
        var an=(document.getElementById('analysis')||{}).textContent||'';
        return { g3d: g?g.style.display!=='none':null, canvas: !!cv, canvasW: cv?cv.width:0,
          board: !!window.board, ggbKids: gc?gc.children.length:-1,
          status: st.slice(0,60), anaHead: an.slice(0,42) };
      })()`);
      console.log("   打开记录:", JSON.stringify(clicked), "→", JSON.stringify(view));
    }
  }

  try { await fetch("http://127.0.0.1:" + PORT + "/json/close/" + t.id); } catch (e) {}
  proc.kill();
  copies.forEach((c) => { try { fs.unlinkSync(path.join(SOLVER, c.name)); } catch (e) {} });
  console.log("DONE");
  process.exit(0);
}
main().catch((e) => { console.log("FATAL", e.message); try { process.exit(1); } catch (x) {} });
