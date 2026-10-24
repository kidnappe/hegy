// §59 真模型验收：改答案区「粘贴答案截图 → 点重画由模型读图」
// 用法: node tools\answer_image_real.js        （会消耗 token，不属日常回归）
//
// 做什么：
//   1) 起 serve(8126)，用本机真实配置（~/.hegy/settings.json 的 model 段）
//   2) 真模型解一道 2D 题 → 拿到 answer/renderCode 作为 previous
//   3) 用无头 Edge 把「∠BDC = 75°」渲染成 PNG，当作「答案截图」
//   4) POST /api/refine（answerImages=[png]，不给文字）→ 检查模型是否读图并回 givenAnswerText
//
// 环境变量：Q（题目）NUM（答案图上的文字）TAG（截图后缀）
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const EPORT = 9447, SPORT = 8126;
const API = "http://127.0.0.1:" + SPORT;
const SHOTS = path.join(__dirname, "shots_new");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Q = process.env.Q || "等腰三角形 ABC 中，AB=AC，∠A=40°，BD 平分 ∠ABC 交 AC 于 D，求 ∠BDC 的度数。";
const NUM = process.env.NUM || "∠BDC = 75°";
const TAG = process.env.TAG || "real_ans_img";

let serveProc = null, edgeProc = null;
function killTree(p) { if (p && p.pid) { try { execSync("taskkill /pid " + p.pid + "/t /f", { stdio: "ignore" }); } catch (e) {} } }
process.on("exit", () => { killTree(serveProc); killTree(edgeProc); });

async function waitHttp(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(url); if (r.ok) return true; } catch (e) {} await sleep(200); }
  return false;
}
async function pollTask(id, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const d = await (await fetch(API + "/api/task/" + id)).json();
    if (d.status !== "running") return d;
    await sleep(600);
  }
  return { status: "timeout" };
}
async function makeAnswerPng(text) {
  edgeProc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + EPORT,
    "--user-data-dir=" + path.join(os.tmpdir(), "edge-ans-img-real-" + process.pid),
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let ver = null;
  for (let i = 0; i < 80; i++) { try { ver = await (await fetch("http://127.0.0.1:" + EPORT + "/json/version")).json(); break; } catch (e) { await sleep(250); } }
  if (!ver) throw new Error("no devtools");
  const tab = await (await fetch("http://127.0.0.1:" + EPORT + "/json/new?about:blank", { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  await new Promise((r) => ws.addEventListener("open", r));
  const send = (m, p) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); res({}); } }, 20000); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 640, height: 220, deviceScaleFactor: 2, mobile: false });
  const html = "<body style=\"margin:0;background:#fff;font:44px/1.6 'Microsoft YaHei',sans-serif;padding:24px 28px;color:#111\">" +
    "<div style=\"font-size:22px;color:#666\">答案</div><div>" + text.replace(/[<>&]/g, "") + "</div></body>";
  await send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(html) });
  await sleep(900);
  const r = await send("Page.captureScreenshot", { format: "png" });
  ws.close();
  if (!r.result || !r.result.data) throw new Error("截图失败");
  return "data:image/png;base64," + r.result.data;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".hegy", "settings.json"), "utf8"));
  const cfg = Object.assign({}, s.model);
  if (!cfg.baseUrl || !cfg.apiKey) throw new Error("本机没有可用配置");
  console.log("模型:", cfg.model, "| 题目:", Q.slice(0, 30) + "…");

  serveProc = spawn(process.execPath, [path.join(ROOT, "solver", "serve.js"), String(SPORT)], { stdio: "ignore" });
  if (!(await waitHttp(API + "/api/status", 15000))) throw new Error("serve 未启动");

  console.log("\n[1] 真模型解题…");
  let t0 = Date.now();
  const r1 = await (await fetch(API + "/api/solve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: Q, config: cfg, stream: true }) })).json();
  const d1 = await pollTask(r1.taskId, 180000);
  if (d1.status !== "done") { console.error("解题失败:", JSON.stringify(d1).slice(0, 400)); process.exit(1); }
  const base = d1.result;
  console.log("    完成 " + ((Date.now() - t0) / 1000).toFixed(1) + "s | answer=" + String(base.answer).slice(0, 60).replace(/\n/g, " "));
  console.log("    renderCode " + String(base.renderCode || "").length + "B / render3d " + (base.render3d ? "有" : "无"));

  console.log("\n[2] 生成答案截图：" + NUM);
  const img = await makeAnswerPng(NUM);
  fs.writeFileSync(path.join(SHOTS, TAG + "_input.png"), Buffer.from(img.split(",")[1], "base64"));
  console.log("    dataURL " + Math.round(img.length / 1024) + "KB");

  console.log("\n[3] 只给图片，走 /api/refine…");
  t0 = Date.now();
  const body = {
    question: Q, questionText: base.questionText || "", images: [],
    previous: { answer: base.answer, analysis: base.analysis, questionText: base.questionText || "", figureBox: base.figureBox || null, renderCode: base.renderCode, render3d: base.render3d, subQuestions: base.subQuestions || null },
    instruction: "按用户给定答案重新生成完整解答与图形",
    target: "answer", scope: "all", questionIndex: -1, option: "",
    answerImages: [img], config: cfg, stream: true
  };
  const r2 = await (await fetch(API + "/api/refine", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const d2 = await pollTask(r2.taskId, 240000);
  if (d2.status !== "done") { console.error("重画失败:", JSON.stringify(d2).slice(0, 600)); process.exit(1); }
  const rr = d2.result;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("    完成 " + secs + "s | tokens " + (rr.usage && rr.usage.total_tokens));
  console.log("    givenAnswerText : " + String(rr.givenAnswerText || "(空)").slice(0, 160).replace(/\n/g, " / "));
  console.log("    givenAnswer     : " + String(rr.givenAnswer || "(空)").slice(0, 120).replace(/\n/g, " / "));
  console.log("    givenFromImage  : " + rr.givenFromImage);
  console.log("    answerAdjusted  : " + rr.answerAdjusted);
  console.log("    answerNote      : " + String(rr.answerNote || "(空)").slice(0, 120));
  console.log("    answer          : " + String(rr.answer || "").slice(0, 120).replace(/\n/g, " "));
  console.log("    renderCode      : " + String(rr.renderCode || "").length + "B");
  const pass = !!(rr.givenFromImage && String(rr.givenAnswerText || "").trim());
  console.log("\n" + (pass ? "RESULT: 通过（模型确实读图并回了 givenAnswerText）" : "RESULT: 失败（没拿到 givenAnswerText）"));
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
