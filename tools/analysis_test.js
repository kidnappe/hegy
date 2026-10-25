// 解析渲染自检：① 多小问/选择题按块区分 ② 裸 LaTeX（无 $ 分隔符）兜底渲染
// 用法: node tools\analysis_test.js   （需 8099 + 8098 在跑；改过 mock.js 要先重启 mock）
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
require("./_cfg_guard").install(); // U-17：跑前备份真实配置，退出/异常一律恢复
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9414;
const APP = "http://127.0.0.1:8099/solver/index.html";
const API = "http://127.0.0.1:8099";
const TEST_DIR = "D:\\software\\tmp\\opencode\\hegy-analysis-test";
const SHOTS = path.join(__dirname, "shots_new");
const HOME = path.join(os.homedir(), ".hegy");
const SETTINGS = path.join(HOME, "settings.json");
const SETTINGS_BAK = path.join(HOME, "settings.json.bak_agent");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, x) => { if (c) console.log("  ok   " + n + (x ? "  [" + x + "]" : "")); else { console.log("  FAIL " + n + (x ? "  [" + x + "]" : "")); fails++; } };
const apiPost = async (p, b) => (await fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) })).json();

// 真实记录（C:\Users\Admin\Documents\Hegy\records\r1792399255048_853.json）的解析原文：
// 模型没有写任何 $ 分隔符，直接裸写 LaTeX，且解析按选项 A：B：C：D：分段
const REAL_ANA = [
  "以 A 为原点，AB、AC、AA₁ 分别为 x、y、z 轴：A(0,0,0)，B(3,0,0)，C(0,3,0)，A₁(0,0,3)。平面 A₁BC 为 x+y+z=3，法向量 (1,1,1)，A 到该平面距离 h=\\sqrt{3}，垂足 O=(1,1,1)。",
  "设 P∈△A₁BC。AP 与平面 A₁BC 成 45°，故 \\sin45°=\\frac{h}{AP}，得 AP=\\sqrt{6}。又 AO⊥平面，所以 AP^2=AO^2+OP^2，即 6=3+OP^2，OP=\\sqrt{3}。因此 P 的轨迹是平面内以 O 为圆心、\\sqrt{3} 为半径的圆落在 △A₁BC 内的部分。",
  "A：A₁O=\\sqrt{6}，圆半径 \\sqrt{3}。A₁ 到圆上点的最小距离为 \\sqrt{6}-\\sqrt{3}，对应点在 A₁O 线段上且在三角形内，所以 A 正确。",
  "B：取靠近 B 的点 P(\\frac{3+\\sqrt{3}}{2},\\frac{3-\\sqrt{3}}{2},0)，则 A₁P^2=(\\frac{3+\\sqrt{3}}{2})^2+(\\frac{3-\\sqrt{3}}{2})^2+3^2=6+9=15，最大值为 \\sqrt{15}，所以 B 错误。",
  "C：A₁P⊥BC 时，该直线与圆有两个交点，一个在三角形内，另一个在三角形外。因此满足条件的 P 有且仅有一个，C 正确。",
  "D：所有 AP 长度均为 \\sqrt{6}，形成以 A 为顶点、底面圆半径 \\sqrt{3} 的曲面，面积为 3\\sqrt{2}\\pi/4，D 正确。"
].join("\n");

const REAL_ANA2 = [
  "设 $A(0,0,0)$，$B(3,0,0)$，$C(0,3,0)$，$A_1(0,0,3)$。",
  "平面 $A_1BC$ 的方程为 $x+y+z=3$，点 $A$ 到该平面的距离 $d=\\frac{3}{\\sqrt3}=\\sqrt3$。",
  "(1) $A_1H=\\sqrt6$，所以到 $A_1$ 最近的轨迹点在 $A_1H$ 上，$A_1P_{\\min}=\\sqrt6-\\sqrt3$。",
  "(2) 轨迹在三角形内被三条边截断，夹角最大为 $135^\\circ$。",
  "(3) $A_1P\\perp BC$ 等价于 $P$ 在 $A_1H$ 上，交点只有一个在三角形内。",
  "(4) 圆与每条边所截得的内侧圆弧圆心角为 $30^\\circ$，三段总弧长 $L=3\\cdot\\sqrt3\\cdot\\frac{\\pi}{4}$。",
  "综上，选 ACD。"
].join("\n");

