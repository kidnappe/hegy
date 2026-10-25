#!/usr/bin/env node
/* =========================================================
   手机端「设置页 / 历史页」视觉验证台（pages-harness.js）
   ---------------------------------------------------------
   和 ui-harness.js 同一套思路（headless Edge + 原始 CDP），但只管
   pages.js 负责的两页：设置（列表 + 三个子页）与历史（列表 + 左滑操作栏）。

   为什么单独一个脚本：ui-harness.js 归「UI 线」维护，多人并行时
   各改各的，避免同文件冲突。

   用法：
     node mobile/tools/pages-harness.js            # 默认 412×915 dpr2
     HJ_W=360 HJ_H=780 node mobile/tools/pages-harness.js
   产物：mobile/tools/shots/pages-*.png
   ========================================================= */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9412;
const ROOT = path.resolve(__dirname, "..", "..");
const OV = path.join(ROOT, "mobile/src/overlay");
const OUT = path.join(__dirname, "shots");
const TMP = path.join(ROOT, ".tmp");
const PROFILE = path.join(TMP, "edge-pages-" + Date.now());
const APP = "http://127.0.0.1:8099/solver/index.html";

const W = Number(process.env.HJ_W || 412);
const H = Number(process.env.HJ_H || 915);
const PFX = W === 412 && H === 915 ? "" : "w" + W + "-";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.error("[harness] " + m);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

