/* Percorre ogni schermata in inglese e in italiano dentro jsdom. */
const fs=require('fs'), {JSDOM}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const html=fs.readFileSync(D+'index.html','utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'');

const state={
  company:{id:'c1',name:'VID',domain:'vid.it',locale:'en',configured:true},
  settings:{autoSend:true,requireConsent:true,allowOverride:true,brevoApiKey:'xkeysib-abcd1234',
            fallbackOwner:'u1',newsletterListId:21},
  ms:{tenantId:'tid',clientId:'',hasOwnSecret:false,mode:'platform',platformApp:true,driveId:'d',itemId:'i',
      tableName:'Lead',fileName:'Leads.xlsx',fileUrl:'https://sp/Leads.xlsx',enabled:true,ready:true,lastError:null},
  users:[{id:'u1',name:'Max',email:'max@bryan.it',role:'admin',status:'active',verified:true,activated:true},
         {id:'u2',name:'Laura Bianchi',email:'laura@vid.it',role:'seller',status:'active',verified:true,activated:true}],
  events:[{id:'e1',name:'MECSPE 2026',startDate:'2026-03-04',endDate:'2026-03-06',status:'open',
           preset:{provenienza:'',country:'Italy',interesse:'Automazione'},brevoListId:19}],
  picklists:{provenienza:[],interesse:[{id:'p2',value:'Automazione',active:true},{id:'p3',value:'Ricambi',active:true}]},
  rules:[],
  leads:[{id:'l1',eventId:'e1',ownerId:'u1',createdBy:'u1',first:'Anna',last:'Müller',company:'Müller GmbH',role:'Buyer',
          email:'anna@m.de',phone:'+49',website:'m.de',address:'Berlin',provenienza:'Evento',country:'Germany',
          interesse:'Automazione, Ricambi',status:'To finalize',ts:Date.now(),consentAt:null,
          newsletter:false,captureType:'event',brevoListId:19},
         {id:'l2',eventId:null,ownerId:'u1',createdBy:'u1',first:'Jon',last:'Tan',company:'Tan Ltd',role:'CTO',
          email:'j@t.sg',phone:'',website:'',address:'',provenienza:'Meeting personale',country:'Italy',
          interesse:'Ricambi',status:'Sent',ts:Date.now()-1000,consentAt:Date.now()-500,
          newsletter:true,captureType:'meeting',brevoListId:20}],
  syncLog:[{leadId:'l2',dest:'Brevo',ok:true,msg:'Contact created',ts:Date.now()}],
  me:{id:'u1',role:'admin',locale:null}
};

function boot(lang){
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://bizca.bryan.it/#/home',pretendToBeVisual:true});
  const w=dom.window;
  w.localStorage.setItem('bizca-token','tok');
  if(lang) w.localStorage.setItem('bizca-lang',lang);
  w.fetch=async(u)=>{const p=String(u);
    if(/\/state/.test(p)) return {ok:true,status:200,json:async()=>state};
    if(/brevo-lists/.test(p)) return {ok:true,status:200,json:async()=>({lists:[{id:19,name:'MECSPE'},{id:21,name:'Newsletter'}]})};
    return {ok:true,status:200,json:async()=>({googleClientId:'',ok:true})};};
  w.eval(fs.readFileSync(D+'i18n.js','utf8'));
  w.eval(fs.readFileSync(D+'data.js','utf8'));
  w.eval(fs.readFileSync(D+'app.js','utf8'));
  return w;
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ROUTES=['#/home','#/scan','#/leads','#/lead?id=l1','#/lead?id=l2','#/batch','#/dashboard',
              '#/admin','#/admin/team','#/admin/sources','#/admin/segments','#/admin/dest','#/admin/events'];

// Parole inglesi che non devono sopravvivere nell'interfaccia italiana.
const SMELL=/\b(Sign in|Welcome|Scan card|Capture card|Choose from gallery|Qualification|Save draft|Consent signed|Add user|Add value|Export CSV|Send rate|By status|Total leads|Check and switch on|Team & access|Destinations|Batch queue|Quick status|My leads|First name|Last name|Website|Address|Country|Segment|Source|Owner|Delete|Cancel|Close|Back|Select all|Personal meeting|Brevo list|Newsletter list)\b/;

(async()=>{
  let fail=0;
  for(const lang of ['en','it']){
    const w=boot(lang); await wait(160);
    if(w.I18N.lang!==lang){console.log('FAIL lingua',w.I18N.lang,'attesa',lang);fail++;}
    for(const r of ROUTES){
      w.location.hash=r; await wait(60);
      const txt=w.document.body.textContent||'';
      if(txt.length<40){console.log('FAIL schermata vuota',lang,r);fail++;continue;}
      if(lang==='it'){
        const m=txt.match(SMELL);
        if(m){console.log('FAIL non tradotto su',r,'→',JSON.stringify(m[0]));fail++;}
      }
    }
    const missing=w.I18N.missingKeys();
    if(lang==='it'&&missing.length){console.log('FAIL chiavi IT mancanti:',missing.join(' | '));fail+=missing.length;}
    console.log(lang,'→ schermate ok, chiavi mancanti:',missing.length);
  }

  const w=boot('en'); await wait(160);
  w.location.hash='#/admin'; await wait(60);
  const before=w.document.body.textContent;
  w.eval("document.querySelector('[data-lang=\"it\"]').click()"); await wait(80);
  const after=w.document.body.textContent;
  if(before===after){console.log('FAIL il cambio lingua non ridisegna');fail++;}
  else if(!/Destinazioni|Segmenti/.test(after)){console.log('FAIL nessun italiano dopo il cambio:',after.slice(0,160));fail++;}
  else console.log('ok  il cambio lingua si applica subito');
  if(w.localStorage.getItem('bizca-lang')!=='it'){console.log('FAIL scelta non salvata');fail++;}
  else console.log('ok  scelta salvata sul dispositivo');

  const w2=boot(null); await wait(160);
  if(w2.I18N.lang!=='en'){console.log('FAIL default azienda, ricevuto',w2.I18N.lang);fail++;}
  else console.log('ok  segue il default dello spazio di lavoro');

  console.log(fail?('\n'+fail+' FALLITI\n'):'\ntutto verde\n');
  process.exit(fail?1:0);
})().catch(e=>{console.log('CRASH',e.stack);process.exit(1)});
