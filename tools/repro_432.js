// §43.2 复现与定位：「改过元素大小 → 切微调版本 → 尺寸滑杆失效，刷新才恢复」
// 用法: node tools\repro_432.js   （需 8099 在跑；只读，不改用户记录）
//
// 按用户描述的步骤走，并在每一步抓取内部状态：
//   verPreviewVid / OBJ.sel / OBJ.styleOff / #objStyle 面板 / 滑杆 oninput 是否触发 /
//   last.result.style2d 是否变化 / styleSaveTimer 是否还挂着
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");

let proc = null;
function killEdge() { if (proc && proc.pid) { try { execSync("taskkill /pid " + proc.pid + "/t /f", { stdio: "ignore" }); } catch (e) {} } }

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9422;
const APP = "http://127.0.0.1:8099/solver/index.html";
const SHOTS = path.join(__dirname, "shots_new");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, x) => { if (c) console.log("  ok   " + n + (x ? "  [" + x + "]" : "")); else { console.log("  FAIL " + n + (x ? "  [" + x + "]" : "")); fails++; } };
const info = (n, x) => console.log("  info " + n + (x != null ? "  [" + x + "]" : ""));

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  proc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + path.join(os.tmpdir(), "edge-repro432-" + process.pid),
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json(); break; } catch (e) { await sleep(250); } }
  if (!ver) throw new Error("no devtools");
  const t = await (await fetch("http://127.0.0.1:" + PORT + "/json/new?about:blank", { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const pend = new Map();
  let id = 0;
  const errs = [];
  ws.addEventListener("message", (ev2) => {
    const m = JSON.parse(ev2.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") errs.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
  });
  await new Promise((r) => ws.addEventListener("open", r));
  const send = (m, p) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async (e) => {
    const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true, timeout: 30000 });
    const rr = r.result || {};
    if (rr.exceptionDetails) throw new Error(JSON.stringify(rr.exceptionDetails).slice(0, 400));
    return (rr.result && "value" in rr.result) ? rr.result.value : null;
  };
  const shot = async (n) => { const r = await send("Page.captureScreenshot", { format: "png" }); if (r.result && r.result.data) fs.writeFileSync(path.join(SHOTS, n), Buffer.from(r.result.data, "base64")); };
  const until = async (expr, ms, step) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await ev(expr).catch(() => false); if (v) return v; await sleep(step || 300); } return false; };

  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: APP });
  await until("!!(window.HJ && window.GGB3D)", 60000);

  /* ---------- 内部状态探针 ---------- */
  const probe = `(function(){
    var out={};
    try{ out.previewVid = window.HJ._styleLocked ? (window.HJ._styleLocked()?1:0) : -1; }catch(e){ out.previewVid='err'; }
    try{ out.styleLocked = window.HJ._styleLocked ? window.HJ._styleLocked() : null; }catch(e){}
    var b=document.getElementById('objStyle');
    out.panelHtml = b? b.innerHTML.length : -1;
    out.sliders = b? b.querySelectorAll('input').length : -1;
    out.labels = b? [].slice.call(b.querySelectorAll('.lbl')).map(function(x){return x.textContent;}) : [];
    var rows=[].slice.call(document.querySelectorAll('#objList .obj'));
    out.rowCount = rows.length;
    out.selRow = (rows.filter(function(x){return x.classList.contains('on');})[0]||{}).textContent;
    try{ out.vp = window.SolverDebug ? window.SolverDebug.previewVid() : null; }catch(e){}
    try{
      var L=window.SolverDebug.last(); out.style2d = L&&L.result&&L.result.style2d ? JSON.stringify(L.result.style2d) : null;
    }catch(e){}
    return out;
  })()`;

  console.log("=== 0. 准备：载入一条真实记录，然后替换成含 2 个版本的合成记录 ===");
  await ev("document.getElementById('btnHist').click();1");
  await until("!!document.querySelector('#histList .hist-item')", 15000);
  await ev("document.querySelector('#histList .hist-item').click();1");
  await sleep(1800);
  ok("画板已渲染", await ev("!!(window.board && window.board.objects)"));

  // 用产品自己的渲染入口重建：写一个 2 版本的记录并渲染 v2
  const built = await ev(`(function(){
    function code(tag){
      return ["var b=GGBBoard.init('ggb-canvas',{boundingbox:[-1,6,7,-1],axis:false,keepaspectratio:true,showCopyright:false});",
        "window.board=b;",
        "var A=b.create('point',[0,0],{name:'A',size:3,fixed:true});",
        "var B=b.create('point',[4,0],{name:'B',size:3,fixed:true});",
        "b.create('segment',[A,B],{name:'AB',strokeWidth:2,strokeColor:'#37474f'});",
        "b.create('text',[0.2,5.2," + JSON.stringify("版本 " + tag) + "],{fontSize:15,fixed:true});"
      ].join("\\n");
    }
    var now=Date.now();
    var rec={ id:'REPRO432', ts:now, question:'复现用', model:'test', answer:'测试', analysis:'测试',
      renderCode:code('v2'), render3d:null, style2d:null,
      versions:[
        {vid:1,ts:now-2000,answer:'测试',analysis:'测试',renderCode:code('v1'),render3d:null,style2d:null},
        {vid:2,ts:now-1000,answer:'测试',analysis:'测试',renderCode:code('v2'),render3d:null,style2d:null}
      ], currentVid:2 };
    // 走产品渲染路径
    window.SolverDebug && window.SolverDebug.renderQCard && 0;
    return {code: rec.renderCode.length, versions: rec.versions.length};
  })()`);
  info("合成记录", JSON.stringify(built));

  /* ---------- 用产品真实 API 渲染这条记录 ---------- */
  // renderResult 不对外，这里用「导入记录」的等价路径：直接调用 window.SolverDebug 能拿到的部分
  const rendered = await ev(`(function(){
    // 直接执行修复版的渲染链（与 render() 内部一致）
    var host=document.getElementById('canvasHost');
    host.style.display='block'; document.getElementById('g3d').style.display='none';
    host.innerHTML='<div id="ggb-canvas" class="jxgbox" style="position:absolute;inset:0;"></div>';
    function code(tag){
      return ["var b=GGBBoard.init('ggb-canvas',{boundingbox:[-1,6,7,-1],axis:false,keepaspectratio:true,showCopyright:false});",
        "window.board=b;",
        "var A=b.create('point',[0,0],{name:'A',size:3,fixed:true});",
        "var B=b.create('point',[4,0],{name:'B',size:3,fixed:true});",
        "b.create('segment',[A,B],{name:'AB',strokeWidth:2,strokeColor:'#37474f'});",
        "b.create('text',[0.2,5.2," + JSON.stringify("版本 " + tag) + "],{fontSize:15,fixed:true});"
      ].join("\\n");
    }
    try{ (new Function(code('v2')))(); }catch(e){ return {err:e.message}; }
    try{ window.applyTex2D(window.board); }catch(e){}
    if(window.HJ && window.HJ.refresh2D) window.HJ.refresh2D();
    return {ok:true, objs:Object.keys(window.board.objects).length};
  })()`);
  info("渲染 v2", JSON.stringify(rendered));
  await sleep(800);

  console.log("\n=== 1. 选中点 A → 样式面板出现 ===");
  const selA = await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('#objList .obj'));
    var r=rows.filter(function(x){return /\\bA\\b|^A/.test(x.textContent);})[0]||rows[0];
    if(!r) return {err:'no row', n:rows.length};
    r.click();
    return {picked:r.textContent.trim().slice(0,30), rows:rows.length};
  })()`);
  await sleep(400);
  const p1 = await ev(probe);
  info("选中", JSON.stringify(selA));
  info("面板", JSON.stringify({ html: p1.panelHtml, sliders: p1.sliders, labels: p1.labels, sel: p1.selRow }));
  ok("样式面板已出现（有滑杆）", p1.sliders >= 1, "sliders=" + p1.sliders + " labels=" + JSON.stringify(p1.labels));

  console.log("\n=== 2. 拖动尺寸滑杆改大小 ===");
  const drag = await ev(`(function(){
    var b=document.getElementById('objStyle');
    var inp=b.querySelector('input'); if(!inp) return {err:'no input'};
    var before=inp.value;
    inp.value=String(Math.min(Number(inp.max), Number(inp.min)+(Number(inp.max)-Number(inp.min))*0.85));
    inp.dispatchEvent(new Event('input'));
    var out=[];
    for(var k in window.board.objects){var e=window.board.objects[k];
      if(e&&String(e.elType)==='point'&&e.visProp) out.push(e.name+'='+e.visProp.size);}
    return {before:before, after:inp.value, points:out};
  })()`);
  await sleep(250);
  info("滑杆", JSON.stringify(drag));
  const p2 = await ev(probe);
  ok("拖动后画布上的点变大了", !!drag.points && drag.points.some((x) => Number(String(x).split("=")[1]) > 3), JSON.stringify(drag.points));
  ok("拖动后 style2d 已写入内存", !!p2.style2d, String(p2.style2d).slice(0, 80));
  await shot("s432_1_after_resize.png");

  console.log("\n=== 3. 立刻切到另一个微调版本（模拟用户操作：点版本条目 = 预览） ===");
  // 找右栏「微调记录」里的版本行
  const verRows = await ev(`(function(){
    var box=document.getElementById('verList') || document.getElementById('versions') || document.querySelector('.ver-list');
    var all=[].slice.call(document.querySelectorAll('#verList *, #versions *, .ver-item, .ver-row'));
    var items=all.filter(function(x){return /^v\\d/.test(x.textContent.trim());});
    return {found:items.length, where:!!box, sample:items.slice(0,4).map(function(x){return x.textContent.trim().slice(0,24);})};
  })()`);
  info("版本行", JSON.stringify(verRows));

  // 直接调产品预览入口（等价于点版本条目）
  const prev = await ev(`(function(){
    try{
      // verPreview 不对外，用 SolverDebug 也没暴露；这里通过点击版本行触发
      var cands=[].slice.call(document.querySelectorAll('[id*=ver] *')).filter(function(x){
        return x.tagName && /^(TR|DIV|LI|BUTTON)$/.test(x.tagName) && /^v\\d/.test(x.textContent.trim());});
      if(cands.length){ cands[0].click(); return {clicked:cands[0].textContent.trim().slice(0,30)}; }
      return {clicked:null, n:cands.length};
    }catch(e){ return {err:e.message}; }
  })()`);
  info("点击版本行", JSON.stringify(prev));
  await sleep(1200);
  const p3 = await ev(probe);
  info("切换后状态", JSON.stringify(p3));
  ok("已进入版本预览（_styleLocked 为真）", p3.styleLocked === true || p3.previewVid === 1, "styleLocked=" + p3.styleLocked + " previewVid=" + p3.previewVid);
  ok("预览态下样式面板被隐藏", p3.sliders === 0, "sliders=" + p3.sliders);
  await shot("s432_2_after_version_switch.png");

  console.log("\n=== 4. 再选一次元素，看滑杆能不能用（用户说『切回来也不行』） ===");
  const selAgain = await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('#objList .obj'));
    if(!rows.length) return {err:'no rows'};
    rows[0].click();
    var b=document.getElementById('objStyle');
    return {rows:rows.length, sliders:b.querySelectorAll('input').length, html:b.innerHTML.length};
  })()`);
  await sleep(400);
  const p4 = await ev(probe);
  info("重新选中", JSON.stringify(selAgain));
  info("面板状态", JSON.stringify({ sliders: p4.sliders, styleLocked: p4.styleLocked, labels: p4.labels }));
  ok("重新点选元素后样式面板恢复", p4.sliders >= 1, "sliders=" + p4.sliders + " locked=" + p4.styleLocked);

  console.log("\n=== 5. 拖动滑杆，看是否真的生效 ===");
  const drag2 = await ev(`(function(){
    var b=document.getElementById('objStyle');
    var inp=b.querySelector('input'); if(!inp) return {err:'no input', html:b.innerHTML.length};
    var pt=[];
    for(var k in window.board.objects){var e=window.board.objects[k];
      if(e&&String(e.elType)==='point'&&e.visProp) pt.push(e.name+'='+e.visProp.size);}
    var before=pt.join(',');
    inp.value=String(Math.min(Number(inp.max), Number(inp.min)+(Number(inp.max)-Number(inp.min))*0.3));
    inp.dispatchEvent(new Event('input'));
    var pt2=[];
    for(var k2 in window.board.objects){var e2=window.board.objects[k2];
      if(e2&&String(e2.elType)==='point'&&e2.visProp) pt2.push(e2.name+'='+e2.visProp.size);}
    return {before:before, after:pt2.join(','), changed: before!==pt2.join(','), val:inp.value};
  })()`);
  info("第二次拖动", JSON.stringify(drag2));
  ok("第二次拖动滑杆仍然生效（若失败即复现 bug）", drag2.changed === true, JSON.stringify(drag2));

  console.log("\n=== 6. 退出预览（回到当前版本），再试 ===");
  const back = await ev(`(function(){
    var b=document.getElementById('verPreviewBack'); if(!b) return {err:'no back btn'};
    var vis=document.getElementById('verPreview').classList.contains('show');
    b.click();
    return {visible:vis};
  })()`);
  await sleep(1000);
  const p5 = await ev(probe);
  info("退出预览", JSON.stringify(back));
  info("状态", JSON.stringify({ styleLocked: p5.styleLocked, sliders: p5.sliders }));
  const drag3 = await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('#objList .obj'));
    if(rows.length) rows[0].click();
    var b=document.getElementById('objStyle');
    var inp=b.querySelector('input');
    if(!inp) return {err:'no slider after exit preview', html:b.innerHTML.length};
    var pt=[];for(var k in window.board.objects){var e=window.board.objects[k];
      if(e&&String(e.elType)==='point'&&e.visProp) pt.push(e.name+'='+e.visProp.size);}
    var before=pt.join(',');
    inp.value=String(Math.min(Number(inp.max), Number(inp.min)+(Number(inp.max)-Number(inp.min))*0.6));
    inp.dispatchEvent(new Event('input'));
    var pt2=[];for(var k2 in window.board.objects){var e2=window.board.objects[k2];
      if(e2&&String(e2.elType)==='point'&&e2.visProp) pt2.push(e2.name+'='+e2.visProp.size);}
    return {before:before, after:pt2.join(','), changed:before!==pt2.join(',')};
  })()`);
  info("退出预览后拖动", JSON.stringify(drag3));
  ok("退出预览后滑杆可用", drag3.changed === true, JSON.stringify(drag3));
  await shot("s432_3_after_exit_preview.png");

  console.log("\n=== 控制台 ===");
  info("JS 异常", errs.length ? errs.slice(0, 3).join(" | ") : "无");

  console.log("\n----------------------------------------");
  console.log(fails === 0 ? "RESULT: 未复现（全部步骤正常）" : "RESULT: " + fails + " 处异常 ← 复现成功");
  killEdge();
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error("\nFATAL:", e && e.message || e); killEdge(); process.exit(1); });
