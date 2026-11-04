/* «Entra come» dalla console superadmin: l'app scambia il codice, mostra la barra,
   non porta con sé lead non sincronizzati, e all'uscita restituisce l'account di prima. */
const fs=require('fs'), {JSDOM, VirtualConsole}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const html=fs.readFileSync(D+'index.html','utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'');
let fail=0; const ck=(c,m)=>{ if(c) console.log('  ok  '+m); else {console.log('  FAIL '+m); fail++;} };
const b64u=o=>Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const tok=p=>b64u({alg:'HS256'})+'.'+b64u(p)+'.sig';
const OWN=tok({uid:'uMax',cid:'cBryan',exp:Date.now()+1e7});
const IMP=tok({uid:'u2',cid:'c1',imp:'max@bryan.it',exp:Date.now()+1e7});
const state={company:{id:'c1',name:'VID',domain:'vid.it',locale:'it'},settings:{},ms:{enabled:false},
  users:[{id:'u2',name:'Laura Bianchi',email:'laura@vid.it',role:'seller',status:'active'}],events:[],picklists:{provenienza:[],interesse:[]},rules:[],leads:[],syncLog:[],me:{id:'u2',role:'seller',locale:'it'}};
function boot(dirty){
  const vc=new VirtualConsole(); let reloaded=false;
  vc.on('jsdomError',e=>{ if(/navigation|reload/i.test(String(e&&e.message))) reloaded=true; });
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://bizca.bryan.it/#/login?imp='+'c'.repeat(48),pretendToBeVisual:true,virtualConsole:vc});
  const w=dom.window; const calls=[];
  w.localStorage.setItem('bizca-token',OWN); w.localStorage.setItem('bizca-lang','it');
  if(dirty) w.localStorage.setItem('bizca-state-v1',JSON.stringify({company:{id:'cBryan',name:'Bryan',configured:true},users:[{id:'uMax',name:'Max'}],
    leads:[{id:'lx',first:'Non',last:'Salvato',status:'To finalize',_dirty:true,ts:1}],session:{userId:'uMax'}}));
  w.fetch=async(u,o)=>{ const p=String(u); calls.push({p,auth:(o&&o.headers&&o.headers.Authorization)||''});
    if(/\/auth\/impersonate/.test(p)) return {ok:true,status:200,json:async()=>({ok:true,token:IMP})};
    if(/\/state/.test(p)) return {ok:true,status:200,json:async()=>state};
    if(/\/leads\//.test(p)) return {ok:false,status:500,json:async()=>({error:'offline'})};   // il salvataggio del lead locale fallisce
    return {ok:true,status:200,json:async()=>({})}; };
  w.eval(fs.readFileSync(D+'i18n.js','utf8')); w.eval(fs.readFileSync(D+'data.js','utf8')); w.eval(fs.readFileSync(D+'app.js','utf8'));
  return {w,calls,isReloaded:()=>reloaded};
}
(async()=>{
  console.log('\nEntra come (superadmin)\n');
  const a=boot(false); await new Promise(r=>setTimeout(r,700));
  ck(a.w.localStorage.getItem('bizca-token')===IMP,'il codice diventa la sessione dell\'utente');
  ck(a.w.localStorage.getItem('bizca-token-prev')===OWN,'la sessione di prima è messa da parte');
  ck(!/imp=/.test(a.w.location.href),'il codice sparisce dall\'indirizzo');
  const bar=a.w.document.querySelector('.impbar');
  ck(bar && /Laura Bianchi/.test(bar.textContent) && /reale/.test(bar.textContent),'la barra dice come chi stai usando l\'app');
  a.w.document.getElementById('impExit').click(); await new Promise(r=>setTimeout(r,50));
  ck(a.w.localStorage.getItem('bizca-token')===OWN,'«Esci» restituisce l\'account di prima');
  ck(!a.w.localStorage.getItem('bizca-token-prev'),'e pulisce la sessione messa da parte');
  ck(!a.w.localStorage.getItem('bizca-state-v1'),'e la cache dell\'altra azienda');

  const b=boot(true); await new Promise(r=>setTimeout(r,700));
  ck(!b.calls.some(c=>/\/auth\/impersonate/.test(c.p)),'con lead non sincronizzati non cambia utente');
  ck(b.w.localStorage.getItem('bizca-token')===OWN,'e resta sull\'account di prima');
  ck(/non ancora sincronizzati/.test(b.w.document.getElementById('toast').textContent||''),'e spiega perché');
  if(fail){ console.log('FALLITI '+fail); process.exit(1); }
})();
