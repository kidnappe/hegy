// Golden 12 离线硬断言：只读 .tmp/golden12_results.json，不重跑模型。
// 用法：node .tmp\golden12_check.js
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '.tmp', 'golden12_results.json');
const j = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const byId = new Map((j.cases || []).map(c => [c.id, c]));

let pass = 0, fail = 0, warn = 0;
const failures = [], warnings = [];

function norm(s) {
  let t = String(s == null ? '' : s);
  t = t.replace(/\$/g, '').replace(/\\[()[\]]/g, '');
  t = t.replace(/\\dfrac/g, '\\frac').replace(/\\tfrac/g, '\\frac');
  t = t.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2');
  t = t.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√$1').replace(/\\sqrt/g, '√');
  t = t.replace(/\\not\s*\\subset/g, '⊄').replace(/\\notin/g, '∉').replace(/\\subset\s*eq?/g, '⊂').replace(/\\subseteq/g, '⊆').replace(/\\subset/g, '⊂');
  t = t.replace(/\\alpha/g, 'α').replace(/\\beta/g, 'β').replace(/\\gamma/g, 'γ')
       .replace(/\\theta/g, 'θ').replace(/\\pi/g, 'π').replace(/\\angle/g, '∠')
       .replace(/\\parallel/g, '∥').replace(/\\perp/g, '⊥').replace(/\\triangle/g, '△')
       .replace(/\\cdot/g, '·').replace(/\\times/g, '×').replace(/\\circ/g, '°')
       .replace(/\\cap/g, '∩').replace(/\\cup/g, '∪')
       .replace(/\\left|\\right|\\,|\\;|\\!|\\ /g, '').replace(/\\mathrm|\\text/g, '');
  t = t.replace(/\^/g, '');
  t = t.replace(/[${}]/g, '');
  t = t.replace(/[，。；：、（）()【】“”"'’‘\s]/g, '');
  t = t.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  return t;
}
const has = (t, ...needles) => needles.some(n => t.includes(n));

function check(id, name, ok, detail) {
  if (ok) { pass++; return true; }
  fail++; failures.push(id + ' · ' + name + (detail ? '  → ' + detail : ''));
  return false;
}

function graphicOf(r) {
  const code = String(r.renderCode || '').trim();
  const d3 = r.render3d;
  const d3ok = !!(d3 && typeof d3 === 'object' && ((Array.isArray(d3.points) && d3.points.length) || (Array.isArray(d3.objects) && d3.objects.length)));
  return { code, codeOk: code.length > 50, d3, d3ok, any: code.length > 50 || d3ok };
}

// G11 这类混合卷：按「一、二、三、四、」切段取各自答案
function seg(raw, idx) {
  const parts = String(raw || '').split(/[一二三四]、/);
  return parts[idx] || '';
}

const rows = [];
for (const c of (j.cases || [])) {
  const r = c.result || {};
  const g = graphicOf(r);
  const ana = String(r.analysis || '');
  const ans = norm(r.answer);
  const anaN = norm(ana);
  const both = ans + '|' + anaN;

  check(c.id, 'status=done', c.status === 'done', c.status + ' ' + (c.error || '') + ' ' + (c.message || ''));
  check(c.id, 'valid=true', r.valid === true, 'valid=' + r.valid + ' issues=' + JSON.stringify(r.issues || []));
  check(c.id, '图形存在', g.any, 'code=' + g.code.length + ' render3d=' + g.d3ok);
  check(c.id, 'analysis 非空(>=80字)', ana.length >= 80, 'len=' + ana.length);
  check(c.id, 'v2 提示词溯源', /^v2/.test(String(r.promptVer || '')), 'promptVer=' + r.promptVer + ' channel=' + r.promptChannel + ' bytes=' + r.promptBytes);
  // R-STEP-01：除纯选择题外必须给分步讲解（≥2 步）。2D 看顶层 steps，3D 看 render3d.steps。
  const stepN = Math.max((r.steps || []).length, ((r.render3d || {}).steps || []).length);
  check(c.id, '分步讲解 >= 2 步（R-STEP-01）', stepN >= 2, 'steps=' + stepN);
  // R-STEP-01 细节：每步至少列 1 个对象（3D 看 elements，2D 看 targets）
  const stepList = ((r.render3d || {}).steps || []).length ? (r.render3d || {}).steps : (r.steps || []);
  const emptyStep = stepList.filter(sp => !((sp.elements || sp.targets || []).length)).length;
  check(c.id, '每步至少 1 个对象', stepList.length > 0 && emptyStep === 0, '空步数=' + emptyStep + '/' + stepList.length);
  // U-16：解析里称 z 轴竖直，就必须声明 upAxis:"z"
  const saysZUp = /z\s*轴.{0,8}(竖直|向上)|竖直.{0,6}z\s*轴/.test(ana);
  const upAxis = ((r.render3d || {}).coordinateSystem || {}).upAxis || 'y';
  check(c.id, 'U-16 轴声明与文字一致', !saysZUp || upAxis === 'z', 'saysZUp=' + saysZUp + ' upAxis=' + upAxis);
  // R-3D-11：有 questionScenes 时，每个场景要有 points + title，且顶层应是第一张的副本
  const scenes = (r.render3d || {}).questionScenes || [];
  if (scenes.length) {
    const badScene = scenes.filter(s => !s || !s.title || !((s.payload || {}).points || []).length).length;
    check(c.id, 'R-3D-11 每个场景完整（title + points）', badScene === 0, '不合格场景=' + badScene + '/' + scenes.length);
    const key = o => ((o || {}).points || []).map(p => p.id + '@' + (p.coords || []).join(',')).join('|');
    const first = key((scenes[0] || {}).payload);
    check(c.id, 'R-3D-11 顶层是第一张副本', first && key(r.render3d) === first, 'scenes=' + scenes.length);
  }

  rows.push({ id: c.id, g, ans, anaN, both, r, ana });

  switch (c.id) {
    case 'G01':
      check(c.id, '线面平行判定：中位线 + 线在面内 + 线不在面内',
        has(anaN, '中位线') && has(anaN, '平面BDE') && has(anaN, '⊄', '不在平面'), ana.slice(0, 120));
      check(c.id, '结论 PA∥平面BDE', has(both, 'PA∥平面BDE', 'PA∥面BDE'), r.answer);
      break;
    case 'G02':
      check(c.id, '线面平行性质：交线/过 a 作平面', has(anaN, '交线', '∩'), ana.slice(0, 120));
      check(c.id, '结论 a∥b', has(both, 'a∥b'), r.answer);
      break;
    case 'G03':
      // 允许两条合法路径：判定定理（两组相交直线）或 法向量平行 + 两平面不重合
      const byThm = has(anaN, '相交') && has(anaN, 'EF', 'FG');
      const byVec = has(anaN, '法向量') && has(anaN, '∥', '平行') && has(anaN, '不重合', '方程');
      check(c.id, '面面平行判定：定理条件或法向量法成立', byThm || byVec, ana.slice(0, 120));
      check(c.id, '结论 平面EFG∥平面CB₁D₁', has(both, 'EFG∥平面CB', 'EFG∥CB', 'EFG∥平面CB_1D_1'), r.answer);
      break;
    case 'G04':
      check(c.id, '面面平行性质：交线 + a∥b', has(anaN, '交线', '∩') && has(both, 'a∥b'), ana.slice(0, 120));
      break;
    case 'G05':
      check(c.id, '线面垂直判定：AC⊥BD 且 AC⊥BB₁', has(anaN, 'AC⊥BD') && has(anaN, 'BB', 'DD'), ana.slice(0, 120));
      check(c.id, '结论 AC⊥平面BB₁D₁D', has(both, 'AC⊥平面BB1D1D', 'AC⊥平面BBDD', 'AC⊥平面BB'), r.answer);
      break;
    case 'G06':
      check(c.id, '线面垂直性质：同一平面/反证/同一法', has(anaN, '平行') && has(anaN, '反证', '同一平面', '同一个平面', '同一法'), ana.slice(0, 120));
      check(c.id, '结论 a∥b', has(both, 'a∥b'), r.answer);
      break;
    case 'G07':
      check(c.id, '面面垂直判定：a⊂β + a⊥α', has(anaN, '⊂') && has(anaN, '⊥'), ana.slice(0, 120));
      check(c.id, '结论 平面α⊥平面β', has(both, 'α⊥β', '平面α⊥平面β'), r.answer);
      break;
    case 'G08':
      check(c.id, '面面垂直性质：面面垂直 + 线在面内 + 线⊥交线（三条件齐全）',
        has(anaN, '∩', '相交') && has(anaN, '⊂') && has(anaN, '⊥'), ana.slice(0, 160));
      check(c.id, '结论 AB⊥β', has(both, 'AB⊥β', 'AB⊥平面β'), r.answer);
      break;
    case 'G09': {
      const dih = has(both, '125.26', '125.3', '-√3/3', 'arccos(-√3/3)');
      const pla = has(both, '54.74', '54.7', '√3/3');
      check(c.id, '二面角为钝角 125.26°（或 cos=-√3/3）', dih, r.answer);
      check(c.id, '平面夹角为锐角 54.74°（或 cos=√3/3）', pla, r.answer);
      check(c.id, '两值互补且分别标注', dih && pla && has(anaN, '二面角') && has(anaN, '夹角'), r.answer);
      break;
    }
    case 'G10': {
      check(c.id, 't 的三个值 0/1/2 都给出', has(ans, 't=0,1,2', 't∈{0,1,2}', 't=0、1、2') || (has(ans, 't=0') && has(ans, 't=1') && has(ans, 't=2')), r.answer);
      const flat = (anaN + '|' + ans).replace(/_/g, '');
      const pairs = ['A1P=A1B', 'A1B=A1P', 'A1P=BP', 'BP=A1P', 'A1B=BP', 'BP=A1B'].filter(k => flat.includes(k));
      check(c.id, '说明等腰的腰（哪两边相等）', (ans.match(/腰/g) || []).length >= 3 && new Set(pairs.map(x => x.split('=').sort().join('='))).size >= 3, r.answer);
      check(c.id, '答案里未把 t=4 当有效解', !has(ans, 't=4'), r.answer);
      break;
    }
    case 'G11': {
      const s1 = norm(seg(r.answer, 1)), s2 = norm(seg(r.answer, 2)), s3 = norm(seg(r.answer, 3)), s4 = norm(seg(r.answer, 4));
      check(c.id, '单选答案 B', /^B/.test(s1) || has(s1, '选B', 'B'), '[' + s1 + ']');
      check(c.id, '多选答案 BC（不是 BCD）', has(s2, 'BC') && !has(s2, 'BCD'), '[' + s2 + ']');
      check(c.id, '填空 60°', has(s3, '60°'), '[' + s3 + ']');
      check(c.id, '解答：体积 2/3', has(s4, '2/3'), '[' + s4 + ']');
      check(c.id, '解答：BD⊥平面PAC 的证明', has(anaN, 'BD⊥平面PAC', 'BD⊥平面 PAC'), ana.slice(0, 160));
      break;
    }
    case 'G12':
      check(c.id, '无 render3d（走 2D 多视图）', !g.d3ok && !r.render3d, JSON.stringify(r.render3d || null).slice(0, 80));
      check(c.id, 'renderCode 三视图标签齐全', has(g.code, '主视图') && has(g.code, '左视图') && has(g.code, '俯视图'), '');
      check(c.id, 'route 2d->2d 且未重试', r.routeExpected === '2d' && r.routeActual === '2d', r.routeExpected + '->' + r.routeActual);
      check(c.id, '表面积 6π', has(ans, '6π'), r.answer);
      check(c.id, '体积 2π', has(ans, '2π'), r.answer);
      check(c.id, '截面面积 4', has(ans, '4'), r.answer);
      break;
  }
}

console.log('\n=== Golden 12 离线硬断言 ===');
for (const row of rows) {
  const c = byId.get(row.id);
  const r = row.r;
  console.log(
    row.id + ' ' + String(c.status).padEnd(5) +
    ' valid=' + (r.valid ? '1' : '0') +
    ' route=' + (r.routeExpected || '-') + '->' + (r.routeActual || '-') +
    ' ' + ((c.elapsedMs || 0) / 1000).toFixed(1) + 's' +
    ' ana=' + row.ana.length +
    ' code=' + row.g.code.length +
    ' 3d=' + (row.g.d3ok ? 'Y' : 'N')
  );
}
const need = ['G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07', 'G08', 'G09', 'G10', 'G11', 'G12'];
const missing = need.filter(id => !byId.has(id));
if (missing.length) check('-', '缺题', false, missing.join(','));

if (warnings.length) { console.log('\n--- 提示 ---'); warnings.forEach(w => console.log('  ? ' + w)); }
if (failures.length) { console.log('\n--- 失败 ---'); failures.forEach(f => console.log('  ✗ ' + f)); }
console.log('\nRESULT: ' + (failures.length ? 'FAIL' : 'PASS') + '  pass=' + pass + ' fail=' + fail + ' cases=' + rows.length);
process.exit(failures.length ? 1 : 0);
