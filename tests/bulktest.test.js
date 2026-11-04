/* Pagina Lead: selezione multipla, invio e cancellazione. */
const fs=require('fs'), {JSDOM}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const html=fs.readFileSync(D+'index.html','utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'');
const L=(id,o={})=>Object.assign({id,eventId:'e1',ownerId:'u1',createdBy:'u1',first:'N'+id,last:'X',company:'C',role:'',
  email:id+'@x.it',phone:'',website:'',address:'',provenienza:'Event',country:'Italy',interesse:'Automazione',
  status:'Ready',ts:Date.now(),consentAt:Date.now(),newsletter:false,captureType:'event',brevoListId:19},o);
function boot(o={}){
  const st={company:{id:'c1',name:'VID',domain:'vid.it',locale:'it',configured:true},
   settings:{autoSend:true,requireConsent:false,allowOverride:true,brevoApiKey:'k',fallbackOwner:'u1',newsletterListId:2},
   ms:{enabled:false,ready:false},
   users:[{id:'u1',name:'Max',email:'max@bryan.it',role:o.role||'admin',status:'active',verified:true,activated:true},
          {id:'u2',name:'Laura',email:'laura@vid.it',role:'seller',status:'active',verified:true,activated:true}],
   events:[{id:'e1',name:'MECSPE',startDate:'',endDate:'',status:'open',preset:{provenienza:'',country:'',interesse:''},brevoListId:19}],
   picklists:{provenienza:[],interesse:[{id:'p1',value:'Automazione',active:true}]},
   rules:[],syncLog:[],me:{id:'u1',role:o.role||'admin',locale:'it'},
   leads:o.leads||[L('a'),L('b'),L('c',{country:''}),L('d',{status:'Sent'})]};
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://bizca.bryan.it/#/leads',pretendToBeVisual:true});
  const w=dom.window; const calls=[];
  w.localStorage.setItem('bizca-token','t'); w.localStorage.setItem('bizca-lang','it');
  w.fetch=async(u,opt)=>{const p=String(u); const m=(opt&&opt.method)||'GET'; calls.push(m+' '+p);
    if(m==='DELETE'&&/\/leads\//.test(p)){ const id=p.split('/').pop();
      if(o.denyDelete&&o.denyDelete.includes(id)) return {ok:false,status:403,json:async()=>({error:'Only the person who captured this lead, or an admin, can delete it'})};
      return {ok:true,status:200,json:async()=>({ok:true,deleted:1})}; }
    if(m==='PUT') return {ok:true,status:200,json:async()=>({ok:true})};
    if(/send-brevo/.test(p)) return {ok:true,status:200,json:async()=>({ok:true,action:'created'})};
    if(/\/state/.test(p)) return {ok:true,status:200,json:async()=>st};
    return {ok:true,status:200,json:async()=>({ok:true,googleClientId:''})};};
  w.confirm=()=>true;
  w.eval(fs.readFileSync(D+'i18n.js','utf8'));
  w.eval(fs.readFileSync(D+'data.js','utf8'));
  w.eval(fs.readFileSync(D+'app.js','utf8'));
  return {w,calls};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let fail=0; const ck=(c,m)=>{ if(c) console.log('  ok  '+m); else {console.log('  FAIL '+m); fail++;} };
const $=(w,s)=>w.document.querySelector(s), $$=(w,s)=>[...w.document.querySelectorAll(s)];
const txt=w=>w.document.body.textContent||'';
(async()=>{
  console.log('\nSelezione multipla nella pagina Lead\n');
  { const {w}=boot(); await wait(250);
    ck(!!$(w,'#selToggle')&&/Seleziona/.test($(w,'#selToggle').textContent),'c\'è il pulsante Seleziona');
    ck(!$(w,'.selbar'),'la barra azioni non c\'è finché non si seleziona');
    // tocco normale: apre il lead
    $(w,'[data-lead="a"]').click(); await wait(120);
    ck(/#\/lead\?id=a/.test(w.location.hash),'fuori dalla selezione, un tocco apre il lead');
  }
  { const {w,calls}=boot(); await wait(250);
    $(w,'#selToggle').click(); await wait(80);
    ck($$(w,'.lead .checkbox').length===4,'in selezione ogni riga ha la sua casella');
    ck(!!$(w,'.selbar'),'compare la barra con le azioni');
    ck($(w,'#selSend').disabled && $(w,'#selDel').disabled,'senza selezione le azioni sono spente');
    $(w,'[data-lead="a"]').click(); await wait(60);
    ck(/#\/leads/.test(w.location.hash),'in selezione il tocco non apre il lead');
    ck($(w,'[data-lead="a"]').classList.contains('picked'),'la riga risulta selezionata');
    ck(/\(1\)/.test($(w,'#selSend').textContent),'il contatore dice 1');
    $(w,'#selAll').click(); await wait(60);
    ck(/\(4\)/.test($(w,'#selSend').textContent),'Seleziona tutti prende tutte le righe visibili');
    ck(/Deseleziona tutti/.test($(w,'#selAll').textContent),'e diventa Deseleziona tutti');
    // invio multiplo
    $(w,'#selSend').click(); await wait(500);
    const sent=calls.filter(c=>/send-brevo/.test(c)).length;
    ck(sent===2,'invia solo i completi e non ancora inviati: 2 su 4, inviati '+sent);
    ck(/2 inviati/.test(txt(w))&&/1 saltati perché incompleti/.test(txt(w))&&/1 già inviati/.test(txt(w)),'il riepilogo spiega cosa è successo');
    ck(!$(w,'.selbar'),'dopo l\'invio si esce dalla selezione');
  }
  { const {w,calls}=boot(); await wait(250);
    $(w,'#selToggle').click(); await wait(60);
    $(w,'[data-lead="a"]').click(); await wait(40); $(w,'[data-lead="d"]').click(); await wait(40);
    $(w,'#selDel').click(); await wait(100);
    ck(/Eliminare 2 lead\?/.test(txt(w)),'chiede conferma con il numero');
    ck(/1 sono già stati inviati: restano in Brevo e nel file Excel/.test(txt(w)),'avvisa che gli inviati restano in Brevo ed Excel');
    $(w,'#delManyYes').click(); await wait(300);
    ck(calls.filter(c=>/^DELETE .*\/leads\//.test(c)).length===2,'chiama la cancellazione per entrambi');
    ck(!w.DB.leads.some(l=>l.id==='a'||l.id==='d'),'spariscono dall\'elenco');
    ck(w.DB.leads.length===2,'gli altri restano');
  }
  { // commerciale: i lead dei colleghi vengono saltati e lo dice
    const {w}=boot({role:'seller',leads:[L('m1'),L('m2',{createdBy:'u2',ownerId:'u1'})],denyDelete:['m2']}); await wait(250);
    $(w,'#selToggle').click(); await wait(60); $(w,'#selAll').click(); await wait(60);
    $(w,'#selDel').click(); await wait(100);
    ck(/1 sono stati acquisiti da colleghi/.test(txt(w)),'avvisa prima che quelli dei colleghi verranno saltati');
    $(w,'#delManyYes').click(); await wait(300);
    ck(!w.DB.leads.some(l=>l.id==='m1') && w.DB.leads.some(l=>l.id==='m2'),'elimina il suo, lascia quello del collega');
    ck(/1 eliminati, 1 non tuoi, saltati/.test(txt(w)),'e lo riassume');
  }
  { // il pulsante Annulla nella conferma non elimina nulla
    const {w,calls}=boot(); await wait(250);
    $(w,'#selToggle').click(); await wait(60); $(w,'[data-lead="a"]').click(); await wait(40);
    $(w,'#selDel').click(); await wait(80);
    w.eval('closeModal()'); await wait(60);
    ck(!calls.some(c=>/^DELETE/.test(c)),'chiudendo la conferma non si elimina nulla');
  }
  console.log(fail?('\n'+fail+' FALLITI\n'):'\ntutto verde\n'); process.exit(fail?1:0);
})().catch(e=>{console.log('CRASH',e.stack);process.exit(1)});
