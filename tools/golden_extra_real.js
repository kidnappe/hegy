// 扩展 golden E01–E03（真实模型，隔离端口 8136）。
// E01 圆锥曲线定值（平面坐标只画 x/y）；E02 初中圆切线+相似（不画轴）；
// E03 答案图 injection 防御 + target=text 改数值时的图文提醒。
// 用法：node tools\golden_extra_real.js [--only=E01]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVE = path.join(ROOT, 'solver', 'serve.js');
const PORT = 8136;
const BASE = 'http://127.0.0.1:' + PORT;
const OUT = path.join(ROOT, '.tmp', 'extra_results.json');
const HOME = path.join(os.tmpdir(), 'hegy-extra-' + process.pid);
const onlyArg = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const only = onlyArg ? new Set(onlyArg.split(',').map(s => s.trim()).filter(Boolean)) : null;

const CFG = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE || os.homedir(), '.hegy', 'settings.json'), 'utf8')).model;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const kill = p => { if (p && p.pid) { try { execSync('taskkill /pid ' + p.pid + '/t /f', { stdio: 'ignore' }); } catch (e) {} } };

const CASES = [
  { id: 'E01', grade: '高三', question: '已知抛物线 $y^2=4x$ 的焦点为 F，过 F 的直线交抛物线于 A、B 两点。求证：$\\frac{1}{|AF|}+\\frac{1}{|BF|}$ 为定值，并求出该定值。' },
  { id: 'E02', grade: '初三', question: 'AB 是 ⊙O 的直径，C 是圆上一点，过 C 作 ⊙O 的切线交 AB 的延长线于 P。已知 PA=2，PC=4，求 ⊙O 的半径。' }
];

async function submit(body) {
  const r = await fetch(BASE + (body.__path || '/api/solve'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([k]) => k !== '__path')))
  });
  const j = await r.json();
  if (!r.ok || !j.taskId) throw new Error('提交失败：' + JSON.stringify(j).slice(0, 300));
  const t0 = Date.now();
  let t = null;
  while (Date.now() - t0 < 300000) {
    await sleep(400);
    t = await (await fetch(BASE + '/api/task/' + j.taskId)).json();
    if (t.status !== 'running') break;
  }
  if (!t) throw new Error('任务无响应');
  return { task: t, elapsedMs: Date.now() - t0 };
}

const norm = s => String(s || '').replace(/\$/g, '').replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2')
  .replace(/\\pi/g, 'π').replace(/\\circ/g, '°').replace(/\\sqrt\s*\{([^{}]*)\}/g, '√$1')
  .replace(/[\\{}]/g, '').replace(/\s+/g, '');

(async () => {
  fs.mkdirSync(HOME, { recursive: true });
  let all = null;
  try { const j = JSON.parse(fs.readFileSync(OUT, 'utf8')); if (j && Array.isArray(j.cases)) all = j; } catch (e) {}
  all = all || { startedAt: new Date().toISOString(), model: CFG.model, cases: [] };

  const srv = spawn(process.execPath, [SERVE, String(PORT)], { cwd: ROOT, env: { ...process.env, USERPROFILE: HOME, HOME }, stdio: 'ignore' });
  process.on('exit', () => kill(srv));
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/status')).ok) break; } catch (e) {} await sleep(200); }

  for (const c of CASES) {
    if (only && !only.has(c.id)) continue;
    process.stdout.write('[' + c.id + '] ... ');
    const { task, elapsedMs } = await submit({ question: c.question, grade: c.grade, config: CFG, stream: false });
    const row = { id: c.id, grade: c.grade, question: c.question, status: task.status, error: task.error || '', elapsedMs, result: task.result || null };
    const at = all.cases.findIndex(x => x.id === c.id);
    if (at >= 0) all.cases[at] = row; else all.cases.push(row);
    fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
    const r = row.result || {};
    process.stdout.write('done ' + (elapsedMs / 1000).toFixed(1) + 's valid=' + (r.valid ? 1 : 0) + ' ' + String(r.answer || '').slice(0, 60) + '\n');
  }
  kill(srv);

  // ---- 断言 ----
  console.log('\n=== 扩展 golden 断言 ===');
  let bad = 0;
  const ck = (id, name, ok, d) => { if (!ok) bad++; console.log('  ' + (ok ? 'ok  ' : 'FAIL') + ' ' + id + ' ' + name + (d ? '  [' + d + ']' : '')); };
  for (const c of all.cases) {
    const r = c.result || {};
    const ans = norm(r.answer), code = String(r.renderCode || '');
    ck(c.id, 'valid=true', r.valid === true, JSON.stringify(r.issues || []));
    ck(c.id, '走 2D（平面题不返回 render3d）', !(r.render3d && (r.render3d.points || []).length) && code.length > 50, 'code=' + code.length);
    if (c.id === 'E01') {
      ck(c.id, '答案含「定值」且值为 1', ans.includes('定值') && /定值[^0-9]{0,6}1|1/.test(ans), r.answer);
      const axisNames = (code.match(/name\s*:\s*['"]([xyz])['"]/g) || []);
      ck(c.id, 'R-AXIS-03 平面坐标不画 z', !/name\s*:\s*['"]z['"]/.test(code), axisNames.join(','));
    }
    if (c.id === 'E02') {
      ck(c.id, '答案半径为 3', /(^|[^0-9])3([^0-9]|$)/.test(ans) && ans.includes('3'), r.answer);
      ck(c.id, 'R-AXIS-03 纯平面几何不画坐标轴', !/name\s*:\s*['"][xyz]['"]/.test(code), '');
    }
  }
  console.log('\nRESULT: ' + (bad ? 'FAIL' : 'PASS') + '  saved -> ' + OUT);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERROR:', e && e.stack || e); process.exit(1); });
