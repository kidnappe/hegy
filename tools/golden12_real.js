// Golden 12 真实模型跑道（隔离端口 8131，配置从 ~/.hegy/settings.json 读取，不打印 key）。
// 用法：node tools\golden12_real.js [--only=G01,G12]
// 结果逐题写入 .tmp/golden12_results.json；断言由 golden12_check.js 离线计算，避免重跑。
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVE = path.join(ROOT, 'solver', 'serve.js');
const PORT = 8131;
const BASE = 'http://127.0.0.1:' + PORT;
const OUT = path.join(ROOT, '.tmp', 'golden12_results.json');
const HOME = path.join(os.tmpdir(), 'hegy-golden12-' + process.pid);
const onlyArg = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const only = onlyArg ? new Set(onlyArg.split(',').map(s => s.trim()).filter(Boolean)) : null;

const settingsPath = path.join(process.env.USERPROFILE || os.homedir(), '.hegy', 'settings.json');
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const CFG = settings.model;

// 按 HANDOVER §63.20 的题目要点拟的代表题（原表只有要点，没有逐字原题）。
const cases = [
  { id: 'G01', grade: '高二', topic: '线面平行判定', question: '在四棱锥 P-ABCD 中，底面 ABCD 是平行四边形，AC 与 BD 交于点 O，E 为 PC 的中点。求证：PA ∥ 平面 BDE。' },
  { id: 'G02', grade: '高二', topic: '线面平行性质', question: '已知直线 a ∥ 平面 α，a ⊂ 平面 β，平面 α ∩ 平面 β = b。求证：a ∥ b。' },
  { id: 'G03', grade: '高二', topic: '面面平行判定', question: '在正方体 ABCD-A₁B₁C₁D₁ 中，E、F、G 分别是棱 AB、AD、AA₁ 的中点。求证：平面 EFG ∥ 平面 CB₁D₁。' },
  { id: 'G04', grade: '高二', topic: '面面平行性质', question: '已知平面 α ∥ 平面 β，平面 γ 分别与平面 α、β 相交于直线 a、b。求证：a ∥ b。' },
  { id: 'G05', grade: '高二', topic: '线面垂直判定', question: '在正方体 ABCD-A₁B₁C₁D₁ 中，求证：AC ⊥ 平面 BB₁D₁D。' },
  { id: 'G06', grade: '高二', topic: '线面垂直性质', question: '已知直线 a ⊥ 平面 α，直线 b ⊥ 平面 α。求证：a ∥ b。' },
  { id: 'G07', grade: '高二', topic: '面面垂直判定', question: '已知直线 a ⊥ 平面 α，a ⊂ 平面 β。求证：平面 α ⊥ 平面 β。' },
  { id: 'G08', grade: '高二', topic: '面面垂直性质', question: '已知平面 α ⊥ 平面 β，α ∩ β = l，AB ⊂ α，AB ⊥ l 于点 B。求证：AB ⊥ β。' },
  { id: 'G09', grade: '高三', topic: '二面角与平面夹角', question: '在棱长为 2 的正方体 ABCD-A₁B₁C₁D₁ 中，求二面角 A₁-BD-C 的大小，以及平面 A₁BD 与平面 CBD 所成夹角的大小。' },
  { id: 'G10', grade: '高三', topic: '等腰分类讨论', question: '在正三棱柱 ABC-A₁B₁C₁ 中，AB = AA₁ = 2，点 P 在棱 CC₁ 上（包括端点），CP = t。当 △A₁BP 为等腰三角形时，求 t 的所有值，并说明此时等腰三角形的腰。' },
  { id: 'G11', grade: '高三', topic: '混合卷格式', question: '请按小题分别作答：\n一、单选题：已知直线 l ⊥ 平面 α，直线 m ⊂ 平面 α，则（ ）\nA. l ∥ m    B. l ⊥ m    C. l 与 m 异面    D. l 与 m 相交\n二、多选题：下列命题中正确的是（ ）\nA. 平行于同一个平面的两条直线平行\nB. 垂直于同一个平面的两条直线平行\nC. 垂直于同一条直线的两个平面平行\nD. 平行于同一条直线的两个平面平行\n三、填空题：在棱长为 2 的正方体 ABCD-A₁B₁C₁D₁ 中，异面直线 A₁B 与 B₁C 所成角的大小为____。\n四、解答题：在四棱锥 P-ABCD 中，底面 ABCD 是正方形，PA ⊥ 底面 ABCD，PA = AB = 2，E 为 PC 的中点。求证：BD ⊥ 平面 PAC，并求三棱锥 E-BCD 的体积。' },
  { id: 'G12', grade: '初三', topic: '三视图还原+截面', question: '一个几何体的三视图如下：主视图和左视图都是边长为 2 的正方形，俯视图是直径为 2 的圆。\n（1）求该几何体的表面积和体积；\n（2）用一个过该几何体轴线的平面去截它，求所得截面的面积。' }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
function killTree(p) { if (!p || !p.pid) return; try { execSync('taskkill /pid ' + p.pid + '/t /f', { stdio: 'ignore' }); } catch (e) {} }
async function waitHttp(url, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(url); if (r.ok) return true; } catch (e) {} await sleep(200); } return false; }
function save(all) { fs.writeFileSync(OUT, JSON.stringify(all, null, 1)); }

