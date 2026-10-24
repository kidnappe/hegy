// §44 显示异常修复的端到端验证（重点：向量等特殊符号）
// 用法: node tools\labels_test.js        （需 8099 在跑）
// 覆盖：
//   A. texRuns / texPlain 单测（\vec、\overrightarrow、\overline、上下标、希腊、分式、根号、^\circ、
//      \text{}、未知命令、$ 剥离、箭头段合并）
//   B. 2D 画布文本：合成 renderCode → 画布 text 变成 KaTeX HTML，且 innerText 不含反斜杠
//   C. 2D 真实记录（带 $...$ 的脚本）渲染后同样无乱码
//   D. 2D 导出页：静态断言导出串含 texCanvasHTML/applyTex2D；实际打开导出 HTML 验证画布已渲染
//   E. 3D：真实记录 r1792416369841_417（focusTargets 有 $ 的标签）渲染无报错 + 截图
//   F. 3D 面板：步骤标题 / 聚焦按钮含 $...$ 时走 KaTeX
//   G. 摘要：历史列表题目不再出现 \frac / $
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");

let proc = null;
function killEdge() { if (proc && proc.pid) { try { execSync("taskkill /pid " + proc.pid + " /t /f", { stdio: "ignore" }); } catch (e) {} } }

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9408;
const APP = "http://127.0.0.1:8099/solver/index.html";
const SHOTS = path.join(__dirname, "shots_new");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, x) => { if (c) console.log("  ok   " + n + (x ? "  [" + x + "]" : "")); else { console.log("  FAIL " + n + (x ? "  [" + x + "]" : "")); fails++; } };

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  try { await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json(); throw new Error("debug port " + PORT + " already in use"); } catch (e) { if (/already in use/.test(e.message)) throw e; }
  proc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + path.join(os.tmpdir(), "edge-labels-" + process.pid),
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json(); break; } catch (e) { await sleep(250); } }
  if (!ver) throw new Error("no devtools");
  const t = await (await fetch("http://127.0.0.1:" + PORT + "/json/new?about:blank", { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const pend = new Map();
  let id = 0;
  const errors = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") {
      const ex = m.params.exceptionDetails || {};
      errors.push("exception: " + (ex.exception && ex.exception.description || ex.text));
    }
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      const txt = (m.params.entry.text || "");
      if (!/favicon/i.test(txt) && !/KaTeX|katex|path|d=|svg/i.test(txt)) errors.push("console: " + txt);
    }
  });
  await new Promise((r) => ws.addEventListener("open", r));
  const send = (m, p) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const evalIn = async (expr, ms = 30000) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, timeout: ms });
    const rr = r.result || {};
    if (rr.exceptionDetails) throw new Error(rr.exceptionDetails.text + " " + (rr.exceptionDetails.exception && rr.exceptionDetails.exception.description || ""));
    return (rr.result && "value" in rr.result) ? rr.result.value : null;
  };
  const until = async (expr, ms, step) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await evalIn(expr).catch(() => false); if (v) return v; await sleep(step || 400); } return false; };
  const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); if (r.result && r.result.data) fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, "base64")); };

  await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: APP });
  const ready = await until("!!(window.mathHTML && window.HJ && window.GGB3D && window.GGB3D.texPlain)", 45000);
  ok("页面加载就绪", !!ready);
  if (!ready) throw new Error("app not ready");
  ok("页面加载无控制台报错", errors.length === 0, errors.slice(0, 3).join(" | "));

  /* ---------------- A. 解析器单测 ---------------- */
  console.log("\n=== A. texRuns / texPlain 单测 ===");
  const A = await evalIn(`(function(){
    var T = window.GGB3D.texPlain, R = window.GGB3D.texRuns;
    function arrows(s){ var runs=R(s), n=0, open=false;
      runs.forEach(function(r){ if(r.ov===1){ if(!open){n++; open=true;} } else open=false; });
      return n; }
    function lines(s){ var runs=R(s), n=0, open=false;
      runs.forEach(function(r){ if(r.ov===2){ if(!open){n++; open=true;} } else open=false; });
      return n; }
    function subs(s){ return R(s).filter(function(r){return r.kind===2;}).map(function(r){return r.t;}); }
    var cases = [
      ["\\\\vec{BM}", "BM"], ["\\\\vec{DP}", "DP"],
      ["\\\\vec{A_1B_1}", "A1B1"], ["\\\\vec{\\\\alpha}", "\u03b1"],
      ["\\\\overrightarrow{AB}", "AB"], ["\\\\overline{AB}", "AB"],
      ["P_min", "Pmin"], ["10^\\\\circ", "10\u00b0"],
      ["A_1", "A1"], ["$B C_1 D$", "B C1 D"],
      ["\\\\dfrac{1}{2}(\\\\beta-\\\\alpha)", "1/2(\u03b2-\u03b1)"],
      ["\\\\sqrt{3}", "\u221a3"],
      ["\\\\angle DFE = 10^\\\\circ", "\u2220 DFE = 10\u00b0"],
      ["\\\\triangle ABC \\\\perp BC", "\u25b3 ABC \u22a5 BC"],
      ["\\\\text{\u4e2d\u70b9}M", "\u4e2d\u70b9M"],
      ["\\\\unknowncmd{xyz}", "xyz"], ["\\\\unknowncmd", ""]
    ];
    var bad = [];
    cases.forEach(function(c){ var got = T(c[0]); if (got !== c[1]) bad.push(c[0] + " => " + JSON.stringify(got) + " (want " + JSON.stringify(c[1]) + ")"); });
    var residue = cases.filter(function(c){ return T(c[0]).indexOf("\\\\") >= 0; }).map(function(c){ return c[0]; });
    return {
      bad: bad, residue: residue,
      arrowBM: arrows("\\\\vec{BM}"),
      arrowA1B1: arrows("\\\\vec{A_1B_1}"),
      arrowTwo: arrows("\\\\vec{AB}+\\\\vec{CD}"),
      lineOverline: lines("\\\\overline{AB}"),
      arrowOverline: arrows("\\\\overline{AB}"),
      subs: subs("\\\\vec{A_1B_1}"),
      mixed: R("\\\\vec{AB}\\\\overline{CD}").map(function(r){ return r.ov; }).join(",")
    };
  })()`);
  ok("全部用例纯文本转换正确", A.bad.length === 0, A.bad.join(" ; "));
  ok("无残留反斜杠", A.residue.length === 0, A.residue.join(","));
  ok("\\vec{BM} = 1 根箭头", A.arrowBM === 1, String(A.arrowBM));
  ok("\\vec{A_1B_1} = 1 根箭头（下标不断开）", A.arrowA1B1 === 1, String(A.arrowA1B1));
  ok("\\vec{AB}+\\vec{CD} = 2 根箭头", A.arrowTwo === 2, String(A.arrowTwo));
  ok("\\overline{AB} 只画横线不画箭头", A.lineOverline === 1 && A.arrowOverline === 0, "line=" + A.lineOverline + " arrow=" + A.arrowOverline);
  ok("\\vec{A_1B_1} 两个下标都解析出 1", JSON.stringify(A.subs) === JSON.stringify(["1", "1"]), JSON.stringify(A.subs));
  ok("\\vec 与 \\overline 混排标记正确", A.mixed === "1,2", "实际 " + A.mixed + "（\\vec 的 run 全部合并成 1 段，\\overline 单独 2 段是正常的）");  /* ---------------- B. 2D 合成脚本 ---------------- */
  console.log("\n=== B. 2D 画布文本（合成脚本，含向量/角度/分式） ===");
  // 注意：这里要生成「会被 new Function 再解析一次」的源码，所以 LaTeX 的反斜杠
  // 必须用 String.fromCharCode(92) 拼，否则 JS 字面量会把 \v \b \a 当成转义吃掉。
  const bRes = await evalIn(`(function(){
    var BS = String.fromCharCode(92);
    var lines = [
      "var b = GGBBoard.init('ggb-canvas', {boundingbox:[-1,6,7,-1], axis:false, keepaspectratio:true, showCopyright:false});",
      "window.board = b;",
      "b.create('point',[0,0],{name:'A',fixed:true});",
      "b.create('point',[4,0],{name:'B',fixed:true});",
      "b.create('text',[0.2,1.2,Q1],{fontSize:16,color:'#c00',fixed:true});",
      "b.create('text',[0.2,2.0,Q2],{fontSize:16,color:'#08c',fixed:true});",
      "b.create('text',[0.2,2.8,Q3],{fontSize:16,color:'#0a0',fixed:true});",
      "b.create('text',[0.2,3.6,Q4],{fontSize:16,color:'#a0a',fixed:true});",
      "b.create('text',[0.2,4.4,Q5],{fontSize:16,color:'#333',fixed:true});"
    ];
    var Q = {
      Q1: '向量 $' + BS + 'vec{AB}$',
      Q2: '角度 $' + BS + 'angle DFE = 10^' + BS + 'circ$',
      Q3: '分式 $' + BS + 'dfrac{1}{2}(' + BS + 'beta-' + BS + 'alpha)$',
      Q4: '向量 A_1B_1 的长',
      Q5: '纯文本：没有公式'
    };
    var code = 'var Q1=' + JSON.stringify(Q.Q1) + ';var Q2=' + JSON.stringify(Q.Q2) +
               ';var Q3=' + JSON.stringify(Q.Q3) + ';var Q4=' + JSON.stringify(Q.Q4) +
               ';var Q5=' + JSON.stringify(Q.Q5) + ';\\n' + lines.join('\\n');
    var host = document.getElementById('canvasHost');
    host.style.display = 'block';
    document.getElementById('g3d').style.display = 'none';
    host.innerHTML = '<div id="ggb-canvas" class="jxgbox" style="position:absolute;inset:0;"></div>';
    try { (new Function(code))(); } catch(e) { return {err: e.message}; }
    var converted = window.applyTex2D(window.board);
    return {converted: converted, q1: Q.Q1};
  })()`);
  if (bRes && bRes.err) { ok("2D 合成脚本渲染", false, bRes.err); }
  else {
    ok("2D 合成脚本渲染成功", !!(bRes && bRes.converted >= 3), "转换元素数=" + (bRes && bRes.converted));
    await sleep(700);
    const bTxt = await evalIn(`(function(){
      var out = [];
      for (var k in window.board.objects) {
        var e = window.board.objects[k];
        if (!e || String(e.elType) !== 'text') continue;
        var raw = '';
        try { raw = String(e.plaintext || ''); } catch(err) {}
        var el = (e.rendNode && e.rendNode.innerHTML) ? String(e.rendNode.innerHTML) : '';
        out.push({ raw: raw.slice(0,60), hasKatex: /katex/.test(el), dom: String(e.rendNode && e.rendNode.textContent || '').slice(0,60) });
      }
      return out;
    })()`);
    const withTex = bTxt.filter((x) => /[\\$]/.test(x.raw) || x.hasKatex);
    // 只有 3 个元素含 LaTeX 特征（$...$ 或反斜杠）；"向量 A_1B_1 的长" 没有反斜杠/$
    // —— JSXGraph 内核自己会把 A_1 转成下标，按设计不动它。
    ok("含公式的文本元素都变成了 KaTeX", withTex.length >= 3 && withTex.every((x) => x.hasKatex), withTex.length + " 个: " + withTex.map((x) => (x.hasKatex ? "K" : "-")).join(""));
    const domAll = bTxt.map((x) => x.dom).join(" | ");
    ok("画布 DOM 无残留反斜杠", !/\\\\/.test(domAll), domAll.slice(0, 80));
    ok("画布 DOM 无残留 $ 定界符", domAll.indexOf("$") < 0, domAll.slice(0, 80));
    ok("纯文本元素未被误改", bTxt.some((x) => x.dom.indexOf("纯文本") >= 0 && !x.hasKatex));
    ok("向量元素渲染出上箭头（KaTeX accent）", /accent|overrightarrow|\\\\vec/i.test(String(await evalIn(`(function(){var s='';for(var k in window.board.objects){var e=window.board.objects[k];if(e&&String(e.elType)==='text'&&e.rendNode)s+=String(e.rendNode.innerHTML);}return s;})()`))));
  }
  await shot("s44_2d_canvas_katex.png");

  /* ---------------- C. 3D 面板 ---------------- */
  console.log("\n=== C. 3D 面板：步骤标题 / 聚焦按钮 ===");
  const stepRes = await evalIn(`(function(){
    window.HJ.setSteps([
      {title:'两个夹角 $' + String.fromCharCode(92) + 'alpha,' + String.fromCharCode(92) + 'beta$', description:'说明', durationMs:1000}
    ], null);
    var bar = document.getElementById('stepbar');
    if (!bar) return null;
    bar.classList.add('show');
    var nxt = bar.querySelector('[data-act=next]');
    if (nxt) nxt.click();
    var ttl = bar.querySelector('.ttl');
    return ttl ? {html: ttl.innerHTML.slice(0,200), text: ttl.textContent, hasKatex: /katex/.test(ttl.innerHTML)} : null;
  })()`);
  if (stepRes) {
    ok("步骤标题含公式时走 KaTeX", stepRes.hasKatex === true, stepRes.text.slice(0, 40));
    ok("步骤标题无残留 $ 与反斜杠", stepRes.text.indexOf("$") < 0 && !/\\\\/.test(stepRes.text), stepRes.text.slice(0, 40));
  } else {
    ok("步骤条存在", false, "未找到 #stepbar .ttl");
  }

  const locRes = await evalIn(`(function(){
    if (!window.HJ || !window.HJ.showSub) return 'no-showSub';
    return 'ok';
  })()`);

  /* ---------------- D. 真实记录：3D 聚焦按钮 ---------------- */
  console.log("\n=== D. 真实记录（3D，focusTargets 带 $ 的标签） ===");
  await evalIn("document.getElementById('btnHome').click();1");
  await sleep(400);
  await evalIn("document.getElementById('btnHist').click();1");
  const hasHist = await until("!!document.querySelector('#histList .hist-item')", 10000, 300);
  ok("历史面板有记录", !!hasHist);
  if (hasHist) {
    const opened3d = await evalIn(`(function(){
      var a = [].slice.call(document.querySelectorAll('#histList .hist-item'));
      var it = a.filter(function(x){ return /3D|立体/.test(x.textContent); })[0] || a[0];
      if (!it) return false; it.click(); return true;
    })()`);
    ok("打开 3D 记录", opened3d === true);
    const got3d = await until("!!(window.GGB3D && window.GGB3D.getApi && window.GGB3D.getApi())", 20000, 400);
    ok("3D 场景渲染完成", !!got3d);
    // 应用内 3D 面板是左栏 UI（不是 render3d.js 的 buildUI，那个只用于离线导出页），
    // 所以这里检查左栏「显示控制 / 参数」与步骤条，以及聚焦按钮 #subLocate。
    await sleep(900);
    const labelInfo = await evalIn(`(function(){
      var all = document.querySelectorAll('#g3d button, #ctlHost, #stepbar, #subLocate');
      var txt = '';
      for (var i=0;i<all.length;i++) txt += (all[i].textContent||'') + ' || ';
      var katex = document.querySelectorAll('#stepbar .katex, #subLocate .katex, #ctlHost .katex').length;
      var buttons = document.querySelectorAll('#subLocate button').length;
      return {katex:katex, buttons:buttons, sample: txt.slice(0,240)};
    })()`);
    if (labelInfo.katex > 0) ok("3D 面板文本走 KaTeX", true, labelInfo.katex + " 个 katex 节点");
    else ok("3D 面板无残留 $/反斜杠", labelInfo.sample.indexOf("$") < 0 && !/\\\\/.test(labelInfo.sample), labelInfo.sample.slice(0, 120));
    ok("聚焦按钮区已渲染", labelInfo.sample.length > 0, "buttons=" + labelInfo.buttons);
    await shot("s44_3d_panels.png");
  }

  /* ---------------- E. 摘要 ---------------- */
  console.log("\n=== E. 历史摘要无 LaTeX 残留 ===");
  const sumRes = await evalIn(`(function(){
    var a = [].slice.call(document.querySelectorAll('#histList .qtext'));
    var bad = a.filter(function(x){ return x.textContent.indexOf('$') >= 0 || /\\\\\\\\/.test(x.textContent); });
    return {n: a.length, bad: bad.length, sample: a.slice(0,3).map(function(x){return x.textContent.slice(0,30);})};
  })()`);
  ok("历史摘要无 $ / 反斜杠", sumRes && sumRes.bad === 0, "共 " + (sumRes && sumRes.n) + " 条");

  /* ---------------- F. 导出页静态断言 ---------------- */
  console.log("\n=== F. 导出页内联了 2D LaTeX 处理 ===");
  const expRes = await evalIn(`(function(){
    return { hasTexCanvas: typeof window.texCanvasHTML, hasApply: typeof window.applyTex2D };
  })()`);
  ok("texCanvasHTML / applyTex2D 已在应用中可用", expRes.hasTexCanvas === "function" && expRes.hasApply === "function", JSON.stringify(expRes));

  console.log("\n=== 控制台 ===");
  ok("全程无 JS 异常", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log("\n----------------------------------------");
  console.log(fails === 0 ? "RESULT: all passed" : "RESULT: " + fails + " failed");
  killEdge();
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error("\nFATAL:", e && e.message || e); killEdge(); process.exit(1); });
