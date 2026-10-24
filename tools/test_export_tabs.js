const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9429;
const APP = 'http://127.0.0.1:8099/solver/index.html';
const OUT = path.join(os.tmpdir(), 'hegy-export-tabs');
fs.mkdirSync(OUT, { recursive: true });
const profile = path.join(os.tmpdir(), 'edge-diag-export-tabs');
const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await sleep(250); } }
  if (!ver) throw new Error('no devtools');
  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(APP), { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errors = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (method, params) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evalIn = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const until = async (expr, ms, step) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await evalIn(expr).catch(() => false); if (v) return v; await sleep(step || 300); } return false; };
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 860, deviceScaleFactor: 1, mobile: false });
  await until('!!(window.HJTest)', 30000);
  await evalIn("window.__exp=null;(function(){var _c=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__exp=this.href;};return 1;})()");

  async function exportRecord(recId, tag) {
    const ok = await evalIn(`fetch('/api/store/record/${recId}').then(r=>r.json()).then(function(rec){HJTest.inject(rec);return true})`).catch(e => String(e));
    if (ok !== true) throw new Error('inject failed ' + recId + ' ' + ok);
    await sleep(1200);
    await evalIn('window.__exp=null;1');
    await evalIn("document.getElementById('btnHtml').click();1");
    const got = await until("!!(window.__exp&&window.__exp.indexOf('blob:')===0)", 60000, 300);
    if (!got) throw new Error('export timeout ' + recId);
    const html = await evalIn('fetch(window.__exp).then(r=>r.text())', 60000);
    const file = path.join(OUT, tag + '.html');
    fs.writeFileSync(file, html);
    console.log('EXPORTED', tag, html.length, file);
    return file;
  }

  async function inspect(file, tag, is3d) {
    const t2 = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('file:///' + file.replace(/\\/g, '/')) , { method: 'PUT' })).json();
    const ws2 = new WebSocket(t2.webSocketDebuggerUrl);
    let id2 = 0; const pend2 = new Map(); const errs2 = [];
    ws2.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pend2.has(m.id)) { pend2.get(m.id)(m); pend2.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errs2.push(JSON.stringify(m.params.exceptionDetails));
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs2.push(m.params.entry.text);
    });
    await new Promise(r => ws2.addEventListener('open', r));
    const send2 = (method, params) => new Promise(res => { const i = ++id2; pend2.set(i, res); ws2.send(JSON.stringify({ id: i, method, params: params || {} })); });
    const eval2 = async (expr) => {
      const r = await send2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error('eval2: ' + JSON.stringify(r.result.exceptionDetails));
      return r.result && r.result.result ? r.result.result.value : null;
    };
    const until2 = async (expr, ms, step) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await eval2(expr).catch(() => false); if (v) return v; await sleep(step || 300); } return false; };
    await send2('Runtime.enable'); await send2('Log.enable');
    await until2('!!(document.getElementById("expSubTabs") && document.querySelectorAll("#expSubTabs button").length)', 20000);
    await sleep(1800);
    const info = await eval2(`(function(){
      var tabs=[].map.call(document.querySelectorAll('#expSubTabs button'),function(b){return b.textContent});
      var steps=document.getElementById('expSteps');
      var ctrls=document.getElementById('expCtrls');
      var ansTitle=document.getElementById('ansTitle');
      var anaTitle=document.getElementById('anaTitle');
      var out={tabs:tabs, tabsDisplay:getComputedStyle(document.getElementById('expSubTabs')).display,
        stepsDisplay:steps?getComputedStyle(steps).display:'', ctrlsDisplay:ctrls?getComputedStyle(ctrls).display:'',
        ansTitle:ansTitle?ansTitle.textContent:'', anaTitle:anaTitle?anaTitle.textContent:'',
        stepButtons:steps?[].map.call(steps.querySelectorAll('button'),function(b){return b.textContent}):[],
        ctrlLabels:ctrls?[].map.call(ctrls.querySelectorAll('label'),function(l){return l.textContent}):[]};
      try{var api=window.GGB3D&&GGB3D.getApi?GGB3D.getApi():null;if(api&&api.byId){out['vis_seg_PA']=api.byId['seg_PA']?api.byId['seg_PA'].vis:null;out['vis_seg_B1M']=api.byId['seg_B1M']?api.byId['seg_B1M'].vis:null;out['vis_plane_BEQF']=api.byId['plane_BEQF']?api.byId['plane_BEQF'].vis:null;}}catch(e){}
      return out;
    })()`);
    console.log('INSPECT', tag, JSON.stringify(info));
    // click sub (1), then check
    if (info.tabs && info.tabs.length > 1) {
      await eval2(`document.querySelectorAll('#expSubTabs button')[1].click();1`);
      await sleep(700);
      console.log('AFTER TAB1', tag, JSON.stringify(await eval2(`(function(){var o={ans:document.getElementById('ansTitle').textContent,ana:document.getElementById('anaTitle').textContent};try{var api=window.GGB3D&&GGB3D.getApi?GGB3D.getApi():null;if(api&&api.byId){o.vis_seg_PA=api.byId['seg_PA'].vis;o.vis_seg_B1M=api.byId['seg_B1M'].vis;}}catch(e){}return o})()`)));
      await eval2(`document.querySelectorAll('#expSubTabs button')[0].click();1`);
      await sleep(700);
      console.log('AFTER ALL', tag, JSON.stringify(await eval2(`(function(){var o={ans:document.getElementById('ansTitle').textContent,ana:document.getElementById('anaTitle').textContent};try{var api=window.GGB3D&&GGB3D.getApi?GGB3D.getApi():null;if(api&&api.byId){o.vis_seg_PA=api.byId['seg_PA'].vis;o.vis_seg_B1M=api.byId['seg_B1M'].vis;}}catch(e){}return o})()`)));
    }
    console.log('ERRORS', tag, JSON.stringify(errs2));
    try { await fetch('http://127.0.0.1:' + PORT + '/json/close/' + t2.id); } catch (e) {}
    ws2.close();
  }

  const f3 = await exportRecord('r1792493937564_708', 'latest_3d');
  await inspect(f3, 'latest_3d', true);
  const f2 = await exportRecord('r1792389250988_386', 'old_2d');
  await inspect(f2, 'old_2d', false);

  try { await fetch('http://127.0.0.1:' + PORT + '/json/close/' + tab.id); } catch (e) {}
  ws.close(); proc.kill(); process.exit(0);
}
main().catch(e => { console.log('FATAL', e.stack || e.message); try { proc.kill(); } catch (x) {} process.exit(1); });
