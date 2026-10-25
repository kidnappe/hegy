// 历史 15 张纯图片题：旧/新对比（只读 .tmp/history_image_replay.json，不重跑模型）。
// 口径（HANDOVER §66.5-6）：
//   ① 跨时代比较——所有旧记录都早于 v2 提示词，措辞/解法差异不算回归；
//   ② 只有「答案不一致」才进人工复算清单，且需复算确认错误才算真回归；
//   ③ 重点看纯图片题会不会被窄校验误触发（routeExpected 应为空）。
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '.tmp', 'history_image_replay.json');
const j = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const rows = j.records || [];

function norm(s) {
  let t = String(s == null ? '' : s);
  t = t.replace(/\\[()[\]]/g, '').replace(/\\dfrac|\\tfrac/g, '\\frac');
  t = t.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2');
  t = t.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√$1');
  t = t.replace(/\\pi/g, 'π').replace(/\\circ/g, '°').replace(/\\angle/g, '∠')
       .replace(/\\parallel/g, '∥').replace(/\\perp/g, '⊥').replace(/\\triangle/g, '△')
       .replace(/\\cdot/g, '·').replace(/\\times/g, '×').replace(/\\left|\\right|\\,|\\;|\\!|\\ /g, '')
       .replace(/\\mathrm|\\text/g, '');
  t = t.replace(/[${}\s]/g, '');
  t = t.replace(/[，。；：、（）()【】\[\]“”"'’‘]/g, '');
  t = t.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  return t.toLowerCase();
}

function core(s) {
  // 去掉纯措辞填充，只留数学内核，用于跨时代比较
  let t = norm(s);
  t = t.replace(/\*\*/g, '');
  t = t.replace(/证明见解析|见解析|证明如下|证明|略/g, '');
  t = t.replace(/^(所以|故|即|因此)/, '');
  return t;
}

function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); }
  return m;
}
function dice(a, b) {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, total = 0;
  for (const [k, v] of A) { total += v; if (B.has(k)) inter += Math.min(v, B.get(k)); }
  for (const v of B.values()) total += v;
  return total ? (2 * inter) / total : 0;
}

const out = [];
let nOk = 0, nNoRoute = 0, nTriggered = 0, nInvalid = 0, nAnswerDiff = 0, nFail = 0;

for (const r of rows) {
  const res = r.result || {};
  const oldA = core(r.stored && r.stored.answer);
  const newA = core(res.answer);
  const aSim = dice(oldA, newA);
  // 跨时代口径：内核相似度 ≥0.8 视为「同一答案、仅措辞差异」；<0.8 才进人工复算清单
  const same = (oldA || newA) ? aSim >= 0.8 : null;
  const sim = dice(norm(r.stored && r.stored.questionText), norm(res.questionText));
  const oldLen = String((r.stored && r.stored.analysis) || '').length;
  const newLen = String(res.analysis || '').length;
  const routeExp = res.routeExpected || '';
  const routeAct = res.routeActual || '';
  const triggered = !!routeExp || !!res.routeRetried;

  if (r.status === 'done') nOk++; else nFail++;
  if (!triggered) nNoRoute++; else nTriggered++;
  if (res.valid !== true) nInvalid++;
  if (same === false) nAnswerDiff++;

  out.push({
    f: r.f, date: new Date(r.ts).toISOString().slice(0, 10),
    status: r.status,
    old3d: !!(r.stored && r.stored.render3d),
    new3d: !!(res.render3d && Array.isArray(res.render3d.points) && res.render3d.points.length),
    new2d: !!(res.renderCode && res.renderCode.trim().length > 20),
    route: routeExp + '->' + routeAct, retried: !!res.routeRetried, valid: res.valid,
    qSim: +sim.toFixed(2), aSim: +aSim.toFixed(2), answerSame: same,
    oldAns: String((r.stored && r.stored.answer) || '').slice(0, 46),
    newAns: String(res.answer || '').slice(0, 46),
    anaLen: oldLen + '->' + newLen,
    sec: +((r.elapsedMs || 0) / 1000).toFixed(1)
  });
}

out.sort((a, b) => (a.date < b.date ? -1 : 1));
console.log('\n=== 历史纯图片题 旧/新对比（跨时代：旧记录全部早于 v2 提示词）===');
const pad = (s, n) => { s = String(s); let w = 0; for (const ch of s) w += /[\u4e00-\u9fa5（）]/.test(ch) ? 2 : 1; return s + ' '.repeat(Math.max(0, n - w)); };
console.log(pad('记录', 30) + pad('日期', 12) + pad('旧3D', 6) + pad('新', 8) + pad('route', 10) + pad('valid', 7) + pad('题干相似', 9) + pad('答案一致', 9) + pad('相似', 7) + pad('解析长度', 13) + '耗时');
for (const r of out) {
  console.log(
    pad(r.f.replace(/\.json$/, ''), 30) + pad(r.date, 12) +
    pad(r.old3d ? 'Y' : 'N', 6) +
    pad((r.new3d ? '3D' : '') + (r.new2d ? '2D' : '') || '-', 8) +
    pad(r.route === '->' ? '-' : r.route, 10) +
    pad(r.valid ? 'Y' : 'N', 7) +
    pad(r.qSim, 9) +
    pad(r.answerSame === null ? '?' : (r.answerSame ? 'Y' : 'N'), 9) + pad(r.aSim, 7) +
    pad(r.anaLen, 13) + r.sec + 's'
  );
}

console.log('\n--- 汇总 ---');
console.log('记录数 ' + rows.length + '，跑通 ' + nOk + '，失败 ' + nFail);
console.log('未触发窄校验（routeExpected 为空且未重试）' + nNoRoute + ' / 触发 ' + nTriggered);
console.log('valid=false ' + nInvalid);
console.log('答案归一化后不一致 ' + nAnswerDiff + ' 条（需人工复算后才算回归）');

const diff = out.filter(r => r.answerSame === false);
if (diff.length) {
  console.log('\n--- 待人工复算（答案不一致）---');
  diff.forEach(r => console.log('  ' + r.f + '\n    旧: ' + r.oldAns + '\n    新: ' + r.newAns));
}
console.log('\nRESULT: ' + (nFail ? 'HAS-FAILURES' : 'RUN-OK'));
