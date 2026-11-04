# Bizca — riferimento tecnico

App per raccogliere i biglietti da visita in fiera: foto → lettura AI → qualifica → invio a **Brevo** e a un **Excel su SharePoint**. Multi-azienda: ogni cliente ha il suo spazio, isolato dagli altri.

Questa cartella è tutto il codice di Bizca: è il repository GitHub che si pubblica, e contiene anche test e note.

---

## Dove gira

| Pezzo | Dove | Indirizzo |
|---|---|---|
| App (PWA) | Vercel | https://bizca.bryan.it · anche https://bizca.vercel.app |
| Funzioni `api/*` | Vercel (serverless) | `/api/...` sullo stesso dominio |
| Backend `server/` | Railway | https://bizca-production.up.railway.app |
| Database | Railway Postgres | rete privata di Railway, non esposto |
| Repository | GitHub | `marketingbryan/bizca` |

Chi fa cosa:

- **App → backend Railway**: login, dati condivisi (`GET /state`), salvataggio lead, utenti, eventi, liste, impostazioni, Excel (`/ms/*`), accesso Microsoft (`/auth/microsoft/*`).
- **App → funzioni Vercel**: lettura del biglietto (`/api/scan`, OpenAI), invio a Brevo (`/api/send-brevo`), liste Brevo, creazione attributi Brevo, configurazione pubblica (`/api/config`).
- **Backend → Microsoft Graph**: scrittura delle righe Excel. Il client secret non arriva mai al browser.

## Struttura

```
index.html            shell + service worker con aggiornamento automatico
app.js                tutta l'app: router a hash, schermate, invio, coda offline
i18n.js               traduzioni IT/EN, plurali, nomi dei paesi
data.js               stato iniziale vuoto (l'app parte non configurata)
styles.css            design system
super.html, super.js  console superadmin (solo Bryan)
sw.js                 cache offline — alza CACHE a ogni modifica del frontend
manifest.webmanifest  PWA
*.png, *.svg          logo e icone
api/                  funzioni Vercel
server/               backend Railway (+ i suoi test *.test.js)
tests/                test del frontend in jsdom
.vercelignore         tiene server, test e note fuori da Vercel
```

## Come si lavora

1. Modifica i file in questa cartella.
2. Lancia i test: `cd tests && npm install && npm test` (deve finire con *All green*). Il backend non ha bisogno di `npm install` per i test.
3. Se hai toccato il frontend, alza `CACHE` in `sw.js`. Se hai toccato il backend, alza `BUILD` in `server/index.js`.
4. Commit + push con GitHub Desktop. Vercel pubblica l'app e `api/`, Railway ricostruisce `server/`.
5. Verifica: `https://bizca-production.up.railway.app/health` deve mostrare il nuovo `build`. L'app si aggiorna da sola sui telefoni entro un minuto.

Nota: su Railway il deploy automatico era spento fino al 25 settembre 2026, ora è acceso. Se `/health` non cambia dopo il push, controlla Railway → servizio → Settings → Source → *Auto deploy*.

## Provarla in locale

```bash
python3 -m http.server 8080      # da questa cartella
```

Le schermate si vedono, ma login e dati puntano al backend di produzione (costante `API` in cima ad `app.js`). Per un backend locale servono un Postgres e le variabili qui sotto:

```bash
cd server && npm install && DATABASE_URL=... JWT_SECRET=... node index.js
```

## Variabili d'ambiente

Solo i nomi: i valori stanno su Railway e Vercel e non vanno mai scritti nel codice.

**Railway (backend)**

| Nome | A cosa serve |
|---|---|
| `DATABASE_URL` | Postgres (riferimento `${{Postgres.DATABASE_URL}}`) |
| `JWT_SECRET` | firma delle sessioni. Se manca, ne viene generato uno casuale e le sessioni si azzerano a ogni riavvio |
| `APP_URL` | `https://bizca.bryan.it` — link nelle email e ritorni da Microsoft |
| `API_URL` | `https://bizca-production.up.railway.app` — link di conferma email |
| `BREVO_TRANSACTIONAL_KEY` | invio delle email di sistema (conferma, invito) |
| `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` | mittente delle email (`info@bryan.it`) |
| `GOOGLE_CLIENT_ID` | verifica dell'accesso con Google |
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | app Microsoft **condivisa** di Bryan: oggi non impostate, ogni cliente usa la sua |
| `MS_REDIRECT_URI` / `MS_LOGIN_REDIRECT_URI` | facoltative, sovrascrivono gli indirizzi di ritorno Microsoft |
| `BIZCA_TZ` | fuso orario delle date in Excel, predefinito `Europe/Rome` |
| `SUPERADMIN_EMAILS` | facoltativa: chi può entrare nella console superadmin, separati da virgola. Predefinito `max@bryan.it,davide.berardino@bryan.it` |

**Vercel (app e funzioni)**

| Nome | A cosa serve |
|---|---|
| `OPENAI_API_KEY` | lettura dei biglietti in `api/scan` |
| `GOOGLE_CLIENT_ID` | pulsante Google nell'app |
| `BIZCA_API_URL` | facoltativa, backend usato da `api/scan` per verificare la sessione |

La **chiave Brevo di ogni cliente** non è una variabile d'ambiente: la inserisce il suo admin in Admin → Destinazioni e viene salvata nel database.

## Console superadmin (solo Bryan)

Indirizzo: **https://bizca.bryan.it/super.html**. Pagina separata dall'app (`super.html` + `super.js`, backend in `server/superadmin.js`).

