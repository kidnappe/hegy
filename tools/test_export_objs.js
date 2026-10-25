// 导出页「对象显隐」端到端测试（2D + 3D）
// 依赖：8099 应用在跑（不需要 mock，只导出已有记录）
// 用法：node tools/test_export_objs.js
// 说明：只读记录，inject 默认不落盘；导出文件写到 %TEMP%\hegy-export-objs\
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9437;
const APP = 'http://127.0.0.1:8099/solver/index.html';
const OUT = path.join(os.tmpdir(), 'hegy-export-objs');
const SHOT = path.join(__dirname, 'shots_new');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(SHOT)) fs.mkdirSync(SHOT, { recursive: true });

const REC_2D = 'r1792389250988_386';   // 2D / 3 小问 / 4 步 / 2 开关
const REC_3D = 'r1792495963519_444';   // 3D / 3 小问 / 5 平面（含重复平面）/ render3d.steps
const REC_VER = 'r1792399255048_853';  // v1=2D，v2/v3=3D：切版本要重建对象清单
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name, extra === undefined ? '' : JSON.stringify(extra)); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

async function cdp(url) {
  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(String((m.params.exceptionDetails.exception || {}).description || '').split('\n')[0]);
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const until = async (expr, ms, step) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await ev(expr).catch(() => false); if (v) return v; await sleep(step || 300); } return false; };
  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result && r.result.data) fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  };
  await send('Runtime.enable'); await send('Page.enable');
  return { ev, until, send, shot, errs, close: () => { try { ws.close(); } catch (e) {} } };
}

async function exportRec(recId, file) {
  const p = await cdp(APP);
  await p.until('!!(window.HJTest)', 30000);
  await p.ev("window.__exp=null;(function(){var _c=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__exp=this.href;};return 1;})()");
  await p.ev(`fetch('/api/store/record/${recId}').then(r=>r.json()).then(function(rec){HJTest.inject(rec);return true})`);
  await sleep(1800);
  await p.ev('window.__exp=null;1');
  await p.ev("document.getElementById('btnHtml').click();1");
  const got = await p.until("!!(window.__exp&&window.__exp.indexOf('blob:')===0)", 60000, 300);
  if (!got) throw new Error('export timeout ' + recId);
  const html = await p.ev('fetch(window.__exp).then(r=>r.text())', 60000);
  fs.writeFileSync(file, html);
  p.close();
  console.log('EXPORTED', recId, html.length, file);
}

// 页面上读状态：对象清单 + 每行状态
const SNAP = `(function(){
  var host=document.getElementById('expObjs');
  var rows=[].slice.call(document.querySelectorAll('#expObjs .exp-obj'));
  return {
    boxShown: !!(host && host.offsetParent !== null),
    head: (document.querySelector('#expObjs .exp-objs-tg')||{}).textContent||'',
    count: rows.length,
    rows: rows.map(function(r){return {k:r.dataset.key,n:(r.querySelector('.nm')||{}).textContent||'',off:r.classList.contains('off'),tag:(r.querySelector('.tag')||{}).style.display!=='none'}}),
    open: !!(document.querySelector('#expObjs .exp-objs-bd') && !document.querySelector('#expObjs .exp-objs-bd').hidden)
  };
})()`;

// 2D：按对象名读可见性
const vis2d = (names) => `(function(){
  var out={}; var want=${JSON.stringify(names)};
  for(var k in window.board.objects){var e=window.board.objects[k];var n=e&&e.name==null?'':String(e.name||'').trim();
    if(want.indexOf(n)>=0){out[n]=(out[n]===undefined?true:out[n]) && !(e.visProp&&e.visProp.visible===false);}}
  return out;})()`;

// 3D：按 id 读 vis
const vis3d = (ids) => `(function(){
  var api=window.GGB3D&&GGB3D.getApi?GGB3D.getApi():null; var out={};
  if(!api) return out;
  ${JSON.stringify(ids)}.forEach(function(id){var it=api.byId[id]; if(it) out[id]=it.vis!==false;});
  return out;})()`;

