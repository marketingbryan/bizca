const fs=require('fs'), {JSDOM}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const html=fs.readFileSync(D+'index.html','utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'');

const state={
  company:{id:'c1',name:'VID',domain:'vid.it',locale:'en',configured:true},
  settings:{autoSend:true,requireConsent:false,allowOverride:true,brevoApiKey:'',fallbackOwner:'u1'},
  ms:{tenantId:'tid-123',clientId:'',hasOwnSecret:false,mode:'platform',platformApp:true,
      driveId:'d',itemId:'i',tableName:'LeadsTable',fileName:'Leads.xlsx',
      fileUrl:'https://sp/Leads.xlsx',enabled:true,ready:true,consentedAt:1,lastOk:null,lastError:null},
  users:[{id:'u1',name:'Max',email:'max@bryan.it',role:'admin',status:'active',verified:true}],
  events:[],picklists:{provenienza:[],interesse:[]},rules:[],leads:[],syncLog:[],me:{id:'u1',role:'admin'}
};
const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://bizca.bryan.it/#/admin/dest',pretendToBeVisual:true});
const w=dom.window;
w.localStorage.setItem('bizca-token','t');
w.fetch=async(u,o)=>{
  const p=String(u);
  if(/\/state/.test(p)) return {ok:true,status:200,json:async()=>state};
  if(/\/ms\/test/.test(p)) return {ok:true,status:200,json:async()=>({ok:true,file:'Leads.xlsx',tables:['LeadsTable'],headers:['Nome','Note'],mapped:['Nome'],unknown:['Note'],wroteTestRow:false,ms:state.ms})};
  return {ok:true,status:200,json:async()=>({ok:true})};
};
w.eval(fs.readFileSync(D+'i18n.js','utf8'));
w.eval(fs.readFileSync(D+'data.js','utf8'));
w.eval(fs.readFileSync(D+'app.js','utf8'));

const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  await wait(120);
  const t=w.document.body.textContent;
  const need=['Microsoft 365','Authorise Bizca','Choose the file','Leads.xlsx','LeadsTable','Send leads to Excel'];
  let bad=need.filter(s=>t.indexOf(s)<0);
  console.log(bad.length?'MISSING: '+bad.join(' | '):'ok  Microsoft card renders');
  console.log(/simulated/i.test(t)?'FAIL still says simulated':'ok  no "simulated" wording left');
  const ids=['msConsent','msUrl','msResolve','msTable','msTest','msTestRow','msOn'];
  const miss=ids.filter(i=>!w.document.getElementById(i));
  console.log(miss.length?'MISSING controls: '+miss.join(','):'ok  all controls present');
  // click Test connection and confirm the report renders
  w.document.getElementById('msTest').click();
  await wait(120);
  const t2=w.document.body.textContent;
  console.log(/Connection works/.test(t2)?'ok  test result rendered':'FAIL no test result: '+t2.slice(0,200));
  console.log(/1 of 2 columns matched/.test(t2)?'ok  column report':'FAIL column report');
  console.log(/not recognised, left blank: Note/.test(t2)?'ok  unknown columns listed':'FAIL unknown cols');
  const errs=[]; w.addEventListener&&0;
  process.exit(0);
})().catch(e=>{console.log('CRASH',e.message);process.exit(1)});
