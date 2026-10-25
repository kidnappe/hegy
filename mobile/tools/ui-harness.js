#!/usr/bin/env node
/* =========================================================
   手机端 UI 验证台（ui-harness.js）
   ---------------------------------------------------------
   用 headless Edge + 原始 CDP（不依赖 puppeteer）：
     1. 412×915 / dpr2 打开 8099 的 solver/index.html；
     2. 把 mobile.css 注入成 <style>、mobile-ui.js 整段 eval 进去；
     3. 依次截图 6 个状态 + 1 张 ⋯ 面板；
     4. 断言：无横向溢出 / 主要区块不重叠 / 触控目标 ≥40×40；
     5. 桌面 1366×800：注入前后截图逐字节比对 + 关键元素 rect 比对。

   用法：
     node mobile/tools/ui-harness.js
   产物：mobile/tools/shots/*.png + 终端打印的 JSON 报告
   ========================================================= */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9411;
const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "shots");
const TMP = path.join(ROOT, ".tmp");
const PROFILE = path.join(TMP, "edge-ui-harness-" + Date.now());
const APP = "http://127.0.0.1:8099/solver/index.html";
const MOCK_CFG = { baseUrl: "http://127.0.0.1:8098/v1", apiKey: "mock-key", model: "mock" };

// 可选：HJ_W=360 HJ_H=780 node mobile/tools/ui-harness.js  → 只跑手机流程，文件名带前缀
const W = Number(process.env.HJ_W || 412);
const H = Number(process.env.HJ_H || 915);
const PFX = W === 412 && H === 915 ? "" : "w" + W + "-";
const PHONE_ONLY = !!(process.env.HJ_W || process.env.HJ_H);

const Q2D = "如图，在 Rt△ABC 中，∠C=90°，AC=3，BC=4，D 为 AB 的中点，求 CD 的长。";
const Q3D = "如图，在棱长为 2 的正方体 ABCD-A₁B₁C₁D₁ 中，求异面直线 AC 与 BD₁ 所成角的余弦值。";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
sweepOldProfiles();

/* ---------------- 后端：用 mock 真跑一次解题 ---------------- */
async function solveOnce(question, dim) {
  const res = await fetch("http://127.0.0.1:8099/api/solve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, dim: dim || "", config: MOCK_CFG }),
  });
  const j = await res.json();
  if (!j.taskId) throw new Error("提交失败：" + JSON.stringify(j));
  for (let i = 0; i < 80; i++) {
    await sleep(400);
    const t = await (await fetch("http://127.0.0.1:8099/api/task/" + j.taskId)).json();
    if (t.status === "done") return t.result;
    if (t.status === "error") throw new Error("任务失败：" + (t.message || t.error));
  }
  throw new Error("任务超时");
}

