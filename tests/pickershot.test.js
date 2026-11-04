/* Renderizza il selettore e misura gli elementi, con il CSS vero applicato. */
const fs=require('fs'), {JSDOM}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const css=fs.readFileSync(D+'styles.css','utf8');
const html=fs.readFileSync(D+'index.html','utf8')
  .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'')
  .replace('</head>','<style>'+css+'</style></head>');
const st={company:{id:'c1',name:'VID FIREKILL',domain:'vid.it',locale:'en',configured:true},
 settings:{autoSend:true,requireConsent:false,allowOverride:true,brevoApiKey:'k',fallbackOwner:'u1',newsletterListId:2},
 ms:{enabled:false},users:[{id:'u1',name:'Max',email:'max@bryan.it',role:'admin',status:'active',verified:true,activated:true}],
 events:[{id:'e1',name:'India',startDate:'2026-09-23',endDate:'2026-09-27',status:'open',preset:{provenienza:'',country:'',interesse:''},brevoListId:19}],
 picklists:{provenienza:[],interesse:[{id:'p1',value:'Automazione',active:true}]},
 rules:[],leads:[],syncLog:[],me:{id:'u1',role:'admin',locale:null}};
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
(async()=>{
  await wait(200);
  w.document.getElementById('switchEv').click();
  await wait(250);
  let fail=0; const ck=(c,m)=>{ if(c) console.log('  ok  '+m); else {console.log('  FAIL '+m); fail++;} };
  const svgs=[...w.document.querySelectorAll('.select-item .tick svg')];
  ck(svgs.length>0,'ci sono icone di spunta nelle righe, trovate: '+svgs.length);
  svgs.forEach((sv,i)=>{
    const st2=w.getComputedStyle(sv);
    ck(st2.width==='22px'&&st2.height==='22px','icona '+(i+1)+' vincolata a 22px, letto: '+st2.width+'×'+st2.height);
    ck(st2.flex==='none'||st2.flexGrow==='0','icona '+(i+1)+' non si allarga');
  });
  const rows=[...w.document.querySelectorAll('.select-item')];
  ck(rows.length>=2,'righe di scelta presenti: '+rows.length);
  const inner=w.document.querySelector('.select-item > div');
  ck(w.getComputedStyle(inner).minWidth==='0px','il blocco di testo può restringersi senza spezzare le parole');
  const pillSvg=w.document.querySelector('.pill svg');
  if(pillSvg){ const ps=w.getComputedStyle(pillSvg); ck(ps.width==='14px','icona nei chip a 14px, letto: '+ps.width); }
  console.log(fail?('\n'+fail+' FALLITI\n'):'\ntutto verde\n');
  process.exit(fail?1:0);
})().catch(e=>{console.log('CRASH',e.stack);process.exit(1)});
