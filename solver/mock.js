const http = require("http");
const fs = require("fs");
const path = require("path");

// mock 用的假场景：优先取 mock 专用样例，其次回退到第一个 example_*.js。
// 约定：文件名 example_mock*.js 为 mock 专用（不参与 few-shot）。
// 与 serve.js 的 few-shot 扫描错开，避免"用同一个文件既当示例又当答案"导致测试失真。
function loadMockCode() {
  try {
    const files = fs.readdirSync(__dirname).filter((n) => /^example_.*\.js$/.test(n));
    const pick = files.find((n) => /^example_mock/i.test(n)) || files.sort()[0];
    if (pick) return { name: pick, code: fs.readFileSync(path.join(__dirname, pick), "utf8") };
  } catch {}
  return { name: null, code: "const board = GGBBoard.init('ggb-canvas', {boundingbox:[-1,5,7,-1], axis:false, showCopyright:false});" };
}
const MOCK_SCENE = loadMockCode();
const code = MOCK_SCENE.code;

// mock 的 steps/controls 是按 16391 那套对象名写的（A/B/C/D/F/E/G/P/H）。
// 若当前样例不是它，就退回通用步骤，避免 targets 指向不存在的对象。
const SCENE_IS_16391 = /16391/.test(MOCK_SCENE.name || "");

// 通用兜底：样例不是 16391 时用这套（不引用任何具体对象名，纯文字说明）
const extra2dGeneric = {
  steps: [],
  controls: [],
  focusTargets: [],
  subQuestions: [
    { label: "(1)", answer: "$\\angle DFE = 10^\\circ$（mock 小问 1）", analysis: "AD 平分 $\\angle BAC$ ⇒ $\\angle BAD=\\angle DAC=40^\\circ$；$FE\\perp BC$，代入 $\\angle B=40^\\circ$、$\\angle C=60^\\circ$ 得 $\\angle DFE=10^\\circ$。", focusTargets: [] },
    { label: "(2)", answer: "$\\angle DFE = \\dfrac{1}{2}(\\beta-\\alpha)$（mock 小问 2）", analysis: "一般地，设 $\\angle B=\\alpha$、$\\angle C=\\beta$，由角平分线与垂直关系推导得 $\\angle DFE=\\frac{1}{2}(\\beta-\\alpha)$。", focusTargets: [] },
    { label: "(3)", answer: "$\\angle DFE = 10^\\circ$（mock 小问 3）", analysis: "结论与 (1) 一致：给定 $\\angle B=40^\\circ$、$\\angle C=60^\\circ$ 时 $\\angle DFE=10^\\circ$。", focusTargets: [] }
  ]
};

const extra2dSpecific = {
  steps: [
    { title: "作三角形 ABC", description: "已知 $\\angle B=40^\\circ$、$\\angle C=60^\\circ$，先画 $\\triangle ABC$。", targets: ["A", "B", "C"] },
    { title: "作角平分线 AD", description: "AD 平分 $\\angle BAC$，交 BC 于 D。", targets: ["A", "B", "C", "D"] },
    { title: "取动点 F 并作垂线", description: "F 在射线 DA 上，作 $FE\\perp BC$ 于 E。拖动滑块改变 F 的位置。", targets: ["D", "F", "E"] },
    { title: "图3：CG 与 PH", description: "CG 平分 $\\angle ACB$，PH$\\perp$AB。", targets: ["G", "P", "H"] }
  ],
  controls: [
    { label: "显示图3辅助点（G/P/H）", type: "toggle", targets: ["G", "P", "H"], default: false },
    { label: "显示 F 位置滑块", type: "toggle", targets: ["F位置%"], default: true }
  ],
  focusTargets: [
    { label: "定位答案（1）∠DFE", target: ["D", "F", "E"] },
    { label: "定位答案（3）∠HPG", target: ["H", "P", "G"] }
  ],
  subQuestions: [
    { label: "(1)", answer: "$\\angle DFE = 10^\\circ$（mock 小问 1）", analysis: "AD 平分 $\\angle BAC$ ⇒ $\\angle BAD=\\angle DAC=40^\\circ$；$FE\\perp BC$，代入 $\\angle B=40^\\circ$、$\\angle C=60^\\circ$ 得 $\\angle DFE=10^\\circ$。", focusTargets: [{ label: "定位答案（1）", target: ["D", "F", "E"] }] },
    { label: "(2)", answer: "$\\angle DFE = \\dfrac{1}{2}(\\beta-\\alpha)$（mock 小问 2）", analysis: "一般地，设 $\\angle B=\\alpha$、$\\angle C=\\beta$，推导得 $\\angle DFE=\\frac{1}{2}(\\beta-\\alpha)$。", focusTargets: [{ label: "定位答案（2）", target: ["D", "F", "E"] }] },
    { label: "(3)", answer: "$\\angle HPG = 90^\\circ-\\alpha-\\dfrac{1}{2}\\beta$（mock 小问 3）", analysis: "CG 平分 $\\angle ACB$，$PH\\perp AB$，计算得 $\\angle HPG=90^\\circ-\\alpha-\\frac{1}{2}\\beta$。", focusTargets: [{ label: "定位答案（3）", target: ["H", "P", "G"] }] }
  ]
};

