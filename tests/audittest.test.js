/* Correzioni del frontend emerse dall'audit. */
const fs=require('fs'), {JSDOM,VirtualConsole}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const html=fs.readFileSync(D+'index.html','utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'');
function mkState(o={}){ return {company:{id:'c1',name:'VID',domain:'vid.it',locale:'it',configured:true},
  settings:{autoSend:true,requireConsent:false,allowOverride:true,brevoApiKey:'k',fallbackOwner:'u1',newsletterListId:2},
  ms:{enabled:true,ready:true,fileName:'Leads.xlsx'},
  users:[{id:'u1',name:'Max',email:'max@bryan.it',role:o.role||'admin',status:'active',verified:true,activated:true},
         {id:'u2',name:'Laura',email:'laura@vid.it',role:'seller',status:'active',verified:true,activated:true}],
  events:[{id:'e1',name:'MECSPE',startDate:'',endDate:'',status:'open',preset:{provenienza:'',country:'Italy',interesse:'Automazione'},brevoListId:19}],
  picklists:{provenienza:[],interesse:[{id:'p1',value:'Automazione',active:true},{id:'p2',value:'Ricambi',active:true}]},
  rules:[],syncLog:[],me:{id:'u1',role:o.role||'admin',locale:'it'},
  leads:o.leads||[{id:'l1',eventId:'e1',ownerId:'u1',createdBy:'u1',first:'Anna',last:'Rossi',company:'ACME',role:'',
    email:'a@acme.it',phone:'',website:'',address:'',provenienza:'Event',country:'Germany',interesse:'Ricambi',
    status:'Ready',ts:Date.now(),consentAt:Date.now(),newsletter:false,captureType:'event',brevoListId:19}]}; }
function boot(o={}){
  const st=o.state||mkState(o);
  const vc=new VirtualConsole();
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://bizca.bryan.it/'+(o.hash||'#/home'),pretendToBeVisual:true,virtualConsole:vc});
  const w=dom.window; const calls=[];
  w.localStorage.setItem('bizca-token','t'); w.localStorage.setItem('bizca-lang','it');
  if(o.cache) w.localStorage.setItem('bizca-state-v1',JSON.stringify(o.cache));
  if(o.offline){ Object.defineProperty(w.navigator,'onLine',{get:()=>false,configurable:true}); }
  w.confirm=()=>o.confirm!==undefined?o.confirm:true;
  w.fetch=async(u,opt)=>{const p=String(u); const m=(opt&&opt.method)||'GET'; calls.push(m+' '+p);
    if(o.offline) throw new TypeError('Failed to fetch');
    if(m==='PUT'&&/\/leads\//.test(p)){ if(o.putDelay) await new Promise(r=>setTimeout(r,o.putDelay));
      if(o.putFails) return {ok:false,status:500,json:async()=>({error:'db down'})};
      return {ok:true,status:200,json:async()=>({ok:true})}; }
    if(/ms\/append/.test(p)) return {ok:true,status:200,json:async()=>({ok:true,file:'Leads.xlsx'})};
    if(/send-brevo/.test(p)){ if(o.brevoDelay) await new Promise(r=>setTimeout(r,o.brevoDelay));
      return {ok:true,status:200,json:async()=>(o.brevoNote?{ok:true,action:'created',note:o.brevoNote}:{ok:true,action:'created'})}; }
    if(/\/state/.test(p)) return {ok:true,status:200,json:async()=>st};
    return {ok:true,status:200,json:async()=>({ok:true,googleClientId:''})};};
  w.eval(fs.readFileSync(D+'i18n.js','utf8'));
  w.eval(fs.readFileSync(D+'data.js','utf8'));
  w.eval(fs.readFileSync(D+'app.js','utf8'));
  return {w,calls,st};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let fail=0; const ck=(c,m)=>{ if(c) console.log('  ok  '+m); else {console.log('  FAIL '+m); fail++;} };

(async()=>{
  console.log('\nCorrezioni frontend dall\'audit\n');

  // 1. doppio tocco su Invia: un solo invio
  { const {w,calls}=boot({brevoDelay:150}); await wait(200);
    w.location.hash='#/lead?id=l1'; await wait(150);
    const b=w.document.getElementById('send'); b.click(); b.disabled=false; b.click();
    await wait(700);
    ck(calls.filter(c=>/send-brevo/.test(c)).length===1,'doppio tocco su Invia → un solo invio a Brevo, visti: '+calls.filter(c=>/send-brevo/.test(c)).length); }

  // 2. salvataggio fallito: niente riga Excel stantia, lead resta da salvare
  { const {w,calls}=boot({putFails:true}); await wait(200);
    w.location.hash='#/lead?id=l1'; await wait(150);
    w.document.getElementById('send').click(); await wait(500);
    ck(!calls.some(c=>/ms\/append/.test(c)),'se il salvataggio fallisce non si chiede la riga Excel');
    const l=w.DB.leads.find(x=>x.id==='l1');
    ck(l._dirty===true,'il lead resta segnato come da salvare');
    ck(l.excelPending===true,'e la riga Excel resta in sospeso'); }

  // 3. un aggiornamento dal server non cancella un lead acquisito solo sul telefono
  { const localLead={id:'lx1',eventId:'e1',ownerId:'u1',createdBy:'u1',first:'Solo',last:'Locale',company:'X',role:'',email:'x@x.it',
      phone:'',website:'',address:'',provenienza:'Event',country:'Italy',interesse:'Ricambi',status:'Ready',ts:Date.now(),
      captureType:'event',brevoListId:19,queuedOffline:true,_dirty:true};
    const {w}=boot({cache:{company:mkState().company,leads:[localLead],users:mkState().users,session:{userId:'u1'}},putFails:true}); await wait(350);
    ck(w.DB.leads.some(l=>l.id==='lx1'),'il lead preso offline sopravvive al caricamento dal server'); }

  // 4. apertura senza rete con sessione salvata: si va alla home, non al login
  { const st=mkState();
    const {w}=boot({offline:true,hash:'',cache:{company:st.company,leads:st.leads,users:st.users,session:{userId:'u1'}}}); await wait(300);
    ck(/#\/home/.test(w.location.hash),'offline con sessione salvata → home, ricevuto: '+(w.location.hash||'(vuoto)')); }

  // 5. un commerciale non entra nelle schermate admin
  { const {w}=boot({role:'seller'}); await wait(200);
    w.location.hash='#/admin/dest'; await wait(120);
    ck(/#\/home/.test(w.location.hash),'un commerciale che apre #/admin/dest torna alla home'); }

  // 6. immagini non valide non entrano nell'HTML
  { const st=mkState(); st.leads[0].image='x" onerror="window.__pwned=1'; st.leads[0].consentSignature='javascript:alert(1)';
    const {w}=boot({state:st}); await wait(200);
    w.location.hash='#/lead?id=l1'; await wait(150);
    const bad=w.document.body.innerHTML.indexOf('onerror="window.__pwned')>=0;
    ck(!bad,'un\'immagine manomessa non finisce nell\'HTML');
    ck(!w.document.querySelector('img[src^="javascript"]'),'né come src javascript:'); }

  // 7. preset: non cancella il paese letto dall'AI, non tocca i meeting
  { const st=mkState({leads:[
      {id:'a',eventId:'e1',ownerId:'u1',createdBy:'u1',first:'A',last:'',company:'',role:'',email:'a@a.it',phone:'',website:'',address:'',
       provenienza:'Event',country:'Germany',interesse:'',status:'To finalize',ts:Date.now(),captureType:'event',brevoListId:19},
      {id:'m',eventId:null,ownerId:'u1',createdBy:'u1',first:'M',last:'',company:'',role:'',email:'m@m.it',phone:'',website:'',address:'',
       provenienza:'Personal meeting',country:'',interesse:'',status:'To finalize',ts:Date.now()-1,captureType:'meeting',brevoListId:null}]});
    const {w}=boot({state:st}); await wait(200);
    w.location.hash='#/batch'; await wait(150);
    w.document.getElementById('applyPreset').click(); await wait(150);
    const a=w.DB.leads.find(x=>x.id==='a'), m=w.DB.leads.find(x=>x.id==='m');
    ck(a.country==='Germany','il preset non sovrascrive il paese già letto');
    ck(a.interesse==='Automazione','ma completa il segmento vuoto');
    ck(m.country===''&&m.interesse==='','i meeting non ricevono il preset dell\'evento'); }

  // 8. Brevo che scarta gli attributi lo dice
  { const {w}=boot({brevoNote:'custom attributes skipped'}); await wait(200);
    w.location.hash='#/lead?id=l1'; await wait(150);
    w.document.getElementById('send').click(); await wait(500);
    const log=w.DB.syncLog.find(x=>x.dest==='Brevo');
    ck(log && /custom attributes skipped/.test(log.msg),'la nota di Brevo compare nel registro'); }

  // 9. le modifiche ai campi arrivano al server senza premere nulla
  { const {w,calls}=boot(); await wait(200);
    w.location.hash='#/lead?id=l1'; await wait(150);
    const f=w.document.querySelector('[data-f="company"]'); f.value='ACME Srl'; f.dispatchEvent(new w.Event('input'));
    await wait(1100);
    ck(calls.some(c=>/^PUT .*\/leads\/l1/.test(c)),'la modifica al campo viene salvata sul server da sola'); }

  // 10. id nuovi non prevedibili
  { // la funzione vive dentro la closure: la estraggo dal sorgente e la eseguo a parte
    const src=fs.readFileSync(D+'app.js','utf8');
    const fn=src.slice(src.indexOf('function newLeadId()'), src.indexOf('\n  }', src.indexOf('function newLeadId()'))+4);
    const window={crypto:require('crypto').webcrypto};
    const newLeadId=eval('('+fn+')');
    const ids=[]; for(let i=0;i<3;i++) ids.push(newLeadId());
    ck(ids.every(x=>/^l[0-9a-z]+[0-9a-f]{16}$/.test(x)) && new Set(ids).size===3,'id dei lead con parte casuale: '+ids[0]); }

  console.log(fail?('\n'+fail+' FALLITI\n'):'\ntutto verde\n'); process.exit(fail?1:0);
})().catch(e=>{console.log('CRASH',e.stack);process.exit(1)});
