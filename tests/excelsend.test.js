/* Il caso segnalato: la riga di test funziona, l'invio dalla cattura no. */
const fs=require('fs'), {JSDOM}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const html=fs.readFileSync(D+'index.html','utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'');
function boot(o){
  const st={company:{id:'c1',name:'VID',domain:'vid.it',locale:'it',configured:true},
   settings:{autoSend:true,requireConsent:false,allowOverride:true,brevoApiKey:'k',fallbackOwner:'u1',newsletterListId:2},
   ms:o.ms, users:[{id:'u1',name:'Max',email:'max@bryan.it',role:o.role||'admin',status:'active',verified:true,activated:true}],
   events:[{id:'e1',name:'MECSPE',startDate:'',endDate:'',status:'open',preset:{provenienza:'',country:'',interesse:''},brevoListId:19}],
   picklists:{provenienza:[],interesse:[{id:'p1',value:'Automazione',active:true}]},
   rules:[],syncLog:[],me:{id:'u1',role:o.role||'admin',locale:'it'},
   leads:[{id:'l1',eventId:'e1',ownerId:'u1',createdBy:'u1',first:'Anna',last:'Rossi',company:'ACME',role:'',
     email:'a@acme.it',phone:'',website:'',address:'',provenienza:'Event',country:'Italy',interesse:'Automazione',
     status:'Ready',ts:Date.now(),consentAt:Date.now(),newsletter:false,captureType:'event',brevoListId:19}]};
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://bizca.bryan.it/#/home',pretendToBeVisual:true});
  const w=dom.window; const order=[]; let putDone=0;
  w.localStorage.setItem('bizca-token','t'); w.localStorage.setItem('bizca-lang','it');
  w.fetch=async(u,opt)=>{const p=String(u); const m=(opt&&opt.method)||'GET';
    if(m==='PUT'&&/\/leads\//.test(p)){ order.push('PUT:start'); await new Promise(r=>setTimeout(r,80)); putDone++; order.push('PUT:end'); return {ok:true,status:200,json:async()=>({ok:true})}; }
    if(/ms\/append/.test(p)){ order.push('APPEND(puts finiti='+putDone+')'); return {ok:true,status:200,json:async()=>({ok:true,file:'Leads.xlsx'})}; }
    if(/send-brevo/.test(p)) return {ok:true,status:200,json:async()=>({ok:true,action:'created'})};
    if(/\/state/.test(p)) return {ok:true,status:200,json:async()=>st};
    return {ok:true,status:200,json:async()=>({ok:true,googleClientId:''})};};
  w.eval(fs.readFileSync(D+'i18n.js','utf8'));
  w.eval(fs.readFileSync(D+'data.js','utf8'));
  w.eval(fs.readFileSync(D+'app.js','utf8'));
  return {w,order};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let fail=0; const ck=(c,m)=>{ if(c) console.log('  ok  '+m); else {console.log('  FAIL '+m); fail++;} };
async function send(w){ w.location.hash='#/lead?id=l1'; await wait(150); w.document.getElementById('send').click(); await wait(600); }
(async()=>{
  console.log('\nInvio dalla cattura verso Excel\n');
  // 1. interruttore acceso: la riga parte, e solo dopo che il lead è salvato
  { const {w,order}=boot({ms:{enabled:true,ready:true,fileName:'Leads.xlsx'}}); await wait(200);
    await send(w);
    const ap=order.find(x=>x.startsWith('APPEND'));
    ck(!!ap,'la riga Excel viene richiesta');
    ck(ap && !/finiti=0/.test(ap),'e solo dopo che il salvataggio del lead è arrivato ('+ap+')');
    const l=w.DB.leads[0];
    ck(w.DB.syncLog.some(x=>x.leadId==='l1'&&x.dest==='Excel'&&x.ok),'nel registro c\'è la riga Excel scritta'); }

  // 2. interruttore spento: non più silenzioso
  { const {w,order}=boot({ms:{enabled:false,ready:true,fileName:'Leads.xlsx'}}); await wait(200);
    await send(w);
    ck(!order.some(x=>x.startsWith('APPEND')),'con l\'interruttore spento non scrive');
    const log=w.DB.syncLog.find(x=>x.leadId==='l1'&&x.dest==='Excel');
    ck(log && /switched off/.test(log.msg),'ma lo dice sulla scheda del lead');
    ck(w.DB.leads[0].excelPending===false,'e non lo tratta come un errore da ritentare'); }

  // 3. anche un commerciale scrive su Excel (il server gli manda "ready")
  { const {w,order}=boot({role:'seller',ms:{enabled:true,ready:true,fileName:'Leads.xlsx'}}); await wait(200);
    await send(w);
    ck(order.some(x=>x.startsWith('APPEND')),'anche da commerciale la riga parte'); }

  // 4. nessun file collegato: nessun rumore
  { const {w,order}=boot({ms:{enabled:false,ready:false}}); await wait(200);
    await send(w);
    ck(!order.some(x=>x.startsWith('APPEND')),'senza file collegato non tenta nulla');
    ck(!w.DB.syncLog.some(x=>x.dest==='Excel'),'e non sporca il registro'); }

  // 5. avviso in Admin quando il file è pronto ma l'invio è spento
  { const {w}=boot({ms:{enabled:false,ready:true,fileName:'Leads.xlsx',tenantId:'t',platformApp:false,mode:'own',hasOwnSecret:true,clientId:'c',fileUrl:'u',tableName:'Lead'}}); await wait(200);
    w.location.hash='#/admin/dest'; await wait(150);
    ck(/invio a Excel è spento/.test(w.document.body.textContent||''),'Admin avvisa che l\'invio a Excel è spento'); }

  console.log(fail?('\n'+fail+' FALLITI\n'):'\ntutto verde\n'); process.exit(fail?1:0);
})().catch(e=>{console.log('CRASH',e.stack);process.exit(1)});