// 桌面 + 手机两种视口下截面板，并检查横向溢出
async function layoutShots(p, tag) {
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 860, deviceScaleFactor: 1, mobile: false });
  await sleep(900);
  await p.ev("(function(){var h=document.getElementById('expObjs'); if(h) h.scrollIntoView({block:'center',behavior:'instant'}); return 1})()");
  await sleep(400);
  await p.shot(path.join(SHOT, 's79_objs_' + tag + '_desktop.png'));
  const desk = await p.ev("(function(){var h=document.getElementById('expObjs');return {overflow:document.documentElement.scrollWidth-window.innerWidth, w:h?Math.round(h.getBoundingClientRect().width):0, rows:document.querySelectorAll('#expObjs .exp-obj').length}})()");
  ok('桌面无横向溢出', desk.overflow <= 1, desk);

  await p.send('Emulation.setDeviceMetricsOverride', { width: 402, height: 874, deviceScaleFactor: 1, mobile: true });
  await sleep(900);
  await p.ev("(function(){var h=document.getElementById('expObjs'); if(h) h.scrollIntoView({block:'center',behavior:'instant'}); return 1})()");
  await sleep(400);
  await p.shot(path.join(SHOT, 's79_objs_' + tag + '_mobile.png'));
  const mob = await p.ev("(function(){var h=document.getElementById('expObjs');return {overflow:document.documentElement.scrollWidth-window.innerWidth, w:h?Math.round(h.getBoundingClientRect().width):0, rows:document.querySelectorAll('#expObjs .exp-obj').length}})()");
  ok('手机无横向溢出', mob.overflow <= 1, mob);
  ok('手机上面板仍在页内', mob.w > 200 && mob.w <= 402, mob);
}

async function test2d(file) {
  console.log('\n== 2D 导出页 ==');
  const p = await cdp('file:///' + file.replace(/\\/g, '/'));
  await p.until('!!(window.board&&window.board.objects)', 20000);
  await sleep(1500);
  let s = await p.ev(SNAP);
  ok('对象面板存在且显示', s.boxShown && s.count > 0, { count: s.count, head: s.head.trim() });
  ok('默认收起', s.open === false);

  // 展开
  await p.ev("document.querySelector('#expObjs .exp-objs-tg').click();1");
  await sleep(300);
  s = await p.ev(SNAP);
  ok('展开后有列表', s.open && s.rows.length > 0, s.rows.slice(0, 6).map((r) => r.n));

  // 选一个当前可见的对象
  const target = (s.rows.filter((r) => !r.off)[0] || {}).k;
  ok('找到可见对象', !!target, target);
  const before = await p.ev(vis2d([target]));
  ok('该对象初始可见', before[target] === true, before);

  // 点眼睛隐藏
  await p.ev(`(function(){var r=[].slice.call(document.querySelectorAll('#expObjs .exp-obj')).filter(function(x){return x.dataset.key===${JSON.stringify(target)}})[0];r.querySelector('[data-act=eye]').click();return 1})()`);
  await sleep(500);
  const after = await p.ev(vis2d([target]));
  s = await p.ev(SNAP);
  const row = s.rows.filter((r) => r.k === target)[0];
  ok('手动隐藏后画布不可见', after[target] === false, after);
  ok('行显示为 off', !!row && row.off === true, row);

  // 切到第 1 个小问：手动隐藏必须保持
  await p.ev("(function(){var b=[].slice.call(document.querySelectorAll('#expSubTabs button'))[1]; if(b)b.click();return 1})()");
  await sleep(700);
  const inSub = await p.ev(vis2d([target]));
  ok('切小问后仍保持手动隐藏', inSub[target] === false, inSub);

  // 恢复自动
  await p.ev("document.querySelector('#expObjs .exp-objs-reset').click();1");
  await sleep(700);
  const reset = await p.ev(vis2d([target]));
  s = await p.ev(SNAP);
  const row2 = s.rows.filter((r) => r.k === target)[0];
  ok('恢复自动后按当前小问状态', reset[target] === true, reset);
  ok('恢复后行不再是 off', !!row2 && row2.off === false, row2);

  // 开关（显示控制）与对象清单联动：把未勾选的开关勾上 → 被它隐藏的对象行应恢复
  const ctlLabels = await p.ev("[].map.call(document.querySelectorAll('#expCtrls label'),function(l){return l.textContent.trim()})");
  const offBefore = (await p.ev(SNAP)).rows.filter((r) => r.off).map((r) => r.k);
  if (ctlLabels.length && offBefore.length) {
    const clicked = await p.ev("(function(){var ls=[].slice.call(document.querySelectorAll('#expCtrls label'));for(var i=0;i<ls.length;i++){var cb=ls[i].querySelector('input');if(cb&&!cb.checked){cb.click();return ls[i].textContent.trim()}}return ''})()");
    await sleep(700);
    s = await p.ev(SNAP);
    const stillOff = offBefore.filter((k) => { const r = s.rows.filter((x) => x.k === k)[0]; return r && r.off; });
    ok('勾选开关后对应对象恢复', !!clicked && stillOff.length < offBefore.length, { clicked, before: offBefore, stillOff });
  } else {
    console.log('  SKIP 开关联动（此记录无 controls 或没有隐藏对象）');
  }

  await p.shot(path.join(SHOT, 's79_export_objs_2d.png'));
  await layoutShots(p, '2d');
  ok('无 JS 异常', p.errs.length === 0, p.errs.slice(0, 3));
  p.close();
  return target;
}

