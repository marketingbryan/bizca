/* Regola: nei sistemi esterni (Excel, Brevo) i valori vanno in inglese;
   a schermo si traducono. Qui si controlla l'invariante nel sorgente e la
   resa a schermo, perché finishScan non è raggiungibile dall'esterno. */
const fs=require('fs');
const D=require('path').join(__dirname,'..')+'/';
const app=fs.readFileSync(D+'app.js','utf8');
let fail=0; const ck=(c,m)=>{ if(c) console.log('  ok  '+m); else {console.log('  FAIL '+m); fail++;} };

console.log('\nValori memorizzati in inglese\n');

ck(/const sourceValue = \(\) => captureType\(\) === 'meeting' \? 'Personal meeting' : 'Event';/.test(app),
   'sourceValue restituisce le due stringhe inglesi');
ck(/provenienza: sourceValue\(\)/.test(app),
   'l\'acquisizione salva sourceValue, non l\'etichetta tradotta');
ck(!/provenienza: sourceLabel\(\)/.test(app),
   'l\'etichetta tradotta non viene mai salvata');
ck(/if\(!l\.provenienza\)l\.provenienza=sourceValue\(\);/.test(app),
   'anche il preset del batch salva il valore inglese');
ck(/sourceDisplay\(l\.provenienza\)/.test(app),
   'a schermo la provenienza passa dalla traduzione');

// gli stati restano inglesi nel dato e tradotti a schermo
ck(/'Captured':\s*\{ pill:'gray'/.test(app) && /const STATUS_IT =/.test(app),
   'gli stati restano inglesi nel dato, con etichette tradotte a parte');
ck(/l\.status = requiredFilled\(l\)\?'Ready':'To finalize'/.test(app),
   'gli stati scritti sul lead sono in inglese');

// i paesi si salvano in inglese e si mostrano tradotti
ck(/const tc = c => I18N\.country\(c\);/.test(app), 'i paesi hanno una funzione di sola visualizzazione');
ck(/optList\(DB\.countries, l\.country, tc\)/.test(app), 'il menu paesi mostra le etichette ma salva il valore inglese');

// il template Excel è in inglese e resta compatibile con entrambe le lingue
const ms=fs.readFileSync(D+'server/ms.js','utf8');
['captured','event','firstname','lastname','company','role','email','phone','website','address',
 'source','country','segment','assignedto','capturedby','status','consent','newsletter']
 .forEach(k=>{ ck(ms.indexOf(k+':')>=0 || ms.indexOf("'"+k+"'")>=0 || new RegExp('\\b'+k+'\\b').test(ms),
   'il connettore riconosce l\'intestazione inglese "'+k+'"'); });

console.log(fail?('\n'+fail+' FALLITI\n'):'\ntutto verde\n');
process.exit(fail?1:0);
