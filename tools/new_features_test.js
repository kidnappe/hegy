// 新功能端到端自检（无头 Edge + CDP）：
//   A. 顶栏「图形 2D/3D」选择器（指定 3D 解平面题；指定 2D 解立体题；localStorage 记忆）
//   B. 微调「只改解析」（target=text，不动图形，撤销回退）
//   C. 微调「切换 3D」（rdim=3d，确认保留落库）
//   D. 图片题：questionText（题干回显）+ figureBox（题图单独裁剪）+ 历史列表 + 记录落盘 + 刷新后回看
//   E. 导出离线 HTML 带「题目/题图/HJ_REC.questionText」
// 用法: node tools\new_features_test.js   （需 8099 + 8098 两个服务在跑）
// 结束后会把 ~/.hegy/settings.json 恢复成本次运行前的备份。
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
require("./_cfg_guard").install(); // U-17：跑前备份真实配置，退出/异常一律恢复
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9405;
const APP = "http://127.0.0.1:8099/solver/index.html";
const API = "http://127.0.0.1:8099";
const TEST_DIR = "D:\\software\\tmp\\opencode\\hegy-feature-test";
const SHOTS = path.join(__dirname, "shots_new");
const HOME = path.join(os.homedir(), ".hegy");
const SETTINGS = path.join(HOME, "settings.json");
const SETTINGS_BAK = path.join(HOME, "settings.json.bak_agent");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log("  ok   " + name + (extra ? "  [" + extra + "]" : ""));
  else { console.log("  FAIL " + name + (extra ? "  [" + extra + "]" : "")); fails++; }
}
async function api(p) { return (await fetch(API + p)).json(); }
async function apiPost(p, body) {
  return (await fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })).json();
}

