const fs=require('fs'), {JSDOM,VirtualConsole}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const html=fs.readFileSync(D+'index.html','utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'');
const state={company:{id:'c1',name:'VID',domain:'vid.it',locale:'it',configured:true},
 settings:{autoSend:true,requireConsent:false,allowOverride:true,brevoApiKey:'',fallbackOwner:'u2'},
 ms:{enabled:false},users:[{id:'u2',name:'Laura',email:'laura@vid.it',role:'seller',status:'active',verified:true,activated:true}],
 events:[],picklists:{provenienza:[],interesse:[]},rules:[],leads:[],syncLog:[],me:{id:'u2',role:'seller',locale:'it'}};
function boot(hash,opts={}){
  // jsdom refuses real navigation; it reports the attempt on the virtual console.
  let navigations=0;
  const vc=new VirtualConsole();
  vc.on('jsdomError',e=>{ if(/Not implemented: navigation/.test(e.message||'')) navigations++; });
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://bizca.bryan.it/'+hash,pretendToBeVisual:true,virtualConsole:vc});
  const w=dom.window; const calls=[];
  const redirected=()=>navigations>0;
  w.localStorage.setItem('bizca-lang','it');
  w.fetch=async(u,o)=>{const p=String(u); calls.push({url:p,body:o&&o.body?JSON.parse(o.body):null});
    if(/microsoft\/start/.test(p)){
      if(opts.startFails) return {ok:false,status:400,json:async()=>({error:'Microsoft sign-in is not set up for your company yet'})};
      return {ok:true,status:200,json:async()=>({ok:true,url:'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?x=1'})};}
    if(/microsoft\/exchange/.test(p)){
      if(opts.exchangeFails) return {ok:false,status:400,json:async()=>({error:'That sign-in link has already been used or has expired'})};
      return {ok:true,status:200,json:async()=>({ok:true,token:'mstok',user:{id:'u2',email:'laura@vid.it'}})};}
    if(/\/state/.test(p)) return {ok:true,status:200,json:async()=>state};
    return {ok:true,status:200,json:async()=>({googleClientId:'',ok:true})};};
  w.eval(fs.readFileSync(D+'i18n.js','utf8'));
  w.eval(fs.readFileSync(D+'data.js','utf8'));
  w.eval(fs.readFileSync(D+'app.js','utf8'));
  return {w,calls,red:redirected};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let fail=0; const ck=(c,m)=>{ if(c) console.log('  ok  '+m); else {console.log('  FAIL '+m); fail++;} };
(async()=>{
  console.log('\nPulsante Microsoft\n');
  { const {w,calls}=boot('#/login'); await wait(150);
    w.document.getElementById('sso').click(); await wait(100);
    ck(!calls.some(c=>/microsoft\/start/.test(c.url)),'senza email non chiama il server');
    ck(/Scrivi prima la tua email/.test(w.document.body.textContent||''),'chiede di scrivere prima l\'email'); }
  { const {w,calls,red}=boot('#/login'); await wait(150);
    w.document.getElementById('email').value='laura@vid.it';
    w.document.getElementById('sso').click(); await wait(150);
    const st=calls.find(c=>/microsoft\/start/.test(c.url));
    ck(!!st,'chiama /auth/microsoft/start');
    ck(st&&st.body.email==='laura@vid.it','passa l\'email digitata');
    ck(red(),'lascia l\'app per andare su Microsoft'); }
  { const {w}=boot('#/login',{startFails:true}); await wait(150);
    w.document.getElementById('email').value='laura@vid.it';
    w.document.getElementById('sso').click(); await wait(150);
    ck(/not set up/.test(w.document.body.textContent||''),'mostra l\'errore del server');
    ck(w.document.getElementById('sso').disabled===false,'il pulsante torna utilizzabile'); }
  { const {w,calls}=boot('#/login?ms=abc123'); await wait(250);
    const ex=calls.find(c=>/microsoft\/exchange/.test(c.url));
    ck(!!ex,'al ritorno scambia il codice');
    ck(ex&&ex.body.code==='abc123','passa il codice ricevuto');
    ck(w.localStorage.getItem('bizca-token')==='mstok','salva la sessione');
    ck(/#\/home/.test(w.location.hash),'entra nella home, ricevuto: '+w.location.hash); }
  { const {w}=boot('#/login?mserror=Account%20disabilitato'); await wait(200);
    ck(/Account disabilitato/.test(w.document.body.textContent||''),'mostra l\'errore tornato da Microsoft');
    ck(/#\/login/.test(w.location.hash),'resta sulla schermata di accesso'); }
  { const {w}=boot('#/login?ms=scaduto',{exchangeFails:true}); await wait(250);
    ck(!w.localStorage.getItem('bizca-token'),'codice scaduto: nessuna sessione salvata');
    ck(/#\/login/.test(w.location.hash),'resta sull\'accesso'); }
  console.log(fail?('\n'+fail+' FALLITI\n'):'\ntutto verde\n');
  process.exit(fail?1:0);
})().catch(e=>{console.log('CRASH',e.stack);process.exit(1)});