function readExisting() {
  try { const j = JSON.parse(fs.readFileSync(OUT, 'utf8')); return j && Array.isArray(j.cases) ? j : null; } catch (e) { return null; }
}

async function solveAndWait(c) {
  const t0 = Date.now();
  const r = await fetch(BASE + '/api/solve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: c.question, grade: c.grade, config: CFG, stream: false })
  });
  const j = await r.json();
  if (!r.ok || !j.taskId) throw new Error('提交失败：' + JSON.stringify(j));
  let t = null;
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    await sleep(400);
    const tr = await fetch(BASE + '/api/task/' + j.taskId);
    t = await tr.json();
    if (t.status !== 'running') break;
  }
  if (!t) throw new Error('任务无响应');
  if (t.status === 'running') throw new Error('任务超时（>300s）');
  return { task: t, elapsedMs: Date.now() - t0 };
}

(async () => {
  fs.mkdirSync(HOME, { recursive: true });
  const prev = readExisting();
  const all = prev || { startedAt: new Date().toISOString(), model: CFG.model, baseHost: (() => { try { return new URL(CFG.baseUrl).host; } catch (e) { return ''; } })(), cases: [] };
  all.model = CFG.model;
  all.lastRunAt = new Date().toISOString();
  const todo = cases.filter(c => !only || only.has(c.id));
  if (!todo.length) throw new Error('--only 没有匹配的题号');

  const serveProc = spawn(process.execPath, [SERVE, String(PORT)], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { USERPROFILE: HOME, HOME }),
    stdio: 'ignore'
  });
  process.on('exit', () => killTree(serveProc));
  if (!await waitHttp(BASE + '/api/status', 15000)) throw new Error('serve 未启动');

  for (const c of todo) {
    const idx = cases.findIndex(x => x.id === c.id);
    process.stdout.write('[' + (idx + 1) + '/12] ' + c.id + ' ' + c.topic + ' ... ');
    try {
      const { task, elapsedMs } = await solveAndWait(c);
      const row = {
        id: c.id, topic: c.topic, grade: c.grade, question: c.question,
        status: task.status, error: task.error || '', message: task.message || '',
        elapsedMs, finishedAt: new Date().toISOString(),
        result: task.result || null
      };
      const at = all.cases.findIndex(x => x.id === c.id);
      if (at >= 0) all.cases[at] = row; else all.cases.push(row);
      all.cases.sort((a, b) => a.id.localeCompare(b.id));
      save(all);
      const rr = row.result || {};
      process.stdout.write('done ' + (elapsedMs / 1000).toFixed(1) + 's attempts=' + (rr.attempts || '-') + ' route=' + (rr.routeExpected || '-') + '->' + (rr.routeActual || '-') + ' retried=' + (rr.routeRetried ? 1 : 0) + ' valid=' + (rr.valid ? 1 : 0) + '\n');
    } catch (e) {
      const row = { id: c.id, topic: c.topic, grade: c.grade, question: c.question, status: 'error', error: 'RUNNER', message: String(e && e.message || e), elapsedMs: 0, finishedAt: new Date().toISOString(), result: null };
      const at = all.cases.findIndex(x => x.id === c.id);
      if (at >= 0) all.cases[at] = row; else all.cases.push(row);
      all.cases.sort((a, b) => a.id.localeCompare(b.id));
      save(all);
      process.stdout.write('FAILED: ' + row.message + '\n');
    }
  }
  killTree(serveProc);
  console.log('saved -> ' + OUT);
  process.exit(0);
})().catch(e => { console.error('ERROR:', e && e.stack || e); process.exit(1); });
