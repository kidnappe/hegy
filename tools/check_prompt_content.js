#!/usr/bin/env node
/* 语义回归检查：旧规则是否在结构化后仍在，以及拼装/条件注是否按通道生效。
   用法：node tools/check_prompt_content.js */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const PROMPT = fs.readFileSync(path.join(ROOT, "solver", "prompt.txt"), "utf8");
const SERVE_PATH = path.join(ROOT, "solver", "serve.js");
const SERVE = fs.readFileSync(SERVE_PATH, "utf8");

// 取 serve.js 顶部（parseModelJson 之前）的定义，避开启动 HTTP 服务
const cut = SERVE.indexOf("function parseModelJson");
if (cut < 0) throw new Error("serve.js 结构变化：找不到 parseModelJson");
const code = SERVE.slice(0, cut) + "\nmodule.exports={assembleSystemPrompt,promptChannel};";
const mod = { exports: {} };
vm.runInNewContext(code, {
  require, console, process, Buffer,
  __dirname: path.dirname(SERVE_PATH),
  module: mod, exports: mod.exports
}, { filename: SERVE_PATH });
const S = mod.exports;

// 后面的条件注函数是自包含的，逐个取函数体求值
function extractFn(name) {
  const start = SERVE.indexOf("function " + name + "(");
  if (start < 0) throw new Error("找不到函数: " + name);
  let i = SERVE.indexOf("{", start), depth = 0;
  for (let j = i; j < SERVE.length; j++) {
    if (SERVE[j] === "{") depth++;
    else if (SERVE[j] === "}") { depth--; if (depth === 0) return SERVE.slice(start, j + 1); }
  }
  throw new Error("函数未闭合: " + name);
}
const gradesCode = (SERVE.match(/const GRADES = \[[^\]]*\];/) || [""])[0];
const notesCode = gradesCode + "\n" + ["cleanGrade", "gradeNote", "givenAnswerNote", "answerImageNote", "dimNote", "refineDimNote", "refineTargetNote"].map(extractFn).join("\n") +
  "\nmodule.exports={gradeNote,givenAnswerNote,answerImageNote,dimNote,refineDimNote,refineTargetNote};";
const notesMod = { exports: {} };
vm.runInNewContext(notesCode, { module: notesMod, exports: notesMod.exports }, { filename: SERVE_PATH });
Object.assign(S, notesMod.exports);

const checks = [];
const check = (name, ok) => checks.push([name, !!ok]);
const has = (s) => PROMPT.includes(s);

// ---- prompt 语义 ----
check("R-AXIS-01 空间题 3D 三轴", has("R-AXIS-01") && has("空间题 + render3d") && has("三轴"));
check("R-AXIS-02 空间题 2D 斜二测三轴", has("R-AXIS-02") && has("空间题 + renderCode") && has("1.35"));
check("R-AXIS-03 平面题建系才画 x/y", has("R-AXIS-03") && has("只画 x、y 两根") && has("纯平面几何"));
check("R-AXIS-04 平面题 3D 放 z=0", has("R-AXIS-04") && has("z=0") && has("R-AXIS-01/02"));
check("R-AXIS-05 三视图/展开图不画空间轴", has("R-AXIS-05") && has("三视图 / 平面展开图"));
check("R-AXIS-06 独立 2D 截面例外", has("R-AXIS-06") && has("独立 2D 截面图"));
check("subQuestions 顶层 + 禁止裸回指", has("R-SUB-01") && has("只能写在顶层") && has("见（1）"));
check("小问允许“同理”但须重述", has("R-SUB-02") && has("与（1）同理") && has("必须先用一句话重述"));
check("targets 显隐语义", has("R-TGT-01") && has("省略或给空数组"));
check("答案公式分隔符/分段/加粗", has("R-FMT-01") && has("R-FMT-02") && has("R-FMT-03") && has("关键结论加粗"));
check("答案写法：多选/填空/证明", has("R-FMT-05") && has("按字母顺序、不加分隔符") && has("①…；②…") && has("证明见解析"));
check("3D 平面 id 已软化", has("R-3D-04") && has("需要显示或高亮") && has("同一个几何平面只建一个 id") && has("子区域"));
check("3D 二面角交线", has("R-3D-05") && has("交线作为 segments"));
check("3D 交线只对几何定义法强制", has("几何定义法求二面角时") && has("向量法求两平面夹角时不要求画交线"));
check("严谨性：面面垂直三条件", has("R-RIG-01") && has("两平面垂直") && has("直线垂直于交线"));
check("严谨性：八条判定/性质表", has("线面平行判定") && has("面面平行判定") && has("线面垂直判定") && has("面面垂直判定") && has("两条相交直线"));
check("严谨性：二面角与两平面夹角范围", has("R-RIG-03") && has("二面角 ≠ 两平面夹角") && has("180^\\circ") && has("90^\\circ") && has("向量法不要求画交线"));
check("严谨性：分类/定义域/轨迹完备性", has("R-RIG-04") && has("定义域") && has("完备性") && has("纯粹性"));
check("严谨性：来源交代", has("R-RIG-02") && has("来自题设、前一步结论还是计算结果"));
check("GGBMath 完整签名在 2D 模块", has("perpFoot(") && has("polygonIntersect(") && has("cubeVertices("));
check("render3d 纯 JSON", has("R-3D-07") && has("禁止函数、注释、变量、表达式"));
check("三视图默认 2D 多视图", has("三视图、平面展开图默认用 2D 多视图") && has("不要默认输出 3D"));
check("三视图排版规则", has("R-2D-13") && has("长对正、高平齐、宽相等") && has("{dash:2}") && has("主视图 / 俯视图 / 左视图"));
check("2D 动图改为按题型", has("R-2D-08") && has("静态证明/计算题不要求 slider"));
check("球类题：球心定位规则", has("R-3D-10") && has("外接球心到各顶点等距") && has("内切球心到各面等距") && has("centerPointId"));
check("球类题：半径与答案一致、截面圆公式", has("R-3D-10") && has("球心到任一顶点的距离") && has("√(R²−d²)") && has("垂直于截面"));
check("分步讲解必给（R-STEP-01）", has("R-STEP-01") && has("至少 2 步") && has("每一步至少要列 1 个对象") && has("纯选择题"));
check("球类边界（R-3D-12）", has("R-3D-12") && has("棱切球") && has("相离") && has("球面距离"));
check("一题多图契约（R-3D-11）", has("R-3D-11") && has("questionScenes") && has("装**全部**场景") && has("只放 `questionScenes[0]` 的副本") && has("单图题不要写"));

