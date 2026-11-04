/* Selettore lingua solo nelle impostazioni; prima dell'accesso segue il telefono. */
const fs=require('fs'), {JSDOM}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const html=fs.readFileSync(D+'index.html','utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'');
const st={company:{id:'c1',name:'VID',domain:'vid.it',locale:'it',configured:true},
 settings:{autoSend:true,requireConsent:false,allowOverride:true,brevoApiKey:'',fallbackOwner:'u1'},ms:{enabled:false},
 users:[{id:'u1',name:'Max',email:'max@bryan.it',role:'admin',status:'active',verified:true,activated:true}],
 events:[],picklists:{provenienza:[],interesse:[]},rules:[],leads:[],syncLog:[],me:{id:'u1',role:'admin',locale:null}};
function boot(hash,{token=false,browser='it-IT'}={}){
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://bizca.bryan.it/'+hash,pretendToBeVisual:true});
  const w=dom.window;
  Object.defineProperty(w.navigator,'language',{get:()=>browser,configurable:true});
  Object.defineProperty(w.navigator,'languages',{get:()=>[browser],configurable:true});
  if(token) w.localStorage.setItem('bizca-token','t');
  w.fetch=async(u)=>{const p=String(u); if(/\/state/.test(p)) return {ok:true,status:200,json:async()=>st};
    return {ok:true,status:200,json:async()=>({ok:true,googleClientId:''})};};
  w.eval(fs.readFileSync(D+'i18n.js','utf8')); w.eval(fs.readFileSync(D+'data.js','utf8')); w.eval(fs.readFileSync(D+'app.js','utf8'));
  return w;
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let fail=0; const ck=(c,m)=>{ if(c) console.log('  ok  '+m); else {console.log('  FAIL '+m); fail++;} };
(async()=>{
  console.log('\nDove si sceglie la lingua\n');
  for (const h of ['#/welcome','#/setup','#/login','#/activate?email=a%40b.it&token=x']) {
    const w=boot(h); await wait(150);
    ck(!w.document.querySelector('[data-lang]'),'nessun selettore su '+h.split('?')[0]);
  }
  { const w=boot('#/welcome',{browser:'it-IT'}); await wait(150);
    ck(/Benvenuto/.test(w.document.body.textContent),'telefono in italiano → schermate d\'accesso in italiano'); }
  { const w=boot('#/welcome',{browser:'en-US'}); await wait(150);
    ck(/Welcome/.test(w.document.body.textContent),'telefono in inglese → in inglese'); }
  { const w=boot('#/admin',{token:true}); await wait(250);
    ck(!!w.document.querySelector('[data-lang]'),'in Admin il selettore c\'è ancora'); }
  { const w=boot('#/home',{token:true}); await wait(250);
    w.document.getElementById('userMenu').click(); await wait(80);
    ck(!!w.document.querySelector('.modal [data-lang]'),'e anche nel menu account'); }
  console.log(fail?('\n'+fail+' FALLITI\n'):'\ntutto verde\n'); process.exit(fail?1:0);
})().catch(e=>{console.log('CRASH',e.stack);process.exit(1)});