- **Accesso**: solo gli indirizzi in `SUPERADMIN_EMAILS`, con un magic link via email. Il link vale una volta, scade in 15 minuti, nel database c'è solo il suo hash e il token viaggia dopo il `#`, quindi non finisce nei log.
- **Sessione**: 8 ore, token con `k:'super'`. L'API dell'app rifiuta ogni token con `k`, quindi la sessione superadmin non apre l'app e una sessione dell'app non apre la console. L'elenco degli indirizzi viene ricontrollato a ogni richiesta: togliere un indirizzo dalla variabile chiude subito le sue sessioni.
- **Cosa si fa**: vedere tutte le aziende con utenti, lead e collegamenti; creare un'azienda con il primo admin; aggiungere utenti; generare link d'invito o di reimpostazione password, da copiare o mandare per email; cambiare ruolo; disattivare e rimuovere utenti (i lead passano a un altro admin); sospendere o eliminare un'azienda (per eliminare va scritto il nome esatto).
- **Sospensione**: `companies.status = 'suspended'`. Il middleware `auth` blocca subito tutti gli utenti di quell'azienda (403 `suspended`) e l'app li riporta al login con un messaggio.
- **Entra come**: da un utente della console si apre l'app con i suoi permessi. La console riceve un codice monouso valido 60 secondi e l'app lo scambia con `POST /auth/impersonate`: nell'indirizzo passa il codice, mai il token. La sessione vale 2 ore, ha `imp:<email del superadmin>` e passa anche su account disattivati e aziende sospese. Si chiude subito se l'indirizzo esce da `SUPERADMIN_EMAILS`. Ogni scrittura fatta così finisce in `super_audit` come `as-user`. Nell'app compare una barra scura con «Esci», che restituisce la sessione che c'era prima sul dispositivo (`bizca-token-prev`). Se sul dispositivo ci sono lead non sincronizzati, il cambio di utente viene rifiutato: non devono finire in un'altra azienda.
- **Registro**: ogni accesso e ogni modifica finisce in `super_audit` e si vede in fondo alla console.

## Accesso con Microsoft e ingresso automatico

- Chi è invitato entra con «Accedi con Microsoft» (scrive prima l'email: serve a trovare l'app Microsoft della sua azienda).
- **Ingresso automatico** (`settings.msAutoJoin`, interruttore in Admin → Destinazioni, passo 4, o nella console superadmin): chi non è invitato ma entra con un account del tenant Microsoft dell'azienda **e** ha un indirizzo su uno dei domini dell'azienda viene creato come commerciale.
- Domini dell'azienda = `companies.domain` + `companies.extra_domains`. Gli extra li imposta solo il superadmin, e un dominio può appartenere a una sola azienda. Se due aziende rivendicano lo stesso dominio con l'ingresso automatico acceso, non entra nessuno in automatico.
- I controlli stanno in `server/msauth.js`: tenant (`tid`) e app (`aud`) dal token di Microsoft, dominio dell'email nei claim (tiene fuori gli ospiti con indirizzi esterni), azienda non sospesa, email non già usata altrove.

## Regole da non rompere

Sono decisioni prese col cliente o correzioni di difetti reali. I test le verificano quasi tutte.

- **Dati in inglese, schermo tradotto.** Stati (`Sent`, `To finalize`…), paesi (`Germany`) e provenienza (`Event` / `Personal meeting`) si salvano in inglese, perché finiscono in Brevo e nell'Excel del cliente, che è in inglese. Si traducono solo a schermo: `statusLabel()`, `tc()`, `sourceDisplay()`.
- **Sessione di raccolta.** Prima di scansionare si sceglie Evento o Meeting personale:
  - evento, senza newsletter → lista Brevo dell'evento;
  - evento, con newsletter → lista dell'evento + lista newsletter;
  - meeting, senza newsletter → nessuna lista (il contatto viene comunque creato);
  - meeting, con newsletter → solo lista newsletter.

  La lista newsletter la sceglie l'admin in Admin → Destinazioni.
- **Titolare** = chi acquisisce, cambiabile con «Assegna a». Niente regole automatiche.
- **Segmenti multipli**, salvati come testo separato da virgole in `lead.interesse`.
- **Excel**:
  - la riga si scrive all'invio;
  - solo se il lead risulta `Sent` nel database;
  - una sola volta per lead (controllo sul `sync_log`);
  - le righe fallite si riprovano da sole;
  - le colonne si abbinano per nome, in italiano o in inglese (`HEADER_MAP` in `ms.js`).
- **Sicurezza**:
  - ogni query filtra per `company_id`, e ruolo e stato dell'utente si leggono dal database a ogni richiesta;
  - i token con un campo `k` sono token di stato (Microsoft, consenso) e non valgono mai come sessione;
  - gli id dei lead sono casuali e il server rifiuta id già usati da un'altra azienda;
  - le immagini accettate sono solo `data:image/…`.
- **Salvataggi**:
  - un lead non confermato dal server resta `_dirty`;
  - `pullState` fonde i lead locali non salvati invece di sovrascriverli;
  - `flushQueued` rimanda in ordine: salvataggi, invii in coda, righe Excel.
- **Traduzioni**: ogni testo visibile passa da `t('…')` e ha la sua voce in `i18n.js`. Il test `i18ntest` fallisce se ne manca una.
- **Icone SVG**: non hanno dimensione propria. Senza una regola CSS si allargano: `iconsizes` lo controlla.