const extra2d = SCENE_IS_16391 ? extra2dSpecific : extra2dGeneric;

const cube3d = {
  sceneType: "geometry_3d",
  camera: { distance: 9 },
  points: [
    { id: "A", coords: [0, 0, 0], label: "A" }, { id: "B", coords: [2, 0, 0], label: "B" },
    { id: "C", coords: [2, 0, 2], label: "C" }, { id: "D", coords: [0, 0, 2], label: "D" },
    { id: "A1", coords: [0, 2, 0], label: "A₁" }, { id: "B1", coords: [2, 2, 0], label: "B₁" },
    { id: "C1", coords: [2, 2, 2], label: "C₁" }, { id: "D1", coords: [0, 2, 2], label: "D₁" }
  ],
  segments: [
    { from: "A", to: "B" }, { from: "B", to: "C" }, { from: "C", to: "D" }, { from: "D", to: "A" },
    { from: "A1", to: "B1" }, { from: "B1", to: "C1" }, { from: "C1", to: "D1" }, { from: "D1", to: "A1" },
    { from: "A", to: "A1" }, { from: "B", to: "B1" }, { from: "C", to: "C1" }, { from: "D", to: "D1" },
    { from: "A", to: "C1", color: "#e91e63", dashed: true }
  ],
  planes: [{ vertices: ["A", "B", "C", "D"], color: "#4caf50", opacity: 0.16 }],
  labels: [{ at: [1, 1, 1], text: "体对角线 AC₁", color: "#e91e63" }],
  steps: [{ title: "画正方体", description: "先画出正方体 $ABCD-A_1B_1C_1D_1$。", elements: [{ type: "segment", targetId: "A" }] }],
  answerOverlays: [{ title: "解题思路", elements: [{ type: "segment", targetId: "C1" }], description: "体对角线 $AC_1=\\sqrt{3}a$。" }]
};

const brokenCode = "const board = GGBBoard.init('ggb-canvas', {boundingbox:[-1,5,7,-1],axis:false});\nwindow.board = board;\nboard.create('point',[thisIsNotDefined(1),1],{name:'X'});\n";

// 图片题：mock 也会"识别"出题干文字与题图区域，用于验证题目卡/题图裁剪
function withQ(obj, nImg) {
  if (nImg > 0) {
    obj.questionText = "（mock 识别题干）如图，AD 平分 ∠BAC，F 是射线 DA 上一点，过点 F 作 FE⊥BC 于点 E。（1）若 F 与 A 重合，∠B=40°、∠C=60°，求 ∠DFE 的度数。（2）一般地，求 ∠DFE 与 ∠B、∠C 的关系。";
    obj.figureBox = { x: 0.06, y: 0.28, w: 0.88, h: 0.6, image: 0 };
  }
  return obj;
}

