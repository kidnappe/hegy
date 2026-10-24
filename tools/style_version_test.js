// §43.2 回归：手动调样式在「切版本 / 切记录」后仍然可用
// 用法: node tools\style_version_test.js   （需 8099 在跑，顺序执行）
//
// 覆盖（用户原话：「改过元素大小后切到另一个微调记录就调不了，切回来也不行，只有刷新才恢复」）：
//   A. 2D：改点大小 → 切到另一版本（预览）→ 切回当前版本 → 仍能改大小
//   B. 3D：改球半径 → 切版本 → 切回 → 仍能改半径，且写回的是当前场景 spec
//   C. 预览态给的是可见提示（不是空白面板），且不写盘
//   D. ★ 状态泄漏：A 记录处于「预览 v1」时直接打开 B 记录，预览锁必须被清掉、B 能正常调样式
//   E. 防抖保存不跨切换：拖动后立刻切记录，样式要落到原来的记录上，不能写进新记录
//
// 本脚本会临时写入两条测试记录（rFIX2D / rFIX3D），结束时自动删除。
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");

let proc = null;
function killEdge() { if (proc && proc.pid) { try { execSync("taskkill /pid " + proc.pid + "/t /f", { stdio: "ignore" }); } catch (e) {} } }

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9435;
const APP = "http://127.0.0.1:8099/solver/index.html";
const SHOTS = path.join(__dirname, "shots_new");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, x) => { if (c) console.log("  ok   " + n + (x ? "  [" + x + "]" : "")); else { console.log("  FAIL " + n + (x ? "  [" + x + "]" : "")); fails++; } };
const info = (n, x) => console.log("  info " + n + (x != null ? "  [" + x + "]" : ""));

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const rec2d = JSON.parse(fs.readFileSync(path.join(__dirname, "_fix_2d.json"), "utf8"));
  const rec3d = JSON.parse(fs.readFileSync(path.join(__dirname, "_fix_3d.json"), "utf8"));

  proc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + path.join(os.tmpdir(), "edge-stylever-" + process.pid),
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json(); break; } catch (e) { await sleep(250); } }
  if (!ver) throw new Error("no devtools");
  const t = await (await fetch("http://127.0.0.1:" + PORT + "/json/new?about:blank", { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const pend = new Map();
  let id = 0;
  const errs = [];
  ws.addEventListener("message", (e2) => {
    const m = JSON.parse(e2.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") errs.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
  });
  await new Promise((r) => ws.addEventListener("open", r));
  const send = (m, p) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async (e) => {
    const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true, timeout: 30000 });
    const rr = r.result || {};
    if (rr.exceptionDetails) throw new Error((rr.exceptionDetails.exception || {}).description || "eval error");
    return (rr.result && "value" in rr.result) ? rr.result.value : null;
  };
  const shot = async (n) => { const r = await send("Page.captureScreenshot", { format: "png" }); if (r.result && r.result.data) fs.writeFileSync(path.join(SHOTS, n), Buffer.from(r.result.data, "base64")); };
  const until = async (e, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await ev(e).catch(() => false); if (v) return v; await sleep(300); } return false; };
  const openItem = (txt) => ev(`(function(){
    var t=[].slice.call(document.querySelectorAll('#histList .hist-item')).filter(function(x){return x.textContent.indexOf(${JSON.stringify(txt)})>=0;})[0];
    if(!t) return {err:'not found'}; t.click(); return {ok:true};})()`);
  const drawer = async () => {
    await ev(`(function(){var c=document.getElementById('verCard');if(!c.classList.contains('open'))document.getElementById('verToggle').click();})()`);
    await sleep(500);
    return ev("document.querySelectorAll('#verList .ver-item').length");
  };
  const clickVer = (vid) => ev(`(function(){
    var t=[].slice.call(document.querySelectorAll('#verList .ver-item')).filter(function(x){return x.getAttribute('data-vid')===${JSON.stringify(String(vid))};})[0];
    if(!t) return {err:'no vid ${vid}'}; t.click(); return {ok:true};})()`);
  const clickObj = (k) => ev(`(function(){
    var r=[].slice.call(document.querySelectorAll('#objList .obj')).filter(function(x){return x.dataset.key===${JSON.stringify(k)};})[0];
    if(!r) return {err:'no row ${k}'}; r.click(); return {ok:true};})()`);

  await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });

  // 写入测试记录
  await send("Page.navigate", { url: APP });
  await until("!!(window.HJ && window.SolverDebug)", 60000);
  await sleep(700);
  for (const rec of [rec2d, rec3d]) {
    const r = await ev(`(async function(){var r=await fetch('/api/store/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({record:${JSON.stringify(rec)}})});return r.status;})()`);
    if (r !== 200) throw new Error("保存测试记录失败: " + r);
  }
  await send("Page.reload");
  await until("!!(window.HJ && window.SolverDebug)", 60000);
  await sleep(900);

  /* ---------------- A. 2D ---------------- */
  console.log("\n=== A. 2D：改大小 → 切版本 → 切回 → 仍能改 ===");
  await ev("document.getElementById('btnHist').click();1");
  await until("!!document.querySelector('#histList .hist-item')", 15000);
  await sleep(500);
  info("打开 2D 测试记录", JSON.stringify(await openItem("§43.2 修复验证 2D")));
  await sleep(2600);
  ok("2D 已渲染", await ev("!!(window.board && window.board.objects)"));
  const n2 = await drawer();
  ok("抽屉有 2 版", n2 >= 2, String(n2));

  info("选 A", JSON.stringify(await clickObj("A")));
  await sleep(350);
  const a1 = await ev(`(function(){
    var inp=document.getElementById('objStyle').querySelector('input');
    if(!inp) return {noSlider:true};
    inp.value='8'; inp.dispatchEvent(new Event('input'));
    var pt=[];for(var k in window.board.objects){var e=window.board.objects[k];
      if(e&&String(e.elType)==='point'&&e.visProp)pt.push(e.name+'='+e.visProp.size);}
    return {points:pt, style2d:JSON.stringify(window.SolverDebug.last().result.style2d||null)};
  })()`);
  await sleep(200);
  ok("首次改大小生效", !!(a1.points && a1.points.some((x) => Number(String(x).split("=")[1]) === 8)), JSON.stringify(a1.points));

  info("切 v1（预览）", JSON.stringify(await clickVer(1)));
  await sleep(1600);
  const a2 = await ev(`(function(){
    var b=document.getElementById('objStyle');
    return {locked:window.HJ._styleLocked(), sliders:b.querySelectorAll('input').length,
      hasNote:!!b.querySelector('.os-note'), note:b.querySelector('.os-note')?b.querySelector('.os-note').textContent.slice(0,30):null};})()`);
  info("预览态", JSON.stringify(a2));
  ok("预览态被锁定", a2.locked === true);
  ok("预览态不是空白面板（有提示）", a2.hasNote === true, String(a2.note));
  await shot("s432_fix_2d_preview_note.png");

  info("切回 v2", JSON.stringify(await clickVer(2)));
  await sleep(1600);
  info("重选 A", JSON.stringify(await clickObj("A")));
  await sleep(350);
  const a3 = await ev(`(function(){
    var inp=document.getElementById('objStyle').querySelector('input');
    if(!inp) return {noSlider:true, locked:window.HJ._styleLocked()};
    var pt=[];for(var k in window.board.objects){var e=window.board.objects[k];
      if(e&&String(e.elType)==='point'&&e.visProp)pt.push(e.name+'='+e.visProp.size);}
    var before=pt.join(',');
    inp.value='2.5'; inp.dispatchEvent(new Event('input'));
    var pt2=[];for(var k2 in window.board.objects){var e2=window.board.objects[k2];
      if(e2&&String(e2.elType)==='point'&&e2.visProp)pt2.push(e2.name+'='+e2.visProp.size);}
    return {before:before, after:pt2.join(','), changed:before!==pt2.join(',')};
  })()`);
  info("切回后改", JSON.stringify(a3));
  ok("切回后 2D 仍能改大小", a3.changed === true, JSON.stringify(a3));

  /* ---------------- B. 3D ---------------- */
  console.log("\n=== B. 3D：改球半径 → 切版本 → 切回 → 仍能改 ===");
  await ev("document.getElementById('btnHist').click();1");
  await until("!!document.querySelector('#histList .hist-item')", 15000);
  await sleep(500);
  info("打开 3D 测试记录", JSON.stringify(await openItem("§43.2 修复验证 3D")));
  await sleep(2800);
  ok("3D 已渲染", await ev("!!(window.GGB3D && window.GGB3D.getApi && window.GGB3D.getApi())"));
  const n3 = await drawer();
  ok("3D 抽屉有 2 版", n3 >= 2, String(n3));

  info("选球 sp1", JSON.stringify(await clickObj("sp1")));
  await sleep(400);
  const b1 = await ev(`(function(){
    var inp=document.getElementById('objStyle').querySelector('input');
    if(!inp) return {noSlider:true};
    var it=window.GGB3D.getApi().byId['sp1'];
    var before=it.spec.radius;
    inp.value='3.5'; inp.dispatchEvent(new Event('input'));
    return {before:before, after:it.spec.radius};
  })()`);
  await sleep(250);
  ok("首次改球半径生效", b1.before !== b1.after, b1.before + " -> " + b1.after);

  info("切 v1", JSON.stringify(await clickVer(1)));
  await sleep(1700);
  const b2 = await ev(`(function(){var b=document.getElementById('objStyle');
    return {locked:window.HJ._styleLocked(), sliders:b.querySelectorAll('input').length, hasNote:!!b.querySelector('.os-note')};})()`);
  ok("3D 预览态被锁定且有提示", b2.locked === true && b2.hasNote === true, JSON.stringify(b2));

  info("切回 v2", JSON.stringify(await clickVer(2)));
  await sleep(1700);
  info("重选球", JSON.stringify(await clickObj("sp1")));
  await sleep(400);
  const b3 = await ev(`(function(){
    var inp=document.getElementById('objStyle').querySelector('input');
    if(!inp) return {noSlider:true, locked:window.HJ._styleLocked()};
    var api=window.GGB3D.getApi(); var it=api.byId['sp1'];
    var sc1=window.GGB3D.getScene(); var sr1=null;
    try{sr1=sc1.spheres.filter(function(s){return s.id==='sp1';})[0].radius;}catch(e){}
    var before=it.spec.radius;
    inp.value='1.8'; inp.dispatchEvent(new Event('input'));
    var sc2=window.GGB3D.getScene(); var sr2=null;
    try{sr2=sc2.spheres.filter(function(s){return s.id==='sp1';})[0].radius;}catch(e){}
    return {before:before, after:it.spec.radius, sceneBefore:sr1, sceneAfter:sr2};
  })()`);
  info("切回后改", JSON.stringify(b3));
  ok("切回后 3D 仍能改半径", b3.before !== b3.after, b3.before + " -> " + b3.after);
  ok("写回的是当前场景 spec（引用未过期）", b3.sceneBefore !== b3.sceneAfter, "scene " + b3.sceneBefore + " -> " + b3.sceneAfter);
  await shot("s432_fix_3d_back.png");

  /* ---------------- D. 状态泄漏（本次修复的核心） ---------------- */
  console.log("\n=== D. ★ 预览态下直接切记录，预览锁不能泄漏 ===");
  await ev("document.getElementById('btnHist').click();1");
  await until("!!document.querySelector('#histList .hist-item')", 15000);
  await sleep(500);
  info("回 2D 记录", JSON.stringify(await openItem("§43.2 修复验证 2D")));
  await sleep(2600);
  await drawer();
  info("进入预览 v1", JSON.stringify(await clickVer(1)));
  await sleep(1500);
  const d1 = await ev(`(function(){return {locked:window.HJ._styleLocked(),
    bar:document.getElementById('verPreview').classList.contains('show')};})()`);
  info("A 记录预览中", JSON.stringify(d1));

  info("不点『回到当前』，直接开 3D 记录", "…");
  await ev("document.getElementById('btnHist').click();1");
  await until("!!document.querySelector('#histList .hist-item')", 15000);
  await sleep(600);
  info("打开 B", JSON.stringify(await openItem("§43.2 修复验证 3D")));
  await sleep(2800);
  const d2 = await ev(`(function(){
    var L=window.SolverDebug.last();
    return {locked:window.HJ._styleLocked(),
      bar:document.getElementById('verPreview').classList.contains('show'),
      curVid:L&&L.result?L.result.currentVid:null,
      recId:window.SolverDebug.recId(), rows:document.querySelectorAll('#objList .obj').length};})()`);
  info("B 记录状态", JSON.stringify(d2));
  ok("★ 预览锁没有泄漏到新记录", d2.locked === false, "locked=" + d2.locked);
  ok("★ 预览条已隐藏", d2.bar === false, "bar=" + d2.bar);

  const d3 = await ev(`(function(){
    var r=[].slice.call(document.querySelectorAll('#objList .obj')).filter(function(x){return x.dataset.key==='sp1';})[0];
    if(!r) return {err:'no sp1'};
    r.click();
    var b=document.getElementById('objStyle');
    return {sliders:b.querySelectorAll('input').length};})()`);
  ok("★ 新记录里样式面板能出现（不用刷新）", (d3.sliders || 0) >= 1, JSON.stringify(d3));
  await shot("s432_fix_no_leak.png");

  /* ---------------- E. 防抖不跨记录 ---------------- */
  console.log("\n=== E. 防抖保存不跨记录：拖完立刻切记录 ===");
  info("改球半径", JSON.stringify(await ev(`(function(){
    var inp=document.getElementById('objStyle').querySelector('input');
    if(!inp) return {noSlider:true};
    inp.value='2.4'; inp.dispatchEvent(new Event('input'));
    return {val:inp.value};
  })()`)));
  // 不等 300ms 防抖，立刻切记录
  await ev("document.getElementById('btnHist').click();1");
  await until("!!document.querySelector('#histList .hist-item')", 15000);
  await sleep(400);
  info("立刻切到 2D 记录", JSON.stringify(await openItem("§43.2 修复验证 2D")));
  await sleep(2500);
  const e1 = await ev(`(async function(){
    var r=await fetch('/api/store/record/rFIX3D');
    var j=await r.json();
    var rec=j.record||j;
    var cur=null;
    try{ cur=rec.versions.filter(function(v){return v.vid===rec.currentVid;})[0]; }catch(e){}
    var rr=(cur&&cur.render3d)||rec.render3d;
    var rad=null;
    try{ rad=rr.spheres.filter(function(s){return s.id==='sp1';})[0].radius; }catch(e){}
    return {curVid:rec.currentVid, radius:rad};
  })()`);
  info("3D 记录落盘的球半径", JSON.stringify(e1));
  ok("★ 拖动后的样式落到原记录上（没丢）", Number(e1.radius) === 2.4, "radius=" + e1.radius + "（期望 2.4）");

  /* ---------------- 收尾 ---------------- */
  console.log("\n=== 控制台 ===");
  ok("全程无 JS 异常", errs.length === 0, errs.slice(0, 3).join(" | "));

  // 清理测试记录
  for (const rid of ["rFIX2D", "rFIX3D"]) {
    await ev(`(async function(){ await fetch('/api/store/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:${JSON.stringify(rid)}})}); return 1; })()`).catch(() => {});
  }

  console.log("\n----------------------------------------");
  console.log(fails === 0 ? "RESULT: all passed" : "RESULT: " + fails + " failed");
  killEdge();
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error("\nFATAL:", e && e.message || e); killEdge(); process.exit(1); });
