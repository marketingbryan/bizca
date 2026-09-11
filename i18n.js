/* Bizca — interface language.

   Keys are the English source strings, so a string that has not been translated
   yet still renders in English instead of breaking. Plurals and sentences that
   carry numbers use symbolic keys (n_*) and live in both tables.

   Which language wins, in order:
     1. the user's own choice, saved on this device
     2. the workspace default set by the admin (companies.locale)
     3. English
*/

window.I18N = (function () {
  const LANGS = [
    { code: 'en', label: 'English' },
    { code: 'it', label: 'Italiano' }
  ];

  /* Plural forms: [singular, plural]. English needs its own table because the
     key is symbolic rather than a sentence. */
  const EN = {
    n_events: ['{n} event', '{n} events'],
    n_users: ['{n} user', '{n} users'],
    n_values: ['{n} value', '{n} values'],
    n_rules: ['{n} rule', '{n} rules'],
    n_active_rules: ['{n} active rule', '{n} active rules'],
    n_cards: ['{n} card', '{n} cards'],
    n_tables: ['{n} table', '{n} tables'],
    n_cards_to_finalize: ['{n} card to finalize', '{n} cards to finalize'],
    n_leads_assigned: ['{n} lead assigned', '{n} leads assigned'],
    n_leads_exported: ['{n} lead exported', '{n} leads exported'],
    n_leads_queued_offline: ['{n} lead queued (offline) — will sync', '{n} leads queued (offline) — will sync'],
    n_leads_synced: ['{n} queued lead synced', '{n} queued leads synced'],
    n_used_by_leads: ['It is used by {n} lead; its existing value is kept. ', 'It is used by {n} leads; their existing value is kept. '],
    n_leads_at_event: ['{n} lead was captured at this event — it will be kept but lose the event reference.', '{n} leads were captured at this event — they will be kept but lose the event reference.']
  };

  const IT = {
    /* plurals */
    n_events: ['{n} evento', '{n} eventi'],
    n_users: ['{n} utente', '{n} utenti'],
    n_values: ['{n} valore', '{n} valori'],
    n_rules: ['{n} regola', '{n} regole'],
    n_active_rules: ['{n} regola attiva', '{n} regole attive'],
    n_cards: ['{n} biglietto', '{n} biglietti'],
    n_tables: ['{n} tabella', '{n} tabelle'],
    n_cards_to_finalize: ['{n} biglietto da completare', '{n} biglietti da completare'],
    n_leads_assigned: ['{n} lead assegnato', '{n} lead assegnati'],
    n_leads_exported: ['{n} lead esportato', '{n} lead esportati'],
    n_leads_queued_offline: ['{n} lead in coda (offline) — verrà sincronizzato', '{n} lead in coda (offline) — verranno sincronizzati'],
    n_leads_synced: ['{n} lead in coda sincronizzato', '{n} lead in coda sincronizzati'],
    n_used_by_leads: ['È usato da {n} lead, che lo mantiene. ', 'È usato da {n} lead, che lo mantengono. '],
    n_leads_at_event: ['{n} lead è stato raccolto a questo evento: resta salvato ma perde il riferimento all\'evento.', '{n} lead sono stati raccolti a questo evento: restano salvati ma perdono il riferimento all\'evento.'],

    /* ---- generic ---- */
    'Back': 'Indietro',
    'Close': 'Chiudi',
    'Cancel': 'Annulla',
    'Delete': 'Elimina',
    'Edit': 'Modifica',
    'Offline': 'Offline',
    'Home': 'Home',
    'Scan': 'Scansiona',
    'Leads': 'Lead',
    'Stats': 'Statistiche',
    'Admin': 'Admin',
    'Seller': 'Commerciale',
    'Account': 'Account',
    'Name': 'Nome',
    'Email': 'Email',
    'Role': 'Ruolo',
    'Company': 'Azienda',
    'Sign out': 'Esci',
    'Data': 'Dati',
    'or': 'oppure',
    '— select —': '— seleziona —',
    'Unnamed': 'Senza nome',
    'unassigned': 'non assegnato',
    'you': 'tu',
    'disabled': 'disattivato',
    'Language': 'Lingua',

    /* ---- welcome / registration ---- */
    'Turn business cards into qualified leads': 'Trasforma i biglietti da visita in lead qualificati',
    'Welcome': 'Benvenuto',
    'Sign in if your company already uses Bizca, or create a new workspace.': 'Accedi se la tua azienda usa già Bizca, oppure crea un nuovo spazio di lavoro.',
    'Sign in': 'Accedi',
    'Register your company': 'Registra la tua azienda',
    'This creates your workspace. You can configure everything else later in Admin.': 'Così crei il tuo spazio di lavoro. Tutto il resto lo configuri dopo, dalla sezione Admin.',
    'Company name': 'Nome azienda',
    'Company domain': 'Dominio aziendale',
    'Your admin account': 'Il tuo account amministratore',
    'Full name': 'Nome e cognome',
    'Work email': 'Email di lavoro',
    'Password': 'Password',
    'At least 8 characters': 'Almeno 8 caratteri',
    'privacy policy': 'informativa privacy',
    'Create workspace': 'Crea spazio di lavoro',
    'Creating…': 'Creazione…',
    'Fill in the required fields': 'Compila i campi obbligatori',
    'Enter a valid email address': 'Inserisci un indirizzo email valido',
    'Password must be at least 8 characters': 'La password deve avere almeno 8 caratteri',
    'Please accept the privacy policy to continue': 'Accetta l\'informativa privacy per continuare',

    /* ---- email confirmation ---- */
    'One last step': 'Ultimo passaggio',
    'Check your inbox': 'Controlla la posta',
    'Go to sign in': 'Vai all\'accesso',
    'Resend email': 'Invia di nuovo',
    'Email sent again': 'Email inviata di nuovo',
    'email not configured': 'email non configurata',
    'the confirmation email could not be sent': 'non è stato possibile inviare l\'email di conferma',

    /* ---- login ---- */
    'Event Leads to CRM': 'Dai contatti in fiera al CRM',
    'Sign in with Microsoft': 'Accedi con Microsoft',
    'Access is limited to users invited by your admin.': 'L\'accesso è riservato agli utenti invitati dall\'amministratore.',
    'Enter your work email and password': 'Inserisci email di lavoro e password',
    'Signing in…': 'Accesso in corso…',
    'Signed in with Google': 'Accesso effettuato con Google',
    'Google sign-in not configured yet.': 'Accesso con Google non ancora configurato.',
    'Google sign-in unavailable.': 'Accesso con Google non disponibile.',
    'Microsoft SSO is enabled once your IT completes the Azure AD setup': 'L\'accesso Microsoft si attiva quando il vostro IT completa la configurazione su Entra ID',

    /* ---- home ---- */
    'Install Bizca on your device': 'Installa Bizca sul tuo dispositivo',
    'Active event': 'Evento attivo',
    'Switch event': 'Cambia evento',
    'No event yet': 'Nessun evento',
    'Create event': 'Crea evento',
    'Ask your admin to create one.': 'Chiedi all\'amministratore di crearne uno.',
    'Scan a business card': 'Scansiona un biglietto',
    'My leads': 'I miei lead',
    'Quick status': 'Situazione',
    'Captured total': 'Raccolti in totale',
    'Ready to send': 'Pronti da inviare',
    'no presets': 'nessun preset',
    'Select active event': 'Scegli l\'evento attivo',
    'Presets pre-fill qualification fields.': 'I preset precompilano i campi di qualifica.',
    'Active event updated': 'Evento attivo aggiornato',

    /* ---- scan ---- */
    'Event': 'Evento',
    'Scan card': 'Scansiona biglietto',
    'Batch': 'Sequenza',
    'Point at a business card': 'Inquadra un biglietto da visita',
    'Capture card': 'Scatta',
    'Choose from gallery': 'Scegli dalla galleria',
    'Reading card with AI…': 'Lettura del biglietto…',
    'Batch queue': 'Coda',
    'Card read with AI': 'Biglietto letto',
    'Could not read image': 'Immagine non leggibile',
    'none': 'nessuno',

    /* ---- lead ---- */
    'Lead': 'Lead',
    'Contact': 'Contatto',
    'AI extracted': 'estratto con AI',
    'Confirm or fix the fields below.': 'Conferma o correggi i campi qui sotto.',
    'First name': 'Nome',
    'Last name': 'Cognome',
    'Phone': 'Telefono',
    'Website': 'Sito web',
    'Address': 'Indirizzo',
    'Qualification': 'Qualifica',
    'Required before sending. Managed as closed lists by admin.': 'Obbligatoria prima dell\'invio. Le liste sono gestite dall\'amministratore.',
    'Source': 'Provenienza',
    'Country': 'Paese',
    'Segment': 'Segmento',
    'Assignment': 'Assegnazione',
    'Owner (seller)': 'Titolare (commerciale)',
    'You can override the suggested owner.': 'Puoi sovrascrivere il titolare suggerito.',
    'Save draft': 'Salva bozza',
    'Draft saved': 'Bozza salvata',
    'Retry send': 'Riprova invio',
    'Send to Brevo': 'Invia a Brevo',
    'Sending…': 'Invio in corso…',
    'Send failed': 'Invio non riuscito',
    'Fill all required qualification fields': 'Compila tutti i campi di qualifica obbligatori',
    'Consent signature required before sending': 'Serve la firma del consenso prima di inviare',
    'Offline — queued, will sync automatically': 'Offline: il lead è in coda e verrà sincronizzato',
    'Brevo send failed — see details': 'Invio a Brevo non riuscito: apri il lead per i dettagli',
    'Delivery': 'Consegna',
    'No delivery records.': 'Nessun invio registrato.',
    'Owner': 'Titolare',
    'Captured by': 'Raccolto da',
    'Fallback → default owner': 'Nessuna regola → titolare predefinito',
    'any country': 'qualsiasi paese',
    'any segment': 'qualsiasi segmento',
    'any': 'qualsiasi',
    'override': 'sovrascritto',

    /* ---- consent ---- */
    'Consent': 'Consenso',
    'Consent signed': 'Consenso firmato',
    'signed': 'firmato',
    'No consent captured.': 'Nessun consenso raccolto.',
    'Re-sign': 'Firma di nuovo',
    'Clear': 'Cancella',
    'Save signature': 'Salva firma',
    'Please sign first': 'Prima firma nel riquadro',
    'Consent captured': 'Consenso raccolto',

    /* ---- leads list ---- */
    'All': 'Tutti',
    'All company leads': 'Tutti i lead aziendali',
    'No leads here yet.': 'Ancora nessun lead qui.',
    'Scan a card': 'Scansiona un biglietto',

    /* ---- batch ---- */
    'Apply preset': 'Applica preset',
    'Auto-assign': 'Assegna in automatico',
    'complete': 'completo',
    'missing fields': 'campi mancanti',
    'Queue is empty.': 'La coda è vuota.',
    'Capture cards': 'Scatta biglietti',
    'No active event': 'Nessun evento attivo',
    'Preset applied to queue': 'Preset applicato alla coda',
    'Select at least one lead': 'Seleziona almeno un lead',

    /* ---- dashboard ---- */
    'Dashboard': 'Cruscotto',
    'Company overview': 'Quadro aziendale',
    'My performance': 'I miei risultati',
    'Total leads': 'Lead totali',
    'Sent to CRM': 'Inviati al CRM',
    'Errors': 'Errori',
    'Send rate': 'Tasso di invio',
    'Leads delivered to Brevo + Excel': 'Lead consegnati a Brevo ed Excel',
    'By status': 'Per stato',
    'Leads by event': 'Lead per evento',
    'Leads by owner': 'Lead per titolare',
    'Auto-assigned': 'Assegnati in automatico',
    'Manual override': 'Sovrascritti a mano',
    'Export CSV': 'Esporta CSV',
    'Open Excel': 'Apri Excel',

    /* ---- admin home ---- */
    'Events': 'Eventi',
    'Team & access': 'Team e accessi',
    'Sources': 'Provenienze',
    'Segments': 'Segmenti',
    'Assignment rules': 'Regole di assegnazione',
    'Destinations': 'Destinazioni',
    'Brevo connected': 'Brevo collegato',
    'Brevo not configured': 'Brevo non configurato',
    'Reset app data on this device': 'Azzera i dati su questo dispositivo',
    'Clears locally-saved leads and configuration on this device. Does not affect Brevo.': 'Cancella lead e impostazioni salvati su questo dispositivo. Non tocca Brevo.',
    'Reset app data?': 'Azzerare i dati?',
    'This clears all locally-saved leads and settings on this device. It does not affect Brevo.': 'Cancella tutti i lead e le impostazioni salvati su questo dispositivo. Non tocca Brevo.',
    'Yes, reset': 'Sì, azzera',

    /* ---- team ---- */
    'Add user': 'Aggiungi utente',
    'They can then sign in with Google or their work email.': 'Potrà accedere con Google o con la sua email di lavoro.',
    'Enter a valid email': 'Inserisci un\'email valida',
    'That user already exists': 'Questo utente esiste già',
    'User added — invitation email sent': 'Utente aggiunto: email di invito inviata',
    'You cannot disable your own account': 'Non puoi disattivare il tuo account',
    'Keep at least one active admin': 'Serve almeno un amministratore attivo',
    'Keep at least one admin': 'Serve almeno un amministratore',
    'Enable / disable': 'Attiva / disattiva',
    'make seller': 'rendi commerciale',
    'make admin': 'rendi admin',
    'active': 'attivo',

    /* ---- picklists ---- */
    'Visible to sellers': 'Visibile ai commerciali',
    'Hidden — kept on existing leads': 'Nascosto, resta sui lead già salvati',
    'Show / hide': 'Mostra / nascondi',
    'delete': 'elimina',
    'No values yet. Add the first one below.': 'Ancora nessun valore. Aggiungi il primo qui sotto.',
    'Add value': 'Aggiungi valore',
    'Add': 'Aggiungi',
    'Type a value first': 'Scrivi prima un valore',
    'That value already exists': 'Questo valore esiste già',
    'Value added': 'Valore aggiunto',
    'Value deleted': 'Valore eliminato',
    'It will no longer be selectable.': 'Non sarà più selezionabile.',

    /* ---- rules ---- */
    'Add rule': 'Aggiungi regola',
    'New rule': 'Nuova regola',
    'Edit rule': 'Modifica regola',
    'Save rule': 'Salva regola',
    'Pick one or more values. Leave a list empty to match anything.': 'Scegli uno o più valori. Lascia vuota una lista per accettare qualsiasi valore.',
    'Countries': 'Paesi',
    'Assign to': 'Assegna a',
    'No segments defined yet': 'Nessun segmento ancora definito',
    'Default owner': 'Titolare predefinito',
    'Used when no rule matches.': 'Usato quando nessuna regola corrisponde.',
    'Override': 'Sovrascrittura',
    'Allow sellers to change the owner on a lead': 'Consenti ai commerciali di cambiare il titolare di un lead',
    'Add a user first': 'Aggiungi prima un utente',
    'Pick at least one country or segment': 'Scegli almeno un paese o un segmento',
    'Rule added': 'Regola aggiunta',
    'Rule saved': 'Regola salvata',
    'Rule deleted': 'Regola eliminata',
    'Up': 'Su',
    'enabled': 'attiva',

    /* ---- destinations ---- */
    'Create/update contact, dedupe by email, BIZCA_* attributes, list per event': 'Crea o aggiorna il contatto, deduplica per email, attributi BIZCA_*, una lista per evento',
    'Append a row to a named table in your shared workbook, via Microsoft Graph': 'Aggiunge una riga a una tabella nominata del vostro file condiviso, via Microsoft Graph',
    'live': 'attiva',
    'ready — not enabled': 'pronta, non attiva',
    'not configured': 'non configurata',
    'Brevo account (API key)': 'Account Brevo (chiave API)',
    'Brevo API key': 'Chiave API Brevo',
    'Save key': 'Salva chiave',
    'Use server default': 'Usa quella predefinita',
    'Enter a key': 'Inserisci una chiave',
    'Brevo key saved': 'Chiave Brevo salvata',
    'Brevo key removed': 'Chiave Brevo rimossa',
    'not set — using server default': 'non impostata, si usa quella predefinita',
    'Sending & consent': 'Invio e consenso',
    'Auto-send when lead is Ready': 'Invia automaticamente quando il lead è Pronto',
    'Require consent signature before sending': 'Richiedi la firma del consenso prima dell\'invio',
    'Brevo attributes': 'Attributi Brevo',
    'Prepare Brevo attributes': 'Prepara gli attributi Brevo',
    'Preparing…': 'Preparazione…',

    /* ---- Microsoft / Excel ---- */
    'Microsoft 365 — Excel on SharePoint': 'Microsoft 365 — Excel su SharePoint',
    'Authorise Bizca': 'Autorizza Bizca',
    'Choose the file': 'Scegli il file',
    'Check and switch on': 'Verifica e attiva',
    'Grant admin consent': 'Concedi il consenso amministratore',
    'Re-run consent': 'Ripeti il consenso',
    'Tenant authorised': 'Tenant autorizzato',
    'Our IT registered their own app': 'Il nostro IT ha registrato un\'app propria',
    'Directory (tenant) ID': 'Directory (tenant) ID',
    'Application (client) ID': 'Application (client) ID',
    'Client secret': 'Client secret',
    'Save app details': 'Salva i dati dell\'app',
    'Remove credentials': 'Rimuovi le credenziali',
    'Link to the Excel file': 'Link al file Excel',
    'Open file': 'Apri file',
    'File': 'File',
    'Table to write into': 'Tabella in cui scrivere',
    'Test connection': 'Prova la connessione',
    'Write a test row': 'Scrivi una riga di prova',
    'Send leads to Excel': 'Invia i lead a Excel',
    'Checking…': 'Verifica…',
    'Writing…': 'Scrittura…',
    'Opening…': 'Apertura…',
    'Saving…': 'Salvataggio…',
    'Saved': 'Salvato',
    'Connection OK': 'Connessione riuscita',
    'Test row written': 'Riga di prova scritta',
    'Tenant ID is required': 'Il Directory (tenant) ID è obbligatorio',
    'Credentials removed': 'Credenziali rimosse',
    'Paste the link to the Excel file': 'Incolla il link al file Excel',
    'Table set': 'Tabella impostata',
    'Finish steps 1 and 2 first': 'Completa prima i passi 1 e 2',
    'Microsoft tenant authorised': 'Tenant Microsoft autorizzato',
    'Consent was not granted': 'Consenso non concesso',
    'Complete the approval in the Microsoft window, then come back': 'Completa l\'approvazione nella finestra Microsoft, poi torna qui',
    'Opened, but no named table found': 'File aperto, ma non contiene tabelle',

    /* ---- events ---- */
    'Create new event': 'Crea nuovo evento',
    'Event name': 'Nome evento',
    'Start date': 'Data di inizio',
    'End date': 'Data di fine',
    'Delete event': 'Elimina evento',
    'Delete event?': 'Eliminare l\'evento?',
    'This event has no leads.': 'Questo evento non ha lead.',
    'Event created': 'Evento creato',
    'Event deleted': 'Evento eliminato',
    'Enter an event name': 'Inserisci il nome dell\'evento',
    'You can set presets and the Brevo list right after.': 'Subito dopo potrai impostare i preset e la lista Brevo.',
    'no dates set': 'nessuna data',
    'set active': 'rendi attivo',
    'Brevo destination list': 'Lista Brevo di destinazione',
    'List cleared': 'Lista rimossa',
    'Loading your Brevo lists…': 'Caricamento delle liste Brevo…',
    'No lists found in your Brevo account.': 'Nessuna lista trovata nel tuo account Brevo.',
    'No events yet. Create your first trade show or event.': 'Ancora nessun evento. Crea la tua prima fiera.',
    '— none —': '— nessuna —',

    /* ---- language picker ---- */
    'Interface language': 'Lingua dell\'interfaccia',
    'Workspace default language': 'Lingua predefinita dello spazio di lavoro',
    'New users see this language until they change it.': 'I nuovi utenti vedranno questa lingua finché non la cambiano.',
    'Use the workspace default': 'Usa la lingua predefinita',
    'Language updated': 'Lingua aggiornata'
  };

  /* Country names are stored in English on the lead and sent that way to Brevo
     and Excel — only the label on screen changes. Anything not listed here falls
     back to the English name. */
  const COUNTRIES_IT = {
    'Afghanistan':'Afghanistan','Albania':'Albania','Algeria':'Algeria','Argentina':'Argentina','Australia':'Australia',
    'Austria':'Austria','Bahrain':'Bahrein','Bangladesh':'Bangladesh','Belgium':'Belgio','Bolivia':'Bolivia',
    'Bosnia and Herzegovina':'Bosnia ed Erzegovina','Brazil':'Brasile','Bulgaria':'Bulgaria','Cambodia':'Cambogia',
    'Canada':'Canada','Chile':'Cile','China':'Cina','Colombia':'Colombia','Costa Rica':'Costa Rica','Croatia':'Croazia',
    'Cyprus':'Cipro','Czechia':'Repubblica Ceca','Denmark':'Danimarca','Dominican Republic':'Repubblica Dominicana',
    'Ecuador':'Ecuador','Egypt':'Egitto','Estonia':'Estonia','Finland':'Finlandia','France':'Francia','Georgia':'Georgia',
    'Germany':'Germania','Ghana':'Ghana','Greece':'Grecia','Guatemala':'Guatemala','Hong Kong':'Hong Kong',
    'Hungary':'Ungheria','Iceland':'Islanda','India':'India','Indonesia':'Indonesia','Iraq':'Iraq','Ireland':'Irlanda',
    'Israel':'Israele','Italy':'Italia','Japan':'Giappone','Jordan':'Giordania','Kazakhstan':'Kazakistan','Kenya':'Kenya',
    'Kuwait':'Kuwait','Latvia':'Lettonia','Lebanon':'Libano','Lithuania':'Lituania','Luxembourg':'Lussemburgo',
    'Malaysia':'Malesia','Malta':'Malta','Mexico':'Messico','Moldova':'Moldavia','Montenegro':'Montenegro',
    'Morocco':'Marocco','Netherlands':'Paesi Bassi','New Zealand':'Nuova Zelanda','Nigeria':'Nigeria',
    'North Macedonia':'Macedonia del Nord','Norway':'Norvegia','Oman':'Oman','Pakistan':'Pakistan','Panama':'Panama',
    'Paraguay':'Paraguay','Peru':'Perù','Philippines':'Filippine','Poland':'Polonia','Portugal':'Portogallo',
    'Qatar':'Qatar','Romania':'Romania','Saudi Arabia':'Arabia Saudita','Serbia':'Serbia','Singapore':'Singapore',
    'Slovakia':'Slovacchia','Slovenia':'Slovenia','South Africa':'Sudafrica','South Korea':'Corea del Sud',
    'Spain':'Spagna','Sri Lanka':'Sri Lanka','Sweden':'Svezia','Switzerland':'Svizzera','Taiwan':'Taiwan',
    'Thailand':'Thailandia','Tunisia':'Tunisia','Turkey':'Turchia','Ukraine':'Ucraina',
    'United Arab Emirates':'Emirati Arabi Uniti','United Kingdom':'Regno Unito','United States':'Stati Uniti',
    'Uruguay':'Uruguay','Venezuela':'Venezuela','Vietnam':'Vietnam'
  };

  const DICT = { en: EN, it: IT };

  let lang = 'en';
  let fallbackLang = 'en';
  const missing = new Set();
  const listeners = [];

  function normalise(code) {
    const c = String(code || '').toLowerCase().slice(0, 2);
    return LANGS.some(l => l.code === c) ? c : '';
  }

  function lookup(key) {
    const table = DICT[lang];
    if (table && Object.prototype.hasOwnProperty.call(table, key)) return table[key];
    if (lang !== 'en') missing.add(key);
    return null;
  }

  function fill(str, vars) {
    if (!vars) return str;
    return String(str).replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : vars[k]));
  }

  // t('Sign in')  ·  t('Sent to {name}', { name: 'Brevo' })
  function t(key, vars) {
    const hit = lookup(key);
    return fill(hit == null ? key : hit, vars);
  }

  // tp('n_events', 3) → "3 eventi"
  function tp(key, n, vars) {
    const table = DICT[lang] || DICT.en;
    const forms = (table && table[key]) || DICT.en[key];
    if (!forms) { missing.add(key); return String(n); }
    const form = Math.abs(Number(n)) === 1 ? forms[0] : forms[1];
    return fill(form, Object.assign({ n: n }, vars || {}));
  }

  function setLang(code) {
    const c = normalise(code) || fallbackLang;
    if (c === lang) return lang;
    lang = c;
    listeners.forEach(fn => { try { fn(lang); } catch (e) {} });
    return lang;
  }
  function setFallback(code) { fallbackLang = normalise(code) || 'en'; }

  return {
    LANGS,
    t, tp,
    country: name => (lang === 'it' && COUNTRIES_IT[name]) || name,
    setLang, setFallback,
    get lang() { return lang; },
    label: code => (LANGS.find(l => l.code === code) || {}).label || code,
    normalise,
    onChange: fn => listeners.push(fn),
    missingKeys: () => Array.from(missing),
    _dict: DICT
  };
})();
