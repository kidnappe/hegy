const { spawn } = require('child_process');
const path = require('path'); const os = require('os');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9431;
const FILE = path.join(os.tmpdir(), 'hegy-export-tabs', 'latest_3d.html');
const prof = path.join(os.tmpdir(), 'edge-diag-export-tabs2');
const proc = spawn(EDGE, ['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir='+prof,'--no-first-run','--no-default-browser-check','--disable-gpu','about:blank'], {stdio:'ignore'});
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async()=>{
  let ver=null; for(let i=0;i<60;i++){try{ver=await(await fetch('http://127.0.0.1:'+PORT+'/json/version')).json();break}catch(e){await sleep(250)}}
  const t=await(await fetch('http://127.0.0.1:'+PORT+'/json/new?'+encodeURIComponent('file:///'+FILE.replace(/\\/g,'/')),{method:'PUT'})).json();
  const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map();
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}});
  await new Promise(r=>ws.addEventListener('open',r));
  const send=(method,params)=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params:params||{}}))});
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}); if(r.result&&r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result&&r.result.result?r.result.result.value:null};
  const until=async(expr,ms)=>{const t0=Date.now();while(Date.now()-t0<ms){const v=await ev(expr).catch(()=>false);if(v)return v;await sleep(300)}return false};
  await send('Runtime.enable');
  await until('!!(window.GGB3D&&GGB3D.getApi&&GGB3D.getApi())',20000); await sleep(1800);
  console.log('buttons', await ev(`[].map.call(document.querySelectorAll('.g3d-steps button'),function(b){return b.textContent})`));
  console.log('title0', await ev(`document.querySelector('.g3d-steps').innerText.slice(0,40)`));
  await ev(`document.querySelectorAll('#expSubTabs button')[1].click();1`); await sleep(700);
  console.log('after sub1', await ev(`(function(){var a=GGB3D.getApi();return {pa:a.byId.seg_PA.vis,b1m:a.byId.seg_B1M.vis,beqf:a.byId.plane_BEQF.vis,title:document.querySelector('.g3d-steps').innerText.slice(0,40)}})()`));
  // click next twice
  await ev(`(function(){var bs=[].slice.call(document.querySelectorAll('.g3d-steps button'));var b=bs.filter(function(x){return x.textContent.indexOf('▶')>=0})[0];if(b){b.click();b.click();}return 1})()`);
  await sleep(800);
  console.log('after steps', await ev(`(function(){var a=GGB3D.getApi();return {pa:a.byId.seg_PA.vis,b1m:a.byId.seg_B1M.vis,beqf:a.byId.plane_BEQF.vis,title:document.querySelector('.g3d-steps').innerText.slice(0,60)}})()`));
  // click 全部 in internal panel
  await ev(`(function(){var bs=[].slice.call(document.querySelectorAll('.g3d-steps button'));var b=bs.filter(function(x){return x.textContent==='全部'})[0];if(b)b.click();return 1})()`);
  await sleep(600);
  console.log('after all', await ev(`(function(){var a=GGB3D.getApi();return {pa:a.byId.seg_PA.vis,b1m:a.byId.seg_B1M.vis,beqf:a.byId.plane_BEQF.vis,title:document.querySelector('.g3d-steps').innerText.slice(0,40)}})()`));
  proc.kill(); process.exit(0);
})().catch(e=>{console.log('FATAL',e.message);proc.kill();process.exit(1)});