async function test3d(file) {
  console.log('\n== 3D 导出页 ==');
  const p = await cdp('file:///' + file.replace(/\\/g, '/'));
  await p.until('!!(window.GGB3D&&GGB3D.getApi&&GGB3D.getApi())', 20000);
  await sleep(1800);
  let s = await p.ev(SNAP);
  ok('对象面板存在且显示', s.boxShown && s.count > 0, { count: s.count, head: s.head.trim() });
  await p.ev("document.querySelector('#expObjs .exp-objs-tg').click();1");
  await sleep(300);
  s = await p.ev(SNAP);
  ok('展开后有列表', s.open && s.rows.length > 0, s.rows.slice(0, 6).map((r) => r.n));
  ok('标签是「棱 AB / 面 ABCD」这种可读名', s.rows.some((r) => /^(棱|面|球|圆|尺寸)/.test(r.n)), s.rows.slice(0, 5).map((r) => r.n));
  const autoHidden = s.rows.filter((r) => r.off);
  ok('分步自动隐藏的对象被标成「自动」', autoHidden.length === 0 || autoHidden.every((r) => r.tag), autoHidden.slice(0, 3));

  const ids = s.rows.map((r) => r.k);
  const target = (s.rows.filter((r) => !r.off && /^棱|^面/.test(r.n))[0] || {}).k;
  ok('找到可见的棱/面', !!target, target);
  const before = await p.ev(vis3d([target]));
  ok('该对象初始可见', before[target] === true, before);

  await p.ev(`(function(){var r=[].slice.call(document.querySelectorAll('#expObjs .exp-obj')).filter(function(x){return x.dataset.key===${JSON.stringify(target)}})[0];r.querySelector('[data-act=eye]').click();return 1})()`);
  await sleep(500);
  const after = await p.ev(vis3d([target]));
  ok('手动隐藏后 api.vis=false', after[target] === false, after);

  // 3D 自带步骤面板：切一步，手动隐藏不能被步骤翻出来
  const stepBtns = await p.ev("document.querySelectorAll('.g3d-steps button').length");
  if (stepBtns) {
    const goPrev = async (n) => { for (let i = 0; i < n; i++) { await p.ev("(function(){var bs=[].slice.call(document.querySelectorAll('.g3d-steps button'));var b=bs.filter(function(x){return x.textContent==='◀'})[0];if(b)b.click();return 1})()"); await sleep(450); } };
    const goNext = async (n) => { for (let i = 0; i < n; i++) { await p.ev("(function(){var bs=[].slice.call(document.querySelectorAll('.g3d-steps button'));var b=bs.filter(function(x){return x.textContent==='▶'})[0];if(b)b.click();return 1})()"); await sleep(450); } };
    const stepNow = () => p.ev('GGB3D.getApi().getStep()');
    const last = await stepNow();          // -1 = 全部
    await goPrev(2);                       // 退到倒数第二步，此时必有分步隐藏
    const mid = await stepNow();
    ok('3D 步骤可切换', mid !== last, { last, mid });
    const inStep = await p.ev(vis3d([target]));
    ok('切 3D 步骤后仍保持手动隐藏', inStep[target] === false, inStep);

    // 分步自动隐藏的对象：行标「自动」+ 眼睛禁用
    const st = await p.ev(SNAP);
    const autoRows = st.rows.filter((r) => r.off && r.tag);
    ok('分步隐藏的对象被标成「自动」', autoRows.length > 0, autoRows.slice(0, 3).map((r) => r.n));
    if (autoRows.length) {
      const eyeDisabled = await p.ev(`(function(){var r=[].slice.call(document.querySelectorAll('#expObjs .exp-obj')).filter(function(x){return x.dataset.key===${JSON.stringify(autoRows[0].k)}})[0];return r.querySelector('[data-act=eye]').disabled})()`);
      ok('自动隐藏行的眼睛按钮禁用', eyeDisabled === true);
      // 点禁用按钮不能把对象翻出来
      await p.ev(`(function(){var r=[].slice.call(document.querySelectorAll('#expObjs .exp-obj')).filter(function(x){return x.dataset.key===${JSON.stringify(autoRows[0].k)}})[0];r.querySelector('[data-act=eye]').click();return 1})()`);
      await sleep(400);
      const stillHidden = await p.ev(vis3d([autoRows[0].k]));
      ok('自动隐藏的对象点不动', stillHidden[autoRows[0].k] === false, stillHidden);
    }

    // 回到「全部」，再恢复自动 → 目标必须重新可见
    await p.ev("(function(){var bs=[].slice.call(document.querySelectorAll('.g3d-steps button'));var b=bs.filter(function(x){return x.textContent==='全部'})[0];if(b)b.click();return 1})()");
    await sleep(600);
    ok('回到全部', (await stepNow()) === -1, await stepNow());
    await p.ev("document.querySelector('#expObjs .exp-objs-reset').click();1");
    await sleep(600);
    const reset = await p.ev(vis3d([target]));
    ok('恢复自动后按当前步重新可见', reset[target] === true, reset);
  } else {
    console.log('  SKIP 3D 步骤面板（此记录无 steps）');
    await p.ev("document.querySelector('#expObjs .exp-objs-reset').click();1");
    await sleep(600);
    const reset = await p.ev(vis3d([target]));
    ok('恢复自动后重新可见', reset[target] === true, reset);
  }

  // 定位按钮不报错、相机有变化
  await p.ev(`(function(){var r=[].slice.call(document.querySelectorAll('#expObjs .exp-obj')).filter(function(x){return x.dataset.key===${JSON.stringify(target)}})[0];r.querySelector('[data-act=focus]').click();return 1})()`);
  await sleep(900);

  await p.shot(path.join(SHOT, 's79_export_objs_3d.png'));
  await layoutShots(p, '3d');
  ok('无 JS 异常', p.errs.length === 0, p.errs.slice(0, 3));
  p.close();
  return ids.length;
}

