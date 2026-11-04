/* Il percorso completo: dal lead nell'app alla richiesta che parte verso Brevo. */
const fs=require('fs'), {JSDOM}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const html=fs.readFileSync(D+'index.html','utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'');

function boot(opts={}){
  const st={company:{id:'c1',name:'VID',domain:'vid.it',locale:'it',configured:true},
   settings:{autoSend:true,requireConsent:false,allowOverride:true,brevoApiKey:'xkeysib-x',
             fallbackOwner:'u1',newsletterListId:opts.newsList===undefined?2:opts.newsList},
   ms:{enabled:false},
   users:[{id:'u1',name:'Max',email:'max@bryan.it',role:'admin',status:'active',verified:true,activated:true}],
   events:[{id:'e1',name:'MECSPE',startDate:'2026-03-04',endDate:'2026-03-06',status:'open',
            preset:{provenienza:'',country:'',interesse:''},brevoListId:19}],
   picklists:{provenienza:[],interesse:[{id:'p1',value:'Automazione',active:true}]},
   rules:[],syncLog:[],me:{id:'u1',role:'admin',locale:'it'},
   leads:[{id:'lm',eventId:null,ownerId:'u1',createdBy:'u1',first:'Jon',last:'Tan',company:'Tan',role:'CTO',
           email:'jon@tan.sg',phone:'',website:'',address:'',provenienza:'Personal meeting',country:'Italy',
           interesse:'Automazione',status:'To finalize',ts:Date.now(),consentAt:Date.now(),
           newsletter:false,captureType:'meeting',brevoListId:null},
          {id:'le',eventId:'e1',ownerId:'u1',createdBy:'u1',first:'Anna',last:'Rossi',company:'ACME',role:'Buyer',
           email:'anna@acme.it',phone:'',website:'',address:'',provenienza:'Event',country:'Italy',
           interesse:'Automazione',status:'To finalize',ts:Date.now()-1e3,consentAt:Date.now(),
           newsletter:false,captureType:'event',brevoListId:19}]};
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://bizca.bryan.it/#/home',pretendToBeVisual:true});
  const w=dom.window; const sent=[];
  w.localStorage.setItem('bizca-token','t'); w.localStorage.setItem('bizca-lang','it');
  w.fetch=async(u,o)=>{const p=String(u);
    if(/send-brevo/.test(p)){ sent.push(JSON.parse(o.body)); return {ok:true,status:200,json:async()=>({ok:true,action:'created'})}; }
    if(/\/state/.test(p)) return {ok:true,status:200,json:async()=>st};
    if(/brevo-lists/.test(p)) return {ok:true,status:200,json:async()=>({lists:[{id:19,name:'MECSPE'},{id:2,name:'contacts'}]})};
    return {ok:true,status:200,json:async()=>({googleClientId:'',ok:true})};};
  w.eval(fs.readFileSync(D+'i18n.js','utf8'));
  w.eval(fs.readFileSync(D+'data.js','utf8'));
  w.eval(fs.readFileSync(D+'app.js','utf8'));
  return {w,sent};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let fail=0; const ck=(c,m)=>{ if(c) console.log('  ok  '+m); else {console.log('  FAIL '+m); fail++;} };

async function send(w,id){ w.location.hash='#/lead?id='+id; await wait(150);
  w.document.getElementById('send').click(); await wait(250); }

(async()=>{
  console.log('\nNewsletter e destinazioni\n');

  // meeting personale con la spunta
  {
    const {w,sent}=boot(); await wait(200);
    w.location.hash='#/lead?id=lm'; await wait(150);
    const nk=w.document.getElementById('newsOk');
    ck(!!nk,'la spunta newsletter è presente su un meeting');
    nk.checked=true; nk.dispatchEvent(new w.Event('change')); await wait(120);
    w.document.getElementById('send').click(); await wait(300);
    ck(sent.length===1,'la richiesta è partita');
    const b=sent[0];
    ck(b.lead.newsletter===true,'la spunta viaggia nella richiesta');
    ck(b.newsletterListId===2,'la lista newsletter configurata viaggia nella richiesta');
    ck(b.listId===undefined,'per un meeting non viene indicata una lista di evento');
  }

  // meeting senza spunta
  {
    const {w,sent}=boot(); await wait(200);
    await send(w,'lm');
    ck(sent[0].lead.newsletter===false,'senza spunta la richiesta lo dichiara');
  }

  // evento con la spunta
  {
    const {w,sent}=boot(); await wait(200);
    w.location.hash='#/lead?id=le'; await wait(150);
    const nk=w.document.getElementById('newsOk'); nk.checked=true; nk.dispatchEvent(new w.Event('change')); await wait(120);
    w.document.getElementById('send').click(); await wait(300);
    ck(sent[0].listId===19,'per un evento viaggia la lista dell\'evento');
    ck(sent[0].newsletterListId===2 && sent[0].lead.newsletter===true,'e anche la newsletter');
  }

  // lista newsletter non configurata
  {
    const {w,sent}=boot({newsList:null}); await wait(200);
    w.location.hash='#/lead?id=lm'; await wait(150);
    const nk=w.document.getElementById('newsOk'); nk.checked=true; nk.dispatchEvent(new w.Event('change')); await wait(120);
    w.document.getElementById('send').click(); await wait(300);
    ck(sent[0].newsletterListId===undefined,'senza lista configurata non si iscrive nessuno');
  }

  // etichetta del pulsante
  {
    const {w}=boot(); await wait(200);
    w.location.hash='#/lead?id=lm'; await wait(150);
    const label=(w.document.getElementById('send').textContent||'').trim();
    ck(label==='Invia','il pulsante dice solo «Invia», letto: «'+label+'»');
  }

  console.log(fail?('\n'+fail+' FALLITI\n'):'\ntutto verde\n');
  process.exit(fail?1:0);
})().catch(e=>{console.log('CRASH',e.stack);process.exit(1)});