(async () => {
  await fs.promises.mkdir(SHOTS, { recursive: true });
  await fs.promises.mkdir(TEST_DIR, { recursive: true });
  const proc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + path.join(os.tmpdir(), "edge-diag-analysis"),
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
  const evalIn = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) console.log("  eval-err", JSON.stringify(((r.result.exceptionDetails.exception || {}).description || "").slice(0, 200))); return r.result && r.result.result ? r.result.result.value : null; };
  const until = async (expr, ms, step) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await evalIn(expr).catch(() => false); if (v) return v; await sleep(step || 400); } return false; };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(s.result.data, "base64")); console.log("  shot " + name); };
  const ready = "!!(window.mathHTML&&document.getElementById('go')&&window.SolverDebug&&SolverDebug.anaSplit)";

  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await apiPost("/api/cfg", { config: { baseUrl: "http://127.0.0.1:8098/v1", apiKey: "mock", model: "mock", temperature: 0.2 } });
  await apiPost("/api/store/dir", { dir: TEST_DIR, migrate: false });
  await apiPost("/api/store/purge", {});
  await send("Page.reload"); await until(ready, 30000);
  await evalIn("localStorage.setItem('solver_cfg_v1', JSON.stringify({baseUrl:'http://127.0.0.1:8098/v1',apiKey:'mock',model:'mock',temperature:0.2}));localStorage.removeItem('solver_tasks_v1');1");
  await send("Page.reload"); await until(ready, 30000);

  console.log("\n=== A. 分块识别（纯函数） ===");
  const jsReal = JSON.stringify(REAL_ANA);
  const nReal = await evalIn("(function(){var bl=SolverDebug.anaSplit(" + jsReal + ");return bl?bl.length:-1;})()");
  ok("真实记录解析切成 A/B/C/D 四块", nReal === 4, "块数=" + nReal);
  const tagsReal = await evalIn("(function(){var bl=SolverDebug.anaSplit(" + jsReal + ")||[];return bl.map(function(b){return b.tag;}).join(',');})()");
  ok("分块标签为 A,B,C,D", tagsReal === "A,B,C,D", tagsReal);
  const nSub = await evalIn("(function(){var bl=SolverDebug.anaSplit('（1）第一问解析。\\n（2）第二问解析。\\n（3）第三问解析。');return bl?bl.map(function(b){return b.tag;}).join(','):'-1';})()");
  ok("（1）（2）（3）按小问切分", nSub === "(1),(2),(3)", nSub);
  const nSub2 = await evalIn("(function(){var bl=SolverDebug.anaSplit('(1) 先算 AB。\\n(2) 再算 AC。');return bl?bl.map(function(b){return b.tag;}).join(','):'-1';})()");
  ok("(1)(2) 半角括号也能切分", nSub2 === "(1),(2)", nSub2);
  const nReal2 = await evalIn("(function(){var bl=SolverDebug.anaSplit(" + JSON.stringify(REAL_ANA2) + ");return bl?bl.map(function(b){return b.tag;}).join(','):'-1';})()");
  ok("真实记录 2（(1)…(4) 写法）切成 4 块", nReal2 === "(1),(2),(3),(4)", nReal2);
  const real2Body = await evalIn("(function(){var bl=SolverDebug.anaSplit(" + JSON.stringify(REAL_ANA2) + ")||[];return bl.length?bl[0].text.slice(0,24):'';})()");
  ok("分块保留「综上，选 ACD」所在段", /综上/.test(await evalIn("(function(){var bl=SolverDebug.anaSplit(" + JSON.stringify(REAL_ANA2) + ")||[];return bl.length?bl[bl.length-1].text:'';})()")), real2Body);
  const nSteps = await evalIn("(function(){return SolverDebug.anaSplit('1) AD 平分角 BAC ⇒ 40°。\\n2) FE⊥BC ⇒ 推出关系。\\n3) 代入得 10°。')===null;})()");
  ok("解题步骤 1) 2) 3) 不误切", nSteps === true, "anaSplit=" + await evalIn("JSON.stringify(SolverDebug.anaSplit('1) AD 平分角 BAC ⇒ 40°。\\n2) FE⊥BC ⇒ 推出关系。'))"));
  const nSingle = await evalIn("(function(){return SolverDebug.anaSplit('一句话解析，没有分块。')===null;})()");
  ok("单段解析不切块", nSingle === true);

  console.log("\n=== B. 渲染（纯函数） ===");
  const htmlReal = await evalIn("SolverDebug.anaHTML(" + jsReal + ")");
  ok("anaHTML 输出 4 个色条块", (htmlReal.match(/class="ana-blk"/g) || []).length === 4, "块数=" + (htmlReal.match(/class="ana-blk"/g) || []).length);
  ok("anaHTML 带标签 chip", (htmlReal.match(/class="ana-tag"/g) || []).length === 4);
  ok("anaHTML 用了轮换色 (data-k 0..3)", /data-k="0"/.test(htmlReal) && /data-k="3"/.test(htmlReal));
  ok("裸 LaTeX 被包成 KaTeX（无残留 \\sqrt 字面量）", htmlReal.indexOf("katex") >= 0 && htmlReal.indexOf("\\sqrt") < 0, "katex 次数=" + (htmlReal.match(/katex/g) || []).length);
  const m1 = await evalIn("window.mathHTML('h=\\\\sqrt{3}')");
  ok("mathHTML 兜底：h=\\sqrt{3}", m1.indexOf("katex") >= 0 && m1.indexOf("\\sqrt") < 0);
  const m2 = await evalIn("window.mathHTML('AP^2=AO^2+OP^2')");
  ok("mathHTML 兜底：AP^2=AO^2+OP^2", m2.indexOf("katex") >= 0, m2.slice(0, 60));
  const m3 = await evalIn("window.mathHTML('三角形的中线把面积平分')");
  ok("纯中文不受影响", m3 === "三角形的中线把面积平分", JSON.stringify(m3));
  const m4 = await evalIn("window.mathHTML('文件 r1792_853.json 已导出')");
  ok("文件名 r1792_853 不被误判成公式", m4.indexOf("katex") < 0, JSON.stringify(m4));
  const m5 = await evalIn("window.mathHTML('$\\\\sqrt{3}$ 已经带分隔符')");
  ok("已有 $...$ 不受影响", (m5.match(/katex/g) || []).length >= 1 && m5.indexOf("\\sqrt") < 0);

  console.log("\n=== C. 端到端：选择题按选项分块 ===");
  await evalIn("document.getElementById('q').value='（多选）在三棱锥中，求各选项是否正确。';document.getElementById('go').click();1");
  const gotChoice = await until("document.querySelectorAll('#analysis .ana-blk').length===4", 60000, 400);
  if (!gotChoice) console.log("  diag status=", await evalIn("document.getElementById('status').textContent"), "| ana=", await evalIn("document.getElementById('analysis').textContent.slice(0,80)"));
  await sleep(500);
  const c1 = await evalIn("document.querySelectorAll('#analysis .ana-blk').length");
  ok("解析渲染成 4 个选项块", c1 === 4, "块数=" + c1);
  const c2 = await evalIn("[...document.querySelectorAll('#analysis .ana-tag')].map(function(e){return e.textContent;}).join(',')");
  ok("选项块标签 A,B,C,D", c2 === "A,B,C,D", c2);
  const c3 = await evalIn("document.getElementById('analysis').innerText.indexOf('\\\\sqrt')<0 && document.getElementById('analysis').innerText.indexOf('katex')<0");
  ok("块内无裸 LaTeX 残留（\\sqrt 未原样显示）", c3 === true, await evalIn("document.getElementById('analysis').innerText.replace(/\\s+/g,' ').slice(0,90)"));
  const c4 = await evalIn("document.querySelectorAll('#analysis .ana-blk .katex').length>=4");
  ok("块内公式已用 KaTeX 渲染", c4 === true, "katex 节点=" + await evalIn("document.querySelectorAll('#analysis .ana-blk .katex').length"));
  const c5 = await evalIn("(function(){var b=document.querySelectorAll('#analysis .ana-blk');var r0=b[0].getBoundingClientRect(),r1=b[1].getBoundingClientRect();var cs=getComputedStyle(b[0]);return {gap:Math.round(r1.top-r0.bottom),border:cs.borderLeftWidth,color:cs.borderLeftColor};})()");
  ok("块之间有间隔 + 左侧色条", c5 && c5.gap >= 4 && parseInt(c5.border) >= 2, JSON.stringify(c5));
  await shot("feature_ana_choice.png");

  console.log("\n=== D. 端到端：多小问解析分块 + 单问视图 ===");
  await evalIn("document.getElementById('analysis').innerHTML='';document.getElementById('q').value='AD 平分∠BAC，求∠DFE。';document.getElementById('go').click();1");
  const gotSubs = await until("document.querySelectorAll('#subTabs button').length>0 && document.querySelectorAll('#analysis .ana-blk').length===4", 60000, 400);
  if (!gotSubs) console.log("  diag status=", await evalIn("document.getElementById('status').textContent"), "| tabs=", await evalIn("document.getElementById('subTabs').innerText.replace(/\\s+/g,' ')"), "| err=", await evalIn("(document.getElementById('status').textContent||'').slice(0,80)"));
  await sleep(500);
  const d1 = await evalIn("document.querySelectorAll('#analysis .ana-blk').length");
  ok("多小问：总述块 + 3 个小问块", d1 === 4 && await evalIn("document.querySelectorAll('#analysis .ana-blk.lead').length===1"), "块数=" + d1 + " lead=" + await evalIn("document.querySelectorAll('#analysis .ana-blk.lead').length"));
  const d1b = await evalIn("document.querySelectorAll('#analysis .ana-blk.lead .ana-tx').length===1 && document.querySelector('#analysis .ana-blk.lead').getAttribute('data-k')==='lead'");
  ok("总述块无标签、用灰色边条", d1b === true, await evalIn("document.querySelector('#analysis .ana-blk.lead').getAttribute('data-k')"));
  const d1c = await evalIn("document.getElementById('analysis').innerText.indexOf('mock：收到')>=0");
  ok("顶层解析内容仍然显示", d1c === true);
  const d2 = await evalIn("[...document.querySelectorAll('#analysis .ana-tag')].map(function(e){return e.textContent;}).join(',')");
  ok("小问块标签 (1),(2),(3)", d2 === "(1),(2),(3)", d2);
  ok("答案和解析里的 **加粗** 已渲染", await evalIn("document.querySelectorAll('#answer strong').length>0 && document.querySelectorAll('#analysis .ana-blk strong').length>0"));
  await shot("feature_ana_subq.png");
  // 选项卡文案已改为「第(2)问」形式（早于 §44 本轮改动），这里用包含匹配而不是全等
  const subBtn = "[...document.querySelectorAll('#subTabs button')].find(function(b){return /^\\(2\\)$|^\u7b2c\\(2\\)\u95ee$/.test(b.textContent.trim());})";
  ok("小题 tab 存在", await evalIn("!!(" + subBtn + ")"));
  await evalIn("var b=document.querySelector('.anbody');b.scrollTop=b.scrollHeight;1");
  await sleep(250);
  const subScrollBefore = await evalIn("document.querySelector('.anbody').scrollTop");
  await evalIn("(" + subBtn + ").click();1");
  await sleep(900);
  const subJump = await evalIn("(function(){var b=document.querySelector('.anbody'),c=document.getElementById('ansCard');return {top:b.scrollTop,before:" + subScrollBefore + ",card:Math.round(c.getBoundingClientRect().top),body:Math.round(b.getBoundingClientRect().top)};})()");
  ok("点小题后自动滚回答案字段", subJump.top < subJump.before && Math.abs(subJump.card - subJump.body) < 60, JSON.stringify(subJump));
  ok("切到单个小题时不再分块（只显示本问）", await evalIn("document.querySelectorAll('#analysis .ana-blk').length===0 && document.getElementById('answer').innerText.indexOf('mock 小问 2')>=0"), await evalIn("document.getElementById('answer').innerText.replace(/\\s+/g,' ').slice(0,40) + ' / ' + document.getElementById('analysis').innerText.replace(/\\s+/g,' ').slice(0,40)"));
  await evalIn("([...document.querySelectorAll('#subTabs button')].find(function(b){return b.textContent==='全部';})).click();1");
  await sleep(300);
  ok("切回「全部」恢复分块", await evalIn("document.querySelectorAll('#analysis .ana-blk').length===4"));
  const order = await evalIn("[...document.querySelectorAll('#analysis .ana-tag')].map(function(e){return e.textContent;}).join(',')");
  ok("分块顺序与小题一致", order === "(1),(2),(3)", order);

  console.log("\n=== E. 导出页：分块结构 + 内联脚本可编译 ===");
  await evalIn("document.getElementById('analysis').innerHTML='';document.getElementById('q').value='（多选）判断下列 A/B/C/D 四个选项的正误。';document.getElementById('go').click();1");
  await until("document.querySelectorAll('#analysis .ana-blk').length===4", 60000, 400);
  await sleep(500);
  await evalIn("window.__exp=null;(function(){var _c=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__exp=this.href;};return 1;})()");
  await evalIn("document.getElementById('btnHtml').click();1");
  const gotExp = await until("!!(window.__exp&&window.__exp.indexOf('blob:')===0)", 90000, 500);
  ok("点「导出」拿到离线 HTML", !!gotExp);
  const html = await evalIn("fetch(window.__exp).then(r=>r.text())", 60000);
  if (html) {
    fs.writeFileSync(path.join(TEST_DIR, "ana_choice_export.html"), html, "utf8");
    ok("导出 HTML 内嵌 4 个解析块", (html.match(/<span class="ana-tag">[A-H1-9]<\/span>/g) || []).length === 4, "块数=" + (html.match(/<span class="ana-tag">[A-H1-9]<\/span>/g) || []).length);
    ok("导出 HTML 带分块样式（.ana-blks）", /\.ana-blks\{/.test(html) && /\.ana-blk\[data-k="1"\]/.test(html));
    ok("导出 HTML 内联了 anaSplit / anaHTML", /var anaSplit=/.test(html) && /var anaHTML=/.test(html));
    ok("导出 CSS 行内公式不再横向滚动", /\.katex-holder\{[^}]*overflow:visible/.test(html) && !/\.katex-holder\{[^}]*overflow-x:auto/.test(html));
    ok("导出 CSS 隐藏独立公式滚动条", /\.katex-display::-webkit-scrollbar\{display:none\}/.test(html));
    ok("导出页保留 **加粗** 渲染", /<strong>/.test(html));
    const scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/g) || [];
    let bad = "";
    scripts.forEach(function (s) { const js = s.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""); try { new Function(js); } catch (e) { bad += e.message + " | "; } });
    ok("导出内联脚本语法可编译（" + scripts.length + " 段）", bad === "", bad.slice(0, 160));
    ok("导出 HTML 保留原始记录（拖回可还原）", /HJ_REC/.test(html));
  }
  await shot("feature_ana_export_src.png");

  console.log("\n=== F. 微调范围：只改某一个选项 ===");
  const scopeOpts = await evalIn("[...document.getElementById('rscope').options].map(function(o){return o.value+':'+o.textContent;}).join(' | ')");
  ok("选择题出现「按选项」范围下拉", await evalIn("document.getElementById('rscope').style.display!=='none'") && /o:B:仅选项 B/.test(scopeOpts), scopeOpts);
  await evalIn("var s=document.getElementById('rscope');s.value='o:B';s.dispatchEvent(new Event('change'));var r=document.getElementById('rin');r.value='把 B 的解析展开讲，其他选项别动';r.dispatchEvent(new Event('input'));document.getElementById('btnRefine').click();1");
  const gotOpt = await until("document.getElementById('analysis').innerText.indexOf('只改选项 B')>=0", 90000, 500);
  ok("只改选项 B：B 段被展开", !!gotOpt, await evalIn("document.getElementById('analysis').innerText.replace(/\\s+/g,' ').slice(0,90)"));
  const tagOf = "function(b){var t=b.querySelector('.ana-tag');return t?t.textContent:'';}";
  ok("B 段带「已按只改选项 B」标记", await evalIn("[...document.querySelectorAll('#analysis .ana-blk')].filter(function(b){return (" + tagOf + ")(b)==='B';})[0].innerText.indexOf('已按「只改选项 B」')>=0"));
  ok("A/C/D 段保持原样", await evalIn("[...document.querySelectorAll('#analysis .ana-blk')].filter(function(b){return ['A','C','D'].indexOf((" + tagOf + ")(b))>=0;}).length===3 && [...document.querySelectorAll('#analysis .ana-blk')].filter(function(b){return ['A','C','D'].indexOf((" + tagOf + ")(b))>=0;}).every(function(b){return b.innerText.indexOf('未要求改，保持原样')>=0;})") === true);
  ok("微调请求带上了当前解析 / 小题上下文", await evalIn("document.getElementById('analysis').innerText.indexOf('mock上下文：解析√')>=0"), await evalIn("(document.getElementById('analysis').innerText.match(/mock上下文[^）]*/)||[''])[0]"));
  ok("范围偏好记住「选项 B」", await evalIn("(function(){var m=JSON.parse(localStorage.getItem('solver_refine_prefs_v1')||'{}');return Object.keys(m).some(function(k){return (m[k]||{}).option==='B';});})()") === true);
  ok("微调后仍未破坏分块（4 块 + 4 个标签）", await evalIn("document.querySelectorAll('#analysis .ana-blk').length===4 && document.querySelectorAll('#analysis .ana-tag').length===4"));
  await shot("feature_ana_option_refine.png");
  await evalIn("document.getElementById('rbKeep').click();1");
  await sleep(600);
  ok("确认保留后回到无待审状态", await evalIn("!document.getElementById('reviewBar').classList.contains('show')"));

  console.log("\n----------------------------------------");
  try { proc.kill(); } catch (e) {}
  try { fs.copyFileSync(SETTINGS_BAK, SETTINGS); console.log("settings.json 已恢复"); } catch (e) {}
  if (fails) { console.log("结果：有 " + fails + " 项失败"); process.exit(1); }
  console.log("结果：全部通过");
  process.exit(0);
})().catch((e) => { console.log("FATAL " + e.message); process.exit(1); });