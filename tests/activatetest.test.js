const fs=require('fs'), {JSDOM}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const html=fs.readFileSync(D+'index.html','utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'');
const state={company:{id:'c1',name:'VID',domain:'vid.it',locale:'it',configured:true},
 settings:{autoSend:true,requireConsent:false,allowOverride:true,brevoApiKey:'',fallbackOwner:'u2'},
 ms:{enabled:false},users:[{id:'u2',name:'Laura Bianchi',email:'laura@vid.it',role:'seller',status:'active',verified:true,activated:true}],
 events:[],picklists:{provenienza:[],interesse:[]},rules:[],leads:[],syncLog:[],me:{id:'u2',role:'seller',locale:'it'}};

function boot(hash, opts={}){
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://bizca.bryan.it/'+hash,pretendToBeVisual:true});
  const w=dom.window; const calls=[];
  w.localStorage.setItem('bizca-lang','it');
  w.fetch=async(u,o)=>{const p=String(u); calls.push({url:p,body:o&&o.body?JSON.parse(o.body):null});
    if(/microsoft\/start/.test(p)){
      if(opts.msOff) return {ok:false,status:400,json:async()=>({error:'Microsoft sign-in is not set up for your company yet'})};
      return {ok:true,status:200,json:async()=>({ok:true,url:'https://login.microsoftonline.com/t/oauth2/v2.0/authorize'})};
    }
    if(/\/auth\/set-password/.test(p)){
      if(opts.alreadyActive) return {ok:false,status:409,json:async()=>({error:'This invitation has already been used — sign in with your password',alreadyActive:true})};
      return {ok:true,status:200,json:async()=>({ok:true,token:'newtok',user:{id:'u2',name:'Laura',email:'laura@vid.it',role:'seller'}})};
    }
    if(/\/state/.test(p)) return {ok:true,status:200,json:async()=>state};
    return {ok:true,status:200,json:async()=>({googleClientId:'',ok:true})};};
  w.eval(fs.readFileSync(D+'i18n.js','utf8'));
  w.eval(fs.readFileSync(D+'data.js','utf8'));
  w.eval(fs.readFileSync(D+'app.js','utf8'));
  return {w,calls};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let fail=0;
const ck=(c,msg)=>{ if(c) console.log('  ok  '+msg); else {console.log('  FAIL '+msg); fail++;} };

(async()=>{
  console.log('\nSchermata di attivazione\n');

  // 1. the invitation link opens the activation screen on a brand-new device
  {
    const {w}=boot('#/activate?email=laura%40vid.it&token=abc123');
    await wait(150);
    const txt=w.document.body.textContent||'';
    ck(/Attiva il tuo account|Benvenuto in Bizca/.test(txt),'il link apre la schermata di attivazione');
    ck(txt.indexOf('laura@vid.it')>=0,'mostra l\'indirizzo invitato');
    ck(!!w.document.getElementById('acPwd'),'c\'è il campo password');
    ck(!/Registra la tua azienda/.test(txt),'non propone di registrare una seconda azienda');
  }

  // 1b. accesso con account aziendale direttamente dall'invito
  {
    const {w,calls}=boot('#/activate?email=laura%40vid.it&token=abc123');
    await wait(150);
    ck(!!w.document.getElementById('acMs'),'c\'è il pulsante Microsoft nella schermata d\'invito');
    ck(!!w.document.getElementById('gBtn'),'c\'è lo spazio per il pulsante Google');
    ck(/oppure crea una password/.test(w.document.body.textContent||''),'la password è presentata come alternativa');
    w.document.getElementById('acMs').click(); await wait(150);
    const st=calls.find(c=>/microsoft\/start/.test(c.url));
    ck(st && st.body.email==='laura@vid.it','Microsoft parte con l\'indirizzo dell\'invito, senza riscriverlo');
  }
  {
    const {w}=boot('#/activate?email=laura%40vid.it&token=abc123',{msOff:true});
    await wait(150);
    w.document.getElementById('acMs').click(); await wait(200);
    ck(/not set up/.test(w.document.body.textContent||''),'se Microsoft non è configurato lo dice');
    ck(w.document.getElementById('acMs').disabled===false,'e il pulsante resta usabile');
    ck(!!w.document.getElementById('acPwd'),'la password resta disponibile');
  }

  // 2. activating signs the person in and lands on the home
  {
    const {w,calls}=boot('#/activate?email=laura%40vid.it&token=abc123');
    await wait(150);
    w.document.getElementById('acName').value='Laura Bianchi';
    w.document.getElementById('acPwd').value='PasswordSicura1';
    w.document.getElementById('acGo').click();
    await wait(200);
    const sp=calls.find(c=>/set-password/.test(c.url));
    ck(!!sp,'chiama /auth/set-password');
    ck(sp&&sp.body.token==='abc123'&&sp.body.email==='laura@vid.it','passa email e token del link');
    ck(sp&&sp.body.name==='Laura Bianchi','passa anche il nome');
    ck(w.localStorage.getItem('bizca-token')==='newtok','salva la sessione restituita');
    ck(/#\/home/.test(w.location.hash),'entra direttamente nella home, ricevuto: '+w.location.hash);
  }

  // 3. a short password never reaches the server
  {
    const {w,calls}=boot('#/activate?email=laura%40vid.it&token=abc123');
    await wait(150);
    w.document.getElementById('acPwd').value='corta';
    w.document.getElementById('acGo').click();
    await wait(120);
    ck(!calls.some(c=>/set-password/.test(c.url)),'password corta bloccata prima della chiamata');
  }

  // 4. a link already used sends the person to the sign-in screen
  {
    const {w}=boot('#/activate?email=laura%40vid.it&token=abc123',{alreadyActive:true});
    await wait(150);
    w.document.getElementById('acPwd').value='PasswordSicura1';
    w.document.getElementById('acGo').click();
    await wait(200);
    ck(/#\/login/.test(w.location.hash),'link già usato → schermata di accesso, ricevuto: '+w.location.hash);
  }

  // 5. an incomplete link does not leave a dead end
  {
    const {w}=boot('#/activate');
    await wait(150);
    ck(/#\/login/.test(w.location.hash),'link incompleto → accesso');
  }

  console.log(fail?('\n'+fail+' FALLITI\n'):'\ntutto verde\n');
  process.exit(fail?1:0);
})().catch(e=>{console.log('CRASH',e.stack);process.exit(1)});
