// 2D 独立 harness：加载 jsxgraph + geometry + shim 后直接跑 renderCode 并截图
// 用法：node tools\shot_2d_harness.js           （复用 .tmp/space2d_code.js）
//       node tools\shot_2d_harness.js --solve   （重新调模型生成一份）
// 依赖顺序很关键：jsxgraph.js → geometry.js → shim.js，容器 id 必须是 ggb-canvas
const fs=require('fs'),os=require('os'),path=require('path'),{spawn,execSync}=require('child_process');
const ROOT=path.join(__dirname,'..'),TMP=path.join(ROOT,'.tmp'),SERVE=path.join(ROOT,'solver','serve.js'),PORT=8144,BASE='http://127.0.0.1:'+PORT;
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const kill=p=>{if(p&&p.pid){try{execSync('taskkill /pid '+p.pid+' /t /f',{stdio:'ignore'});}catch(e){}}};

async function makeCode(){
  const HOME=path.join(os.tmpdir(),'hegy-2d-'+process.pid);
  fs.mkdirSync(HOME,{recursive:true});
  const CFG=JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE||os.homedir(),'.hegy','settings.json'),'utf8')).model;
  const srv=spawn(process.execPath,[SERVE,String(PORT)],{cwd:ROOT,env:{...process.env,USERPROFILE:HOME,HOME},stdio:'ignore'});
  for(let i=0;i<60;i++){try{if((await fetch(BASE+'/api/status')).ok)break;}catch(e){}await sleep(200);}
  const Q='正方体 $ABCD-A_1B_1C_1D_1$ 的棱长为 2，求异面直线 $A_1B$ 与 $B_1C$ 所成角的大小。';
  const r=await fetch(BASE+'/api/solve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:Q,grade:'高二',dim:'2d',config:CFG,stream:false})});
  const j=await r.json(); let t=null;
  while(true){await sleep(400);t=await(await fetch(BASE+'/api/task/'+j.taskId)).json();if(t.status!=='running')break;}
  kill(srv);
  return (t.result||{}).renderCode||'';
}

async function renderWith(code){
  const html=path.join(TMP,'shot_space2d.html');
  fs.writeFileSync(html,`<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="../solver/vendor/jsxgraph.css">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#fff}#ggb-canvas{width:100vw;height:100vh}</style></head>
<body><div id="ggb-canvas"></div>
<script src="../solver/vendor/jsxgraph.js"></script>
<script src="../solver/geometry.js"></script>
<script src="../solver/shim.js"></script>
<script>
window.__err=null;
try { (new Function(${JSON.stringify(code)}))(); } catch (e) { window.__err=String(e); }
window.__axes=(window.board&&board.objectsList?board.objectsList:[]).filter(function(o){return o&&/^[xyz]$/.test(o.name||'');}).map(function(o){return o.name;});
</script></body></html>`);
  const prof=path.join(TMP,'edge-prof'), cdp=9700+Math.floor(Math.random()*100);
  const p=spawn(EDGE,['--headless=new','--no-sandbox','--remote-debugging-port='+cdp,'--user-data-dir='+prof,'--window-size=900,640',require('url').pathToFileURL(html).href],{stdio:'ignore'});
  let ws=null;
  for(let i=0;i<60;i++){try{const l=await (await fetch('http://127.0.0.1:'+cdp+'/json')).json();const pg=l.find(x=>x.type==='page');if(pg){ws=pg.webSocketDebuggerUrl;break;}}catch(e){}await sleep(300);}
  if(!ws){kill(p);throw new Error('no cdp');}
  const sock=new WebSocket(ws); await new Promise(r=>sock.onopen=r);
  let n=0; const pend=new Map();
  sock.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
  const send=(m,pa={})=>new Promise(res=>{const i=++n;pend.set(i,res);sock.send(JSON.stringify({id:i,method:m,params:pa}));});
  await sleep(2000);
  const info=await send('Runtime.evaluate',{expression:"JSON.stringify({err:window.__err,axes:window.__axes,n:(window.board?board.objectsList.length:0)})",returnByValue:true});
  console.log('渲染信息:',info.result&&info.result.result&&info.result.result.value);
  const s=await send('Page.captureScreenshot',{format:'png'});
  if(s.result&&s.result.data) fs.writeFileSync(path.join(TMP,'shot_space2d.png'),Buffer.from(s.result.data,'base64'));
  console.log('saved .tmp/shot_space2d.png');
  sock.close();kill(p);
}

(async()=>{
  let code='';
  const cached=path.join(TMP,'space2d_code.js');
  if(!process.argv.includes('--solve') && fs.existsSync(cached)) code=fs.readFileSync(cached,'utf8');
  if(!code) { code=await makeCode(); fs.writeFileSync(cached,code); }
  console.log('codeLen',code.length);
  await renderWith(code);
  fs.rmSync(path.join(TMP,'edge-prof'),{recursive:true,force:true});
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