(async () => {
  await fs.promises.mkdir(SHOTS, { recursive: true });
  await fs.promises.mkdir(TEST_DIR, { recursive: true });
  const proc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + path.join(os.tmpdir(), "edge-diag-features"),
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
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const until = async (expr, ms, step) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await evalIn(expr).catch(() => false); if (v) return v; await sleep(step || 400); } return false; };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(s.result.data, "base64")); console.log("  shot " + name); };

  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.reload");
  if (!await until("!!(window.mathHTML&&document.getElementById('go')&&window.SolverDebug)", 30000)) throw new Error("app not ready");

  // 测试期配置：mock 模型 + 独立记录目录（结束时恢复 settings.json 备份）
  await apiPost("/api/cfg", { config: { baseUrl: "http://127.0.0.1:8098/v1", apiKey: "mock", model: "mock", temperature: 0.2 } });
  await apiPost("/api/store/dir", { dir: TEST_DIR, migrate: false });
  await apiPost("/api/store/purge", {}); // 测试目录每次从空开始
  const info = await api("/api/store/info");
  ok("测试记录目录已切换", String(info.recordsDir || "").indexOf("hegy-feature-test") >= 0, info.recordsDir);
  await evalIn("localStorage.setItem('solver_cfg_v1', JSON.stringify({baseUrl:'http://127.0.0.1:8098/v1',apiKey:'mock',model:'mock',temperature:0.2}));localStorage.removeItem('solver_dim_v1');localStorage.removeItem('solver_refine_opts_v1');1");
  await send("Page.reload");
  await until("!!(window.mathHTML&&document.getElementById('go')&&window.SolverDebug)", 30000);

  console.log("\n=== A. 图形类型选择器 ===");
  ok("#dim 控件存在（默认自动）", await evalIn("document.getElementById('dim') && document.getElementById('dim').value===''"));
  await evalIn("var d=document.getElementById('dim');d.value='3d';d.dispatchEvent(new Event('change'));document.getElementById('q').value='如图，在 Rt△ABC 中，∠C=90°，AC=3，BC=4，求 AB 的长。';document.getElementById('go').click();1");
  const s3d = await until("document.getElementById('status').textContent.indexOf('3D 图形')>=0", 90000, 500);
  ok("平面题被强制 3D 渲染", !!s3d, s3d ? "" : await evalIn("document.getElementById('status').textContent + ' || dim=' + document.getElementById('dim').value + ' || ' + SolverDebug.tasks().map(t=>t.status+':'+t.stage).join(',')"));
  ok("答案含 mock 3D 标记", await evalIn("document.getElementById('analysis').textContent.indexOf('已按指定 3D')>=0"), await evalIn("document.getElementById('analysis').textContent.slice(0,60)"));
  ok("选择被记忆（solver_dim_v1=3d）", await evalIn("localStorage.getItem('solver_dim_v1')==='3d'"));
  await shot("feature_dim_3d.png");

  await evalIn("var d=document.getElementById('dim');d.value='2d';d.dispatchEvent(new Event('change'));document.getElementById('q').value='如图，在正方体 ABCD-A1B1C1D1 中，AB=2，求体对角线 AC1 的长度。';document.getElementById('go').click();1");
  const s2d = await until("document.getElementById('status').textContent.indexOf('脚本')>=0", 90000, 500);
  ok("立体题被强制 2D 渲染", !!s2d, s2d ? "" : await evalIn("document.getElementById('status').textContent + ' || dim=' + document.getElementById('dim').value + ' || ' + SolverDebug.tasks().map(t=>t.status+':'+t.stage).join(',')"));
  ok("3D 画布已隐藏", await evalIn("document.getElementById('g3d').style.display==='none'"));
  ok("解析含「已按指定 2D」", await evalIn("document.getElementById('analysis').textContent.indexOf('已按指定 2D')>=0"), await evalIn("document.getElementById('analysis').textContent.slice(0,60)"));
  await shot("feature_dim_2d.png");

  console.log("\n=== B. 微调：只改解析（不动图形） ===");
  await evalIn("var r=document.getElementById('rtarget');r.value='text';r.dispatchEvent(new Event('change'));var i=document.getElementById('rin');i.value='解析再详细一些';i.dispatchEvent(new Event('input'));document.getElementById('btnRefine').click();1");
  const pendText = await until("document.getElementById('reviewBar').classList.contains('show')", 90000, 500);
  ok("微调结果待确认", !!pendText);
  ok("解析已加详细（answer 标记）", await evalIn("document.getElementById('answer').textContent.indexOf('解析已按要求补充')>=0"));
  ok("图形未被切换（仍无 3D 画布）", await evalIn("document.getElementById('g3d').style.display==='none'"));
  ok("微调选项被记忆（target=text）", await evalIn("(JSON.parse(localStorage.getItem('solver_refine_opts_v1')||'{}')).target==='text'"));
  const idx1 = await api("/api/store/index");
  const rec1 = await api("/api/store/record/" + encodeURIComponent(idx1.items[0].id));
  ok("待确认期间记录未落库", String(rec1.analysis || "").indexOf("解析已按要求补充") < 0);
  await shot("feature_refine_text.png");
  await evalIn("document.getElementById('rbRevert').click();1");
  await sleep(500);
  ok("撤销回退恢复原解析", await evalIn("document.getElementById('answer').textContent.indexOf('解析已按要求补充')<0"));
  ok("微调按钮解锁", await evalIn("!document.getElementById('btnRefine').disabled"));

  console.log("\n=== C. 微调：切换 3D ===");
  await evalIn("var r=document.getElementById('rtarget');r.value='auto';r.dispatchEvent(new Event('change'));var d=document.getElementById('rdim');d.value='3d';d.dispatchEvent(new Event('change'));var i=document.getElementById('rin');i.value='把图形换成 3D 看看';i.dispatchEvent(new Event('input'));document.getElementById('btnRefine').click();1");
  const pend3 = await until("document.getElementById('reviewBar').classList.contains('show')", 90000, 500);
  ok("微调待确认", !!pend3);  ok("3D 画布已出现", await evalIn("document.getElementById('g3d').style.display!=='none'"));
  ok("答案含「切换 3D」", await evalIn("document.getElementById('answer').textContent.indexOf('切换 3D')>=0"));
  await evalIn("document.getElementById('rbKeep').click();1");
  await sleep(600);
  const idx2 = await api("/api/store/index");
  const rec2 = await api("/api/store/record/" + encodeURIComponent(idx2.items[0].id));
  ok("确认保留后落库（render3d 非空）", !!(rec2.render3d && rec2.render3d.points && rec2.render3d.points.length));
  ok("refined 计数 +1", (idx2.items[0].refined || 0) >= 1, "refined=" + idx2.items[0].refined);
  await shot("feature_refine_3d.png");

  console.log("\n=== D. 图片题：题干回显 + 题图裁剪 ===");
  const imgLen = await evalIn(`(function(){
    var c=document.createElement('canvas');c.width=480;c.height=360;
    var x=c.getContext('2d');
    for(var i=0;i<480;i+=4){for(var j=0;j<360;j+=4){x.fillStyle='rgb('+((Math.random()*255)|0)+','+((Math.random()*255)|0)+','+((Math.random()*255)|0)+')';x.fillRect(i,j,4,4);}}
    var u=c.toDataURL('image/png');
    var bin=atob(u.split(',')[1]);var a=new Uint8Array(bin.length);
    for(var k=0;k<bin.length;k++)a[k]=bin.charCodeAt(k);
    SolverDebug.addImageFile(new File([a],'q.png',{type:'image/png'}));
    return u.length;
  })()`);
  await until("document.querySelectorAll('#thumbs .thumb').length===1", 8000, 300);
  ok("测试图片已加入（>10KB 校验通过）", imgLen > 10000, imgLen + " 字符 dataURL");
  await evalIn("document.getElementById('q').value='';document.getElementById('go').click();1");
  const sImg = await until("document.getElementById('status').textContent.indexOf('脚本')>=0", 90000, 500);
  ok("图片题解出（2D mock）", !!sImg);
  await until("(function(){var c=document.getElementById('qTextFloat');return !!c && c.hidden!==true;})()", 8000, 300);
  // 原题卡已迁成画布悬浮窗（#qTextFloat / #qFigFloat），旧 #qCard 已删除
  ok("题目卡显示", await evalIn("(function(){var c=document.getElementById('qTextFloat');return !!c && c.hidden!==true && document.getElementById('qText').textContent.indexOf('mock 识别题干')>=0;})()"));
  await until("(function(){var im=document.querySelector('#qFig img.qfig-main');return im&&im.naturalWidth>0&&im.src.indexOf('data:image/jpeg')===0;})()", 8000, 300);
  ok("题图已单独裁剪显示（jpeg）", await evalIn("(function(){var im=document.querySelector('#qFig img.qfig-main');return !!(im&&im.src.indexOf('data:image/jpeg')===0&&im.naturalWidth>50);})()"),
    await evalIn("(function(){var im=document.querySelector('#qFig img.qfig-main');return im?im.naturalWidth+'x'+im.naturalHeight:'无';})()"));
  ok("提供「查看整张原图」入口", await evalIn("!!document.querySelector('#qFig .qfig-open')"));
  const idx3 = await api("/api/store/index");
  ok("历史列表用识别题干占位", String(idx3.items[0].questionText || "").indexOf("mock 识别题干") >= 0);
  const rec3 = await api("/api/store/record/" + encodeURIComponent(idx3.items[0].id));
  ok("记录已存 questionText", String(rec3.questionText || "").indexOf("mock 识别题干") >= 0);
  ok("记录已存 figureBox", !!(rec3.figureBox && Math.abs(rec3.figureBox.x - 0.06) < 1e-6 && Math.abs(rec3.figureBox.w - 0.88) < 1e-6), JSON.stringify(rec3.figureBox));
  await shot("feature_image_question.png");

  console.log("\n=== E. 刷新后回看 + 导出离线 HTML ===");
  await send("Page.reload");
  await until("!!(window.mathHTML&&document.getElementById('go')&&window.SolverDebug)", 30000);
  await evalIn("document.getElementById('btnHist').click();1");
  await until("!!document.querySelector('#histList .hist-item')", 8000, 300);
  await evalIn("document.querySelector('#histList .hist-item').click();1");
  await until("document.getElementById('qCard').style.display!=='none'", 8000, 300);
  ok("刷新后回看图片题：题干卡在", await evalIn("document.getElementById('qText').textContent.indexOf('mock 识别题干')>=0"));
  ok("刷新后回看图片题：题图裁剪在", await until("(function(){var im=document.querySelector('#qFig img.qfig-main');return !!(im&&im.naturalWidth>50);})()", 8000, 300));

  await evalIn("(function(){window.__capHref='';var o=HTMLAnchorElement.prototype.click;window.__origClick=o;HTMLAnchorElement.prototype.click=function(){window.__capHref=this.href;};})();document.getElementById('btnHtml').click();1");
  await until("!!window.__capHref", 60000, 400);
  const expOk = await evalIn("fetch(window.__capHref).then(function(r){return r.text();}).then(function(t){window.__expText=t;return t.length;})", 60000);
  ok("导出文件已生成", expOk > 100000, expOk + " 字符");
  const checks = await evalIn(`(function(){var t=window.__expText||'';return JSON.stringify({
    hasRec: t.indexOf('var HJ_REC=')>=0,
    hasQText: t.indexOf('"questionText":"（mock 识别题干）')>=0,
    hasTitle: t.indexOf('<h3>题目</h3>')>=0,
    hasFig: t.indexOf('class="qfig"')>=0,
    hasFigBox: t.indexOf('"figureBox"')>=0
  });})()`);
  const cj = JSON.parse(checks);
  ok("导出含 HJ_REC", cj.hasRec);
  ok("导出含 questionText", cj.hasQText);
  ok("导出含题目区块", cj.hasTitle);
  ok("导出含题图", cj.hasFig);
  ok("导出含 figureBox", cj.hasFigBox);
  await evalIn("HTMLAnchorElement.prototype.click=window.__origClick;1");
  await shot("feature_export.png");

  console.log("\n=== F. 过期任务不覆盖新结果 ===");
  // 先发起一个慢任务（mock 支持「慢速N」），再发起一个正常任务；慢任务后返回不得覆盖
  await evalIn("var d=document.getElementById('dim');d.value='2d';d.dispatchEvent(new Event('change'));document.getElementById('q').value='慢速6：先发起的旧题';document.getElementById('go').click();1");
  await sleep(400);
  await evalIn("document.getElementById('q').value='后发起的新题：在 Rt△ABC 中，∠C=90°，AC=3，BC=4，求 AB 的长。';document.getElementById('go').click();1");
  const newDone = await until("document.getElementById('status').textContent.indexOf('脚本')>=0", 90000, 500);
  ok("后发起的题先解出", !!newDone, await evalIn("document.getElementById('status').textContent"));
  await sleep(9000);
  ok("旧任务晚返回未覆盖解答", await evalIn("document.getElementById('status').textContent.indexOf('脚本')>=0 && document.getElementById('answer').textContent.indexOf('10')>=0"),
    await evalIn("document.getElementById('status').textContent + ' || ' + document.getElementById('answer').textContent.slice(0,30)"));
  ok("旧任务被标为结果过期", await evalIn("SolverDebug.tasks().some(function(t){return String(t.stage||'').indexOf('结果已过期')>=0;})"),
    await evalIn("SolverDebug.tasks().map(function(t){return t.stage;}).join(' | ')"));
  await shot("feature_stale_task.png");

  console.log("\n=== G. 左上角图标回首页 ===");
  await evalIn("document.getElementById('btnHome').click();1");
  await sleep(600);
  const home = await evalIn("({last:SolverDebug.last(),q:document.getElementById('q').value,answer:document.getElementById('answer').textContent,status:document.getElementById('status').textContent,welcome:getComputedStyle(document.getElementById('welcome')).display,chat:document.getElementById('chatCard').style.display})");
  ok("回首页清空当前解答", home.last === null && home.q === "" && home.answer === "—" && home.status === "就绪", JSON.stringify(home));
  ok("回首页显示欢迎页并隐藏追问", home.welcome !== "none" && home.chat === "none");
  const hw = await evalIn("[getComputedStyle(document.querySelector('#rightPanel .ph-t')).fontWeight,getComputedStyle(document.querySelector('#ansCard .cardh')).fontWeight,getComputedStyle(document.querySelector('#refine .rh')).fontWeight]");
  ok("解答/解析/微调区头已加粗", hw.every(function(x){return parseInt(x,10)>=700}), JSON.stringify(hw));

  console.log("\n----------------------------------------");
  try { proc.kill(); } catch (e) {}
  try { fs.copyFileSync(SETTINGS_BAK, SETTINGS); console.log("settings.json 已恢复为测试前备份"); } catch (e) { console.log("恢复 settings.json 失败：" + e.message); }
  if (fails) { console.log("结果：有 " + fails + " 项失败"); process.exit(1); }
  console.log("结果：全部通过");
  process.exit(0);
})().catch((e) => { console.log("FATAL " + e.message); process.exit(1); });
