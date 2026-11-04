/* Nessuna icona deve crescere oltre misura, su nessuna schermata.
   Questo test blocca per sempre la classe di bug degli SVG senza dimensione. */
const fs=require('fs'), {JSDOM}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const css=fs.readFileSync(D+'styles.css','utf8');
const html=fs.readFileSync(D+'index.html','utf8')
  .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'')
  .replace('</head>','<style>'+css+'</style></head>');
const st={company:{id:'c1',name:'VID FIREKILL',domain:'vid.it',locale:'en',configured:true},
 settings:{autoSend:true,requireConsent:true,allowOverride:true,brevoApiKey:'k',fallbackOwner:'u1',newsletterListId:2},
 ms:{tenantId:'t',clientId:'',hasOwnSecret:false,mode:'platform',platformApp:true,driveId:'d',itemId:'i',
     tableName:'Lead',fileName:'Leads.xlsx',fileUrl:'https://sp/L.xlsx',enabled:true,ready:true,lastError:null},
 users:[{id:'u1',name:'Max',email:'max@bryan.it',role:'admin',status:'active',verified:true,activated:true},
        {id:'u2',name:'Laura',email:'laura@vid.it',role:'seller',status:'active',verified:true,activated:false}],
 events:[{id:'e1',name:'India',startDate:'2026-09-23',endDate:'2026-09-27',status:'open',preset:{provenienza:'',country:'',interesse:''},brevoListId:19}],
 picklists:{provenienza:[],interesse:[{id:'p1',value:'Automazione',active:true},{id:'p2',value:'Ricambi',active:true}]},
 rules:[],
 leads:[{id:'l1',eventId:'e1',ownerId:'u1',createdBy:'u1',first:'Anna',last:'Rossi',company:'ACME',role:'Buyer',
         email:'a@acme.it',phone:'+39',website:'acme.it',address:'Milano',provenienza:'Evento',country:'Italy',
         interesse:'Automazione',status:'To finalize',ts:Date.now(),consentAt:null,newsletter:false,captureType:'event',brevoListId:19},
        {id:'l2',eventId:null,ownerId:'u1',createdBy:'u1',first:'Jon',last:'Tan',company:'Tan',role:'CTO',
         email:'j@t.sg',phone:'',website:'',address:'',provenienza:'Meeting personale',country:'Italy',
         interesse:'Ricambi',status:'Sent',ts:Date.now()-1e3,consentAt:Date.now()-500,newsletter:true,captureType:'meeting',brevoListId:null}],
 syncLog:[{leadId:'l2',dest:'Brevo',ok:true,msg:'Contact created',ts:Date.now()}],
 me:{id:'u1',role:'admin',locale:null}};

const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://bizca.bryan.it/#/home',pretendToBeVisual:true});
const w=dom.window; w.localStorage.setItem('bizca-token','t');
w.fetch=async(u)=>{const p=String(u);
  if(/\/state/.test(p)) return {ok:true,status:200,json:async()=>st};
  if(/brevo-lists/.test(p)) return {ok:true,status:200,json:async()=>({lists:[{id:19,name:'Lista test Bizca'},{id:2,name:'contacts'}]})};
  return {ok:true,status:200,json:async()=>({googleClientId:'',ok:true})};};
w.eval(fs.readFileSync(D+'i18n.js','utf8'));
w.eval(fs.readFileSync(D+'data.js','utf8'));
w.eval(fs.readFileSync(D+'app.js','utf8'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ROUTES=['#/home','#/scan','#/leads','#/lead?id=l1','#/lead?id=l2','#/batch','#/dashboard',
              '#/admin','#/admin/team','#/admin/sources','#/admin/segments','#/admin/dest','#/admin/events'];
const MAX=60;   // nessuna icona oltre questa misura
(async()=>{
  await wait(220);
  let fail=0;
  const check=(where)=>{
    const bad=[];
    w.document.querySelectorAll('svg').forEach(sv=>{
      const cs=w.getComputedStyle(sv);
      const wd=parseFloat(cs.width), ht=parseFloat(cs.height);
      if(!cs.width || cs.width==='auto' || cs.width===''){ bad.push('senza larghezza: '+(sv.parentElement&&sv.parentElement.className||'?')); return; }
      if(wd>MAX||ht>MAX) bad.push(Math.round(wd)+'×'+Math.round(ht)+' in .'+(sv.parentElement&&sv.parentElement.className||'?'));
      if(cs.flexGrow && cs.flexGrow!=='0') bad.push('si allarga in .'+(sv.parentElement&&sv.parentElement.className||'?'));
    });
    if(bad.length){ console.log('  FAIL '+where+' → '+bad.slice(0,4).join(' | ')); fail++; }
    else console.log('  ok  '+where);
  };
  for(const r of ROUTES){ w.location.hash=r; await wait(60); check(r); }
  w.location.hash='#/home'; await wait(80);
  w.document.getElementById('switchEv').click(); await wait(220);
  check('selettore evento/meeting');
  console.log(fail?('\n'+fail+' FALLITI\n'):'\ntutte le icone sono nei limiti\n');
  process.exit(fail?1:0);
})().catch(e=>{console.log('CRASH',e.stack);process.exit(1)});