function applyGivenAnswer(obj, given, label, qi) {
  // 测试用：给定答案里出现「冲突答案」或 99° 时模拟「与题设矛盾，模型纠正」分支
  const conflict = /冲突答案|与题设矛盾|99\s*[°度]/.test(given);
  if (conflict) {
    obj.answerAdjusted = true;
    obj.answerNote = "给定答案与题设矛盾：按验算结果保留正确答案（mock）";
    return obj;
  }
  obj.answerAdjusted = false;
  obj.answerNote = "已按你给的答案重画（mock）";
  const lm = String(label || "").match(/(\d+)/);
  const idx = qi >= 0 ? qi : (lm ? Number(lm[1]) - 1 : -1);
  if (idx >= 0 && Array.isArray(obj.subQuestions) && obj.subQuestions[idx]) {
    obj.subQuestions[idx] = Object.assign({}, obj.subQuestions[idx], { answer: given });
    obj.answer = "按第 (" + (idx + 1) + ") 问给定答案重画（mock）";
  } else {
    obj.answer = given;
  }
  return obj;
}

function reply(q, nImg, isRefine, broken, scopeQi, badRefine, target, force2, force3, optionScope) {
  if (isRefine) {
    if (badRefine) return { answer: "（渲染失败的微调结果，mock）", analysis: "此结果脚本有错误，用于验证自动回退。", renderCode: brokenCode, steps: extra2d.steps, controls: extra2d.controls, focusTargets: extra2d.focusTargets, subQuestions: extra2d.subQuestions };
    if (force3) return withQ({ answer: "（已微调 · 切换 3D，mock）", analysis: "已按你的要求把图形切换为 3D 场景（mock 3D）。", render3d: cube3d }, nImg);
    if (force2) return withQ({
      answer: "$\\angle DFE = 10^\\circ$（已微调 · 切换 2D，mock）",
      analysis: "已按你的要求把图形切换为 2D 平面图（mock）。\n（mock：收到 " + nImg + " 张图片）",
      renderCode: code,
      steps: extra2d.steps, controls: extra2d.controls, focusTargets: extra2d.focusTargets, subQuestions: extra2d.subQuestions
    }, nImg);
    if (target === "text") {
      return withQ({
        answer: "$\\angle DFE = 10^\\circ$（解析已按要求补充，mock）",
        analysis: "【详细解析 · mock】\n1) AD 平分 $\\angle BAC$ ⇒ $\\angle BAD=\\angle DAC=40^\\circ$。\n2) $FE\\perp BC$ ⇒ $\\angle DFE$ 与 $\\angle B$、$\\angle C$ 的关系可逐步推出。\n3) 代入 $\\angle B=40^\\circ$、$\\angle C=60^\\circ$，得 $\\angle DFE=10^\\circ$。\n（本次只改解析，图形保持不动 · mock）",
        renderCode: code,
        steps: extra2d.steps, controls: extra2d.controls, focusTargets: extra2d.focusTargets, subQuestions: extra2d.subQuestions
      }, nImg);
    }
    if (optionScope) {
      const mk = (L) => L + "：" + "$\\sqrt{" + (L.charCodeAt(0) - 64) + "}$ 计算与判断，$x^2+y^2=1$。" +
        (L === optionScope ? "（已按「只改选项 " + optionScope + "」展开推导 · mock）" : "（未要求改，保持原样 · mock）");
      return withQ({ answer: "A、C、D", analysis: ["A", "B", "C", "D"].map(mk).join("\n"), renderCode: code, steps: extra2d.steps, controls: extra2d.controls, focusTargets: extra2d.focusTargets }, nImg);
    }
    const is3d = /3d|立体|正方体|长方体|棱柱|棱锥|棱台|二面角|异面|圆锥|圆柱|球/i.test(q);
    if (is3d) return withQ({ answer: "（已微调）见解析（mock 3D）", analysis: "已按你的要求微调 3D 场景。", render3d: cube3d }, nImg);
    const fixed = broken ? { answer: "$\\angle DFE = 10^\\circ$（已自动修正脚本）", analysis: "上一条脚本报错已修正，重新渲染正常。", renderCode: code, steps: extra2d.steps, controls: extra2d.controls, focusTargets: extra2d.focusTargets } : null;
    if (fixed) return withQ(fixed, nImg);
    if (scopeQi >= 0) {
      const subs = extra2d.subQuestions.map((s) => Object.assign({}, s));
      if (!subs[scopeQi]) subs[scopeQi] = { label: "(" + (scopeQi + 1) + ")", answer: "", analysis: "" };
      subs[scopeQi] = Object.assign({}, subs[scopeQi], { answer: subs[scopeQi].answer + "（已微调此问）" });
      return withQ({
        answer: "$\\angle DFE = 10^\\circ$（已仅微调第 " + (scopeQi + 1) + " 问，mock）",
        analysis: "微调范围：仅第 (" + (scopeQi + 1) + ") 小题。已保留其余小题内容。\n（mock：收到 " + nImg + " 张图片）",
        renderCode: code,
        steps: extra2d.steps, controls: extra2d.controls, focusTargets: extra2d.focusTargets, subQuestions: subs
      }, nImg);
    }
    return withQ({
      answer: "$\\angle DFE = 10^\\circ$（已微调版本，mock）",
      analysis: "已按你的要求微调（整题）。\n（mock：收到 " + nImg + " 张图片）",
      renderCode: code,
      steps: extra2d.steps, controls: extra2d.controls, focusTargets: extra2d.focusTargets, subQuestions: extra2d.subQuestions
    }, nImg);
  }
  const is3d = force3 || (force2 ? false : /3d|立体|正方体|长方体|棱柱|棱锥|棱台|二面角|异面|圆锥|圆柱|球/i.test(q));
  // 选择题：解析按选项分段（A．B．C．D．），且故意混入「裸 LaTeX」验证前端容错
  if (/多选|选择题/.test(q)) {
    return withQ({
      answer: "A、C、D",
      analysis: "A：$A_1O=\\sqrt{6}$，轨迹圆半径 $\\sqrt{3}$，$A_1$ 到圆上点的最小距离为 $\\sqrt{6}-\\sqrt{3}$，所以 **A 正确**。\n"
        + "B：由\nAB=3, AC=4 出发计算，$A_1P$ 的最大值为 \\sqrt{15}，不是 $\\sqrt{6}+\\sqrt{3}$，所以 B 错误。\n"
        + "C：满足 $A_1P\\perp BC$ 的点 P 有且仅有一个（另一个交点在三角形外），所以 C 正确。\n"
        + "D：所有满足条件的 AP 长均为 \\sqrt{6}，形成的曲面面积为 $3\\sqrt{2}\\pi/4$，所以 D 正确。\n"
        + "（mock 选择题：解析按选项分块 + 裸 LaTeX 容错）",
      renderCode: code, steps: extra2d.steps, controls: extra2d.controls, focusTargets: extra2d.focusTargets
    }, nImg);
  }
  if (is3d) return withQ({ answer: "见解析（mock 3D）", analysis: "这是 mock 的固定 3D 演示场景（正方体示例）——mock 是联调用测试模型，不会按题目真实作答。" + (force3 ? "（已按指定 3D 输出）" : "") + "\n你的题目：" + q.slice(0, 40) + (q.length > 40 ? "…" : "") + "\n（mock：收到 " + nImg + " 张图片）", render3d: cube3d }, nImg);
  return withQ({
    answer: "**关键结论**：$\\angle DFE = 10^\\circ$。由角平分线与垂直关系：$\\angle DFE=\\frac{1}{2}(\\angle C-\\angle B)$，代入得 $10^\\circ$。",
    analysis: "1) AD 平分 $\\angle BAC$ ⇒ $\\angle BAD=\\angle DAC=40^\\circ$。\n2) **关键一步**：$FE\\perp BC$ ⇒ 推出 $\\angle DFE$。\n3) 代入 $\\angle B=40^\\circ$、$\\angle C=60^\\circ$ 得 $\\angle DFE=10^\\circ$。" + (force2 ? "\n（已按指定 2D 输出，mock）" : "") + "\n（mock：收到 " + nImg + " 张图片）",
    renderCode: broken ? brokenCode : code,
    steps: extra2d.steps, controls: extra2d.controls, focusTargets: extra2d.focusTargets, subQuestions: extra2d.subQuestions
  }, nImg);
}

