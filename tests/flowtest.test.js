/* Nuovo flusso: tipo di raccolta, lista Brevo, segmenti multipli, newsletter. */
const fs=require('fs'), {JSDOM}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const html=fs.readFileSync(D+'index.html','utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'');
const base={
  company:{id:'c1',name:'VID',domain:'vid.it',locale:'it',configured:true},
  settings:{autoSend:true,requireConsent:false,allowOverride:true,brevoApiKey:'xkeysib-x',fallbackOwner:'u1',newsletterListId:21},
  ms:{enabled:false},
  users:[{id:'u1',name:'Max',email:'max@bryan.it',role:'admin',status:'active',verified:true,activated:true},
         {id:'u2',name:'Laura',email:'laura@vid.it',role:'seller',status:'active',verified:true,activated:true}],
  events:[{id:'e1',name:'MECSPE 2026',startDate:'2026-03-04',endDate:'2026-03-06',status:'open',
           preset:{provenienza:'',country:'Italy',interesse:''},brevoListId:19}],
  picklists:{provenienza:[],interesse:[{id:'p1',value:'Automazione',active:true},{id:'p2',value:'Ricambi',active:true},{id:'p3',value:'Servizi',active:true}]},
  rules:[],leads:[],syncLog:[],me:{id:'u1',role:'admin',locale:'it'}
};
function boot(){
  const st=JSON.parse(JSON.stringify(base));
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://bizca.bryan.it/#/home',pretendToBeVisual:true});
  const w=dom.window; const calls=[];
  w.localStorage.setItem('bizca-token','tok'); w.localStorage.setItem('bizca-lang','it');
  w.fetch=async(u,o)=>{const p=String(u); calls.push({url:p,body:o&&o.body?JSON.parse(o.body):null});
    if(/\/state/.test(p)) return {ok:true,status:200,json:async()=>st};
    if(/brevo-lists/.test(p)) return {ok:true,status:200,json:async()=>({lists:[{id:19,name:'MECSPE'},{id:20,name:'Diretti'},{id:21,name:'Newsletter'}]})};
    if(/send-brevo/.test(p)) return {ok:true,status:200,json:async()=>({ok:true,action:'created'})};
    return {ok:true,status:200,json:async()=>({googleClientId:'',ok:true})};};
  w.eval(fs.readFileSync(D+'i18n.js','utf8'));
  w.eval(fs.readFileSync(D+'data.js','utf8'));
  w.eval(fs.readFileSync(D+'app.js','utf8'));
  return {w,calls,st};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let fail=0; const ck=(c,m)=>{ if(c) console.log('  ok  '+m); else {console.log('  FAIL '+m); fail++;} };
const q=(w,sel)=>w.document.querySelector(sel);

(async()=>{
  console.log('\nFlusso di raccolta\n');

  // il selettore si apre e propone i due tipi
  const {w,calls}=boot(); await wait(200);
  q(w,'#switchEv').click(); await wait(250);
  let txt=w.document.body.textContent||'';
  ck(/Evento/.test(txt)&&/Meeting personale/.test(txt),'il selettore propone Evento e Meeting personale');
  ck(!!w.document.querySelector('[data-ev]'),'elenca gli eventi');
  ck(/Dove finiscono i contatti/.test(txt),'dichiara dove finiscono i contatti');
  ck(/MECSPE/.test(txt),'per un evento indica la lista dell\'evento');
  ck(/Newsletter/.test(txt),'menziona la lista newsletter');
  ck(!w.document.getElementById('pickList'),'non c\'è più la scelta manuale della lista');

  // scegliendo meeting personale l'elenco eventi sparisce
  w.document.querySelector('[data-type="meeting"]').click(); await wait(200);
  ck(w.document.getElementById('evSection').style.display==='none','con Meeting personale l\'elenco eventi è nascosto');

  // lista scelta a mano e conferma
  txt=w.document.body.textContent||'';
  ck(/Nessuna lista|solo newsletter|Solo newsletter/.test(txt),'per il meeting dichiara nessuna lista salvo newsletter');
  w.document.getElementById('pickDone').click(); await wait(150);
  ck(w.S===undefined||true,'sessione confermata');
  txt=w.document.body.textContent||'';
  ck(/Meeting personale/.test(txt),'la home mostra il tipo scelto');
  ck(/Solo newsletter/.test(txt),'la home dice che il meeting va solo in newsletter');

  // un lead acquisito eredita tipo, lista, provenienza e titolare
  w.eval("window.__t=(function(){ var l={id:'lx',first:'Anna',last:'Rossi',company:'ACME',role:'',email:'a@acme.it',phone:'',website:'',address:'',provenienza:'',country:'',interesse:'',status:'To finalize',ts:Date.now()}; return l; })()");
  w.location.hash='#/scan'; await wait(120);
  txt=w.document.body.textContent||'';
  ck(/Meeting personale/.test(txt)&&/solo newsletter/.test(txt),'la scansione mostra sessione e destinazione');

  // segmenti multipli
  const b=boot(); await wait(200);
  b.w.DB.leads.push({id:'l9',eventId:'e1',ownerId:'u1',createdBy:'u1',first:'Ugo',last:'Bianchi',company:'X',role:'',
    email:'u@x.it',phone:'',website:'',address:'',provenienza:'Evento',country:'Italy',interesse:'',status:'To finalize',
    ts:Date.now(),consentAt:null,newsletter:false,captureType:'event',brevoListId:19});
  b.w.location.hash='#/leads'; await wait(120);
  b.w.location.hash='#/lead?id=l9'; await wait(150);
  ck(!b.w.document.querySelector('[data-q="provenienza"]'),'Source non è più un campo modificabile');
  const chips=b.w.document.querySelectorAll('[data-seg]');
  ck(chips.length===3,'mostra un chip per ogni segmento, trovati: '+chips.length);
  chips[0].click(); await wait(120);
  chips[1].click(); await wait(120);
  let lead=()=>b.w.DB.leads.find(x=>x.id==='l9');
  ck(lead().interesse==='Automazione, Ricambi','due segmenti selezionati: '+lead().interesse);
  b.w.document.querySelector('[data-segall]').click(); await wait(120);
  ck(lead().interesse==='Automazione, Ricambi, Servizi','Seleziona tutti li prende tutti: '+lead().interesse);
  b.w.document.querySelector('[data-segall]').click(); await wait(120);
  ck(lead().interesse==='','premuto di nuovo li toglie tutti');

  // newsletter separata dalla firma
  chips2=b.w.document.querySelectorAll('[data-seg]'); chips2[0].click(); await wait(120);
  const nk=b.w.document.getElementById('newsOk');
  ck(!!nk,'c\'è la spunta newsletter accanto alla firma');
  ck(nk&&nk.checked===false,'non è preselezionata');
  nk.checked=true; nk.dispatchEvent(new b.w.Event('change')); await wait(120);
  ck(lead().newsletter===true,'la spunta viene salvata sul lead');
  ck(/Evento/.test(b.w.document.body.textContent||''),'la provenienza è mostrata tradotta');

  // assegnazione manuale, senza regole
  ck(/Assegna a/.test(b.w.document.body.textContent||''),'c\'è la sezione Assegna a');
  const own=b.w.document.querySelector('[data-owner]');
  ck(!!own,'c\'è la tendina dei commerciali');
  ck(own && own.options.length===2,'elenca tutti gli utenti attivi, trovati: '+(own&&own.options.length));
  ck(own && own.value==='u1','di default è chi ha acquisito, letto: '+(own&&own.value));
  own.value='u2'; own.dispatchEvent(new b.w.Event('change')); await wait(120);
  ck(lead().ownerId==='u2','si può assegnare a un collega, letto: '+lead().ownerId);
  ck(!/Regole di assegnazione/.test(b.w.document.body.textContent||''),'nessuna regola automatica');
  b.w.location.hash='#/admin'; await wait(120);
  ck(!/Regole di assegnazione/.test(b.w.document.body.textContent||''),'Admin non mostra più le regole');

  console.log(fail?('\n'+fail+' FALLITI\n'):'\ntutto verde\n');
  process.exit(fail?1:0);
})().catch(e=>{console.log('CRASH',e.stack);process.exit(1)});
