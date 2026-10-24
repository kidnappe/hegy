// 球类 golden（R-3D-10）：外接球 / 内切球 / 截面圆，真实模型，隔离端口 8134。
// 断言球心与半径是否与答案一致——这是 §66 之前完全没有覆盖的规则缺口。
// 用法：node tools\golden_sphere_real.js [--only=S01]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVE = path.join(ROOT, 'solver', 'serve.js');
const PORT = 8134;
const BASE = 'http://127.0.0.1:' + PORT;
const OUT = path.join(ROOT, '.tmp', 'sphere_results.json');
const HOME = path.join(os.tmpdir(), 'hegy-sphere-' + process.pid);
const onlyArg = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const only = onlyArg ? new Set(onlyArg.split(',').map(s => s.trim()).filter(Boolean)) : null;

const settings = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE || os.homedir(), '.hegy', 'settings.json'), 'utf8'));
const CFG = settings.model;

const cases = [
  { id: 'S01', grade: '高三', topic: '外接球', question: '棱长为 2 的正方体，求它的外接球的表面积和体积。' },
  { id: 'S02', grade: '高三', topic: '内切球', question: '底面半径为 3、高为 4 的圆锥，求它的内切球的半径。' },
  { id: 'S03', grade: '高三', topic: '截面圆', question: '球的半径为 5，用一个与球心距离为 3 的平面去截球，求所得截面圆的半径和面积。' },
  { id: 'S04', grade: '高三', topic: '棱切球', question: '棱长为 2 的正方体，求它的棱切球（与各棱都相切的球）的半径。' },
  { id: 'S05', grade: '高三', topic: '两球位置关系', question: '球 O₁ 的半径为 3，球 O₂ 的半径为 2，两球球心距为 4。判断这两个球的位置关系。' },
  { id: 'S06', grade: '高三', topic: '球面距离', question: '球 O 的半径为 3，A、B 是球面上的两点，球心角 ∠AOB = 60°。求 A、B 两点间的球面距离。' }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
function killTree(p) { if (!p || !p.pid) return; try { execSync('taskkill /pid ' + p.pid + '/t /f', { stdio: 'ignore' }); } catch (e) {} }
async function waitHttp(url, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(url); if (r.ok) return true; } catch (e) {} await sleep(200); } return false; }
function save(all) { fs.writeFileSync(OUT, JSON.stringify(all, null, 1)); }

async function solveAndWait(c) {
  const t0 = Date.now();
  const r = await fetch(BASE + '/api/solve', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: c.question, grade: c.grade, dim: '3d', config: CFG, stream: false })
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

// 期望值（硬编码，来自独立复算）
const expect = {
  S01: { radius: Math.sqrt(3), answerAny: ['12π', '4√3π', '4\\sqrt{3}\\pi'], kind: 'sphere' },
  S02: { radius: 1.5, answerAny: ['3/2', '1.5'], kind: 'sphere' },
  S03: { radius: 4, answerAny: ['4', '16π'], kind: 'circle' },
  S04: { radius: Math.SQRT2, answerAny: ['√2', '1.414', '1.41'], kind: 'sphere' },
  S05: { radius: 3, answerAny: ['相交'], kind: 'sphere' },
  S06: { radius: 3, answerAny: ['π', 'pi'], kind: 'sphere' }
};

function norm(s) {
  let t = String(s || '').replace(/\$/g, '');
  t = t.replace(/\\dfrac|\\tfrac/g, '\\frac').replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2');
  t = t.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√$1').replace(/\\pi/g, 'π').replace(/\\circ/g, '°');
  return t.replace(/[${}\s]/g, '');
}

(async () => {
  fs.mkdirSync(HOME, { recursive: true });
  let all = null;
  try { const j = JSON.parse(fs.readFileSync(OUT, 'utf8')); if (j && Array.isArray(j.cases)) all = j; } catch (e) {}
  all = all || { startedAt: new Date().toISOString(), model: CFG.model, cases: [] };
  all.lastRunAt = new Date().toISOString();
  const todo = cases.filter(c => !only || only.has(c.id));

  const serveProc = spawn(process.execPath, [SERVE, String(PORT)], {
    cwd: ROOT, env: Object.assign({}, process.env, { USERPROFILE: HOME, HOME }), stdio: 'ignore'
  });
  process.on('exit', () => killTree(serveProc));
  if (!await waitHttp(BASE + '/api/status', 15000)) throw new Error('serve 未启动');

  for (const c of todo) {
    process.stdout.write('[' + c.id + '] ' + c.topic + ' ... ');
    try {
      const { task, elapsedMs } = await solveAndWait(c);
      const row = { id: c.id, topic: c.topic, grade: c.grade, question: c.question, status: task.status, error: task.error || '', message: task.message || '', elapsedMs, finishedAt: new Date().toISOString(), result: task.result || null };
      const at = all.cases.findIndex(x => x.id === c.id);
      if (at >= 0) all.cases[at] = row; else all.cases.push(row);
      all.cases.sort((a, b) => a.id.localeCompare(b.id));
      save(all);
      const r3 = (row.result || {}).render3d || {};
      process.stdout.write('done ' + (elapsedMs / 1000).toFixed(1) + 's valid=' + (row.result && row.result.valid ? 1 : 0) + '\n');
      process.stdout.write('     ans: ' + String((row.result || {}).answer || '').replace(/\n/g, ' ').slice(0, 160) + '\n');
      process.stdout.write('     spheres=' + JSON.stringify((r3.spheres || []).map(s => ({ c: s.centerPointId, r: s.radius }))) + ' circles=' + JSON.stringify((r3.circles || []).map(s => ({ c: s.centerPointId, r: s.radius, n: s.normal }))) + '\n');
    } catch (e) {
      const row = { id: c.id, topic: c.topic, grade: c.grade, question: c.question, status: 'error', error: 'RUNNER', message: String(e && e.message || e), elapsedMs: 0, finishedAt: new Date().toISOString(), result: null };
      const at = all.cases.findIndex(x => x.id === c.id);
      if (at >= 0) all.cases[at] = row; else all.cases.push(row);
      save(all);
      process.stdout.write('FAILED: ' + row.message + '\n');
    }
  }
  killTree(serveProc);

  // ---- 离线断言 ----
  console.log('\n=== 球类 golden 断言 ===');
  let bad = 0;
  for (const c of all.cases) {
    const r = c.result || {};
    const r3 = r.render3d || {};
    const e = expect[c.id];
    const list = e.kind === 'sphere' ? (r3.spheres || []) : (r3.circles || []);
    const got = list.map(x => Number(x.radius));
    const near = got.some(v => isFinite(v) && Math.abs(v - e.radius) <= Math.max(0.02, e.radius * 0.02));
    const ans = norm(r.answer);
    const ansOk = e.answerAny.some(k => ans.includes(k));
    const okAll = c.status === 'done' && r.valid === true && near && ansOk;
    if (!okAll) bad++;
    console.log('  ' + (okAll ? 'ok  ' : 'FAIL') + ' ' + c.id +
      ' 半径 ' + JSON.stringify(got) + ' 期望 ' + e.radius.toFixed(3) + (near ? ' ✓' : ' ✗') +
      ' 答案' + (ansOk ? ' ✓' : ' ✗ [' + String(r.answer || '').slice(0, 60) + ']'));
  }
  console.log('\nRESULT: ' + (bad ? 'FAIL' : 'PASS') + '  saved -> ' + OUT);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERROR:', e && e.stack || e); process.exit(1); });