// 多版本：v1(2D) → v2(3D) → 回 v1，对象清单必须跟着画板重建、手动显隐不能跨版本残留
async function testVersion(file) {
  console.log('\n== 多版本切换 ==');
  const p = await cdp('file:///' + file.replace(/\\/g, '/'));
  await p.until('document.querySelectorAll("#expVerTabs button").length', 20000);
  await sleep(1600);
  const verTabs = await p.ev("[].map.call(document.querySelectorAll('#expVerTabs button'),function(b){return b.textContent})");
  ok('有多版本标签', verTabs.length >= 2, verTabs);

  // 记录当前版本是 v2（3D），先切到 v1（2D）再测
  await p.ev("(function(){var bs=[].slice.call(document.querySelectorAll('#expVerTabs button'));if(bs[0])bs[0].click();return 1})()");
  await p.until('!!(window.board&&window.board.objects)', 20000);
  await sleep(1500);
  await p.ev("document.querySelector('#expObjs .exp-objs-tg').click();1");
  await sleep(300);
  let s = await p.ev(SNAP);
  const v1Count = s.count, v1Target = (s.rows.filter((r) => !r.off)[0] || {}).k;
  ok('v1(2D) 有对象', v1Count > 0 && !!v1Target, { count: v1Count, target: v1Target });

  // 在 v1 里手动隐藏一个对象
  await p.ev(`(function(){var r=[].slice.call(document.querySelectorAll('#expObjs .exp-obj')).filter(function(x){return x.dataset.key===${JSON.stringify(v1Target)}})[0];r.querySelector('[data-act=eye]').click();return 1})()`);
  await sleep(400);
  ok('v1 手动隐藏生效', (await p.ev(vis2d([v1Target])))[v1Target] === false);

  // 切到 v2（3D）
  await p.ev("(function(){var bs=[].slice.call(document.querySelectorAll('#expVerTabs button'));if(bs[1])bs[1].click();return 1})()");
  await sleep(2500);
  s = await p.ev(SNAP);
  const is3dNow = await p.ev("!!(window.GGB3D&&GGB3D.getApi&&GGB3D.getApi())");
  ok('v2 切到 3D', is3dNow === true);
  ok('对象清单按新画板重建', s.count !== v1Count && s.count > 0, { v1Count, v2Count: s.count });
  ok('v1 的手动隐藏没有残留', s.rows.every((r) => !r.off || r.tag), s.rows.filter((r) => r.off).slice(0, 3));

  // 切回 v1：刚才隐藏的对象应恢复可见（手动显隐不跨版本）
  await p.ev("(function(){var bs=[].slice.call(document.querySelectorAll('#expVerTabs button'));if(bs[0])bs[0].click();return 1})()");
  await sleep(2200);
  const back = await p.ev(vis2d([v1Target]));
  ok('切回 v1 后手动隐藏已清空', back[v1Target] === true, back);
  s = await p.ev(SNAP);
  ok('切回 v1 清单恢复', s.count === v1Count, { count: s.count, v1Count });

  ok('无 JS 异常', p.errs.length === 0, p.errs.slice(0, 3));
  p.close();
}

(async () => {
  const prof = path.join(OUT, 'edge-profile');
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + prof,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 80; i++) { try { ver = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await sleep(250); } }
  if (!ver) throw new Error('no devtools');

  const f2 = path.join(OUT, 'rec2d.html');
  const f3 = path.join(OUT, 'rec3d.html');
  const fv = path.join(OUT, 'recver.html');
  await exportRec(REC_2D, f2);
  await exportRec(REC_3D, f3);
  await exportRec(REC_VER, fv);

  await test2d(f2);
  await test3d(f3);
  await testVersion(fv);

  console.log('\nRESULT', fail === 0 ? 'ALL PASS' : fail + ' FAILED', '(' + pass + ' passed)');
  proc.kill();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.log('FATAL', e && e.message); process.exit(1); });
