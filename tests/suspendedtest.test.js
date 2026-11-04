/* Azienda sospesa dal superadmin: l'app esce e lo dice. */
const fs=require('fs'), {JSDOM}=require('jsdom');
const D=require('path').join(__dirname,'..')+'/';
const html=fs.readFileSync(D+'index.html','utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'');
let fail=0; const ck=(c,m)=>{ if(c) console.log('  ok  '+m); else {console.log('  FAIL '+m); fail++;} };
(async()=>{
  console.log('\nAzienda sospesa\n');
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://bizca.bryan.it/#/home',pretendToBeVisual:true});
  const w=dom.window;
  w.localStorage.setItem('bizca-token','tok'); w.localStorage.setItem('bizca-lang','it');
  w.fetch=async(u)=>{ if(/\/state/.test(String(u))) return {ok:false,status:403,json:async()=>({error:'This workspace is suspended — contact Bryan',suspended:true})};
    return {ok:true,status:200,json:async()=>({})}; };
  w.eval(fs.readFileSync(D+'i18n.js','utf8')); w.eval(fs.readFileSync(D+'data.js','utf8')); w.eval(fs.readFileSync(D+'app.js','utf8'));
  await new Promise(r=>setTimeout(r,600));
  ck(!w.localStorage.getItem('bizca-token'),'il token viene tolto dal dispositivo');
  ck(/#\/(login|welcome)/.test(w.location.hash),'torna alla schermata di accesso ('+w.location.hash+')');
  ck(/sospeso/.test(w.document.getElementById('toast').textContent||''),'spiega che lo spazio è sospeso, in italiano');
  if(fail) { console.log('FALLITI '+fail); process.exit(1); }
})();