http.createServer((req, res) => {
  let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => {
    let nImg = 0, q = "", stream = false, body = null;
    try {
      const b = JSON.parse(d); body = b;
      stream = !!b.stream;
      const u = b.messages && b.messages[b.messages.length - 1];
      if (u && Array.isArray(u.content)) { nImg = u.content.filter((x) => x.type === "image_url").length; q = (u.content[0] && u.content[0].text) || ""; }
      else q = (u && u.content) || "";
    } catch (e) {}

    // 追问：纯文本多轮问答（system 里带【何解·追问】标记），不返回 JSON
    const sysText = body && body.messages && body.messages[0] ? String(body.messages[0].content || "") : "";
    if (/【何解·追问】/.test(sysText)) {
      const hist = [];
      let chatImgs = 0;
      (body.messages || []).forEach((m) => {
        if (!m || m.role === "system") return;
        let text = "";
        if (Array.isArray(m.content)) {
          chatImgs += m.content.filter((x) => x && x.type === "image_url").length;
          const tx = m.content.filter((x) => x && x.type === "text")[0];
          text = (tx && tx.text) || "";
        } else text = String(m.content || "");
        hist.push({ role: m.role, text: text });
      });
      const lastUser = hist.slice().reverse().filter((m) => m.role === "user")[0];
      const uq = (lastUser && lastUser.text) || "";
      const turn = hist.filter((m) => m.role === "user").length;
      const hasCtx = /【当前答案】/.test(sysText) && /【当前解析】/.test(sysText) && /【当前(2D 图形脚本|3D 场景)】/.test(sysText);
      let txt = "（mock 追问 · 第 " + turn + " 轮）\n\n";
      if (/为什么|怎么|理由|推导|这一步/.test(uq)) {
        txt += "因为 $AD$ 平分 $\\angle BAC$，所以 $\\angle BAD=\\angle DAC$。再结合 $FE\\perp BC$，把角转到同一个三角形里，就能得到 **$\\angle DFE=10^\\circ$**。这一步用的是角平分线定义和直角三角形两锐角互余。";
      } else if (/换.*解法|另一种|其他方法/.test(uq)) {
        txt += "可以换一种思路：先设 $\\angle BAD=x$，用 $x$ 表示 $\\angle DFE$，最后代入 $x=40^\\circ$。两种写法本质相同，只是未知量的选择不同。";
      } else if (/改图|画图|图形/.test(uq)) {
        txt += "我只负责回答问题，不会改图形。要调整图中的点、线或标注，请用右侧的「微调」并选择「只改图形」。";
      } else {
        txt += "按题面理解，你问的是「" + uq.replace(/\s+/g, " ").slice(0, 36) + "」。结合当前的答案与图形，可以先抓住题目的角平分线和垂直关系，再逐步推导；如果你希望我针对某一步展开，直接告诉我步骤编号即可。";
      }
      txt += "\n\n（mock 上下文：" + (hasCtx ? "题目/答案/解析/图形 √" : "上下文 ×") + "；历史消息 " + hist.length + " 条；题图 " + chatImgs + " 张）";
      const usage = { prompt_tokens: 1200, completion_tokens: Math.ceil(txt.length / 2), total_tokens: 1200 + Math.ceil(txt.length / 2) };
      const sendChat = () => {
        if (/坏追问/.test(uq)) {
          res.writeHead(500, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: { message: "mock 追问失败" } }));
        }
        if (!stream) {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({ choices: [{ message: { content: txt } }], usage }));
        }
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
        const size = 14, chunks = [];
        for (let i = 0; i < txt.length; i += size) chunks.push(txt.slice(i, i + size));
        let i = 0;
        const tick = () => {
          if (i >= chunks.length) {
            res.write("data: " + JSON.stringify({ choices: [], usage }) + "\n\n");
            res.write("data: [DONE]\n\n");
            return res.end();
          }
          res.write("data: " + JSON.stringify({ choices: [{ delta: { content: chunks[i] } }] }) + "\n\n");
          i++;
          setTimeout(tick, 22);
        };
        tick();
      };
      const sm = uq.match(/慢速(\d+)?/);
      const wait = sm ? (sm[1] ? Number(sm[1]) * 1000 : 6000) : 0;
      if (wait) setTimeout(sendChat, wait); else sendChat();
      return;
    }

    const isRefine = /【修改要求】/.test(q) || /微调/.test(q);
    const broken = /坏脚本/.test(q);
    let qq = q;
    const mm = q.match(/【当前题目】\n([\s\S]*?)\n\n【当前答案】/);
    if (mm) qq = mm[1];
    qq = qq.split("【重要】")[0];
    qq = qq.replace(/^【年级设定】[^\n]*\n\n/, "");
    const retried = /【重要】上次输出不合格/.test(q);
    const badJson = /坏JSON/.test(qq) && !isRefine && !retried;
    const qm = q.match(/只修改第 \((\d+)\) 小题/);
    const scopeQi = qm ? Number(qm[1]) - 1 : -1;
    const om0 = q.match(/只修改选项 ([A-H])/);
    const optionScope = om0 ? om0[1] : "";
    const gm = q.match(/【年级设定】([^（\n]+)（数学）/);
    const grade = gm ? gm[1].trim() : "";
    const badRefine = isRefine && /坏微调/.test(q);
    // 新选项：微调对象 / 图形类型（区分“指定用 **2D / 改用 2D”与默认“保持原类型”的说明）
    const tm = q.match(/【微调对象】([^\n]*)/);
    const target = tm ? (/只修改答案与解析/.test(tm[1]) ? "text" : (/只修改图形/.test(tm[1]) ? "figure" : "auto")) : "auto";
    const dm = q.match(/【图形类型】([^\n]*)/);
    const dim = dm ? dm[1] : "";
    const force2 = /指定用 \*\*2D|改用 2D/.test(dim);
    const force3 = /指定用 \*\*3D|改用 3D/.test(dim);
    const giv = q.match(/【用户给定答案（([^）]*)）】\n([\s\S]*?)\n\n【给定答案使用规则/);
    const givenAnswer = giv ? giv[2].trim() : "";
    const givenLabel = giv ? giv[1] : "";
    const obj = reply(qq, nImg, isRefine, broken, scopeQi, badRefine, target, force2, force3, optionScope);
    // 答案截图（改答案 → 粘贴图片）：模型从图里读出答案原文写进 givenAnswerText；
    // 若同时给了文字答案，以文字为准（下面的 applyGivenAnswer 用文字）。
    const hasAnsImg = isRefine && /【答案图片】/.test(q);
    if (hasAnsImg) {
      const ocr = "（mock 识别）∠DFE=10°。\n(1) 由角平分线得 $\\angle BAD=\\angle DAC=40^\\circ$；\n(2) 因为 $FE\\perp BC$，所以 $\\angle DFE=10^\\circ$。";
      obj.givenAnswerText = ocr;
      if (!givenAnswer) applyGivenAnswer(obj, ocr, "整题", scopeQi);
    }
    if (isRefine && givenAnswer) applyGivenAnswer(obj, givenAnswer, givenLabel, scopeQi);
    // 微调请求里必须带上「当前解析 / 当前各小题」上下文，否则模型无法"只改某一部分而其余保持"
    if (isRefine) obj.analysis = (obj.analysis || "") + "\n（mock上下文：解析" + (/【当前解析】/.test(q) ? "√" : "×") + " / 小题" + (/【当前各小题】/.test(q) ? "√" : "×") + "）";
    if (grade) obj.analysis = (obj.analysis || "") + "\n（mock年级：" + grade + "）";
    const usage = { prompt_tokens: 912, completion_tokens: 358, total_tokens: 1270 };
    const slowM = q.match(/慢速(\d+)?/);
    const slowMs = slowM ? (slowM[1] ? Number(slowM[1]) * 1000 : 6000) : 0;
    const emit = () => {
      if (badJson) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ choices: [{ message: { content: "抱歉，我无法按要求输出 JSON 格式。" } }], usage }));
      }
      if (!stream) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }], usage }));
      }
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
      const s = JSON.stringify(obj);
      const size = 36;
      const chunks = [];
      for (let i = 0; i < s.length; i += size) chunks.push(s.slice(i, i + size));
      let i = 0;
      const tick = () => {
        if (i >= chunks.length) {
          res.write("data: " + JSON.stringify({ choices: [], usage }) + "\n\n");
          res.write("data: [DONE]\n\n");
          return res.end();
        }
        res.write("data: " + JSON.stringify({ choices: [{ delta: { content: chunks[i] } }] }) + "\n\n");
        i++;
        setTimeout(tick, 25);
      };
      tick();
    };
    if (slowMs) setTimeout(emit, slowMs); else emit();
  });
}).listen(Number(process.argv[2]) || 8098, () => console.log("mock LLM on " + (Number(process.argv[2]) || 8098)));