/* ---------------- 极简 CDP 客户端 ---------------- */
class Page {
  constructor(ws, id) { this.ws = ws; this.id = id; this.seq = 0; this.pend = new Map(); }
  static async open(url, w, h, mobile) {
    const t = await (await fetch("http://127.0.0.1:" + PORT + "/json/new?" + encodeURIComponent("about:blank"), { method: "PUT" })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    const page = new Page(ws, t.id);
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && page.pend.has(m.id)) { page.pend.get(m.id)(m); page.pend.delete(m.id); }
    });
    await new Promise((r) => ws.addEventListener("open", r));
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: w, height: h, deviceScaleFactor: 2, mobile: !!mobile,
    });
    if (mobile) await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await page.send("Page.navigate", { url });
    await page.waitReady();
    return page;
  }
  send(method, params) {
    return new Promise((res) => {
      const i = ++this.seq;
      this.pend.set(i, (m) => res(m.result || {}));
      this.ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
  }
  async evalIn(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true, userGesture: true,
    });
    if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result ? r.result.value : null;
  }
  async waitFor(expr, timeout = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await this.evalIn("(function(){try{return !!(" + expr + ")}catch(e){return false}})()")) return true;
      await sleep(150);
    }
    throw new Error("等待超时：" + expr);
  }
  async waitReady() {
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const st = await this.evalIn("document.readyState + '|' + (document.querySelector('.topbar') ? 1 : 0)");
      if (st === "complete|1") break;
      await sleep(150);
    }
    await sleep(600);
  }
  async shot(file) {
    const r = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const buf = Buffer.from(r.data, "base64");
    fs.writeFileSync(path.join(OUT, file), buf);
    return buf;
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

/* ---------------- 注入 ---------------- */
const CSS = fs.readFileSync(path.join(ROOT, "mobile/src/overlay/mobile.css"), "utf8");
const UI = fs.readFileSync(path.join(ROOT, "mobile/src/overlay/mobile-ui.js"), "utf8");

async function injectOverlay(page) {
  await page.evalIn(
    "(function(){var s=document.createElement('style');s.id='hj-mobile-css';" +
    "s.textContent=" + JSON.stringify(CSS) + ";document.head.appendChild(s);return 1;})()"
  );
  await page.evalIn(UI + "\n;'ok'");
  await sleep(400);
}

/* ---------------- 量测 ---------------- */
const PROBE = `(function(){
  var vw = window.innerWidth, vh = window.innerHeight;
  var de = document.documentElement;
  function R(sel){
    var e = document.querySelector(sel); if(!e) return null;
    var r = e.getBoundingClientRect();
    return {sel:sel, x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1),
            right:+r.right.toFixed(1), bottom:+r.bottom.toFixed(1)};
  }
  var blocks = ['.topbar','#inputRow','#stage','#rightPanel','.statusbar'].map(R).filter(Boolean);
  var overlaps = [];
  for (var i=0;i<blocks.length;i++) for (var j=i+1;j<blocks.length;j++){
    var a=blocks[i], b=blocks[j];
    var ox = Math.min(a.right,b.right)-Math.max(a.x,b.x);
    var oy = Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y);
    if (ox > 0.5 && oy > 0.5) overlaps.push({a:a.sel,b:b.sel,ox:+ox.toFixed(1),oy:+oy.toFixed(1)});
  }
  var PRIMARY = ['.topbar .logo','#mMenuBtn','#go','#mObjBtn','.toolbar button','#subTabs button',
                 '.stepbar button','.qfloat-btn','#mSheet .tbtn','#mSheet #gradeWrap','#mSheet #dimWrap',
                 '#mSheet #viewWrap','.mfoot button','.modal .actions button','.dlg-close',
                 '#leftPanel .ph button'];
  var small = [], checked = 0;
  PRIMARY.forEach(function(sel){
    [].slice.call(document.querySelectorAll(sel)).forEach(function(e){
      var r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      checked++;
      if (r.width < 39.5 || r.height < 39.5)
        small.push({sel:sel, w:+r.width.toFixed(1), h:+r.height.toFixed(1)});
    });
  });
  var all = [], tiny = 0;
  [].slice.call(document.querySelectorAll('button, [role=button]')).forEach(function(e){
    var r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    if (r.bottom < 0 || r.top > vh) return;
    if (r.width < 39.5 || r.height < 39.5){
      tiny++;
      if (all.length < 8) all.push((e.id ? '#'+e.id : e.className || e.tagName) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
    }
  });
  return {
    viewport:{w:vw,h:vh,dpr:window.devicePixelRatio},
    docScrollWidth:de.scrollWidth, docClientWidth:de.clientWidth,
    overflowX:+(de.scrollWidth - vw).toFixed(1),
    scrollHeight:de.scrollHeight,
    blocks:blocks, overlaps:overlaps,
    touch:{checked:checked, failures:small},
    tinyTargets:{count:tiny, sample:all},
    stage:{h:Math.round((document.querySelector('#stage')||{getBoundingClientRect:function(){return {height:0}}}).getBoundingClientRect().height)},
    layout:['.measure','#stageTop','#toolbar','#subTabs','#stepbar','#stepdesc','#qTextFloat','#qFigFloat','#mObjBtn','#mGrip'].map(R).filter(Boolean),
    stepbarText:(document.querySelector('#stepbar')||{textContent:''}).textContent.replace(/\s+/g,' ').trim().slice(0,60),
    measureText:(document.querySelector('#measure')||{textContent:''}).textContent.replace(/\s+/g,' ').trim().slice(0,60),
    layout:['.measure','#stageTop','#toolbar','#subTabs','#stepbar','#stepdesc','#qTextFloat','#qFigFloat','#mObjBtn','#mGrip'].map(R).filter(Boolean),
    stepbarText:(document.querySelector('#stepbar')||{textContent:''}).textContent.replace(/\s+/g,' ').trim().slice(0,60),
    measureText:(document.querySelector('#measure')||{textContent:''}).textContent.replace(/\s+/g,' ').trim().slice(0,60),
    canvas:{count:document.querySelectorAll('canvas').length},
    sheet:{present:!!document.getElementById('mSheet'), open:!!(document.getElementById('mSheet')||{classList:{contains:function(){return false}}}).classList.contains('show')},
    moved:{goInTopbar:!!document.querySelector('.topbar #go'), gradeInSheet:!!document.querySelector('#mSheet #gradeWrap')}
  };
})()`;

const DESKTOP_PROBE = `(function(){
  var sels = ['.topbar','#inputRow','#main','#leftPanel','#stage','#rightPanel','.statusbar',
              '#go','#gradeWrap','#dimWrap','#viewWrap','#btnHist','#btnHtml','#btnCfg','#btnTheme','#toolbar','.chip'];
  var out = {};
  sels.forEach(function(s){
    var e = document.querySelector(s); if(!e) { out[s]=null; return; }
    var r = e.getBoundingClientRect();
    out[s] = [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)].join(',');
  });
  out['__scrollW'] = document.documentElement.scrollWidth;
  return out;
})()`;

/* ---------------- 主流程 ---------------- */
let edge = null;

async function main() {
  console.log("[harness] 准备结果（mock 模型）…");
  const r2d = await solveOnce(Q2D, "2d");
  const r3d = await solveOnce(Q3D, "3d");
  console.log("[harness] 2D renderCode " + (r2d.renderCode || "").length + " 字符；3D points " + ((r3d.render3d && r3d.render3d.points || []).length));

  edge = spawn(EDGE, [
    "--headless=new",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + PROFILE,
    "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-background-networking",
    "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--hide-scrollbars",
    "about:blank",
  ], { stdio: "ignore" });

  let ok = false;
  for (let i = 0; i < 80; i++) {
    try { await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json(); ok = true; break; }
    catch (e) { await sleep(250); }
  }
  if (!ok) throw new Error("Edge DevTools 没起来");

  const report = { desktop: null, states: {} };

  /* ---------- A. 桌面 1366×800：注入前后逐字节比对 ---------- */
  if (!PHONE_ONLY) {
    const p = await Page.open(APP, 1366, 800, false);
    await p.waitFor("window.HJTest && document.querySelector('#stage')");
    await sleep(700);
    const beforeRect = await p.evalIn(DESKTOP_PROBE);
    const beforePng = await p.shot(PFX + "00-desktop-before.png");
    // 同一状态连拍两张：确认页面本身是否稳定（有动画/光标时逐字节比对没有意义）
    await sleep(500);
    const beforePng2 = await p.shot(PFX + "00-desktop-before-2.png");

    await injectOverlay(p);
    await sleep(700);
    const afterRect = await p.evalIn(DESKTOP_PROBE);
    const afterPng = await p.shot(PFX + "00-desktop-after.png");

    // 像素级 diff：把两张图交给页面里的 canvas 逐像素比，拿到差异数 + 包围盒
    await p.evalIn("window.__A=" + JSON.stringify("data:image/png;base64," + beforePng2.toString("base64")));
    await p.evalIn("window.__B=" + JSON.stringify("data:image/png;base64," + afterPng.toString("base64")));
    const pixDiff = await p.evalIn(`(function(){
      return new Promise(function(res){
        var a = new Image(), b = new Image(), left = 2;
        function go(){
          if (--left) return;
          var c = document.createElement('canvas');
          c.width = a.width; c.height = a.height;
          var g = c.getContext('2d');
          g.drawImage(a,0,0);
          var da = g.getImageData(0,0,a.width,a.height).data;
          g.clearRect(0,0,a.width,a.height);
          g.drawImage(b,0,0);
          var db = g.getImageData(0,0,a.width,a.height).data;
          var n=0, x0=1e9, y0=1e9, x1=-1, y1=-1;
          for (var i=0;i<da.length;i+=4){
            if (da[i]!==db[i] || da[i+1]!==db[i+1] || da[i+2]!==db[i+2]){
              n++;
              var px=(i/4)%a.width, py=Math.floor((i/4)/a.width);
              if(px<x0)x0=px; if(px>x1)x1=px; if(py<y0)y0=py; if(py>y1)y1=py;
            }
          }
          res({differing:n, box: n?[x0,y0,x1,y1]:null, size:[a.width,a.height]});
        }
        a.onload = go; b.onload = go;
        a.src = window.__A; b.src = window.__B;
      });
    })()`);

    const diffs = [];
    Object.keys(beforeRect).forEach(function (k) {
      if (beforeRect[k] !== afterRect[k]) diffs.push({ k: k, before: beforeRect[k], after: afterRect[k] });
    });
    report.desktop = {
      viewport: "1366x800",
      rectDiffs: diffs,
      rectIdentical: diffs.length === 0,
      pngIdentical: beforePng.equals(afterPng),
      stableWithoutOverlay: beforePng.equals(beforePng2),
      beforeBytes: beforePng.length,
      afterBytes: afterPng.length,
      pixelDiff: pixDiff,
      mobileDomLeak: await p.evalIn("!!document.getElementById('mSheet') || !!document.getElementById('mObjBtn')"),
    };
    p.close();
  }

  /* ---------- B. 手机 412×915 ---------- */
  {
    const p = await Page.open(APP, W, H, true);
    await p.waitFor("window.HJTest && document.querySelector('#stage')");
    await sleep(500);

    // 注入前先记一笔「改造前」的样子，便于对照
    await p.shot(PFX + "00-mobile-before.png");
    await injectOverlay(p);
    await sleep(900);

    report.states.empty = await p.evalIn(PROBE);
    await p.shot(PFX + "01-empty.png");

    // ⋯ 面板
    await p.evalIn("window.HJMobile.openSheet();1");
    await sleep(450);
    await p.shot(PFX + "02-sheet.png");
    await p.evalIn("window.HJMobile.closeAll();1");
    await sleep(350);

    // 2D
    await p.evalIn("window.HJTest.inject(" + JSON.stringify(r2d) + ");1");
    await sleep(1800);
    report.states.solved2d = await p.evalIn(PROBE);
    await p.shot(PFX + "03-solved-2d.png");

    // 2D 下半屏（解答区滚动到解析）
    await p.evalIn("(function(){var a=document.querySelector('.anbody');if(a)a.scrollTop=260;return 1})()");
    await sleep(400);
    await p.shot(PFX + "03b-solved-2d-answer.png");
    await p.evalIn("(function(){var a=document.querySelector('.anbody');if(a)a.scrollTop=0;return 1})()");

    // 3D：换一张干净的页面再注入（同一页从 2D 切 3D 会留下 2D 的测量读数）
    await p.send("Page.navigate", { url: APP });
    await p.waitReady();
    await injectOverlay(p);
    await sleep(900);
    await p.evalIn("window.HJTest.inject(" + JSON.stringify(r3d) + ");1");
    await sleep(2600);
    report.states.solved3d = await p.evalIn(PROBE);
    await p.shot(PFX + "04-solved-3d.png");

    // 历史记录
    await p.evalIn("document.getElementById('btnHist').click();1");
    await sleep(1200);
    report.states.history = await p.evalIn(PROBE);
    await p.shot(PFX + "05-history.png");
    await p.evalIn("document.getElementById('btnHistX').click();1");
    await sleep(400);

    // 设置
    await p.evalIn("document.getElementById('btnCfg').click();1");
    await sleep(800);
    report.states.settings = await p.evalIn(PROBE);
    await p.shot(PFX + "06-settings.png");
    await p.evalIn("document.getElementById('btnCfgClose').click();1");
    await sleep(400);

    // 夜间模式
    await p.evalIn("document.documentElement.dataset.theme='dark';1");
    await sleep(500);
    report.states.dark = await p.evalIn(PROBE);
    await p.shot(PFX + "07-dark.png");

    // 抽屉
    await p.evalIn("window.HJMobile.openDrawer();1");
    await sleep(450);
    await p.shot(PFX + "08-drawer.png");
    report.states.drawer = await p.evalIn(PROBE);
    await p.evalIn("window.HJMobile.closeAll();document.documentElement.dataset.theme='light';1");

    // 反向验证：把窗口拉回桌面宽度，搬到面板里的元素必须原样归位
    await p.send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(1000);
    report.reflow = await p.evalIn(`(function(){
      function pid(id){ var e=document.getElementById(id); return e && e.parentNode ? (e.parentNode.id || e.parentNode.className || e.parentNode.tagName) : null; }
      var sheet = document.getElementById('mSheet');
      return {
        htmlClass: document.documentElement.className,
        goParent: pid('go'),
        gradeParent: pid('gradeWrap'),
        histParent: pid('btnHist'),
        sheetVisible: sheet ? getComputedStyle(sheet).display !== 'none' : false,
        objBtnVisible: (function(){var b=document.getElementById('mObjBtn');return b?getComputedStyle(b).display!=='none':false;})(),
        vars: {
          left: getComputedStyle(document.documentElement).getPropertyValue('--left-w'),
          right: getComputedStyle(document.documentElement).getPropertyValue('--right-w')
        },
        layout: window.HJ && window.HJ.layout ? {left:window.HJ.layout.left, right:window.HJ.layout.right} : null,
        rects: (function(){
          var o = {};
          ['#leftPanel','#stage','#rightPanel','#main'].forEach(function(s){
            var e=document.querySelector(s); if(!e) return;
            var r=e.getBoundingClientRect(); o[s]=[Math.round(r.x),Math.round(r.width)];
          });
          o.vw = window.innerWidth;
          return o;
        })()
      };
    })()`);
    await p.shot(PFX + "09-back-to-desktop.png");

    p.close();
  }

  /* ---------- C. 汇总 ---------- */
  const verdict = { pass: true, reasons: [] };
  Object.keys(report.states).forEach(function (k) {
    const s = report.states[k];
    if (s.overflowX > 1) { verdict.pass = false; verdict.reasons.push(k + " 横向溢出 " + s.overflowX + "px"); }
    if (s.overlaps.length) { verdict.pass = false; verdict.reasons.push(k + " 区块重叠 " + JSON.stringify(s.overlaps)); }
    if (s.touch.failures.length) { verdict.pass = false; verdict.reasons.push(k + " 触控目标不足 " + JSON.stringify(s.touch.failures)); }
  });
  const RF = report.reflow;
  if (RF) {
    if (RF.goParent !== "inputRow") { verdict.pass = false; verdict.reasons.push("回到桌面后 #go 没回到输入行：" + RF.goParent); }
    if (RF.gradeParent !== "topbar") { verdict.pass = false; verdict.reasons.push("回到桌面后 #gradeWrap 没回到顶栏：" + RF.gradeParent); }
    if (RF.histParent !== "topbar") { verdict.pass = false; verdict.reasons.push("回到桌面后 #btnHist 没回到顶栏：" + RF.histParent); }
    if (RF.sheetVisible || RF.objBtnVisible) { verdict.pass = false; verdict.reasons.push("回到桌面后手机端节点还露着"); }
  }

  const D = report.desktop;
  if (D) {
    if (!D.rectIdentical) { verdict.pass = false; verdict.reasons.push("桌面 rect 变化 " + JSON.stringify(D.rectDiffs)); }
    if (D.pixelDiff && D.pixelDiff.differing > 0) {
      verdict.pass = false;
      verdict.reasons.push("桌面截图有 " + D.pixelDiff.differing + " 个像素变化 " + JSON.stringify(D.pixelDiff.box));
    }
    if (D.mobileDomLeak) { verdict.pass = false; verdict.reasons.push("桌面残留手机端节点"); }
  }

  report.verdict = verdict;
  console.log(JSON.stringify(report, null, 2));

  await cleanup();
  process.exit(verdict.pass ? 0 : 1);
}

/* 收尾必须彻底：profile 留在磁盘上会一条几十 MB，历史上攒过 4.7GB。
   顺序：CDP Browser.close → 等 9222 端口的浏览器真的没了 → 再删目录（带重试）。 */
async function cleanup() {
  // 1. 先用 CDP 让浏览器自己退（spawn 出来的 pid 未必是浏览器主进程）
  try {
    const v = await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json();
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((r) => { ws.addEventListener("open", r); setTimeout(r, 1000); });
    ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    await sleep(600);
  } catch (e) {}

  // 2. 兜底：按 pid 杀进程树
  try { if (edge) spawn("taskkill", ["/pid", String(edge.pid), "/T", "/F"], { stdio: "ignore" }); } catch (e) {}

  // 3. 等 DevTools 端口彻底不通（说明进程真的退了）
  let waited = 0;
  for (let i = 0; i < 60; i++) {
    let alive = false;
    try { await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json(); alive = true; } catch (e) { alive = false; }
    if (!alive) break;
    waited += 300;
    await sleep(300);
  }
  console.log("[harness] 浏览器已退出（等 " + waited + "ms），开始删除临时 profile…");
  // Chromium 的 crashpad 在退出后还会补写几百毫秒，删早了目录会被重建
  await sleep(2000);

  // 4. 删目录：Chromium 关掉 DevTools 端口后还要花几秒把 profile 刷完盘，
  //    这期间删掉的目录会被它重新建回来。所以「删掉」不算数，
  //    要连着 10 秒都不再出现才算干净（最多等 40 秒）。
  let stable = 0;
  for (let i = 0; i < 40; i++) {
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 2 }); } catch (e) {}
    if (fs.existsSync(PROFILE)) {
      stable = 0;
    } else {
      stable++;
      if (stable >= 10) {
        console.log("[harness] 临时 profile 已删除");
        return true;
      }
    }
    await sleep(1000);
  }
  console.warn("[harness] ⚠️ 临时 profile 没删掉，请手动删除：" + PROFILE);
  return false;
}

/* 上一次跑剩下的 profile（进程晚退导致没删掉）：开跑前先扫一遍，别越攒越多 */
function sweepOldProfiles() {
  try {
    fs.readdirSync(TMP)
      .filter((n) => /^edge-ui-harness-\d+$/.test(n))
      .forEach((n) => {
        const p = path.join(TMP, n);
        try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 2 }); } catch (e) {}
      });
  } catch (e) {}
}

main().catch(async (e) => {
  console.error("FATAL", e && e.stack || e);
  await cleanup();
  process.exit(1);
});
