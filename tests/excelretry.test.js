/* Lato app: una riga Excel fallita resta in sospeso e viene ripresa all'avvio. */
const fs=require('fs'), {JSDOM}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const html=fs.readFileSync(D+'index.html','utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'');
function boot(opts){
  const st={company:{id:'c1',name:'VID',domain:'vid.it',locale:'it',configured:true},
   settings:{autoSend:true,requireConsent:false,allowOverride:true,brevoApiKey:'k',fallbackOwner:'u1',newsletterListId:2},
   ms:{enabled:true,ready:true},
   users:[{id:'u1',name:'Max',email:'max@bryan.it',role:'admin',status:'active',verified:true,activated:true}],
   events:[{id:'e1',name:'MECSPE',startDate:'',endDate:'',status:'open',preset:{provenienza:'',country:'',interesse:''},brevoListId:19}],
   picklists:{provenienza:[],interesse:[{id:'p1',value:'Automazione',active:true}]},
   rules:[],syncLog:[],me:{id:'u1',role:'admin',locale:'it'},
   leads:[{id:'l1',eventId:'e1',ownerId:'u1',createdBy:'u1',first:'Anna',last:'Rossi',company:'ACME',role:'',
           email:'a@acme.it',phone:'',website:'',address:'',provenienza:'Event',country:'Italy',interesse:'Automazione',
           status:'Ready',ts:Date.now(),consentAt:Date.now(),newsletter:false,captureType:'event',brevoListId:19}]};
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://bizca.bryan.it/#/home',pretendToBeVisual:true});
  const w=dom.window; const calls=[];
  w.localStorage.setItem('bizca-token','t'); w.localStorage.setItem('bizca-lang','it');
  if(opts.cache) w.localStorage.setItem('bizca-state-v1', opts.cache);
  w.fetch=async(u,o)=>{const p=String(u); calls.push(p);
    if(/ms\/append/.test(p)) return opts.excelOk
      ? {ok:true,status:200,json:async()=>({ok:true,file:'Leads.xlsx'})}
      : {ok:false,status:500,json:async()=>({error:'Graph down'})};
    if(/send-brevo/.test(p)) return {ok:true,status:200,json:async()=>({ok:true,action:'created'})};
    if(/\/state/.test(p)) return {ok:true,status:200,json:async()=>opts.state||st};
    return {ok:true,status:200,json:async()=>({ok:true,googleClientId:''})};};
  w.eval(fs.readFileSync(D+'i18n.js','utf8'));
  w.eval(fs.readFileSync(D+'data.js','utf8'));
  w.eval(fs.readFileSync(D+'app.js','utf8'));
  return {w,calls,st};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let fail=0; const ck=(c,m)=>{ if(c) console.log('  ok  '+m); else {console.log('  FAIL '+m); fail++;} };
(async()=>{
  console.log('\nRipresa delle righe Excel\n');
  // 1. invio con Excel giù
  const a=boot({excelOk:false}); await wait(200);
  a.w.location.hash='#/lead?id=l1'; await wait(150);
  a.w.document.getElementById('send').click(); await wait(300);
  const l=a.w.DB.leads.find(x=>x.id==='l1');
  ck(l.status==='Sent','Brevo ok: il lead risulta inviato');
  ck(l.excelPending===true,'la riga Excel mancante resta segnata in sospeso');
  ck(/^Excel:/.test(l.error||''),'l\'errore Excel è visibile sulla scheda');

  // 2. riavvio con Excel tornato su: il lead in sospeso viene ripreso da solo
  const pendingLead=Object.assign({},l);
  const st2=JSON.parse(JSON.stringify(a.st)); st2.leads=[pendingLead];
  const b=boot({excelOk:true, state:st2}); await wait(400);
  const appends=b.calls.filter(c=>/ms\/append/.test(c)).length;
  ck(appends===1,'all\'avvio la riga viene riscritta una volta, chiamate: '+appends);
  const l2=b.w.DB.leads.find(x=>x.id==='l1');
  ck(l2.excelPending===false,'dopo la ripresa non è più in sospeso');
  ck(!l2.error,'e l\'errore Excel sparisce');

  // 3. nessun lead in sospeso → nessuna chiamata inutile
  const st3=JSON.parse(JSON.stringify(a.st)); st3.leads[0].status='Sent'; st3.leads[0].excelPending=false;
  const c=boot({excelOk:true, state:st3}); await wait(300);
  ck(c.calls.filter(x=>/ms\/append/.test(x)).length===0,'senza arretrati non parte nulla');

  console.log(fail?('\n'+fail+' FALLITI\n'):'\ntutto verde\n'); process.exit(fail?1:0);
})().catch(e=>{console.log('CRASH',e.stack);process.exit(1)});