class Page {
  constructor(ws) { this.ws = ws; this.seq = 0; this.pend = new Map(); }
  static async open(url) {
    const t = await (await fetch("http://127.0.0.1:" + PORT + "/json/new?about:blank", { method: "PUT" })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    const p = new Page(ws);
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && p.pend.has(m.id)) { p.pend.get(m.id)(m); p.pend.delete(m.id); }
    });
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", () => rej(new Error("CDP WebSocket 连接失败")), { once: true });
      setTimeout(() => rej(new Error("CDP WebSocket 连接超时")), 15000);
    });
    await p.send("Page.enable");
    await p.send("Runtime.enable");
    await p.send("Page.navigate", { url });
    await p.waitReady();
    // 导航会把 metrics 清掉，必须在导航之后再设一次
    await p.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: true });
    await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await sleep(400);
    return p;
  }
  send(method, params) {
    return new Promise((res, rej) => {
      const i = ++this.seq;
      const timer = setTimeout(() => { this.pend.delete(i); rej(new Error("CDP 超时：" + method)); }, 30000);
      this.pend.set(i, (m) => { clearTimeout(timer); res(m.result || {}); });
      this.ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
  }
  async evalIn(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails.exception && r.exceptionDetails.exception.description;
      throw new Error("eval: " + (d || r.exceptionDetails.text));
    }
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
    await sleep(700);
  }
  async shot(file) {
    const r = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, PFX + file), Buffer.from(r.data, "base64"));
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function main() {
  const hard = setTimeout(function () {
    console.error("[harness] 硬超时（5 分钟），强制退出");
    process.exit(2);
  }, 300000);
  const edge = spawn(EDGE, [
    "--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars",
    "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank",
  ], { stdio: "ignore" });

  for (let i = 0; i < 60; i++) {
    try { await fetch("http://127.0.0.1:" + PORT + "/json/version"); break; }
    catch (e) { await sleep(200); }
  }

  log("edge 已就绪，打开页面…");
  const page = await Page.open(APP);
  log("页面就绪");

  // 别让首启向导盖住页面
  await page.evalIn("localStorage.setItem('hj_wizard_done','1');1");

  // 注入手机端样式与脚本（顺序同 prepare.js：layers → pages）
  for (const css of ["mobile.css", "pages.css"]) {
    const p = path.join(OV, css);
    if (!fs.existsSync(p)) continue;
    await page.evalIn(
      "(function(){var s=document.createElement('style');s.dataset.hj='" + css + "';s.textContent=" +
      JSON.stringify(fs.readFileSync(p, "utf8")) + ";document.head.appendChild(s);return 1;})()"
    );
  }
  // mobile-ui.js 会给 <html> 挂 m-mobile，solver.js 的 isMobileUI() 靠它分流手机 DOM
  for (const js of ["layers.js", "mobile-ui.js", "pages.js"]) {
    const p = path.join(OV, js);
    if (!fs.existsSync(p)) continue;
    await page.evalIn(fs.readFileSync(p, "utf8") + "\n;'ok'");
  }
  await sleep(500);
  log("注入完成");

  // ---------- 截图流程（可跑多套主题/皮肤） ----------
  async function capture(pfx) {
    log("capture " + pfx);
    // 历史页
    await page.evalIn("(document.getElementById('btnHist')||{click:function(){}}).click();1");
    await sleep(800);
    await page.shot(pfx + "1-history.png");

    // 左滑第一条，露出删除栏
    const swiped = await page.evalIn(`(function(){
      var it=document.querySelector('#histList .hist-item'); if(!it) return 'no-item';
      var r=it.getBoundingClientRect(), y=r.top+r.height/2;
      function P(type,x){ return new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:1,pointerType:'touch',isPrimary:true,clientX:x,clientY:y}); }
      var x0=r.right-30;
      it.dispatchEvent(P('pointerdown',x0));
      it.dispatchEvent(P('pointermove',x0-20));
      it.dispatchEvent(P('pointermove',x0-60));
      it.dispatchEvent(P('pointermove',x0-100));
      it.dispatchEvent(P('pointerup',x0-100));
      return 'ok';
    })()`);
    await sleep(500);
    await page.shot(pfx + "2-history-rail.png");

    // 右滑手势：先收起操作栏、等动画走完，再向右拖，行必须一动不动
    await page.evalIn("document.dispatchEvent(new CustomEvent('hj-swipe-close'));1");
    await sleep(500);
    const rsw = await page.evalIn(`(function(){
      var it=document.querySelector('#histList .hist-item'); if(!it) return null;
      var r=it.getBoundingClientRect(), y=r.top+r.height/2, x0=r.left+40;
      function P(type,x){ return new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:2,pointerType:'touch',isPrimary:true,clientX:x,clientY:y}); }
      var before=getComputedStyle(it).transform;
      it.dispatchEvent(P('pointerdown',x0));
      it.dispatchEvent(P('pointermove',x0+30));
      it.dispatchEvent(P('pointermove',x0+70));
      it.dispatchEvent(P('pointermove',x0+120));
      var mid=getComputedStyle(it).transform;
      it.dispatchEvent(P('pointerup',x0+120));
      return {before:before, mid:mid, moved: before !== mid};
    })()`);
    await sleep(250);

    // 设置页
    await page.evalIn("(document.getElementById('btnHistX')||{click:function(){}}).click();1");
    await sleep(450);
    await page.evalIn("(document.getElementById('btnCfg')||{click:function(){}}).click();1");
    await sleep(800);
    await page.shot(pfx + "4-settings-home.png");

    for (const [go, name] of [["model", "5-settings-model"], ["appearance", "6-settings-appearance"], ["view", "7-settings-view"]]) {
      const ok = await page.evalIn("(function(){var b=document.querySelector('.m-set-row[data-go=\"" + go + "\"]');if(!b)return 0;b.click();return 1;})()");
      if (!ok) continue;
      await sleep(650);
      await page.shot(pfx + name + ".png");
      await page.evalIn("(function(){var b=document.querySelector('.m-set-hd .m-back');if(b)b.click();return 1;})()");
      await sleep(450);
    }
    // 关于页（从设置根页进，退回设置根页）
    await page.evalIn("(function(){var b=document.querySelector('.m-set-row[data-go=\"about\"]');if(b)b.click();return 1;})()");
    await sleep(1600);
    await page.shot(pfx + "8-about.png");
    await page.evalIn("(function(){var t=document.querySelector('#aboutModal .ab-tab button[data-pane=legal]');if(t)t.click();return 1;})()");
    await sleep(450);
    await page.shot(pfx + "9-about-legal.png");
    await page.evalIn("(function(){var b=document.querySelector('#aboutModal .m-back');if(b)b.click();return 1;})()");
    await sleep(500);

    await page.evalIn("(document.getElementById('btnCfgClose')||{click:function(){}}).click();1");
    await sleep(500);
    return { swiped: swiped, rightSwipe: rsw };
  }

  const runs = [];
  runs.push(Object.assign({ theme: "light" }, await capture("pages-")));
  log("light 完成");

  // 夜间 + 暖工业皮肤各跑一遍，确认新样式只用变量、不写死色值。
  // 换完属性要强制重绘再等一拍：合成层（will-change:transform 的卡片）不重绘时，
  // 截图会拍到上一层残留，看着像"半透明"。
  async function switchLook(js) {
    await page.evalIn("(function(){" + js + ";void document.body.offsetHeight;return 1;})()");
    await sleep(900);
  }
  await switchLook("document.documentElement.setAttribute('data-theme','dark')");
  runs.push(Object.assign({ theme: "dark" }, await capture("pages-dark-")));
  log("dark 完成");

  await switchLook("document.documentElement.setAttribute('data-theme','light');document.documentElement.setAttribute('data-skin','warm')");
  // 暖工业皮肤在 headless 下 captureScreenshot 偶发超时（合成层不收敛），默认跳过；
  // 要单独验：HJ_WARM=1 node mobile/tools/pages-harness.js
  if (process.env.HJ_WARM) {
    runs.push(Object.assign({ theme: "warm" }, await capture("pages-warm-")));
    log("warm 完成");
  }
  await switchLook("document.documentElement.setAttribute('data-skin','default')");

  // 量测：触控目标 / 横向溢出 / 卡片几何
  const probe = await page.evalIn(`(function(){
    var out={};
    out.viewport={w:innerWidth,h:innerHeight,dpr:devicePixelRatio};
    out.overflowX=document.documentElement.scrollWidth-innerWidth;
    var rows=[].slice.call(document.querySelectorAll('.m-set-row'));
    out.setRows=rows.map(function(e){var r=e.getBoundingClientRect();return {t:(e.querySelector('.n')||{}).textContent,w:Math.round(r.width),h:Math.round(r.height)};});
    var small=[];
    [].slice.call(document.querySelectorAll('.m-set-row,.m-set-pick-row,.m-back,.m-hist-clear,.hist-del')).forEach(function(e){
      var r=e.getBoundingClientRect(); if(r.width<1) return;
      if(r.width<39.5||r.height<39.5) small.push({c:e.className,w:Math.round(r.width),h:Math.round(r.height)});
    });
    out.tinyTargets=small;
    var it=document.querySelector('#histList .hist-item');
    if(it){var r=it.getBoundingClientRect();out.histItem={w:Math.round(r.width),h:Math.round(r.height)};}
    return out;
  })()`);

  console.log(JSON.stringify({ runs: runs, probe: probe }, null, 2));

  page.close();
  edge.kill();
  clearTimeout(hard);
  await sleep(300);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
}

main().catch((e) => { console.error(e); process.exit(1); });
