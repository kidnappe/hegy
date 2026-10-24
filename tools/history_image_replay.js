// 历史纯图片题回放（隔离端口 8132，真实模型）。
// 从 Documents/Hegy/records 取当前版本的题图，question 留空（模拟真实搜题），逐题重跑。
// 用法：node tools\history_image_replay.js [--only=子串]
// 结果逐题写入 .tmp/history_image_replay.json；与旧解析的对比由 history_image_compare.js 离线做。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVE = path.join(ROOT, 'solver', 'serve.js');
const PORT = 8132;
const BASE = 'http://127.0.0.1:' + PORT;
const OUT = path.join(ROOT, '.tmp', 'history_image_replay.json');
const HOME = path.join(os.tmpdir(), 'hegy-imgreplay-' + process.pid);
const REC_DIR = path.join(process.env.USERPROFILE || os.homedir(), 'Documents', 'Hegy', 'records');
const onlyArg = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const only = onlyArg || '';

const settings = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE || os.homedir(), '.hegy', 'settings.json'), 'utf8'));
const CFG = settings.model;

const sleep = ms => new Promise(r => setTimeout(r, ms));
function killTree(p) { if (!p || !p.pid) return; try { execSync('taskkill /pid ' + p.pid + '/t /f', { stdio: 'ignore' }); } catch (e) {} }
async function waitHttp(url, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(url); if (r.ok) return true; } catch (e) {} await sleep(200); } return false; }
function save(all) { fs.writeFileSync(OUT, JSON.stringify(all, null, 1)); }
function readExisting() { try { const j = JSON.parse(fs.readFileSync(OUT, 'utf8')); return j && Array.isArray(j.records) ? j : null; } catch (e) { return null; } }

function loadImageRecords() {
  const out = [];
  for (const f of fs.readdirSync(REC_DIR).filter(x => x.endsWith('.json')).sort()) {
    const lines = fs.readFileSync(path.join(REC_DIR, f), 'utf8').split(/\r?\n/).filter(s => s.trim());
    let meta = null, rec = null;
    try { meta = JSON.parse(lines[0]); } catch (e) {}
    try { rec = JSON.parse(lines[lines.length - 1]); } catch (e) { continue; }
    if (!rec || !Array.isArray(rec.images) || !rec.images.length) continue;
    const vs = Array.isArray(rec.versions) ? rec.versions : [];
    const v = vs.find(x => x.vid === rec.currentVid) || vs[vs.length - 1] || rec;
    const get = k => (v && v[k] !== undefined) ? v[k] : rec[k];
    out.push({
      f,
      ts: rec.ts || (meta && meta.ts) || 0,
      grade: rec.grade || (meta && meta.grade) || '',
      image: rec.images[0],
      storedVid: v && v.vid || '',
      storedVersionTs: v && v.ts || 0,
      storedVersions: vs.length,
      stored: {
        questionText: String(get('questionText') || ''),
        answer: String(get('answer') || ''),
        analysis: String(get('analysis') || ''),
        render3d: !!(get('render3d') && Array.isArray(get('render3d').points) && get('render3d').points.length),
        renderCode: String(get('renderCode') || ''),
        refined: !!get('refined')
      }
    });
  }
  return out;
}

async function solveAndWait(row) {
  const t0 = Date.now();
  const r = await fetch(BASE + '/api/solve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: '', images: [row.image], grade: row.grade, config: CFG, stream: false })
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
  const all = prev || { startedAt: new Date().toISOString(), model: CFG.model, baseHost: (() => { try { return new URL(CFG.baseUrl).host; } catch (e) { return ''; } })(), records: [] };
  all.model = CFG.model;
  all.lastRunAt = new Date().toISOString();
  let rows = loadImageRecords();
  if (only) rows = rows.filter(r => r.f.includes(only));
  if (!rows.length) throw new Error('没有匹配的图片记录');
  // 图片不写进结果 JSON，避免文件过大；只留长度和前缀。
  const safeRows = rows.map(r => Object.assign({}, r, { image: undefined, imageLen: String(r.image || '').length, imageHead: String(r.image || '').slice(0, 30) }));

  const serveProc = spawn(process.execPath, [SERVE, String(PORT)], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { USERPROFILE: HOME, HOME }),
    stdio: 'ignore'
  });
  process.on('exit', () => killTree(serveProc));
  if (!await waitHttp(BASE + '/api/status', 15000)) throw new Error('serve 未启动');

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    process.stdout.write('[' + (i + 1) + '/' + rows.length + '] ' + row.f + ' ' + new Date(row.ts).toISOString().slice(0, 10) + ' ... ');
    try {
      const { task, elapsedMs } = await solveAndWait(row);
      const sr = safeRows[i];
      const outRow = {
        f: row.f, ts: row.ts, grade: row.grade, storedVid: row.storedVid, storedVersionTs: row.storedVersionTs,
        storedVersions: row.storedVersions, imageLen: sr.imageLen, imageHead: sr.imageHead,
        stored: row.stored,
        status: task.status, error: task.error || '', message: task.message || '',
        elapsedMs, finishedAt: new Date().toISOString(), result: task.result || null
      };
      const at = all.records.findIndex(x => x.f === row.f);
      if (at >= 0) all.records[at] = outRow; else all.records.push(outRow);
      all.records.sort((a, b) => a.ts - b.ts);
      save(all);
      const rr = outRow.result || {};
      process.stdout.write('done ' + (elapsedMs / 1000).toFixed(1) + 's attempts=' + (rr.attempts || '-') + ' route=' + (rr.routeExpected || '-') + '->' + (rr.routeActual || '-') + ' retried=' + (rr.routeRetried ? 1 : 0) + ' valid=' + (rr.valid ? 1 : 0) + '\n');
    } catch (e) {
      const sr = safeRows[i];
      const outRow = {
        f: row.f, ts: row.ts, grade: row.grade, storedVid: row.storedVid, storedVersionTs: row.storedVersionTs,
        storedVersions: row.storedVersions, imageLen: sr.imageLen, imageHead: sr.imageHead,
        stored: row.stored,
        status: 'error', error: 'RUNNER', message: String(e && e.message || e), elapsedMs: 0, finishedAt: new Date().toISOString(), result: null
      };
      const at = all.records.findIndex(x => x.f === row.f);
      if (at >= 0) all.records[at] = outRow; else all.records.push(outRow);
      all.records.sort((a, b) => a.ts - b.ts);
      save(all);
      process.stdout.write('FAILED: ' + outRow.message + '\n');
    }
  }
  killTree(serveProc);
  console.log('saved -> ' + OUT);
  process.exit(0);
})().catch(e => { console.error('ERROR:', e && e.stack || e); process.exit(1); });
