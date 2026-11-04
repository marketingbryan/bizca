/* Il selettore non deve ricostruirsi a ogni tocco: le stesse righe restano
   nel DOM, cambiano solo classe e spunta. */
const fs=require('fs'), {JSDOM}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const css=fs.readFileSync(D+'styles.css','utf8');
const html=fs.readFileSync(D+'index.html','utf8')
  .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'')
  .replace('</head>','<style>'+css+'</style></head>');
const st={company:{id:'c1',name:'VID',domain:'vid.it',locale:'it',configured:true},
 settings:{autoSend:true,requireConsent:false,allowOverride:true,brevoApiKey:'k',fallbackOwner:'u1',newsletterListId:2},
 ms:{enabled:false},users:[{id:'u1',name:'Max',email:'max@bryan.it',role:'admin',status:'active',verified:true,activated:true}],
 events:[{id:'e1',name:'India',startDate:'2026-09-23',endDate:'2026-09-27',status:'open',preset:{provenienza:'',country:'',interesse:''},brevoListId:19},
         {id:'e2',name:'MECSPE',startDate:'2026-03-04',endDate:'2026-03-06',status:'open',preset:{provenienza:'',country:'',interesse:''},brevoListId:null}],
 picklists:{provenienza:[],interesse:[{id:'p1',value:'Automazione',active:true}]},
 rules:[],leads:[],syncLog:[],me:{id:'u1',role:'admin',locale:'it'}};
const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://bizca.bryan.it/#/home',pretendToBeVisual:true});
const w=dom.window; w.localStorage.setItem('bizca-token','t'); w.localStorage.setItem('bizca-lang','it');
w.fetch=async(u)=>{const p=String(u);
  if(/\/state/.test(p)) return {ok:true,status:200,json:async()=>st};
  if(/brevo-lists/.test(p)) return {ok:true,status:200,json:async()=>({lists:[{id:19,name:'Lista test Bizca'},{id:2,name:'contacts'}]})};
  return {ok:true,status:200,json:async()=>({googleClientId:'',ok:true})};};
w.eval(fs.readFileSync(D+'i18n.js','utf8'));
w.eval(fs.readFileSync(D+'data.js','utf8'));
w.eval(fs.readFileSync(D+'app.js','utf8'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let fail=0; const ck=(c,m)=>{ if(c) console.log('  ok  '+m); else {console.log('  FAIL '+m); fail++;} };
(async()=>{
  console.log('\nSelettore senza sfarfallio\n');
  await wait(220);
  w.document.getElementById('switchEv').click(); await wait(250);

  const modalEl=w.document.querySelector('.modal');
  const rowEvent=w.document.querySelector('[data-type="event"]');
  const rowMeet=w.document.querySelector('[data-type="meeting"]');
  ck(!!modalEl&&!!rowEvent&&!!rowMeet,'la finestra si apre con le due scelte');
  ck(rowEvent.classList.contains('sel'),'parte su Evento');
  ck(rowEvent.querySelector('.tick').innerHTML.length>0,'la spunta è su Evento');

  // gli stessi nodi devono sopravvivere al cambio
  w.eval("document.querySelector('[data-type=\"meeting\"]').click()"); await wait(120);
  ck(w.document.querySelector('.modal')===modalEl,'la finestra non viene ricreata');
  ck(w.document.querySelector('[data-type="event"]')===rowEvent,'la riga Evento è lo stesso nodo');
  ck(w.document.querySelector('[data-type="meeting"]')===rowMeet,'la riga Meeting è lo stesso nodo');
  ck(rowMeet.classList.contains('sel')&&!rowEvent.classList.contains('sel'),'la selezione si è spostata');
  ck(rowMeet.querySelector('.tick').innerHTML.length>0&&rowEvent.querySelector('.tick').innerHTML==='','la spunta si è spostata');
  ck(w.document.getElementById('evSection').style.display==='none','l\'elenco eventi si nasconde');
  ck(/newsletter/i.test(w.document.getElementById('destText').textContent),'il testo di destinazione si aggiorna');

  // e tornando indietro
  w.eval("document.querySelector('[data-type=\"event\"]').click()"); await wait(120);
  ck(w.document.querySelector('.modal')===modalEl,'ancora la stessa finestra dopo due cambi');
  ck(w.document.getElementById('evSection').style.display==='','l\'elenco eventi riappare');
  ck(/Lista test Bizca/.test(w.document.getElementById('destText').textContent),'torna la lista dell\'evento');

  // cambio evento: nodi stabili anche qui
  const rowE1=w.document.querySelector('[data-ev="e1"]'), rowE2=w.document.querySelector('[data-ev="e2"]');
  w.eval("document.querySelector('[data-ev=\"e2\"]').click()"); await wait(120);
  ck(w.document.querySelector('[data-ev="e1"]')===rowE1,'le righe evento non vengono ricreate');
  ck(rowE2.classList.contains('sel')&&!rowE1.classList.contains('sel'),'la spunta passa al secondo evento');
  ck(/non ha una lista/.test(w.document.getElementById('destText').textContent),'avvisa che quell\'evento non ha lista');

  console.log(fail?('\n'+fail+' FALLITI\n'):'\ntutto verde\n');
  process.exit(fail?1:0);
})().catch(e=>{console.log('CRASH',e.stack);process.exit(1)});
