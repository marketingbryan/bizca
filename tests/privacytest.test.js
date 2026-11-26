/* Privacy: la foto del biglietto non va al server e sparisce alla conferma; la firma
   non si perde con la memoria piena; informativa e versione nel consenso. */
const fs=require('fs'), {JSDOM}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const html=fs.readFileSync(D+'index.html','utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'');
let fail=0; const ck=(c,m)=>{ if(c) console.log('  ok  '+m); else {console.log('  FAIL '+m); fail++;} };
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const PHOTO='data:image/jpeg;base64,'+'A'.repeat(400);
function boot(opts){
  opts=opts||{};
  const st={company:{id:'c1',name:'VID',domain:'vid.it',locale:'it',configured:true},
    settings:{autoSend:true,requireConsent:false,brevoApiKey:'k',privacy:opts.privacy===undefined?{legalName:'VID S.p.A.',address:'Via Roma 1, Milano',vat:'IT01234567890',email:'privacy@vid.it'}:opts.privacy},
    ms:{enabled:false},users:[{id:'u1',name:'Max',email:'max@bryan.it',role:'admin',status:'active'}],
    events:[{id:'e1',name:'Fiera',status:'open',preset:{},brevoListId:3}],picklists:{provenienza:[],interesse:[{id:'p1',value:'Ricambi',active:true}]},
    rules:[],leads:[],syncLog:[],me:{id:'u1',role:'admin',locale:'it'}};
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://bizca.bryan.it/#/home',pretendToBeVisual:true});
  const w=dom.window; const calls=[];
  w.localStorage.setItem('bizca-token','tok'); w.localStorage.setItem('bizca-lang','it');
  if(opts.cache) w.localStorage.setItem('bizca-state-v1',JSON.stringify(opts.cache));
  if(opts.quota){ const orig=w.Storage.prototype.setItem; w.Storage.prototype.setItem=function(k,v){ if(k==='bizca-state-v1'&&String(v).length>opts.quota) throw new Error('QuotaExceededError'); return orig.call(this,k,v); }; }
  w.fetch=async(u,o)=>{ const p=String(u); calls.push({p,m:o&&o.method,b:o&&o.body?JSON.parse(o.body):null});
    if(/\/state/.test(p)) return {ok:true,status:200,json:async()=>st};
    if(/\/api\/scan/.test(p)) return {ok:true,status:200,json:async()=>({first:'Anna',last:'Rossi',company:'ACME',email:'a@acme.it'})};
    if(/brevo-lists/.test(p)) return {ok:true,status:200,json:async()=>({lists:[]})};
    if(/send-brevo/.test(p)) return {ok:true,status:200,json:async()=>({ok:true,action:'created'})};
    return {ok:true,status:200,json:async()=>({ok:true})}; };
  w.eval(fs.readFileSync(D+'i18n.js','utf8')); w.eval(fs.readFileSync(D+'data.js','utf8')); w.eval(fs.readFileSync(D+'app.js','utf8'));
  return {w,calls,st};
}
const cache=()=>JSON.parse(globalThis.__w.localStorage.getItem('bizca-state-v1')||'{}');
(async()=>{
  console.log('\nPrivacy\n');
  // 1. foto: solo durante la revisione, mai al server
  let b=boot(); globalThis.__w=b.w; await wait(400);
  b.w.DB.leads.unshift({id:'lr',first:'Anna',last:'Rossi',company:'ACME',role:'',email:'a@acme.it',phone:'',website:'',address:'',provenienza:'Event',country:'',interesse:'',
    eventId:'e1',captureType:'event',ownerId:'u1',createdBy:'u1',status:'To finalize',image:PHOTO,_review:true,ts:Date.now()});
  b.w.location.hash='#/lead?id=lr'; await wait(250);
  ck(!!b.w.document.querySelector('img[alt="business card"]'),'durante la revisione la foto si vede');
  b.w.document.querySelector('[data-f="first"]').value='Anna M'; b.w.document.querySelector('[data-f="first"]').dispatchEvent(new b.w.Event('input')); await wait(1000);
  const puts=b.calls.filter(c=>c.m==='PUT'&&/\/leads\/lr/.test(c.p));
  ck(puts.length>0 && puts.every(c=>!('image' in c.b) && !('_review' in c.b)),'il salvataggio sul server non porta mai la foto');
  b.w.document.getElementById('saveDraft').click(); await wait(200);
  const l=b.w.DB.leads.find(x=>x.id==='lr');
  ck(!l.image,'confermato il lead, la foto sparisce dalla memoria');
  ck(!JSON.stringify(cache()).includes(PHOTO.slice(0,60)),'e dalla memoria locale del telefono');

  // 2. vecchie foto in cache, di lead non in revisione, vengono tolte all'avvio
  b=boot({cache:{company:{id:'c1',name:'VID',configured:true},users:[{id:'u1'}],leads:[{id:'old',first:'X',status:'Sent',image:PHOTO,ts:1}],session:{userId:'u1'}}}); globalThis.__w=b.w; await wait(400);
  ck(!JSON.stringify(cache()).includes(PHOTO.slice(0,60)),'le foto rimaste in cache da versioni vecchie vengono cancellate');

  // 3. memoria piena: si sacrificano le foto, mai una firma non ancora sul server
  const SIG='data:image/png;base64,'+'S'.repeat(3000);
  b=boot({quota:9000}); globalThis.__w=b.w; await wait(400);
  b.w.DB.leads=[{id:'a',first:'A',status:'To finalize',image:'data:image/jpeg;base64,'+'P'.repeat(6000),_review:true,ts:1},
                {id:'s',first:'S',status:'Ready',consentSignature:SIG,consentAt:Date.now(),_dirty:true,ts:2}];
  b.w.eval('void 0'); // no-op
  b.w.location.hash='#/leads'; await wait(200);
  const c3=cache(); const sl=(c3.leads||[]).find(x=>x.id==='s');
  ck(sl && sl.consentSignature===SIG,'con la memoria piena la firma non ancora inviata resta');
  ck(!((c3.leads||[]).find(x=>x.id==='a')||{}).image,'e si sacrifica la foto');

  // 4. schermata di consenso
  b=boot(); globalThis.__w=b.w; await wait(400);
  b.w.DB.leads.unshift({id:'lc',first:'Anna',last:'Rossi',company:'ACME',role:'',email:'a@acme.it',phone:'',website:'',address:'',provenienza:'Event',country:'Italy',interesse:'Ricambi',
    eventId:'e1',captureType:'event',ownerId:'u1',createdBy:'u1',status:'Ready',ts:Date.now()});
  b.w.location.hash='#/lead?id=lc'; await wait(250);
  let txt=b.w.document.querySelector('.consent-text').textContent;
  ck(/ricontattato da VID S\.p\.A\./.test(txt) && /privacy@vid\.it/.test(txt),'sopra la firma c\'è il testo con azienda ed email privacy');
  ck(!!b.w.document.getElementById('privAck'),'c\'è la casella «Ho letto l\'informativa…»');
  b.w.document.getElementById('readNotice').click(); await wait(100);
  let modal=b.w.document.getElementById('modal-root').textContent;
  ck(/Titolare del trattamento è VID S\.p\.A\./.test(modal) && /IT01234567890/.test(modal) && /Bryan s\.r\.l\./.test(modal),'l\'informativa completa è compilata con i dati dell\'azienda');
  b.w.document.querySelector('[data-nlang="en"]').click(); await wait(50);
  ck(/The data controller is VID S\.p\.A\./.test(b.w.document.getElementById('modal-root').textContent),'e c\'è la versione inglese');
  b.w.closeModal();
  b.w.document.querySelector('[data-clang="en"]').click(); await wait(100);
  txt=b.w.document.querySelector('.consent-text').textContent;
  ck(/By signing, you agree to be contacted by VID S\.p\.A\./.test(txt),'il contatto può leggere il testo in inglese');

  // 4b. consenso al tracciamento delle email: separato, facoltativo, non spuntato
  const tk=b.w.document.getElementById('trackOk');
  ck(tk && !tk.checked,'c\'è la casella del tracciamento email, non spuntata');
  tk.checked=true; tk.dispatchEvent(new b.w.Event('change')); await wait(150);
  ck(b.w.DB.leads.find(x=>x.id==='lc').emailTracking===true,'spuntata, il lead registra il consenso al tracciamento');
  ck(b.calls.some(c=>c.m==='PUT'&&/\/leads\/lc/.test(c.p)&&c.b.emailTracking===true),'e lo salva sul server');
  b.w.document.getElementById('send').click(); await wait(400);
  const sb=b.calls.find(c=>/send-brevo/.test(c.p));
  ck(sb && sb.b.lead.emailTracking===true,'e lo manda a Brevo');
  b.w.document.querySelector('[data-clang]') ; b.w.location.hash='#/lead?id=lc'; await wait(200);
  ck(/Tracciamento email/.test(b.w.document.body.textContent),'il lead inviato mostra il consenso al tracciamento');

  // 5. dati mancanti: avviso
  b=boot({privacy:null}); globalThis.__w=b.w; await wait(400);
  b.w.DB.leads.unshift({id:'lm',first:'A',last:'B',company:'C',status:'Ready',ts:Date.now(),ownerId:'u1',createdBy:'u1'});
  b.w.location.hash='#/lead?id=lm'; await wait(250);
  ck(/Admin → Privacy/.test(b.w.document.body.textContent),'se mancano i dati dell\'azienda lo dice');

  // 6. Admin → Privacy salva i quattro campi
  b.w.location.hash='#/admin/privacy'; await wait(250);
  b.w.document.getElementById('pvAddr').value='Via Verdi 2, Torino'; b.w.document.getElementById('pvVat').value='IT09876543210'; b.w.document.getElementById('pvMail').value='privacy@vid.it';
  b.w.document.getElementById('pvSave').click(); await wait(150);
  const pc=b.calls.find(c=>/\/settings/.test(c.p)&&c.m==='PATCH');
  ck(pc && pc.b.privacy && pc.b.privacy.vat==='IT09876543210' && pc.b.privacy.address==='Via Verdi 2, Torino' && pc.b.privacy.legalName==='VID','Admin → Privacy salva indirizzo, P.IVA, email e ragione sociale');

  // 7. registrazione: link alla nuova privacy policy
  ck(/href="\/privacy\/"/.test(fs.readFileSync(D+'app.js','utf8')) && !/bryan\.it\/privacy-policy/.test(fs.readFileSync(D+'app.js','utf8')),'la registrazione punta a /privacy');
  ck(fs.existsSync(D+'privacy/index.html') && fs.existsSync(D+'privacy/en/index.html'),'la policy esiste in italiano e in inglese');
  if(fail){ console.log('FALLITI '+fail); process.exit(1); }
})();
