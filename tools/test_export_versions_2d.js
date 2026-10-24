const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9435;
const APP = 'http://127.0.0.1:8099/solver/index.html';
const OUT = path.join(os.tmpdir(), 'hegy-export-tabs');
const profile = path.join(os.tmpdir(), 'edge-diag-version-tabs2');
const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await sleep(250); } }
  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(APP), { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (method, params) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evalIn = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const until = async (expr, ms, step) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await evalIn(expr).catch(() => false); if (v) return v; await sleep(step || 300); } return false; };
  await send('Runtime.enable');
  await until('!!(window.HJTest)', 30000);
  await evalIn("window.__exp=null;(function(){var _c=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__exp=this.href;};return 1;})()");
  const recId = 'r1792399255048_853';
  // 把顶层切成 v1（2D），currentVid=1，但 versions 里仍有 v2/v3（3D）
  const inject = `fetch('/api/store/record/${recId}').then(r=>r.json()).then(function(rec){
    var v1=(rec.versions||[])[0];
    ['answer','analysis','renderCode','render3d','style2d','steps','controls','focusTargets','subQuestions','questionText','figureBox','usage','elapsedMs','cost'].forEach(function(k){rec[k]=v1[k];});
    rec.currentVid=1;
    HJTest.inject(rec);return true;
  })`;
  await evalIn(inject);
  await sleep(1500);
  await evalIn('window.__exp=null;1');
  await evalIn("document.getElementById('btnHtml').click();1");
  const got = await until("!!(window.__exp&&window.__exp.indexOf('blob:')===0)", 60000, 300);
  if (!got) throw new Error('export timeout');
  const html = await evalIn('fetch(window.__exp).then(r=>r.text())', 60000);
  const file = path.join(OUT, 'multi_ver_2dstart.html');
  fs.writeFileSync(file, html);
  console.log('EXPORTED', html.length, file);

  const t2 = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('file:///' + file.replace(/\\/g, '/')), { method: 'PUT' })).json();
  const ws2 = new WebSocket(t2.webSocketDebuggerUrl);
  let id2 = 0; const pend2 = new Map(); const errs = [];
  ws2.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend2.has(m.id)) { pend2.get(m.id)(m); pend2.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify(m.params.exceptionDetails.exception));
  });
  await new Promise(r => ws2.addEventListener('open', r));
  const send2 = (method, params) => new Promise(res => { const i = ++id2; pend2.set(i, res); ws2.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const eval2 = async expr => {
    const r = await send2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('eval2: ' + JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const until2 = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await eval2(expr).catch(() => false); if (v) return v; await sleep(300); } return false; };
  await send2('Runtime.enable');
  await until2('!!(document.querySelectorAll("#expVerTabs button").length)', 20000);
  await sleep(1800);
  const info = async () => eval2(`(function(){
    var api=window.GGB3D&&GGB3D.getApi?GGB3D.getApi():null;
    return {
      verTabs:[].map.call(document.querySelectorAll('#expVerTabs button'),function(b){return b.textContent}),
      verActive:(document.querySelector('#expVerTabs .on')||{}).textContent||'',
      currentVid:(window.HJ_REC||{}).currentVid,
      hasBoard:!!(window.board&&window.board.objects&&Object.keys(window.board.objects).length),
      has3d:!!(api&&api.byId),
      hasGGB3D:!!window.GGB3D
    };
  })()`);
  console.log('INITIAL', JSON.stringify(await info()));
  await eval2(`(function(){var bs=[].slice.call(document.querySelectorAll('#expVerTabs button'));var b=bs.filter(function(x){return x.textContent==='v2'})[0];if(b)b.click();return 1})()`);
  await sleep(1800);
  console.log('AFTER v2', JSON.stringify(await info()));
  console.log('ERRORS', JSON.stringify(errs));
  proc.kill(); process.exit(0);
}
main().catch(e => { console.log('FATAL', e.stack || e.message); try { proc.kill(); } catch (x) {} process.exit(1); });
