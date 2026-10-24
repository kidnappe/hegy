// 微调记录 / 版本快照自检（方案 1）
// 用法: node tools\versions_test.js   （需 8099 + 8098 在跑；改过 solver.js 直接跑即可）
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
require("./_cfg_guard").install(); // U-17：跑前备份真实配置，退出/异常一律恢复
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9415;
const APP = "http://127.0.0.1:8099/solver/index.html";
const API = "http://127.0.0.1:8099";
const TEST_DIR = path.join(os.tmpdir(), "hegy-version-test");
const DL_DIR = path.join(os.tmpdir(), "hegy-version-dl");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, x) => { if (c) console.log("  ok   " + n + (x ? "  [" + x + "]" : "")); else { console.log("  FAIL " + n + (x ? "  [" + x + "]" : "")); fails++; } };
const apiPost = async (p, b) => (await fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) })).json();
const recGet = async (id) => (await fetch(API + "/api/store/record/" + encodeURIComponent(id))).json();

(async () => {
  await fs.promises.mkdir(TEST_DIR, { recursive: true });
  await fs.promises.mkdir(DL_DIR, { recursive: true });
  for (const f of await fs.promises.readdir(DL_DIR)) await fs.promises.unlink(path.join(DL_DIR, f)).catch(() => {});
  const proc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + path.join(os.tmpdir(), "edge-diag-versions"),
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json(); break; } catch (e) { await sleep(250); } }
  if (!ver) throw new Error("no devtools");
  const t = await (await fetch("http://127.0.0.1:" + PORT + "/json/new?" + encodeURIComponent(APP), { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  await new Promise((r) => ws.addEventListener("open", r));
  const send = (m, p) => new Promise((res) => {
    const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); res({}); } }, 20000);
  });
  const evalIn = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) console.log("  eval-err", JSON.stringify((((r.result.exceptionDetails.exception || {}).description) || "").slice(0, 300))); return r.result && r.result.result ? r.result.result.value : null; };
  const until = async (expr, ms, step) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await evalIn(expr).catch(() => false); if (v) return v; await sleep(step || 400); } return false; };
  const ready = "!!(window.SolverDebug&&document.getElementById('go')&&document.getElementById('verToggle'))";
  const idle = "SolverDebug.tasks().filter(function(t){return t.status==='running'}).length===0";
  const openVers = async () => { if (!(await evalIn("document.getElementById('verCard').classList.contains('open')"))) { await evalIn("document.getElementById('verToggle').click();1"); await sleep(300); } };

  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL_DIR });
  await apiPost("/api/cfg", { config: { baseUrl: "http://127.0.0.1:8098/v1", apiKey: "mock", model: "mock", temperature: 0.2 } });
  await apiPost("/api/store/dir", { dir: TEST_DIR, migrate: false });
  await apiPost("/api/store/purge", {});
  await send("Page.reload"); await until(ready, 30000);
  await evalIn("localStorage.setItem('solver_cfg_v1', JSON.stringify({baseUrl:'http://127.0.0.1:8098/v1',apiKey:'mock',model:'mock',temperature:0.2}));localStorage.removeItem('solver_tasks_v1');localStorage.removeItem('solver_ver_open_v1');1");
  await send("Page.reload"); await until(ready, 30000);

  console.log("\n=== A. 首次解题：生成 v1 ===");
  await evalIn("document.getElementById('q').value='正方体中，求体对角线 AC1 的长度。';document.getElementById('go').click();1");
  const solved = await until(idle + "&&!!(SolverDebug.last()&&SolverDebug.last().result&&SolverDebug.last().result.versions)", 120000);
  ok("解题完成并生成版本", !!solved);
  const id1 = await evalIn("SolverDebug.recId()");
  const v1 = await evalIn("SolverDebug.versions()");
  ok("初始只有 1 个版本", v1 && v1.list.length === 1, "len=" + (v1 && v1.list.length));
  ok("v1 是 3D", !!(v1 && v1.list[0].render3d), "3d=" + !!(v1 && v1.list[0].render3d));
  ok("只有 1 版时抽屉隐藏", await evalIn("document.getElementById('verCard').style.display==='none'"));
  ok("审查条默认隐藏", !(await evalIn("document.getElementById('reviewBar').classList.contains('show')")));

  console.log("\n=== B. 3D → 2D：存为新版本 ===");
  await evalIn("document.getElementById('rdim').value='2d';document.getElementById('rin').value='把图形改成平面图';document.getElementById('btnRefine').click();1");
  ok("微调结果待确认", !!(await until("document.getElementById('reviewBar').classList.contains('show')", 120000, 300)));
  ok("审查条有「存为新版本」", (await evalIn("document.getElementById('rbKeep').textContent")) === "存为新版本");
  ok("审查条有「覆盖当前版本」", !!(await evalIn("document.getElementById('rbOverwrite')")));
  await evalIn("document.getElementById('rbKeep').click();1");
  await until("!document.getElementById('reviewBar').classList.contains('show')", 5000);
  await sleep(900);
  let rec = await recGet(id1);
  ok("记录里有 2 个版本", rec && rec.versions && rec.versions.length === 2, "len=" + (rec && rec.versions && rec.versions.length));
  ok("currentVid=2", rec && rec.currentVid === 2, "cur=" + (rec && rec.currentVid));
  ok("顶层已是 2D（render3d 清空）", rec && !rec.render3d && !!rec.renderCode, "3d=" + !!(rec && rec.render3d));
  ok("v1 保留原 3D 图形", !!(rec && rec.versions[0].render3d && rec.versions[0].render3d.points && rec.versions[0].render3d.points.length));
  ok("v2 是 2D", !!(rec && rec.versions[1].renderCode && !rec.versions[1].render3d));
  ok("抽屉显示 2 个版本", (await evalIn("document.getElementById('verCard').style.display!=='none'&&document.getElementById('verCount').textContent")) === "2 个版本");

  console.log("\n=== C. 预览 v1（3D）不改记录 ===");
  await openVers();
  ok("抽屉展开后有 2 行", (await evalIn("document.querySelectorAll('#verList .ver-item').length")) === 2);
  const costRows = await evalIn("[...document.querySelectorAll('#verList .ver-item .ver-cost')].map(function(x){return x.textContent})");
  ok("每版显示 tokens 消耗", costRows.length === 2 && costRows.every(function(x){return /tokens \d+/.test(x);}), JSON.stringify(costRows));
  ok("每版显示资费", costRows.length === 2 && costRows.every(function(x){return x.indexOf("资费") >= 0;}), JSON.stringify(costRows));
  await evalIn("document.querySelector('#verList .ver-item[data-vid=\"1\"]').click();1");
  await sleep(600);
  ok("出现预览提示条", await evalIn("document.getElementById('verPreview').classList.contains('show')"));
  ok("预览的是 v1 · 3D", (await evalIn("document.getElementById('verPreviewTxt').textContent")) === "预览 v1 · 3D");
  ok("预览提示条移到画布左上角", await evalIn("(function(){var s=document.getElementById('stage').getBoundingClientRect(),p=document.getElementById('verPreview').getBoundingClientRect();return Math.abs(p.left-s.left-14)<2&&Math.abs(p.top-s.top-14)<2;})()"));
  ok("预览提示条不再挡右上工具栏", await evalIn("(function(){var p=document.getElementById('verPreview').getBoundingClientRect(),t=document.getElementById('toolbar').getBoundingClientRect();return p.right<=t.left||p.bottom<=t.top;})()"));
  ok("画布切到 3D", await evalIn("document.getElementById('g3d').style.display==='block'"));
  ok("记录未被改动（currentVid 仍 2）", (await recGet(id1)).currentVid === 2);
  ok("预览态屏蔽微调", await evalIn("(function(){document.getElementById('rin').value='随便改改';document.getElementById('btnRefine').click();return document.getElementById('status').textContent.indexOf('已回到当前版本')>=0;})()"));

  console.log("\n=== D. 设为当前 / 切回 ===");
  await sleep(500);
  await openVers();
  const setCurTip = await evalIn("(document.querySelector('#verList .ver-item[data-vid=\"1\"] .ver-acts button')||{}).title");
  ok("非当前版本按钮的悬停文案为「设为当前」", setCurTip === "设为当前", setCurTip || "");
  await evalIn("(document.querySelector('#verList .ver-item[data-vid=\"1\"] .ver-acts button')||{click:function(){}}).click();1");
  await sleep(900);
  rec = await recGet(id1);
  ok("切到 v1 后 currentVid=1", rec.currentVid === 1, "cur=" + rec.currentVid);
  ok("切到 v1 后顶层恢复 3D", !!(rec.render3d && rec.render3d.points), "3d=" + !!rec.render3d);
  ok("切到 v1 后画布是 3D", await evalIn("document.getElementById('g3d').style.display==='block'"));
  await evalIn("(document.querySelector('#verList .ver-item[data-vid=\"2\"] .ver-acts button')||{click:function(){}}).click();1");
  await sleep(900);
  rec = await recGet(id1);
  ok("切回 v2 后 currentVid=2", rec.currentVid === 2, "cur=" + rec.currentVid);
  ok("切回 v2 后顶层是 2D", !rec.render3d && !!rec.renderCode);

  console.log("\n=== E. 刷新后持久化 ===");
  await send("Page.reload"); await until(ready, 30000);
  await evalIn("document.getElementById('btnHist').click();1");
  await until("document.getElementById('histModal').classList.contains('show')", 5000);
  await evalIn("document.querySelector('#histList .hist-item').click();1");
  ok("重新载入记录成功", !!(await until("SolverDebug.recId()===" + JSON.stringify(id1), 10000, 250)));
  const vr = await until("(function(){var v=SolverDebug.versions();return v&&v.list.length===2?v.currentVid:0;})()", 5000, 250);
  ok("刷新后仍是 2 版、当前 v2", vr === 2, "cur=" + vr);
  ok("历史列表显示版本数", (await evalIn("document.querySelector('#histList .hist-item .sub').textContent")).indexOf("2 版") >= 0);

  console.log("\n=== F. 导出包含版本 ===");
  await evalIn("document.getElementById('btnHtml').click();1");
  let file = "";
  for (let i = 0; i < 120; i++) {
    const fs2 = await fs.promises.readdir(DL_DIR).catch(() => []);
    file = fs2.filter((f) => /\.html$/i.test(f))[0] || "";
    if (file) break;
    await sleep(500);
  }
  ok("导出文件已生成", !!file, file);
  if (file) {
    const html = await fs.promises.readFile(path.join(DL_DIR, file), "utf8");
    const m = html.match(/var HJ_REC=(\{[\s\S]*?\});\n/);
    let hj = null; try { hj = m ? JSON.parse(m[1]) : null; } catch (e) {}
    ok("导出 HJ_REC 带 versions", !!(hj && hj.versions && hj.versions.length === 2), "len=" + (hj && hj.versions && hj.versions.length));
    ok("导出 HJ_REC.currentVid=2", !!(hj && hj.currentVid === 2), "cur=" + (hj && hj.currentVid));
  }

  console.log("\n=== G. 覆盖当前版本 ===");
  await evalIn("document.getElementById('rtarget').value='text';document.getElementById('rdim').value='';document.getElementById('rin').value='解析再详细些';document.getElementById('btnRefine').click();1");
  ok("覆盖前待确认", !!(await until("document.getElementById('reviewBar').classList.contains('show')", 120000, 300)));
  await evalIn("document.getElementById('rbOverwrite').click();1");
  await until("!document.getElementById('reviewBar').classList.contains('show')", 5000);
  await sleep(900);
  rec = await recGet(id1);
  ok("覆盖后版本数不变（2）", rec.versions.length === 2, "len=" + rec.versions.length);
  ok("覆盖后 currentVid 仍 2", rec.currentVid === 2);
  ok("当前版本内容已更新", String(rec.answer || "").indexOf("解析已按要求补充") >= 0, String(rec.answer || "").slice(0, 30));
  ok("v1 的 3D 图形未受影响", !!(rec.versions[0].render3d && rec.versions[0].render3d.points));

  console.log("\n=== H. 撤销回退 ===");
  await evalIn("document.getElementById('rdim').value='3d';document.getElementById('rin').value='改成 3D';document.getElementById('btnRefine').click();1");
  ok("撤销前待确认", !!(await until("document.getElementById('reviewBar').classList.contains('show')", 120000, 300)));
  await evalIn("document.getElementById('rbRevert').click();1");
  await sleep(700);
  rec = await recGet(id1);
  ok("撤销后版本数不变（2）", rec.versions.length === 2, "len=" + rec.versions.length);
  ok("撤销后仍为 2D 文本版", !rec.render3d, "3d=" + !!rec.render3d);
  ok("撤销后审查条关闭", !(await evalIn("document.getElementById('reviewBar').classList.contains('show')")));

  console.log("\n=== I. 复制为新记录 ===");
  const before = (await (await fetch(API + "/api/store/index")).json()).items.length;
  await openVers();
  await evalIn("document.querySelector('#verList .ver-item[data-vid=\"1\"] .ver-acts button[title*=\"复制\"]').click();1");
  const grew = await until("fetch('/api/store/index').then(function(r){return r.json()}).then(function(j){return j.items.length===" + (before + 1) + "})", 8000, 500);
  ok("历史记录 +1", !!grew, "before=" + before);
  const hist = (await (await fetch(API + "/api/store/index")).json()).items;
  const fork = hist.filter((x) => x.id !== id1)[0];
  ok("复制出的记录是 3D", !!(fork && fork.has3d));
  const forkRec = fork ? await recGet(fork.id) : null;
  ok("复制记录无旧版本（独立 v1）", !!(forkRec && (!forkRec.versions || forkRec.versions.length === 1)));
  ok("复制记录带 parentId", !!(forkRec && forkRec.parentId === id1));

  console.log("\n=== J. 删除版本 ===");
  await evalIn("window.confirm=function(){return true};1");
  await openVers();
  await evalIn("document.querySelector('#verList .ver-item[data-vid=\"1\"] .ver-acts button.danger').click();1");
  await sleep(900);
  rec = await recGet(id1);
  ok("删除后只剩 1 个版本", rec.versions.length === 1, "len=" + rec.versions.length);
  ok("删除后 currentVid 仍指向存在的版本", rec.currentVid === rec.versions[0].vid, "cur=" + rec.currentVid);
  ok("删除后抽屉隐藏", await evalIn("document.getElementById('verCard').style.display==='none'"));

  console.log("\n=== 结果 ===");
  console.log(fails ? "失败 " + fails + " 项" : "全部通过");
  try { ws.close(); } catch (e) {}
  try { proc.kill(); } catch (e) {}
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
