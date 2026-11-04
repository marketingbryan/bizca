/* Admin → Destinazioni: interruttore «Crea in automatico chi entra con Microsoft». */
const fs=require('fs'), {JSDOM}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const html=fs.readFileSync(D+'index.html','utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'');
let fail=0; const ck=(c,m)=>{ if(c) console.log('  ok  '+m); else {console.log('  FAIL '+m); fail++;} };
function boot(ms){
  const st={company:{id:'c1',name:'VID',domain:'vidfirekill.com',extraDomains:['vidfirekill.dk'],locale:'it'},
    settings:{msAutoJoin:false,brevoApiKey:'k'},ms,users:[{id:'u1',name:'Max',email:'max@bryan.it',role:'admin',status:'active'}],
    events:[],picklists:{provenienza:[],interesse:[]},rules:[],leads:[],syncLog:[],me:{id:'u1',role:'admin',locale:'it'}};
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://bizca.bryan.it/#/admin/dest',pretendToBeVisual:true});
  const w=dom.window; const calls=[];
  w.localStorage.setItem('bizca-token','tok'); w.localStorage.setItem('bizca-lang','it');
  w.fetch=async(u,o)=>{ const p=String(u); calls.push({p,m:o&&o.method,b:o&&o.body?JSON.parse(o.body):null});
    if(/\/state/.test(p)) return {ok:true,status:200,json:async()=>st};
    if(/brevo-lists/.test(p)) return {ok:true,status:200,json:async()=>({lists:[]})};
    return {ok:true,status:200,json:async()=>({ok:true})}; };
  w.eval(fs.readFileSync(D+'i18n.js','utf8')); w.eval(fs.readFileSync(D+'data.js','utf8')); w.eval(fs.readFileSync(D+'app.js','utf8'));
  return {w,calls};
}
(async()=>{
  console.log('\nIngresso automatico con Microsoft\n');
  const a=boot({enabled:true,ready:true,tenantId:'t',clientId:'c',hasOwnSecret:true}); await new Promise(r=>setTimeout(r,500));
  const txt=a.w.document.body.textContent;
  ck(/Crea in automatico chi entra con Microsoft/.test(txt),'l\'interruttore c\'è');
  ck(/@vidfirekill\.com, @vidfirekill\.dk/.test(txt),'dice per quali domini vale');
  a.w.document.getElementById('msJoin').click(); await new Promise(r=>setTimeout(r,150));
  const c=a.calls.find(x=>/\/settings/.test(x.p)&&x.m==='PATCH');
  ck(c && c.b.msAutoJoin===true,'accendendolo salva msAutoJoin:true');
  ck(a.w.document.getElementById('msJoin').classList.contains('on'),'e resta acceso');

  const b=boot({enabled:false,ready:false,tenantId:'',clientId:'',hasOwnSecret:false}); await new Promise(r=>setTimeout(r,500));
  b.w.document.getElementById('msJoin').click(); await new Promise(r=>setTimeout(r,150));
  ck(!b.calls.some(x=>/\/settings/.test(x.p)&&x.m==='PATCH'),'senza app Microsoft non si accende');
  if(fail){ console.log('FALLITI '+fail); process.exit(1); }
})();