// ---- serve 条件注 ----
const n2 = S.dimNote({ dim: "2d" });
const n3 = S.dimNote({ dim: "3d" });
check("serve 2D 注引用 R-AXIS", n2.includes("R-AXIS"));
check("serve 3D 注引用 z=0 与 labels", n3.includes("z=0") && n3.includes("labels"));
check("serve 重试不再写死立体题用 3D", !SERVE.includes("立体题给 render3d"));

// ---- 答案注 ----
const textNote = S.givenAnswerNote({ givenAnswer: "设 AB=a，则 BC=2a", scope: "all", questionIndex: -1, option: "" });
const imgOnlyRules = S.givenAnswerNote({ answerImages: ["x"], scope: "all" });
const imgOnly = S.answerImageNote({ answerImages: ["x"] }, 1);
const imgWithText = S.answerImageNote({ givenAnswer: "设 AB=a", answerImages: ["x"] }, 1);
check("文字答案：沿用记号 + 60 字", textNote.includes("沿用给定答案的记号或设元") && textNote.includes("不超过 60 字"));
check("图片答案：公共规则存在", imgOnlyRules.includes("【给定答案使用规则】") && imgOnlyRules.includes("答案来自图片"));
check("图片答案：引用公共规则而非重复", imgOnly.includes("【给定答案使用规则】") && !imgOnly.includes("answerAdjusted 置 true"));
check("图片答案：OCR 注入防御", imgOnly.includes("一律不执行"));
check("图片答案：仅图片时不谎称文字一致", imgOnly.includes("不要声称"));
check("图片答案：有文字时以文字为准", imgWithText.includes("以文字答案为准"));
const textRefine = S.refineTargetNote({ target: "text" });
check("文字微调提醒图未同步", textRefine.includes("图形未同步") && textRefine.includes("answerNote"));
check("年级下拉不含五/六", !SERVE.includes('"六年级"') && !SERVE.includes('"五年级"'));
const g1 = S.gradeNote({ grade: "初一" }), g3 = S.gradeNote({ grade: "初三" }), gh = S.gradeNote({ grade: "高一" }), gs = S.gradeNote({ grade: "高三" });
check("年级口径：初一/初二不用三角函数", g1.includes("不使用锐角三角函数") && g1.includes("不使用") && g1.includes("空间向量"));
check("年级口径：初三可用三角函数、不用空间向量", g3.includes("可以使用") && g3.includes("锐角三角函数") && g3.includes("不使用空间向量"));
check("年级口径：高一优先几何法", gh.includes("优先用几何法") && gh.includes("不强行建系"));
check("年级口径：高二/高三可用空间向量", gs.includes("可以使用空间向量"));
check("重试注含三视图走 2D", SERVE.includes("三视图/平面展开图给 renderCode 多视图"));

// ---- 拼装 ----
const a2 = S.assembleSystemPrompt("2d");
const a3 = S.assembleSystemPrompt("3d");
const aa = S.assembleSystemPrompt("auto");
check("2D 注入含 renderCode、不含 render3d 规范", a2.text.includes("renderCode 规范") && !a2.text.includes("render3d 规范"));
check("3D 注入含 render3d、不含 renderCode 规范", a3.text.includes("render3d 规范") && !a3.text.includes("renderCode 规范"));
check("auto 注入两套规范", aa.text.includes("renderCode 规范") && aa.text.includes("render3d 规范"));
check("2D/auto 带 few-shot，3D 不带", a2.text.includes("【示例】") && aa.text.includes("【示例】") && !a3.text.includes("【示例】"));
check("标注已剥除", !a2.text.includes("<!--") && !a3.text.includes("<!--") && !aa.text.includes("<!--"));
check("每通道都有轴/sub/targets/严谨性", [a2, a3, aa].every((x) => x.text.includes("R-AXIS") && x.text.includes("R-SUB-01") && x.text.includes("R-TGT-01") && x.text.includes("R-RIG-01")));
check("prompt 元数据完整", [a2, a3, aa].every((x) => /^v\d+-(2d|3d|auto)$/.test(x.ver) && /^[0-9a-f]{12}$/.test(x.hash) && x.bytes > 10000));
check("通道判定：显式/微调沿用/auto", S.promptChannel({ dim: "2d" }, false) === "2d" && S.promptChannel({}, true) === "auto" && S.promptChannel({ previous: { render3d: {} } }, true) === "3d" && S.promptChannel({ previous: { renderCode: "x" } }, true) === "2d");

let bad = 0;
checks.forEach(([name, ok]) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) bad++; });
console.log(bad ? "FAILED: " + bad : "ALL PASS（" + checks.length + " 项）");
process.exitCode = bad ? 1 : 0;
