/* Bizca — app logic. The shared backend is the source of truth;
   localStorage is only an offline cache of what the server sent. */
(function () {
  const DB = window.DB, S = window.SESSION;
  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  let scanIndex = 0, batchMode = false;

  /* ---------- backend ---------- */
  const API = 'https://bizca-production.up.railway.app';
  const TOKEN_KEY = 'bizca-token';
  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
  const setToken = t => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} };

  async function api(method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (res.status === 401) { setToken(''); S.user = null; }
    if (!res.ok) { const err = new Error(data.error || ('Request failed (' + res.status + ')')); err.status = res.status; err.data = data; throw err; }
    return data;
  }

  // Pull the whole workspace from the server into the in-memory model
  async function pullState() {
    const d = await api('GET', '/state');
    DB.company = Object.assign({}, d.company, { configured: true });
    if (d.me && d.me.locale) { try { localStorage.setItem(LANG_KEY, d.me.locale); } catch (e) {} }
    DB.users = d.users || [];
    DB.events = (d.events || []).map(e => Object.assign({}, e, { preset: e.preset || { provenienza: '', country: '', interesse: '' } }));
    DB.pickLists = d.picklists || { provenienza: [], interesse: [] };
    DB.assignmentRules = d.rules || [];
    DB.leads = d.leads || [];
    DB.syncLog = d.syncLog || [];
    const s = d.settings || {};
    DB.autoSend = s.autoSend !== false;
    DB.requireConsent = !!s.requireConsent;
    DB.allowOverride = s.allowOverride !== false;
    DB.brevoApiKey = s.brevoApiKey || '';
    DB.newsletterListId = s.newsletterListId || null;
    DB.ms = d.ms || { enabled: false };
    DB.fallbackOwner = s.fallbackOwner || (DB.users[0] && DB.users[0].id) || null;
    S.user = DB.users.find(u => u.id === d.me.id) || null;
    applyLang();
    if (!S.activeEventId || !DB.events.some(e => e.id === S.activeEventId)) S.activeEventId = DB.events.length ? DB.events[0].id : null;
    saveState();
    return d;
  }

  // Fire-and-forget server writes: the UI stays responsive, errors surface as a toast
  function push(method, path, body) {
    return api(method, path, body).catch(e => { if (e.status !== 401) toast(e.message, 'err'); throw e; });
  }
  // Persist one lead (create or update). Silent on failure: the local copy is kept
  // and will be retried on the next save.
  function saveLead(l) {
    if (!getToken()) return Promise.resolve();
    return api('PUT', '/leads/' + l.id, l).catch(() => {});
  }

  /* If i18n.js failed to load, fall back to the English source strings rather
     than leaving the user with a blank screen. */
  if (!window.I18N) {
    window.I18N = {
      LANGS: [{ code: 'en', label: 'English' }], lang: 'en',
      t: k => k, tp: (k, n) => String(n), country: c => c,
      setLang: () => 'en', setFallback: () => {}, normalise: () => '',
      label: c => c, onChange: () => {}, missingKeys: () => []
    };
  }

  /* ---------- helpers ---------- */
  const t = (k, v) => I18N.t(k, v);        // translate
  const tp = (k, n, v) => I18N.tp(k, n, v); // translate with a count
  const tc = c => I18N.country(c);          // country label (stored value stays English)
  const $ = sel => document.querySelector(sel);
  const esc = s => (s == null ? '' : String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])));
  const go = h => { location.hash = h; };
  const user = () => S.user;
  const isAdmin = () => S.user && S.user.role === 'admin';
  const initials = n => n.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
  const userName = id => (DB.users.find(u => u.id === id) || {}).name || '—';
  const activeEvent = () => DB.events.find(e => e.id === S.activeEventId) || DB.events[0];
  // What this capture session is: a trade show, or a one-to-one meeting.
  const captureType = () => (S.captureType === 'meeting' ? 'meeting' : 'event');
  const sourceLabel = () => captureType() === 'meeting' ? t('Personal meeting') : t('Event');
  /* Where a lead lands in Brevo:
       event   → the list configured for that event, plus the newsletter list if ticked
       meeting → nothing, unless the newsletter is ticked — then only that list
     So the destination follows the choice made before scanning; there is nothing
     to pick by hand, and a meeting contact is never added to an event list. */
  const sessionListId = () => {
    if (captureType() !== 'event') return null;
    const ev = activeEvent();
    return ev && ev.brevoListId ? ev.brevoListId : null;
  };
  const listLabel = id => {
    if (!id) return t('no list');
    const l = (brevoLists || []).find(x => x.id === id);
    return l ? l.name : ((I18N.lang === 'it' ? 'lista #' : 'list #') + id);
  };
  const pick = k => DB.pickLists[k].filter(v => v.active);
  // Segments are multiple. Stored joined so Brevo and Excel keep a plain text
  // column, handled as a list everywhere in the interface.
  const segList = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
  const segJoin = arr => arr.join(', ');

  /* ---------- language ----------
     A personal choice on this device beats the workspace default. Clearing the
     personal choice falls back to whatever the admin set for the company. */
  const LANG_KEY = 'bizca-lang';
  const readUserLang = () => { try { return I18N.normalise(localStorage.getItem(LANG_KEY)); } catch (e) { return ''; } };
  function applyLang() {
    I18N.setFallback(I18N.normalise(DB.company && DB.company.locale) || 'en');
    I18N.setLang(readUserLang() || I18N.normalise(DB.company && DB.company.locale) || 'en');
    document.documentElement.lang = I18N.lang;
  }
  function setUserLang(code) {
    try { code ? localStorage.setItem(LANG_KEY, code) : localStorage.removeItem(LANG_KEY); } catch (e) {}
    applyLang();
    if (getToken()) push('PATCH', '/me', { locale: code || null }).catch(() => {});
  }

  /* ---------- persistence (localStorage) ---------- */
  const STORE_KEY = 'bizca-state-v1';
  function saveState() {
    try {
      const snap = {
        company: DB.company,
        leads: DB.leads, pickLists: DB.pickLists, events: DB.events,
        assignmentRules: DB.assignmentRules, users: DB.users, destinations: DB.destinations,
        fallbackOwner: DB.fallbackOwner, allowOverride: DB.allowOverride, autoSend: DB.autoSend,
        requireConsent: DB.requireConsent, brevoApiKey: DB.brevoApiKey, ms: DB.ms,
        newsletterListId: DB.newsletterListId,
        syncLog: DB.syncLog.slice(0, 300),
        session: { activeEventId: S.activeEventId, captureType: S.captureType, userId: S.user ? S.user.id : null }
      };
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(snap));
      } catch (quota) {
        // Storage full — drop card images oldest-first, then retry
        const clone = JSON.parse(JSON.stringify(snap));
        clone.leads.sort((a, b) => a.ts - b.ts);
        for (const l of clone.leads) {
          if (l.image || l.consentSignature) {
            l.image = null; l.consentSignature = null;
            try { localStorage.setItem(STORE_KEY, JSON.stringify(clone)); return; } catch (e) {}
          }
        }
      }
    } catch (e) {}
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      ['company','leads','pickLists','events','assignmentRules','users','destinations','syncLog'].forEach(k => { if (d[k]) DB[k] = d[k]; });
      ['fallbackOwner','allowOverride','autoSend','requireConsent','brevoApiKey','ms','newsletterListId'].forEach(k => { if (d[k] !== undefined) DB[k] = d[k]; });
      if (d.session) {
        if (d.session.activeEventId) S.activeEventId = d.session.activeEventId;
        if (d.session.captureType) S.captureType = d.session.captureType;
        // only trust a cached session if we still hold a token
        if (d.session.userId && getToken()) { const u = DB.users.find(x => x.id === d.session.userId); if (u) S.user = u; }
      }
    } catch (e) {}
  }
  function resetState() { try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(TOKEN_KEY); } catch (e) {} location.hash = '#/welcome'; location.reload(); }

  /* ---------- connectivity & install ---------- */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; if (window.render) render(); });
  window.addEventListener('online', () => { S.online = true; if (window.render) render(); flushQueued(); });
  window.addEventListener('offline', () => { S.online = false; if (window.render) render(); });
  S.online = (navigator.onLine !== false);

  /* ---------- delivery (Brevo + Excel on SharePoint) ---------- */
  // Excel is written server-side: the Microsoft client secret never reaches the browser.
  async function pushToExcel(l) {
    if (!(DB.ms && DB.ms.enabled)) return null;      // destination off → nothing to log
    if (!getToken()) return { ok: false, msg: 'Not signed in' };
    try {
      const d = await api('POST', '/ms/append', { leadId: l.id });
      if (d && d.skipped) return null;
      return { ok: true, msg: 'Row added to ' + (d.file || 'the shared workbook') };
    } catch (e) { return { ok: false, msg: e.message || 'Graph error' }; }
  }

  async function pushToBrevo(l) {
    const ownerName = userName(l.ownerId);
    const ev = DB.events.find(e => e.id === l.eventId) || {};
    const evName = ev.name || '';
    try {
      const res = await fetch('/api/send-brevo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: DB.brevoApiKey || undefined,
          listId: (l.brevoListId || ev.brevoListId) || undefined,
          newsletterListId: DB.newsletterListId || undefined,
          lead: {
          first: l.first, last: l.last, company: l.company, role: l.role, email: l.email,
          phone: l.phone, website: l.website, address: l.address,
          provenienza: l.provenienza, country: l.country, interesse: l.interesse, event: evName, owner: ownerName,
          newsletter: !!l.newsletter,
          consent: l.consentAt ? new Date(l.consentAt).toISOString().slice(0, 10) : ''
        } })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) return { ok: true, action: data.action };
      return { ok: false, msg: data.error || ('Brevo error ' + res.status) };
    } catch (e) { return { ok: false, msg: e.message }; }
  }
  async function deliverLead(l) {
    const r = await pushToBrevo(l);
    DB.syncLog.unshift({ leadId: l.id, dest: 'Brevo', ok: r.ok, ts: Date.now(), msg: r.ok ? (r.action === 'updated' ? 'Contact updated (dedupe by email)' : 'Contact created') : r.msg });
    if (r.ok) { l.status = 'Sent'; l.error = null; l.queuedOffline = false; }
    else { l.status = 'Error'; l.error = 'Brevo: ' + r.msg; }
    saveLead(l);
    api('POST', '/sync-log', { leadId: l.id, dest: 'Brevo', ok: r.ok, msg: r.ok ? (r.action || 'sent') : r.msg }).catch(() => {});

    // Excel runs after the lead is saved, so the server has the row to copy.
    // A failure here does not undo the Brevo push: it is logged and retryable.
    const x = await pushToExcel(l);
    if (x) {
      DB.syncLog.unshift({ leadId: l.id, dest: 'Excel', ok: x.ok, ts: Date.now(), msg: x.msg });
      if (!x.ok && r.ok) { l.error = 'Excel: ' + x.msg; saveLead(l); }
    }
    return r.ok;
  }
  async function flushQueued() {
    const q = DB.leads.filter(l => l.queuedOffline && (l.status === 'Ready' || l.status === 'Error'));
    if (!q.length) return;
    for (const l of q) { await deliverLead(l); }
    saveState(); toast(q.length + ' queued lead(s) synced', 'ok'); if (window.render) render();
  }

  // Brevo lists (for per-event routing config in Admin)
  let brevoLists = null;
  async function loadBrevoLists(force) {
    if (!DB.brevoApiKey) return null;           // no key for this workspace → nothing to load
    if (brevoLists && !force) return brevoLists;
    try {
      const r = await fetch('/api/brevo-lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: DB.brevoApiKey || undefined }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(d.lists)) { brevoLists = d.lists; return brevoLists; }
    } catch (e) {}
    return null;
  }

  function toast(msg, kind) {
    const el = document.getElementById('toast');
    el.className = ''; el.innerHTML = (kind === 'ok' ? ic.check : kind === 'err' ? ic.alert : '') + '<span>' + esc(msg) + '</span>';
    if (kind) el.classList.add(kind);
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function modal(inner) {
    modalRoot.innerHTML = '<div class="modal-bg"><div class="modal"><div class="grab"></div>' + inner + '</div></div>';
    modalRoot.querySelector('.modal-bg').addEventListener('click', e => { if (e.target.classList.contains('modal-bg')) closeModal(); });
  }
  function closeModal() { modalRoot.innerHTML = ''; }
  window.closeModal = closeModal;

  /* ---------- icons ---------- */
  const ic = {
    home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
    scan:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="8" y="9" width="8" height="6" rx="1"/></svg>',
    leads:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg>',
    dash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/></svg>',
    admin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.9 1V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.6 15a1.65 1.65 0 0 0-1.5-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 3.6 8.4a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 3.6 1.65 1.65 0 0 0 9 2.1V2a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15.6 3.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 21.9 9H22a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.5 1z"/></svg>',
    check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    alert:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    camera:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    chevR:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    chevL:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    ms:'<svg viewBox="0 0 24 24" width="20" height="20"><rect x="2" y="2" width="9.5" height="9.5" fill="#F25022"/><rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00"/><rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF"/><rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#FFB900"/></svg>',
    bolt:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>',
    send:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>',
    info:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    grid:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    empty:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>'
  };

  /* ---------- status ----------
     The keys are stored in the database and must stay English; only the label
     shown on screen is translated. */
  const STATUS = {
    'Captured':    { pill:'gray',  label:'Captured' },
    'To finalize': { pill:'amber', label:'To finalize' },
    'Ready':       { pill:'blue',  label:'Ready' },
    'Sent':        { pill:'green', label:'Sent' },
    'Error':       { pill:'red',   label:'Error' }
  };
  const STATUS_IT = { 'Captured':'Acquisito', 'To finalize':'Da completare', 'Ready':'Pronto', 'Sent':'Inviato', 'Error':'Errore' };
  const statusLabel = s => (I18N.lang === 'it' ? (STATUS_IT[s] || s) : (STATUS[s] ? STATUS[s].label : s));
  const statusPill = s => '<span class="pill ' + STATUS[s].pill + '">' + esc(statusLabel(s)) + '</span>';
  const requiredFilled = l => l.provenienza && l.country && l.interesse && (l.first || l.last);

  /* The lead belongs to whoever captured it. No routing rules: the person who
     spoke to the contact is the person who follows up. */

  /* ================= SCREENS ================= */

  function shell(title, sub, body, activeTab, opts) {
    opts = opts || {};
    const back = opts.back ? '<button class="back" data-nav="' + opts.back + '">' + ic.chevL + esc(t('Back')) + '</button>' : '';
    const brand = opts.brand ? '<div class="brandrow"><img src="icon-192.png" alt=""><div><div class="title">' + esc(title) + '</div><div class="sub">' + esc(sub) + '</div></div></div>' : '<div><div class="title">' + esc(title) + '</div>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>';
    const right = opts.right || '';
    const off = S.online ? '' : '<span class="pill offline-tag" style="margin-left:6px">' + esc(t('Offline')) + '</span>';
    app.innerHTML =
      '<div class="topbar">' + back + brand + off + '<div class="spacer"></div>' + right + '</div>' +
      '<div class="screen">' + body + '</div>' +
      (activeTab ? tabbar(activeTab) : '') +
      (opts.fab ? '<button class="fab" data-nav="#/scan">' + ic.camera + '</button>' : '');
    bindCommon();
    if (opts.bind) opts.bind();
    saveState();
  }

  function tabbar(active) {
    const tabs = [
      ['#/home', t('Home'), ic.home],
      ['#/scan', t('Scan'), ic.scan],
      ['#/leads', t('Leads'), ic.leads],
      ['#/dashboard', t('Stats'), ic.dash]
    ];
    if (isAdmin()) tabs.push(['#/admin', t('Admin'), ic.admin]);
    return '<nav class="tabbar">' + tabs.map(tab =>
      '<button class="tab ' + (active === tab[0] ? 'active' : '') + '" data-nav="' + tab[0] + '">' + tab[2] + '<span>' + esc(tab[1]) + '</span></button>'
    ).join('') + '</nav>';
  }

  function bindCommon() {
    app.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => go(b.getAttribute('data-nav'))));
  }

  /* ---------- Welcome (sign in or register a company) ---------- */
  function welcomeScreen() {
    app.innerHTML =
      '<div class="login">' +
        '<div class="brand"><img src="icon-512.png" alt="Bizca"><h1>Bizca</h1><p>' + esc(t('Turn business cards into qualified leads')) + '</p></div>' +
        '<div class="card" style="box-shadow:var(--shadow-lg)">' +
          '<h3 style="text-align:center">' + esc(t('Welcome')) + '</h3>' +
          '<p class="hint" style="text-align:center">' + esc(t('Sign in if your company already uses Bizca, or create a new workspace.')) + '</p>' +
          '<button class="btn primary" id="wSignIn">' + esc(t('Sign in')) + '</button>' +
          '<button class="btn ghost" id="wRegister" style="margin-top:10px">' + ic.plus + ' ' + esc(t('Register your company')) + '</button>' +
          langSwitchRow() +
        '</div>' +
      '</div>';
    $('#wSignIn').onclick = () => go('#/login');
    $('#wRegister').onclick = () => go('#/setup');
    bindLangSwitch(() => welcomeScreen());
  }

  /* Admin → language: the workspace default, plus this user's own choice. */
  function langCard() {
    const personal = readUserLang();
    const def = I18N.normalise(DB.company.locale) || 'en';
    return '<div class="card"><h3>' + esc(t('Language')) + '</h3>' +
      '<div class="field"><label>' + esc(t('Workspace default language')) + '</label>' +
        '<select class="input" id="coLang">' + I18N.LANGS.map(l =>
          '<option value="' + l.code + '" ' + (def === l.code ? 'selected' : '') + '>' + esc(l.label) + '</option>').join('') +
        '</select>' +
        '<p class="hint" style="margin:6px 0 0">' + esc(t('New users see this language until they change it.')) + '</p></div>' +
      '<div class="kv" style="border:none;margin-top:6px"><span class="k">' + esc(t('Interface language')) + '</span><span class="v">' + langSwitchRow() + '</span></div>' +
      (personal ? '<button class="btn ghost sm" id="langReset" style="margin-top:8px">' + esc(t('Use the workspace default')) + '</button>' : '') +
      '</div>';
  }
  function bindLangCard() {
    const sel = $('#coLang');
    if (sel) sel.onchange = () => {
      DB.company.locale = sel.value;
      saveState();
      push('PATCH', '/settings', { locale: sel.value }).catch(() => {});
      applyLang();
      toast(t('Language updated'), 'ok');
      adminScreen();
    };
    const reset = $('#langReset');
    if (reset) reset.onclick = () => { setUserLang(''); adminScreen(); };
    bindLangSwitch(() => adminScreen());
  }

  /* Language picker shown on the screens you see before signing in. */
  function langSwitchRow() {
    return '<div style="display:flex;justify-content:center;gap:6px;margin-top:16px">' +
      I18N.LANGS.map(l => '<button class="pill ' + (I18N.lang === l.code ? 'indigo' : 'gray') + '" data-lang="' + l.code + '" style="border:none;cursor:pointer">' + esc(l.label) + '</button>').join('') +
      '</div>';
  }
  function bindLangSwitch(rerender) {
    document.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => {
      setUserLang(b.getAttribute('data-lang'));
      rerender ? rerender() : render();
    });
  }

  /* ---------- Setup wizard (register a company) ---------- */
  function setupScreen() {
    app.innerHTML =
      '<div class="login" style="justify-content:flex-start;padding-top:40px">' +
        '<div class="brand"><img src="icon-512.png" alt="Bizca"><h1>Bizca</h1><p>' + esc(t('Register your company')) + '</p></div>' +
        '<div class="card" style="box-shadow:var(--shadow-lg)">' +
          '<h3>' + esc(t('Company')) + '</h3><p class="hint">' + esc(t('This creates your workspace. You can configure everything else later in Admin.')) + '</p>' +
          '<div class="field"><label>' + esc(t('Company name')) + ' <span class="req">*</span></label><input class="input" id="coName" placeholder="Acme S.p.A."></div>' +
          '<div class="field"><label>' + esc(t('Company domain')) + ' <span class="req">*</span></label><input class="input" id="coDomain" placeholder="acme.com"></div>' +
          '<h3 style="margin-top:18px">' + esc(t('Your admin account')) + '</h3>' +
          '<div class="field"><label>' + esc(t('Full name')) + ' <span class="req">*</span></label><input class="input" id="adName" placeholder="Mario Rossi"></div>' +
          '<div class="field"><label>' + esc(t('Work email')) + ' <span class="req">*</span></label><input class="input" id="adEmail" type="email" placeholder="mario@acme.com"></div>' +
          '<div class="field"><label>' + esc(t('Password')) + ' <span class="req">*</span></label><input class="input" id="adPwd" type="password" placeholder="' + esc(t('At least 8 characters')) + '" autocomplete="new-password"></div>' +
          '<label class="select-item" for="privacyOk" style="cursor:pointer;margin-top:14px">' +
            '<input type="checkbox" id="privacyOk" style="width:20px;height:20px;accent-color:var(--indigo)">' +
            '<span style="font-size:13px;color:var(--slate)">' + (I18N.lang === 'it'
              ? 'Ho letto e accetto l\'<a href="https://www.bryan.it/privacy-policy" target="_blank" rel="noopener">informativa privacy</a> e acconsento al trattamento dei miei dati.'
              : 'I have read and accept the <a href="https://www.bryan.it/privacy-policy" target="_blank" rel="noopener">privacy policy</a> and agree to the processing of my data.') +
            ' <span class="req">*</span></span>' +
          '</label>' +
          '<button class="btn primary" id="doSetup" style="margin-top:14px">' + esc(t('Create workspace')) + '</button>' +
          (DB.company.configured ? '' : '<button class="btn ghost" id="backWelcome" style="margin-top:10px">' + esc(t('Back')) + '</button>') +
          langSwitchRow() +
        '</div>' +
      '</div>';
    const bw = $('#backWelcome'); if (bw) bw.onclick = () => go('#/welcome');
    bindLangSwitch(() => setupScreen());
    $('#doSetup').onclick = async () => {
      const name = ($('#coName').value || '').trim();
      const domain = ($('#coDomain').value || '').trim().toLowerCase().replace(/^@/, '');
      const adName = ($('#adName').value || '').trim();
      const adEmail = ($('#adEmail').value || '').trim().toLowerCase();
      const pwd = $('#adPwd').value || '';
      if (!name || !domain || !adName || !adEmail || !pwd) { toast(t('Fill in the required fields'), 'err'); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adEmail)) { toast(t('Enter a valid email address'), 'err'); return; }
      if (pwd.length < 8) { toast(t('Password must be at least 8 characters'), 'err'); return; }
      if (!$('#privacyOk').checked) { toast(t('Please accept the privacy policy to continue'), 'err'); return; }
      const btn = $('#doSetup'); btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> ' + esc(t('Creating…'));
      try {
        const r = await api('POST', '/auth/register', { company: name, domain, name: adName, email: adEmail, password: pwd, privacy: true, locale: I18N.lang });
        checkEmailScreen(adEmail, r.emailSent === false ? (r.emailError || t('the confirmation email could not be sent')) : null);
      } catch (e) {
        toast(e.message, 'err'); btn.disabled = false; btn.textContent = t('Create workspace');
      }
    };
  }

  /* ---------- "check your inbox" after registering ---------- */
  function checkEmailScreen(email, mailProblem) {
    app.innerHTML =
      '<div class="login">' +
        '<div class="brand"><img src="icon-512.png" alt="Bizca"><h1>Bizca</h1><p>' + esc(t('One last step')) + '</p></div>' +
        '<div class="card" style="box-shadow:var(--shadow-lg);text-align:center">' +
          '<h3>' + esc(t('Check your inbox')) + '</h3>' +
          (mailProblem
            ? '<div class="banner" style="background:#FEF2F2;border-color:#FECACA;color:#991B1B;text-align:left">' + ic.alert + '<div>' + (I18N.lang === 'it'
                ? 'Il tuo account è stato creato, ma non siamo riusciti a inviare l\'email di conferma: ' + esc(mailProblem) + '. Contatta l\'amministratore di Bizca.'
                : 'Your account was created, but we could not send the confirmation email: ' + esc(mailProblem) + '. Contact your Bizca administrator.') + '</div></div>'
            : '<p class="hint">' + (I18N.lang === 'it'
                ? 'Abbiamo inviato un link di conferma a <b>' + esc(email) + '</b>. Cliccalo per attivare lo spazio di lavoro, poi accedi.'
                : 'We sent a confirmation link to <b>' + esc(email) + '</b>. Click it to activate your workspace, then sign in.') + '</p>') +
          '<button class="btn primary" id="goLogin">' + esc(t('Go to sign in')) + '</button>' +
          '<button class="btn ghost" id="resend" style="margin-top:10px">' + esc(t('Resend email')) + '</button>' +
        '</div>' +
      '</div>';
    $('#goLogin').onclick = () => go('#/login');
    $('#resend').onclick = async () => {
      const b = $('#resend'); b.disabled = true;
      try { const r = await api('POST', '/auth/resend', { email, locale: I18N.lang }); toast(r.emailSent === false ? ((I18N.lang === 'it' ? 'Invio non riuscito: ' : 'Could not send: ') + (r.emailError || t('email not configured'))) : t('Email sent again'), r.emailSent === false ? 'err' : 'ok'); }
      catch (e) { toast(e.message, 'err'); }
      b.disabled = false;
    };
  }

  /* ---------- Activate an invited account ----------
     Target of the link in the invitation email. The account already exists —
     here the person only picks a password and is signed in straight away. */
  function activateScreen(email, token) {
    if (!email || !token) {
      toast(t('This invitation link is incomplete'), 'err');
      return go('#/login');
    }
    app.innerHTML =
      '<div class="login">' +
        '<div class="brand"><img src="icon-512.png" alt="Bizca"><h1>Bizca</h1><p>' + esc(t('Activate your account')) + '</p></div>' +
        '<div class="card" style="box-shadow:var(--shadow-lg)">' +
          '<h3>' + esc(t('Welcome to Bizca')) + '</h3>' +
          '<p class="hint">' + (I18N.lang === 'it'
            ? 'Scegli una password per <b>' + esc(email) + '</b> ed entri subito.'
            : 'Choose a password for <b>' + esc(email) + '</b> and you are in.') + '</p>' +
          '<div class="field"><label>' + esc(t('Full name')) + '</label><input class="input" id="acName" placeholder="Mario Rossi" autocomplete="name"></div>' +
          '<div class="field"><label>' + esc(t('Password')) + '</label><input class="input" id="acPwd" type="password" placeholder="' + esc(t('At least 8 characters')) + '" autocomplete="new-password"></div>' +
          '<button class="btn primary" id="acGo">' + esc(t('Activate and sign in')) + '</button>' +
          '<p class="hint" style="text-align:center;margin:12px 0 0">' + (I18N.lang === 'it'
            ? 'Se preferisci, puoi anche accedere con Google usando questo stesso indirizzo.'
            : 'You can also sign in with Google using this same address.') + '</p>' +
          '<button class="btn ghost" id="acLogin" style="margin-top:10px">' + esc(t('Go to sign in')) + '</button>' +
          langSwitchRow() +
        '</div>' +
      '</div>';
    $('#acLogin').onclick = () => go('#/login');
    bindLangSwitch(() => activateScreen(email, token));

    const submit = async () => {
      const pwd = $('#acPwd').value || '';
      const name = ($('#acName').value || '').trim();
      if (pwd.length < 8) { toast(t('Password must be at least 8 characters'), 'err'); return; }
      const btn = $('#acGo'); btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> ' + esc(t('Activating…'));
      try {
        const d = await api('POST', '/auth/set-password', { email, token, password: pwd, name, locale: I18N.lang });
        setToken(d.token);
        await pullState();
        toast(t('Account activated'), 'ok');
        go('#/home');
      } catch (e) {
        // An already-used link is a dead end here, but the person can simply sign in.
        if (e.data && e.data.alreadyActive) { toast(e.message, 'err'); go('#/login'); return; }
        toast(e.message, 'err');
        btn.disabled = false; btn.textContent = t('Activate and sign in');
      }
    };
    $('#acGo').onclick = submit;
    $('#acPwd').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }

  /* ---------- Login ---------- */
  let googleReady = false;
  function loginScreen() {
    app.innerHTML =
      '<div class="login">' +
        '<div class="brand"><img src="icon-512.png" alt="Bizca"><h1>Bizca</h1><p>' + esc(t('Event Leads to CRM')) + (DB.company.name ? ' · ' + esc(DB.company.name) : '') + '</p></div>' +
        '<div class="card" style="box-shadow:var(--shadow-lg)">' +
          '<div id="gBtn" style="display:flex;justify-content:center;min-height:44px"></div>' +
          '<button class="ms-btn" id="sso" style="margin-top:10px">' + ic.ms + esc(t('Sign in with Microsoft')) + '</button>' +
          '<div class="divider">' + esc(t('or')) + '</div>' +
          '<div class="field"><label>' + esc(t('Work email')) + '</label><input class="input" id="email" type="email" placeholder="nome@' + esc(DB.company.domain || 'azienda.com') + '" autocomplete="username"></div>' +
          '<div class="field"><label>' + esc(t('Password')) + '</label><input class="input" id="pwd" type="password" placeholder="••••••••" autocomplete="current-password"></div>' +
          '<button class="btn primary" id="login">' + esc(t('Sign in')) + '</button>' +
          (DB.company.configured
            ? '<p class="hint" style="text-align:center;margin:12px 0 0">' + esc(t('Access is limited to users invited by your admin.')) + '</p>'
            : '<div class="banner" style="margin:14px 0 0">' + ic.info + '<div>' + (I18N.lang === 'it'
                ? 'Su questo dispositivo non c\'è ancora uno spazio di lavoro. Se la tua azienda usa già Bizca, accedi con Google usando l\'account di lavoro; altrimenti registra la tua azienda.'
                : 'No workspace on this device yet. If your company already uses Bizca, sign in with Google using your work account — otherwise register your company.') + '</div></div>' +
              '<button class="btn ghost" id="backWelcome" style="margin-top:10px">' + esc(t('Back')) + '</button>') +
          langSwitchRow() +
        '</div>' +
      '</div>';
    const bw = $('#backWelcome'); if (bw) bw.onclick = () => go('#/welcome');
    const signInEmail = async () => {
      const email = ($('#email').value || '').trim().toLowerCase();
      const pwd = $('#pwd').value || '';
      if (!email || !pwd) { toast(t('Enter your work email and password'), 'err'); return; }
      const btn = $('#login'); if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> ' + esc(t('Signing in…')); }
      const reset = () => { if (btn) { btn.disabled = false; btn.textContent = t('Sign in'); } };
      try {
        const d = await api('POST', '/auth/login', { email, password: pwd });
        setToken(d.token);
        await pullState();
        go('#/home');
      } catch (e) {
        if (e.data && e.data.needsVerification) { checkEmailScreen(email); return; }
        toast(e.message, 'err'); reset();
      }
    };
    $('#sso').onclick = async () => {
      const email = ($('#email').value || '').trim().toLowerCase();
      if (!email) {
        toast(t('Type your work email first, then Microsoft'), 'err');
        const f = $('#email'); if (f) f.focus();
        return;
      }
      const btn = $('#sso'); btn.disabled = true; const label = btn.innerHTML;
      btn.innerHTML = '<div class="spinner"></div> ' + esc(t('Redirecting to Microsoft…'));
      try {
        const d = await api('POST', '/auth/microsoft/start', { email });
        location.href = d.url;                 // leaves the app; Microsoft sends us back
      } catch (e) {
        toast(e.message, 'err');
        btn.disabled = false; btn.innerHTML = label;
      }
    };
    $('#login').onclick = signInEmail;
    $('#pwd').addEventListener('keydown', e => { if (e.key === 'Enter') signInEmail(); });
    bindLangSwitch(() => loginScreen());
    initGoogle();
  }

  // Google Identity Services — the ID token is verified server-side,
  // and only users already invited by the admin are allowed in.
  async function initGoogle() {
    const host = document.getElementById('gBtn');
    if (!host) return;
    let clientId = '';
    try {
      const r = await fetch('/api/config');
      const d = await r.json().catch(() => ({}));
      clientId = d.googleClientId || '';
    } catch (e) {}
    if (!clientId) { host.innerHTML = '<p class="hint" style="margin:0">' + esc(t('Google sign-in not configured yet.')) + '</p>'; return; }
    const start = () => {
      if (!window.google || !google.accounts || !google.accounts.id) return;
      google.accounts.id.initialize({ client_id: clientId, callback: onGoogleCredential });
      google.accounts.id.renderButton(host, { theme: 'outline', size: 'large', width: 320, text: 'signin_with' });
      googleReady = true;
    };
    if (window.google && window.google.accounts) { start(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = start;
    s.onerror = () => { host.innerHTML = '<p class="hint" style="margin:0">' + esc(t('Google sign-in unavailable.')) + '</p>'; };
    document.head.appendChild(s);
  }

  window.onGoogleCredential = onGoogleCredential;
  async function onGoogleCredential(resp) {
    try {
      const d = await api('POST', '/auth/google', { credential: resp.credential });
      setToken(d.token);
      await pullState();
      toast(t('Signed in with Google'), 'ok');
      go('#/home');
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------- Home ---------- */
  function homeScreen() {
    const ev = activeEvent();
    const mine = DB.leads.filter(l => l.createdBy === user().id);
    const drafts = mine.filter(l => l.status === 'Captured' || l.status === 'To finalize').length;
    const ready = mine.filter(l => l.status === 'Ready').length;
    const body =
      (deferredPrompt ? '<button class="btn soft" id="installApp" style="margin-bottom:12px">' + ic.plus + ' ' + esc(t('Install Bizca on your device')) + '</button>' : '') +
      (S.online ? '' : '<div class="banner offline-tag" style="background:#FEF3C7;border-color:#FDE68A;color:#92400E">' + ic.info + '<div>' + esc(I18N.lang === 'it' ? 'Sei offline. Acquisizioni e invii restano in coda e si sincronizzano da soli appena torna la rete.' : 'You are offline. Captures and sends are queued and will sync automatically when you are back online.') + '</div></div>') +
      captureCard() +
      '<button class="btn primary" data-nav="#/scan" style="margin-bottom:12px">' + ic.camera + ' ' + esc(t('Scan a business card')) + '</button>' +
      '<div class="btnrow" style="margin-bottom:8px">' +
        '<button class="btn soft" data-nav="#/batch">' + ic.grid + ' ' + esc(t('Batch')) + ' (' + drafts + ')</button>' +
        '<button class="btn soft" data-nav="#/leads">' + ic.leads + ' ' + esc(t('My leads')) + '</button>' +
      '</div>' +
      '<div class="section-title">' + esc(t('Quick status')) + '</div>' +
      '<div class="stats">' +
        stat(mine.length, t('Captured total'), 'i') +
        stat(drafts, statusLabel('To finalize'), 'a') +
        stat(ready, t('Ready to send'), 'i') +
        stat(mine.filter(l=>l.status==='Sent').length, statusLabel('Sent'), 'g') +
      '</div>';
    shell((I18N.lang === 'it' ? 'Ciao, ' : 'Hi, ') + (user().name || user().email).split(' ')[0], DB.company.name + ' · ' + (isAdmin()?t('Admin'):t('Seller')), body, '#/home', { brand:true, right:'<button class="iconbtn" id="userMenu" title="'+esc(t('Account'))+'">'+ic.leads+'</button>',
      bind(){
        const sw = $('#switchEv'); if (sw) sw.onclick = eventPicker;
        $('#userMenu').onclick = () => {
          modal('<h3>'+esc(t('Account'))+'</h3>' +
            '<div class="kv"><span class="k">'+esc(t('Name'))+'</span><span class="v">'+esc(user().name||'—')+'</span></div>' +
            '<div class="kv"><span class="k">'+esc(t('Email'))+'</span><span class="v">'+esc(user().email)+'</span></div>' +
            '<div class="kv"><span class="k">'+esc(t('Role'))+'</span><span class="v">'+esc(user().role==='admin'?t('Admin'):t('Seller'))+'</span></div>' +
            '<div class="kv"><span class="k">'+esc(t('Company'))+'</span><span class="v">'+esc(DB.company.name)+'</span></div>' +
            '<div class="kv" style="border:none"><span class="k">'+esc(t('Interface language'))+'</span><span class="v">'+langSwitchRow()+'</span></div>' +
            '<button class="btn danger" id="doLogout" style="margin-top:14px">'+esc(t('Sign out'))+'</button>' +
            '<button class="btn ghost" onclick="closeModal()" style="margin-top:8px">'+esc(t('Close'))+'</button>');
          bindLangSwitch(() => { closeModal(); render(); });
          setTimeout(()=>{ const b=document.getElementById('doLogout'); if(b) b.onclick=()=>{ setToken(''); S.user=null; DB.leads=[]; saveState(); closeModal(); go('#/login'); }; },0);
        };
        const inst = $('#installApp'); if (inst) inst.onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); try { await deferredPrompt.userChoice; } catch(e){} deferredPrompt = null; render(); };
      }});
  }
  /* What the next scan will be filed as. Tapping it reopens the picker. */
  function captureCard() {
    const type = captureType();
    const ev = activeEvent();
    const listId = sessionListId();
    const title = type === 'meeting' ? t('Personal meeting') : (ev ? ev.name : t('No event yet'));
    const sub = type === 'meeting'
      ? esc(I18N.lang === 'it' ? 'Solo newsletter, se spuntata' : 'Newsletter only, if ticked')
      : (ev ? esc(fmtDates(ev)) + ' · ' + (listId ? esc(listLabel(listId)) : esc(t('no list'))) : '');
    const warn = (type === 'event' && !ev)
      ? '<p class="hint" style="margin:2px 0 12px">' + esc(I18N.lang === 'it'
          ? 'Scegli un evento o passa a Meeting personale prima di scansionare.'
          : 'Pick an event or switch to Personal meeting before scanning.') + '</p>'
      : '';
    return '<div class="card" style="background:linear-gradient(135deg,#EEF2FF,#ECFEFF)">' +
        '<div class="section-title" style="margin:0 0 6px">' + esc(sourceLabel()) + '</div>' +
        '<h3 style="font-size:18px">' + esc(title) + '</h3>' +
        (sub ? '<p class="hint" style="margin:2px 0 12px">' + sub + '</p>' : '') + warn +
        '<button class="btn ghost sm" id="switchEv">' + esc(t('Change')) + '</button>' +
      '</div>';
  }

  const presetSummary = ev => ['provenienza','country','interesse']
    .map(k => k === 'country' ? (ev.preset[k] && tc(ev.preset[k])) : ev.preset[k])
    .filter(Boolean).join(' · ') || t('no presets');
  const stat = (n,l,c) => '<div class="stat"><div class="num '+(c||'')+'">'+n+'</div><div class="lbl">'+esc(l)+'</div></div>';

  /* The one screen that decides where this capture session goes: what kind of
     contact it is, which event, and which Brevo list. Everything captured
     afterwards inherits these three choices. */
  function eventPicker() {
    const type = captureType();
    const evs = DB.events;
    const ev = activeEvent();
    const listId = sessionListId();

    const typeBtn = (code, label, hint) =>
      '<div class="select-item ' + (type === code ? 'sel' : '') + '" data-type="' + code + '" style="cursor:pointer">' +
        '<div style="flex:1"><div style="font-weight:600">' + esc(label) + '</div>' +
        '<div class="hint" style="margin:0">' + esc(hint) + '</div></div>' +
        (type === code ? ic.check : '') + '</div>';

    const eventBlock = type !== 'event' ? '' : (evs.length
      ? '<div class="section-title" style="margin-top:14px">' + esc(t('Which event')) + '</div>' +
        evs.map(e => '<div class="select-item ' + (e.id === S.activeEventId ? 'sel' : '') + '" data-ev="' + e.id + '" style="cursor:pointer">' +
          '<div style="flex:1"><div style="font-weight:600">' + esc(e.name) + '</div>' +
          '<div class="hint" style="margin:0">' + esc(fmtDates(e)) + (e.brevoListId ? ' · ' + esc(listLabel(e.brevoListId)) : '') + '</div></div>' +
          (e.id === S.activeEventId ? ic.check : '') + '</div>').join('')
      : '<div class="banner" style="margin-top:14px">' + ic.info + '<div>' + esc(I18N.lang === 'it'
          ? 'Non ci sono eventi. Chiedi all\'amministratore di crearne uno, oppure scegli Meeting personale.'
          : 'No events yet. Ask your admin to create one, or pick Personal meeting.') + '</div></div>');

    const newsName = DB.newsletterListId ? listLabel(DB.newsletterListId) : null;
    const listBlock = (type === 'event' && !evs.length) ? '' :
      '<div class="section-title" style="margin-top:14px">' + esc(t('Where contacts go')) + '</div>' +
      '<div class="banner" style="margin:0">' + ic.send + '<div>' +
        (type === 'meeting'
          ? esc(newsName
              ? (I18N.lang === 'it' ? 'Nessuna lista, salvo chi spunta la newsletter: quelli finiscono in «' + newsName + '».'
                               : 'No list, except those who tick the newsletter: they go to “' + newsName + '”.')
              : (I18N.lang === 'it' ? 'Nessuna lista. Per iscrivere chi spunta la newsletter, scegli la lista in Admin → Destinazioni.'
                               : 'No list. To subscribe those who tick the newsletter, pick the list in Admin → Destinations.'))
          : (ev && ev.brevoListId
              ? esc((I18N.lang === 'it' ? 'Lista dell\'evento: ' : 'Event list: ') + listLabel(ev.brevoListId)) +
                (newsName ? esc((I18N.lang === 'it' ? ' · chi spunta la newsletter va anche in «' : ' · newsletter tickers also go to “') + newsName + (I18N.lang === 'it' ? '».' : '”.')) : '')
              : esc(I18N.lang === 'it' ? 'Questo evento non ha una lista Brevo: impostala in Admin → Eventi.'
                                   : 'This event has no Brevo list: set one in Admin → Events.'))) +
      '</div></div>';

    modal('<h3 style="margin:0 0 4px">' + esc(t('Before you start')) + '</h3>' +
      '<p class="hint">' + esc(I18N.lang === 'it'
        ? 'Vale per tutti i biglietti che scansioni da adesso.'
        : 'Applies to every card you scan from now on.') + '</p>' +
      typeBtn('event', t('Event'), I18N.lang === 'it' ? 'Fiera o manifestazione' : 'Trade show or fair') +
      typeBtn('meeting', t('Personal meeting'), I18N.lang === 'it' ? 'Incontro uno a uno, visita, appuntamento' : 'One-to-one meeting, visit, appointment') +
      eventBlock + listBlock +
      '<button class="btn primary" id="pickDone" style="margin-top:14px">' + esc(t('Start scanning')) + '</button>' +
      '<button class="btn ghost" onclick="closeModal()" style="margin-top:8px">' + esc(t('Cancel')) + '</button>');

    if (DB.brevoApiKey && !brevoLists) loadBrevoLists().then(r => { if (r && modalRoot.querySelector('[data-type]')) eventPicker(); });

    modalRoot.querySelectorAll('[data-type]').forEach(x => x.onclick = () => { S.captureType = x.getAttribute('data-type'); eventPicker(); });
    modalRoot.querySelectorAll('[data-ev]').forEach(x => x.onclick = () => { S.activeEventId = x.getAttribute('data-ev'); eventPicker(); });
    document.getElementById('pickDone').onclick = () => {
      if (captureType() === 'event' && !S.activeEventId) { toast(t('Pick an event first'), 'err'); return; }
      saveState(); closeModal(); toast(t('Ready to scan'), 'ok'); render();
    };
  }

  /* ---------- Scan ---------- */
  function scanScreen() {
    const body =
      '<div class="card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
          '<div><h3 style="margin:0">' + esc(t('Scan card')) + '</h3><p class="hint" style="margin:0">' + esc(sourceLabel()) + (captureType() === 'event' && activeEvent() ? ': ' + esc(activeEvent().name) : '') + ' · ' + esc(captureType() === 'meeting'
          ? (I18N.lang === 'it' ? 'solo newsletter' : 'newsletter only')
          : listLabel(sessionListId())) + '</p></div>' +
          '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:13px;font-weight:600;color:var(--slate)">' + esc(t('Batch')) + '</span><div class="switch ' + (batchMode?'on':'') + '" id="batchToggle"></div></div>' +
        '</div>' +
        '<div class="scanview" id="scanview"><div class="frame"></div><div style="text-align:center;color:#94A3B8"><div style="width:46px;height:46px;margin:0 auto;color:#CBD5E1">' + ic.camera + '</div><div style="font-size:13px;margin-top:10px">' + esc(t('Point at a business card')) + '</div></div></div>' +
        '<p class="hint" style="text-align:center;margin:12px 0">' + (batchMode ? (I18N.lang === 'it' ? 'Modalità sequenza: scatti più biglietti uno dopo l\'altro.' : 'Batch mode: shoot several cards in a row.') : (I18N.lang === 'it' ? 'Modalità singola: scatti e completi subito.' : 'Single mode: capture, then finalize now.')) + '</p>' +
        '<button class="btn primary" id="capture">' + ic.camera + ' ' + esc(t('Capture card')) + '</button>' +
        '<button class="btn ghost" id="gallery" style="margin-top:10px">' + esc(t('Choose from gallery')) + '</button>' +
        '<input type="file" accept="image/*" capture="environment" id="camInput" style="display:none">' +
        '<input type="file" accept="image/*" id="galInput" style="display:none">' +
      '</div>' +
      '<div class="banner">' + ic.bolt + '<div>' + esc(I18N.lang === 'it' ? 'Un modello di intelligenza artificiale legge il biglietto e precompila nome, azienda, ruolo, email, telefono, sito e indirizzo. A te resta una conferma.' : 'A vision AI model reads the card and pre-fills name, company, role, email, phone, website and address. You confirm in a tap.') + '</div></div>' +
      queuePreview();
    shell(t('Scan'), null, body, '#/scan', { back:'#/home', bind(){
      $('#batchToggle').onclick = () => { batchMode = !batchMode; render(); };
      const cam = $('#camInput'), gal2 = $('#galInput');
      $('#capture').onclick = () => cam.click();
      $('#gallery').onclick = () => gal2.click();
      const onPick = e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) handleCardFile(f); };
      cam.onchange = onPick; gal2.onchange = onPick;
    }});
  }
  function queuePreview() {
    const q = DB.leads.filter(l => l.createdBy === user().id && (l.status === 'Captured' || l.status === 'To finalize'));
    if (!q.length) return '';
    return '<div class="section-title">' + esc(I18N.lang === 'it' ? 'In coda' : 'In queue') + ' (' + q.length + ')</div>' +
      '<button class="rowbtn" data-nav="#/batch"><div class="lead-ic">' + ic.grid + '</div><div style="flex:1"><div style="font-weight:600">' + esc(t('Batch queue')) + '</div><div class="hint" style="margin:0">' + esc(tp('n_cards_to_finalize', q.length)) + '</div></div>' + ic.chevR + '</button>';
  }
  function handleCardFile(file) {
    const sv = $('#scanview');
    if (sv) sv.innerHTML = '<div class="scanline"></div><div style="text-align:center"><div class="spinner" style="margin:0 auto 10px"></div><div style="color:#CBD5E1;font-size:13px">' + esc(t('Reading card with AI…')) + '</div></div>';
    const cap = $('#capture'), gal = $('#gallery'); if (cap) cap.disabled = true; if (gal) gal.disabled = true;
    fileToDataURL(file, 1100, url => {
      if (!url) { toast(t('Could not read image'), 'err'); scanScreen(); return; }
      runScan(url);
    });
  }

  // Downscale the photo client-side to keep the request small and cheap
  function fileToDataURL(file, maxDim, cb) {
    const img = new Image(); const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      const s = Math.min(1, maxDim / Math.max(w, h));
      w = Math.round(w * s); h = Math.round(h * s);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(objUrl);
      try { cb(cv.toDataURL('image/jpeg', 0.82)); } catch (e) { cb(null); }
    };
    img.onerror = () => { URL.revokeObjectURL(objUrl); cb(null); };
    img.src = objUrl;
  }

  // Send the image to the serverless OpenAI proxy; fall back to demo data on failure
  async function runScan(dataURL) {
    try {
      const res = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: dataURL }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      finishScan(data, dataURL, true);
    } catch (e) {
      finishScan({}, dataURL, false, e.message);
    }
  }

  function finishScan(d, image, isReal, errMsg) {
    d = d || {};
    const ev = activeEvent();
    const preset = (ev && ev.preset) || { provenienza: '', country: '', interesse: '' };
    const lead = {
      id: 'l' + Date.now(),
      first: d.first || '', last: d.last || '', company: d.company || '', role: d.role || '',
      email: d.email || '', phone: d.phone || '', website: d.website || '', address: d.address || '',
      provenienza: sourceLabel(), country: d.country || preset.country || '', interesse: preset.interesse || '',
      eventId: captureType() === 'event' && ev ? ev.id : null,
      captureType: captureType(), brevoListId: sessionListId(), newsletter: false,
      ownerId: user().id, createdBy: user().id, status: 'To finalize', override: false, image: image, ts: Date.now()
    };
    DB.leads.unshift(lead);
    saveState(); saveLead(lead);
    if (isReal) toast(t('Card read with AI'), 'ok');
    else toast((I18N.lang === 'it' ? 'Il biglietto non è stato letto — compila i campi a mano' : 'AI could not read the card — fill fields manually') + (errMsg ? ' (' + errMsg + ')' : ''), 'err');
    if (batchMode) scanScreen();
    else go('#/lead?id=' + lead.id);
  }

  /* ---------- Lead finalize / detail ---------- */
  function leadScreen(id) {
    const l = DB.leads.find(x => x.id === id);
    if (!l) return go('#/leads');
    const readOnly = l.status === 'Sent';
    if (!l.ownerId) l.ownerId = l.createdBy || user().id;
    const ctryOpts = optList(DB.countries, l.country, tc);

    const contact = ['first','last','company','role','email','phone','website','address'];
    const labels = { first:t('First name'), last:t('Last name'), company:t('Company'), role:t('Role'), email:t('Email'), phone:t('Phone'), website:t('Website'), address:t('Address') };
    const contactFields = '<div class="grid2">' + contact.map((f,idx) =>
      (f==='address'||f==='company' ? '</div><div class="field" style="margin-bottom:10px"><label>'+esc(labels[f])+'</label><input class="input" data-f="'+f+'" value="'+esc(l[f])+'" '+(readOnly?'disabled':'')+'></div><div class="grid2">'
       : '<div class="field"><label>'+esc(labels[f])+'</label><input class="input" data-f="'+f+'" value="'+esc(l[f])+'" '+(readOnly?'disabled':'')+'></div>')
    ).join('') + '</div>';

    const body =
      '<div class="lead" style="margin-bottom:16px"><div class="avatar">' + esc(initials((l.first||'?')+' '+(l.last||''))) + '</div>' +
        '<div class="meta"><div class="name">' + esc((l.first+' '+l.last).trim()||t('Unnamed')) + '</div><div class="co">' + esc(l.company||'—') + '</div>' +
        '<div class="tags">' + statusPill(l.status) + '</div></div></div>' +

      (l.status==='Error' ? '<div class="banner" style="background:#FEF2F2;border-color:#FECACA;color:#991B1B">'+ic.alert+'<div>'+esc(l.error||t('Send failed'))+'</div></div>' : '') +

      '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3>'+esc(t('Contact'))+'</h3><span class="pill indigo">'+ic.bolt+' '+esc(t('AI extracted'))+'</span></div><p class="hint">'+esc(t('Confirm or fix the fields below.'))+'</p>' + (l.image ? '<img src="'+l.image+'" alt="business card" style="width:100%;max-height:160px;object-fit:cover;border-radius:12px;margin-bottom:12px;border:1px solid var(--line)">' : '') + contactFields + '</div>' +

      '<div class="card"><h3>'+esc(t('Qualification'))+'</h3><p class="hint">'+esc(t('Required before sending. Managed as closed lists by admin.'))+'</p>' +
        '<div class="kv"><span class="k">'+esc(t('Source'))+'</span><span class="v">'+esc(l.provenienza || '—')+'</span></div>' +
        '<p class="hint" style="margin:6px 0 12px">'+esc(I18N.lang === 'it' ? 'Impostata quando hai scelto evento o meeting.' : 'Set when you chose the event or meeting.')+'</p>' +
        '<div class="field"><label>'+esc(t('Country'))+' <span class="req">*</span></label><select class="input" data-q="country" '+(readOnly?'disabled':'')+'>'+ctryOpts+'</select></div>' +
        '<div class="field" style="margin-bottom:0"><label>'+esc(t('Segment'))+' <span class="req">*</span></label>' + segChips(l, readOnly) + '</div>' +
      '</div>' +

      consentCard(l, readOnly) +

      (readOnly ? syncLogCard(l) :
        '<div class="btnrow"><button class="btn ghost" id="saveDraft">'+esc(t('Save draft'))+'</button>' +
        '<button class="btn primary" id="send">' + ic.send + ' ' + esc(l.status==='Error'?t('Retry send'):t('Send to Brevo')) + '</button></div>' +
        '<p class="hint" style="text-align:center;margin-top:10px">' + esc(I18N.lang === 'it' ? 'Destinazioni: Brevo (CRM) + Excel su SharePoint · deduplica automatica per email' : 'Destinations: Brevo (CRM) + Excel on SharePoint · auto-dedupe by email') + '</p>');

    shell(t('Lead'), l.company||'', body, null, { back: history.length>1 ? null : '#/leads', right:'<button class="back" data-nav="#/leads">'+ic.chevL+esc(t('Leads'))+'</button>', bind(){
      // live updates
      app.querySelectorAll('[data-f]').forEach(inp => inp.oninput = () => { l[inp.getAttribute('data-f')] = inp.value; });
      app.querySelectorAll('[data-q]').forEach(sel => sel.onchange = () => { l[sel.getAttribute('data-q')] = sel.value; });
      bindSegChips(l, () => leadScreen(l.id));
      const nk = $('#newsOk'); if (nk) nk.onchange = () => { l.newsletter = nk.checked; saveState(); saveLead(l); };
      const sd = $('#saveDraft'); if (sd) sd.onclick = () => { l.status = requiredFilled(l)?'Ready':'To finalize'; saveState(); saveLead(l); toast(t('Draft saved'),'ok'); go('#/leads'); };
      const sb = $('#send'); if (sb) sb.onclick = () => sendLead(l);
      const rs = $('#reSign'); if (rs) rs.onclick = () => { l.consentSignature = null; l.consentAt = null; saveState(); saveLead(l); leadScreen(l.id); };
      initSigPad(l);
    }});
  }

  /* A second, separate consent: being contacted about what you discussed is not
     the same as subscribing to a newsletter, so it needs its own unticked box. */
  function newsletterTick(l, readOnly) {
    const on = !!l.newsletter;
    if (readOnly) {
      return '<div class="kv" style="border:none;margin-top:10px"><span class="k">' + esc(t('Newsletter')) + '</span>' +
        '<span class="v">' + (on ? '<span class="pill green">' + ic.check + ' ' + esc(t('subscribed')) + '</span>'
                                 : '<span class="pill gray">' + esc(t('not subscribed')) + '</span>') + '</span></div>';
    }
    return '<label class="select-item" for="newsOk" style="cursor:pointer;margin-top:12px">' +
      '<input type="checkbox" id="newsOk" ' + (on ? 'checked' : '') + ' style="width:20px;height:20px;accent-color:var(--indigo)">' +
      '<span style="font-size:13px;color:var(--slate)">' + esc(I18N.lang === 'it'
        ? 'Desidero ricevere la newsletter di ' + DB.company.name + ' con novità e aggiornamenti commerciali.'
        : 'I would like to receive the ' + DB.company.name + ' newsletter with news and commercial updates.') + '</span></label>';
  }

  /* Segment picker: tap to toggle, plus one control that takes or clears the lot. */
  function segChips(l, readOnly) {
    const all = pick('interesse').map(v => v.value);
    if (!all.length) {
      return '<p class="hint" style="margin:0">' + esc(I18N.lang === 'it'
        ? 'Nessun segmento definito. L\'amministratore li crea in Admin → Segmenti.'
        : 'No segments defined yet. An admin creates them in Admin → Segments.') + '</p>';
    }
    const chosen = segList(l.interesse);
    const allOn = chosen.length === all.length;
    return '<div class="tags" style="gap:8px">' +
      (readOnly ? '' :
        '<button class="pill ' + (allOn ? 'indigo' : 'gray') + '" data-segall="1" style="border:none;cursor:pointer">' +
          (allOn ? ic.check + ' ' : '') + esc(allOn ? t('Clear all') : t('Select all')) + '</button>') +
      all.map(v => {
        const on = chosen.indexOf(v) >= 0;
        return '<button class="pill ' + (on ? 'blue' : 'gray') + '"' + (readOnly ? ' disabled' : ' data-seg="' + esc(v) + '"') +
          ' style="border:none;' + (readOnly ? '' : 'cursor:pointer') + '">' + (on ? ic.check + ' ' : '') + esc(v) + '</button>';
      }).join('') + '</div>';
  }

  function bindSegChips(l, rerender) {
    const all = pick('interesse').map(v => v.value);
    app.querySelectorAll('[data-seg]').forEach(b => b.onclick = () => {
      const v = b.getAttribute('data-seg');
      const cur = segList(l.interesse);
      const i = cur.indexOf(v);
      if (i >= 0) cur.splice(i, 1); else cur.push(v);
      l.interesse = segJoin(cur);
      rerender();
    });
    const allBtn = app.querySelector('[data-segall]');
    if (allBtn) allBtn.onclick = () => {
      l.interesse = segList(l.interesse).length === all.length ? '' : segJoin(all);
      rerender();
    };
  }

  function consentCard(l, readOnly) {
    const has = !!l.consentAt;
    const when = has ? new Date(l.consentAt).toLocaleString(I18N.lang === 'it' ? 'it-IT' : 'en-GB') : '';
    if (readOnly) {
      return '<div class="card"><h3>'+esc(t('Consent'))+'</h3>' + (has
        ? '<div class="tags"><span class="pill green">'+ic.check+' '+esc(t('Consent signed'))+'</span></div><p class="hint" style="margin:8px 0 0">'+esc(when)+'</p>' + (l.consentSignature ? '<img src="'+l.consentSignature+'" alt="signature" style="margin-top:8px;max-height:90px;border:1px solid var(--line);border-radius:10px;background:#fff">' : '')
        : '<p class="hint">'+esc(t('No consent captured.'))+'</p>') + '</div>';
    }
    const req = DB.requireConsent;
    return '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3>'+esc(t('Consent'))+(req?' <span class="req">*</span>':'')+'</h3>'+(has?'<span class="pill green">'+ic.check+' '+esc(t('signed'))+'</span>':'')+'</div>' +
      '<p class="hint">'+esc(I18N.lang === 'it' ? 'Il contatto acconsente a essere ricontattato da '+DB.company.name+' riguardo ai prodotti e servizi di cui avete parlato. Firma qui sotto.' : 'The contact agrees to be contacted by '+DB.company.name+' about the products and services discussed. Sign below.')+'</p>' +
      (has && l.consentSignature
        ? '<img src="'+l.consentSignature+'" alt="signature" style="width:100%;max-height:120px;object-fit:contain;border:1px solid var(--line);border-radius:12px;background:#fff">' +
          '<button class="btn ghost sm" id="reSign" style="margin-top:10px">'+esc(t('Re-sign'))+'</button>'
        : '<canvas id="sigPad" style="width:100%;height:150px;border:1.5px dashed var(--line);border-radius:12px;background:#fff;touch-action:none"></canvas>' +
          '<div class="btnrow" style="margin-top:10px"><button class="btn ghost sm" id="sigClear">'+esc(t('Clear'))+'</button><button class="btn soft sm" id="sigSave">'+esc(t('Save signature'))+'</button></div>') +
      (has ? '<p class="hint" style="margin:8px 0 0">'+esc(I18N.lang === 'it' ? 'Firmato il ' : 'Signed ')+esc(when)+'</p>' : '') +
      newsletterTick(l, readOnly) +
      '</div>';
  }

  function initSigPad(l) {
    const cv = document.getElementById('sigPad'); if (!cv) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    cv.width = Math.max(1, rect.width * ratio); cv.height = Math.max(1, rect.height * ratio);
    const ctx = cv.getContext('2d'); if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0F172A';
    let drawing = false, last = null, dirty = false;
    const pt = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', e => { e.preventDefault(); drawing = true; last = pt(e); try { cv.setPointerCapture(e.pointerId); } catch (x) {} });
    cv.addEventListener('pointermove', e => { if (!drawing) return; e.preventDefault(); const p = pt(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; dirty = true; });
    cv.addEventListener('pointerup', () => { drawing = false; });
    const clr = $('#sigClear'); if (clr) clr.onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); dirty = false; };
    const save = $('#sigSave'); if (save) save.onclick = () => {
      if (!dirty) { toast(t('Please sign first'), 'err'); return; }
      l.consentSignature = cv.toDataURL('image/png'); l.consentAt = Date.now(); saveState(); saveLead(l); toast(t('Consent captured'), 'ok'); leadScreen(l.id);
    };
  }
  function optList(arr, sel, label) {
    return '<option value="">'+esc(t('— select —'))+'</option>' +
      arr.map(v => '<option value="'+esc(v)+'" '+(v===sel?'selected':'')+'>'+esc(label?label(v):v)+'</option>').join('');
  }

  async function sendLead(l) {
    if (!requiredFilled(l)) { toast(t('Fill all required qualification fields'), 'err'); return; }
    if (DB.requireConsent && !l.consentAt) { toast(t('Consent signature required before sending'), 'err'); return; }
    if (!S.online) { l.status = 'Ready'; l.queuedOffline = true; saveState(); toast(t('Offline — queued, will sync automatically'), ''); go('#/leads'); return; }
    const btn = $('#send'); if (btn){ btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> ' + esc(t('Sending…')); }
    const ok = await deliverLead(l);
    saveState();
    if (ok) toast(DB.ms && DB.ms.enabled ? (I18N.lang === 'it' ? 'Inviato a Brevo ed Excel' : 'Sent to Brevo + Excel') : (I18N.lang === 'it' ? 'Inviato a Brevo' : 'Sent to Brevo'), 'ok');
    else toast(t('Brevo send failed — see details'), 'err');
    go('#/leads');
  }
  function syncLogCard(l) {
    const logs = DB.syncLog.filter(s => s.leadId === l.id);
    return '<div class="card"><h3>'+esc(t('Delivery'))+'</h3>' + (logs.length ? logs.map(s =>
      '<div class="kv"><span class="k">'+esc(s.dest)+'</span><span class="v">'+(s.ok?'<span class="pill green">'+ic.check+' '+esc(s.msg)+'</span>':'<span class="pill red">'+esc(s.msg)+'</span>')+'</span></div>').join('')
      : '<p class="hint">'+esc(t('No delivery records.'))+'</p>') +
      '<div class="kv"><span class="k">'+esc(t('Owner'))+'</span><span class="v">'+esc(userName(l.ownerId))+'</span></div>' +
      '<div class="kv"><span class="k">'+esc(t('Captured by'))+'</span><span class="v">'+esc(userName(l.createdBy))+'</span></div></div>';
  }

  /* ---------- Leads list ---------- */
  let leadFilter = 'all';
  function leadsScreen() {
    const mine = isAdmin() ? DB.leads : DB.leads.filter(l => l.createdBy === user().id || l.ownerId === user().id);
    const filters = ['all','To finalize','Ready','Sent','Error'];
    const counts = f => f==='all' ? mine.length : mine.filter(l=>l.status===f).length;
    const chips = filters.map(f => '<button class="pill '+(leadFilter===f?'indigo':'gray')+'" data-filter="'+f+'" style="border:none">'+esc(f==='all'?t('All'):statusLabel(f))+' · '+counts(f)+'</button>').join(' ');
    const list = mine.filter(l => leadFilter==='all' || l.status===leadFilter).sort((a,b)=>b.ts-a.ts);
    const body =
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">' + chips + '</div>' +
      (list.length ? list.map(leadRow).join('') :
        '<div class="list-empty">'+ic.empty+'<p>'+esc(t('No leads here yet.'))+'</p><button class="btn primary sm" data-nav="#/scan" style="margin:0 auto">'+esc(t('Scan a card'))+'</button></div>');
    shell(t('Leads'), isAdmin()?t('All company leads'):t('My leads'), body, '#/leads', { fab:true, bind(){
      app.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { leadFilter = b.getAttribute('data-filter'); leadsScreen(); });
      app.querySelectorAll('[data-lead]').forEach(b => b.onclick = () => go('#/lead?id=' + b.getAttribute('data-lead')));
    }});
  }
  function leadRow(l) {
    return '<div class="lead" data-lead="'+l.id+'"><div class="avatar">'+esc(initials((l.first||'?')+' '+(l.last||'')))+'</div>' +
      '<div class="meta"><div class="name">'+esc((l.first+' '+l.last).trim()||t('Unnamed'))+'</div><div class="co">'+esc(l.company||'—')+' · '+esc(userName(l.ownerId)||t('unassigned'))+'</div>' +
      '<div class="tags">'+statusPill(l.status)+(l.country?'<span class="pill gray">'+esc(tc(l.country))+'</span>':'')+(l.interesse?'<span class="pill blue">'+esc(l.interesse)+'</span>':'')+'</div></div>'+ic.chevR+'</div>';
  }

  /* ---------- Batch ---------- */
  const batchSel = new Set();
  function batchScreen() {
    const q = DB.leads.filter(l => l.createdBy === user().id && l.status !== 'Sent').sort((a,b)=>b.ts-a.ts);
    const body =
      '<div class="banner">'+ic.grid+'<div>'+esc(I18N.lang === 'it' ? 'Rivedi i biglietti acquisiti, applica il preset dell\'evento a tutti, assegna in automatico e invia quelli pronti.' : 'Review captured cards, apply the event preset in bulk, auto-assign and send the ready ones.')+'</div></div>' +
      (q.length ? (
        '<button class="btn soft sm" id="applyPreset" style="margin-bottom:14px">'+esc(t('Apply preset'))+'</button>' +
        q.map(l => {
          const ready = requiredFilled(l);
          return '<div class="lead"><div class="checkbox '+(batchSel.has(l.id)?'on':'')+'" data-sel="'+l.id+'">'+(batchSel.has(l.id)?ic.check:'')+'</div>' +
            '<div class="meta" data-open="'+l.id+'"><div class="name">'+esc((l.first+' '+l.last).trim()||t('Unnamed'))+'</div><div class="co">'+esc(l.company||'—')+'</div>' +
            '<div class="tags">'+statusPill(l.status)+(ready?'<span class="pill green">'+esc(t('complete'))+'</span>':'<span class="pill amber">'+esc(t('missing fields'))+'</span>')+'</div></div>'+ic.chevR+'</div>';
        }).join('') +
        '<button class="btn primary" id="sendSel" style="margin-top:6px">'+ic.send+' '+esc(I18N.lang === 'it' ? 'Invia selezionati' : 'Send selected')+' ('+batchSel.size+')</button>'
      ) : '<div class="list-empty">'+ic.empty+'<p>'+esc(t('Queue is empty.'))+'</p><button class="btn primary sm" data-nav="#/scan" style="margin:0 auto">'+esc(t('Capture cards'))+'</button></div>');
    shell(t('Batch queue'), tp('n_cards', q.length), body, null, { back:'#/home', bind(){
      app.querySelectorAll('[data-sel]').forEach(c => c.onclick = () => { const id=c.getAttribute('data-sel'); batchSel.has(id)?batchSel.delete(id):batchSel.add(id); batchScreen(); });
      app.querySelectorAll('[data-open]').forEach(m => m.onclick = () => go('#/lead?id=' + m.getAttribute('data-open')));
      const ap=$('#applyPreset'); if(ap) ap.onclick = () => { const ev=activeEvent(); if(!ev){ toast(t('No active event'),'err'); return; } q.forEach(l=>{ if(!l.provenienza)l.provenienza=sourceLabel(); if(ev.preset.country)l.country=ev.preset.country; if(ev.preset.interesse)l.interesse=ev.preset.interesse; if(!l.ownerId)l.ownerId=user().id; if(requiredFilled(l))l.status='Ready'; }); q.forEach(saveLead); toast(t('Preset applied to queue'),'ok'); batchScreen(); };
      const ss=$('#sendSel'); if(ss) ss.onclick = async () => {
        if(!batchSel.size){ toast(t('Select at least one lead'),'err'); return; }
        if(!S.online){ let q2=0; batchSel.forEach(id=>{ const l=DB.leads.find(x=>x.id===id); if(l&&requiredFilled(l)){ l.status='Ready'; l.queuedOffline=true; q2++; } }); batchSel.clear(); saveState(); toast(tp('n_leads_queued_offline', q2),'' ); batchScreen(); return; }
        ss.disabled=true; ss.innerHTML='<div class="spinner"></div> '+esc(t('Sending…'));
        let sent=0, fail=0, skip=0;
        const ids=Array.from(batchSel);
        for(const id of ids){ const l=DB.leads.find(x=>x.id===id); if(!l){continue;} if(!requiredFilled(l)||(DB.requireConsent&&!l.consentAt)){ skip++; continue; } const ok=await deliverLead(l); ok?sent++:fail++; }
        batchSel.clear(); saveState();
        toast(I18N.lang === 'it'
          ? (sent+' inviati'+(fail?', '+fail+' non riusciti':'')+(skip?', '+skip+' saltati (incompleti)':''))
          : (sent+' sent'+(fail?', '+fail+' failed':'')+(skip?', '+skip+' skipped (incomplete)':'')), fail?'err':'ok'); batchScreen();
      };
    }});
  }

  /* ---------- Dashboard ---------- */
  function dashScreen() {
    const admin = isAdmin();
    const scope = admin ? DB.leads : DB.leads.filter(l => l.createdBy === user().id || l.ownerId === user().id);
    const total = scope.length;
    const sent = scope.filter(l=>l.status==='Sent').length;
    const rate = total ? Math.round(sent/total*100) : 0;
    const byState = Object.keys(STATUS).map(s => [s, scope.filter(l=>l.status===s).length]);
    let body =
      '<div class="stats" style="margin-bottom:14px">' +
        stat(total,t('Total leads'),'i') + stat(sent,t('Sent to CRM'),'g') +
        stat(scope.filter(l=>l.status==='To finalize'||l.status==='Captured').length,statusLabel('To finalize'),'a') +
        stat(scope.filter(l=>l.status==='Error').length,t('Errors'),'r') +
      '</div>' +
      '<div class="card"><h3>'+esc(t('Send rate'))+'</h3><p class="hint">'+esc(t('Leads delivered to Brevo + Excel'))+'</p><div class="bar"><span style="width:'+rate+'%"></span></div><p style="text-align:right;font-weight:700;margin:8px 0 0">'+rate+'%</p></div>' +
      '<div class="card"><h3>'+esc(t('By status'))+'</h3>' + byState.map(([s,n]) => '<div class="kv"><span class="k">'+statusPill(s)+'</span><span class="v">'+n+'</span></div>').join('') + '</div>';

    if (admin) {
      const byEvent = DB.events.map(e => [e.name, DB.leads.filter(l=>l.eventId===e.id).length]).filter(x=>x[1]);
      const bySeller = DB.users.filter(u=>u.role==='seller').map(u=>[u.name, DB.leads.filter(l=>l.ownerId===u.id).length]).filter(x=>x[1]);
      body +=
        '<div class="card"><h3>'+esc(t('Leads by event'))+'</h3>' + byEvent.map(([n,c])=>'<div class="kv"><span class="k">'+esc(n)+'</span><span class="v">'+c+'</span></div>').join('') + '</div>' +
        '<div class="card"><h3>'+esc(t('Leads by owner'))+'</h3>' + bySeller.map(([n,c])=>'<div class="kv"><span class="k">'+esc(n)+'</span><span class="v">'+c+'</span></div>').join('') + '</div>' +
        '<div class="btnrow"><button class="btn ghost" id="csv">'+esc(t('Export CSV'))+'</button>' +
        (DB.ms && DB.ms.fileUrl ? '<button class="btn ghost" id="xlsx">'+esc(t('Open Excel'))+'</button>' : '') + '</div>';
    } else {
      body += '<div class="btnrow"><button class="btn ghost" id="csv">'+esc(t('Export CSV'))+'</button></div>';
    }
    shell(t('Dashboard'), admin?t('Company overview'):t('My performance'), body, '#/dashboard', { bind(){
      const c=$('#csv'); if(c) c.onclick=()=>exportCsv();
      const x=$('#xlsx'); if(x) x.onclick=()=>window.open(DB.ms.fileUrl, '_blank', 'noopener');
    }});
  }

  /* ---------- Admin ---------- */
  function adminScreen() {
    const rows = [
      [t('Events'), tp('n_events', DB.events.length), '#/admin/events', ic.home],
      [t('Team & access'), tp('n_users', DB.users.length), '#/admin/team', ic.leads],
      [t('Sources'), tp('n_values', pick('provenienza').length), '#/admin/sources', ic.grid],
      [t('Segments'), tp('n_values', pick('interesse').length), '#/admin/segments', ic.grid],
      [t('Destinations'), (DB.brevoApiKey?t('Brevo connected'):t('Brevo not configured')), '#/admin/dest', ic.send]
    ];
    const body =
      rows.map(r => '<button class="rowbtn" data-nav="'+r[2]+'"><div class="lead-ic">'+r[3]+'</div><div style="flex:1"><div style="font-weight:600">'+esc(r[0])+'</div><div class="hint" style="margin:0">'+esc(r[1])+'</div></div>'+ic.chevR+'</button>').join('') +
      langCard() +
      '<div class="section-title">' + esc(t('Data')) + '</div>' +
      '<button class="btn danger" id="resetDemo">' + esc(t('Reset app data on this device')) + '</button>' +
      '<p class="hint" style="text-align:center;margin-top:8px">' + esc(t('Clears locally-saved leads and configuration on this device. Does not affect Brevo.')) + '</p>';
    shell(t('Admin'), DB.company.name, body, '#/admin', { bind(){
      bindLangCard();
      $('#resetDemo').onclick = () => modal('<h3>'+esc(t('Reset app data?'))+'</h3><p class="hint">'+esc(t('This clears all locally-saved leads and settings on this device. It does not affect Brevo.'))+'</p><button class="btn danger" id="doReset">'+esc(t('Yes, reset'))+'</button><button class="btn ghost" onclick="closeModal()" style="margin-top:8px">'+esc(t('Cancel'))+'</button>') || setTimeout(()=>{ const b=document.getElementById('doReset'); if(b) b.onclick=resetState; },0);
    }});
  }

  function adminTeam() {
    const me = user();
    const body = '<div class="banner">'+ic.info+'<div>'+esc(I18N.lang === 'it' ? 'Gli utenti elencati qui possono accedere con Google o con la loro email di lavoro. Chi non è in elenco resta fuori.' : 'Users listed here can sign in with Google or with their work email. Anyone not listed is blocked.')+'</div></div>' +
      DB.users.map(u => '<div class="lead"><div class="avatar">'+esc(initials(u.name||u.email))+'</div>' +
        '<div class="meta"><div class="name">'+esc(u.name||u.email)+(u.id===me.id?' <span class="pill gray">'+esc(t('you'))+'</span>':'')+'</div>' +
        '<div class="co">'+esc(u.email)+'</div>' +
        '<div class="tags"><span class="pill '+(u.role==='admin'?'indigo':'gray')+'">'+esc(u.role==='admin'?t('Admin'):t('Seller'))+'</span>'+(u.status==='active'?'':'<span class="pill red">'+esc(t('disabled'))+'</span>')+(u.activated===false?'<span class="pill amber">'+esc(t('invitation pending'))+'</span>':'')+'</div></div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">' +
          '<div class="switch '+(u.status==='active'?'on':'')+'" data-u="'+u.id+'" title="'+esc(t('Enable / disable'))+'"></div>' +
          (u.id!==me.id?'<button class="pill gray" data-role="'+u.id+'" style="border:none;cursor:pointer">'+esc(u.role==='admin'?t('make seller'):t('make admin'))+'</button>':'') +
          (u.activated===false?'<button class="pill blue" data-resend="'+u.id+'" style="border:none;cursor:pointer">'+esc(t('resend invitation'))+'</button>':'') +
        '</div></div>').join('') +
      '<button class="btn primary" id="invite" style="margin-top:8px">'+ic.plus+' '+esc(t('Add user'))+'</button>';
    shell(t('Team & access'), tp('n_users', DB.users.length), body, null, { back:'#/admin', bind(){
      app.querySelectorAll('[data-u]').forEach(sw => sw.onclick = () => {
        const u=DB.users.find(x=>x.id===sw.getAttribute('data-u'));
        if (u.id===me.id) { toast(t('You cannot disable your own account'),'err'); return; }
        if (u.role==='admin' && u.status==='active' && DB.users.filter(x=>x.role==='admin'&&x.status==='active').length<=1) { toast(t('Keep at least one active admin'),'err'); return; }
        u.status = u.status==='active'?'disabled':'active'; saveState(); push('PATCH','/users/'+u.id,{status:u.status}); toast((u.name||u.email)+' · '+(u.status==='active'?t('active'):t('disabled')),'ok'); adminTeam();
      });
      app.querySelectorAll('[data-role]').forEach(b => b.onclick = () => {
        const u=DB.users.find(x=>x.id===b.getAttribute('data-role'));
        if (u.role==='admin' && DB.users.filter(x=>x.role==='admin'&&x.status==='active').length<=1) { toast(t('Keep at least one admin'),'err'); return; }
        u.role = u.role==='admin'?'seller':'admin'; saveState(); push('PATCH','/users/'+u.id,{role:u.role}); toast((u.name||u.email)+' → '+(u.role==='admin'?t('Admin'):t('Seller')),'ok'); adminTeam();
      });
      app.querySelectorAll('[data-resend]').forEach(b => b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await api('POST', '/users/' + b.getAttribute('data-resend') + '/resend', {});
          toast(r.emailSent === false ? ((I18N.lang === 'it' ? 'Invio non riuscito: ' : 'Could not send: ') + (r.emailError || t('email not configured'))) : t('Invitation sent again'), r.emailSent === false ? 'err' : 'ok');
        } catch (e) { toast(e.message, 'err'); }
        b.disabled = false;
      });
      $('#invite').onclick = () => {
        modal('<h3>'+esc(t('Add user'))+'</h3><p class="hint">'+esc(t('They can then sign in with Google or their work email.'))+'</p>' +
          '<div class="field"><label>'+esc(t('Full name'))+'</label><input class="input" id="invName" placeholder="Mario Rossi"></div>' +
          '<div class="field"><label>'+esc(t('Work email'))+'</label><input class="input" id="invEmail" type="email" placeholder="nome@'+esc(DB.company.domain||'azienda.com')+'"></div>' +
          '<div class="field"><label>'+esc(t('Role'))+'</label><select class="input" id="invRole"><option value="seller">'+esc(t('Seller'))+'</option><option value="admin">'+esc(t('Admin'))+'</option></select></div>' +
          '<button class="btn primary" id="doInv">'+esc(t('Add user'))+'</button><button class="btn ghost" onclick="closeModal()" style="margin-top:8px">'+esc(t('Cancel'))+'</button>');
        setTimeout(()=>{ const d=document.getElementById('doInv'); if(d) d.onclick=()=>{
          const email=(document.getElementById('invEmail').value||'').trim().toLowerCase();
          const name=(document.getElementById('invName').value||'').trim();
          const role=document.getElementById('invRole').value;
          if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ toast(t('Enter a valid email'),'err'); return; }
          if(DB.users.some(u=>u.email.toLowerCase()===email)){ toast(t('That user already exists'),'err'); return; }
          push('POST','/users',{name:name,email:email,role:role,locale:I18N.lang})
            .then(r=>{ DB.users.push(r.user); saveState(); closeModal(); toast(t('User added — invitation email sent'),'ok'); adminTeam(); }).catch(()=>{});
        }; },0);
      };
    }});
  }

  // One screen per list: 'provenienza' → Sources, 'interesse' → Segments
  function adminPickList(type) {
    const meta = type === 'provenienza'
      ? { title: t('Sources'),
          hint: I18N.lang === 'it' ? 'Da dove arriva il contatto (es. "MECSPE 2026", "Passaggio allo stand", "Segnalazione"). Il commerciale ne sceglie uno quando qualifica il lead.' : 'Where the contact came from (e.g. "MECSPE 2026", "Booth walk-in", "Referral"). Sellers pick one when qualifying a lead.',
          ph: I18N.lang === 'it' ? 'es. Passaggio allo stand' : 'e.g. Booth walk-in' }
      : { title: t('Segments'),
          hint: I18N.lang === 'it' ? 'Che cosa interessa al contatto: le vostre linee di prodotto o aree di business. Il commerciale ne sceglie una quando qualifica il lead.' : 'What the contact is interested in — your product lines or business areas. Sellers pick one when qualifying a lead.',
          ph: I18N.lang === 'it' ? 'es. Automazione industriale' : 'e.g. Industrial Automation' };
    const values = DB.pickLists[type];
    const rows = values.length
      ? values.map(v => '<div class="lead" style="padding:10px 12px"><div class="meta"><div class="name">'+esc(v.value)+'</div>' +
          '<div class="hint" style="margin:0">'+esc(v.active?t('Visible to sellers'):t('Hidden — kept on existing leads'))+'</div></div>' +
          '<div style="display:flex;align-items:center;gap:10px"><div class="switch '+(v.active?'on':'')+'" data-toggle="'+v.id+'" title="'+esc(t('Show / hide'))+'"></div>' +
          '<button class="pill red" data-del="'+v.id+'" style="border:none;cursor:pointer">'+esc(t('delete'))+'</button></div></div>').join('')
      : '<div class="list-empty">'+ic.empty+'<p>'+esc(t('No values yet. Add the first one below.'))+'</p></div>';
    const body = '<div class="banner">'+ic.info+'<div>'+esc(meta.hint)+'</div></div>' + rows +
      '<div class="card" style="margin-top:14px"><h3>'+esc(t('Add value'))+'</h3>' +
        '<div class="field" style="margin-bottom:10px"><input class="input" id="newVal" placeholder="'+esc(meta.ph)+'"></div>' +
        '<button class="btn primary" id="addVal">'+ic.plus+' '+esc(t('Add'))+'</button></div>';
    shell(meta.title, tp('n_values', values.length), body, '#/admin', { back:'#/admin', bind(){
      app.querySelectorAll('[data-toggle]').forEach(sw => sw.onclick = () => { const v=values.find(x=>x.id===sw.getAttribute('data-toggle')); v.active=!v.active; saveState(); push('PATCH','/picklists/'+v.id,{active:v.active}); adminPickList(type); });
      app.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
        const v = values.find(x=>x.id===b.getAttribute('data-del'));
        const used = DB.leads.filter(l => (type==='provenienza'?l.provenienza:l.interesse) === v.value).length;
        modal('<h3>'+esc(I18N.lang === 'it' ? 'Eliminare "'+v.value+'"?' : 'Delete "'+v.value+'"?')+'</h3><p class="hint">'+esc((used ? tp('n_used_by_leads', used) : '') + t('It will no longer be selectable.'))+'</p>' +
          '<button class="btn danger" id="delYes">'+esc(t('Delete'))+'</button><button class="btn ghost" onclick="closeModal()" style="margin-top:8px">'+esc(t('Cancel'))+'</button>');
        setTimeout(()=>{ const y=document.getElementById('delYes'); if(y) y.onclick=()=>{ DB.pickLists[type]=values.filter(x=>x.id!==v.id); saveState(); push('DELETE','/picklists/'+v.id); closeModal(); toast(t('Value deleted'),'ok'); adminPickList(type); }; },0);
      });
      const add = () => {
        const inp = $('#newVal'); const val = (inp.value||'').trim();
        if (!val) { toast(t('Type a value first'),'err'); return; }
        if (values.some(x => x.value.toLowerCase() === val.toLowerCase())) { toast(t('That value already exists'),'err'); return; }
        push('POST','/picklists',{ kind: type==='provenienza'?'source':'segment', value: val })
          .then(r => { DB.pickLists[type].push(r.item); saveState(); toast(t('Value added'),'ok'); adminPickList(type); })
          .catch(()=>{});
      };
      $('#addVal').onclick = add;
      $('#newVal').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    }});
  }

  // Same column order as the Excel table, so the two exports stay comparable.
  function exportCsv() {
    const head = I18N.lang === 'it'
      ? ['Data acquisizione','Evento','Nome','Cognome','Azienda','Ruolo','Email','Telefono','Sito web','Indirizzo','Provenienza','Country','Segmento','Assegnato a','Caricato da','Stato','Consenso']
      : ['Date','Event','First name','Last name','Company','Role','Email','Phone','Website','Address','Source','Country','Segment','Assigned to','Captured by','Status','Consent'];
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const evName = id => (DB.events.find(e => e.id === id) || {}).name || '';
    const rows = DB.leads.map(l => [
      new Date(l.ts).toISOString().slice(0, 16).replace('T', ' '), evName(l.eventId),
      l.first, l.last, l.company, l.role, l.email, l.phone, l.website, l.address,
      l.provenienza, l.country, l.interesse, userName(l.ownerId), userName(l.createdBy),
      statusLabel(l.status), l.consentAt ? new Date(l.consentAt).toISOString().slice(0, 10) : ''
    ].map(q).join(','));
    const csv = '﻿' + [head.map(q).join(',')].concat(rows).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'bizca-leads-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(tp('n_leads_exported', DB.leads.length), 'ok');
  }

  /* ---------- Microsoft 365 · Excel on SharePoint ---------- */
  let msShowOwn = false;   // reveal the "own app registration" fields
  let msTables = null;     // table names found in the selected workbook
  let msReport = null;     // last test result, shown under the buttons

  function msCard(m) {
    const hasOwn = !!(m.clientId && m.hasOwnSecret);
    const showOwn = msShowOwn || hasOwn || !m.platformApp;
    const tables = msTables || (m.tableName ? [m.tableName] : []);

    const consent = (m.platformApp && !hasOwn)
      ? '<p class="hint" style="margin:0 0 10px">'+esc(I18N.lang === 'it' ? 'Il vostro amministratore IT approva Bizca una volta sola per il tenant Microsoft: nessuna credenziale da scambiare.' : 'Your IT admin approves Bizca once for your Microsoft tenant — no credentials to hand over.')+'</p>' +
        (m.tenantId ? '<div class="kv"><span class="k">'+esc(t('Tenant authorised'))+'</span><span class="pill green">'+ic.check+' '+esc(String(m.tenantId).slice(0,8))+'…</span></div>' : '') +
        '<div class="btnrow" style="margin-top:10px"><button class="btn soft sm" id="msConsent">'+esc(m.tenantId?t('Re-run consent'):t('Grant admin consent'))+'</button></div>'
      : '';

    const ownFields = showOwn
      ? '<div class="field"><label>'+esc(t('Directory (tenant) ID'))+'</label><input class="input" id="msTenant" value="'+esc(m.tenantId||'')+'" placeholder="00000000-0000-0000-0000-000000000000" autocomplete="off"></div>' +
        '<div class="field"><label>'+esc(t('Application (client) ID'))+'</label><input class="input" id="msClient" value="'+esc(m.clientId||'')+'" placeholder="'+esc(I18N.lang === 'it' ? 'solo se il vostro IT ha registrato un\'app propria' : 'only if your IT registered their own app')+'" autocomplete="off"></div>' +
        '<div class="field"><label>'+esc(t('Client secret'))+'</label><input class="input" id="msSecret" type="password" placeholder="'+esc(m.hasOwnSecret?(I18N.lang === 'it' ? '•••••••••• salvato' : '•••••••••• saved'):(I18N.lang === 'it' ? 'incollalo una volta — resta sul server' : 'paste once — kept on the server'))+'" autocomplete="off"></div>' +
        '<div class="btnrow"><button class="btn soft sm" id="msSaveApp">'+esc(t('Save app details'))+'</button>' +
          (hasOwn ? '<button class="btn ghost sm" id="msClearApp">'+esc(t('Remove credentials'))+'</button>' : '') + '</div>'
      : '<div class="btnrow" style="margin-top:4px"><button class="btn ghost sm" id="msOwn">'+esc(t('Our IT registered their own app'))+'</button></div>';

    const fileBlock =
      '<div class="field"><label>'+esc(t('Link to the Excel file'))+'</label><input class="input" id="msUrl" value="'+esc(m.fileUrl||'')+'" placeholder="https://contoso.sharepoint.com/…/Leads.xlsx" autocomplete="off"></div>' +
      '<p class="hint" style="margin:-4px 0 10px">'+esc(I18N.lang === 'it' ? 'In Excel o SharePoint: Condividi → Copia collegamento. Il file deve contenere una tabella nominata (Inserisci → Tabella).' : 'In Excel or SharePoint: Share → Copy link. The workbook must contain a named table (Insert → Table).')+'</p>' +
      '<div class="btnrow"><button class="btn soft sm" id="msResolve">'+esc(t('Open file'))+'</button></div>' +
      (m.fileName ? '<div class="kv" style="margin-top:10px"><span class="k">'+esc(t('File'))+'</span><b style="font-size:13px">'+esc(m.fileName)+'</b></div>' : '') +
      (tables.length
        ? '<div class="field" style="margin-top:10px;margin-bottom:0"><label>'+esc(t('Table to write into'))+'</label><select class="input" id="msTable">' +
            tables.map(t => '<option value="'+esc(t)+'" '+(m.tableName===t?'selected':'')+'>'+esc(t)+'</option>').join('') +
          '</select></div>'
        : '');

    const report = msReport
      ? '<div class="banner" style="margin-top:10px">'+ (msReport.ok ? ic.check : ic.info) +'<div>'+msReport.html+'</div></div>'
      : (m.lastError ? '<div class="banner" style="margin-top:10px">'+ic.info+'<div>'+esc(I18N.lang === 'it' ? 'Ultimo errore: ' : 'Last error: ')+esc(m.lastError)+'</div></div>' : '');

    return '<div class="card"><h3>'+esc(t('Microsoft 365 — Excel on SharePoint'))+'</h3>' +
      '<p class="hint" style="margin:6px 0 14px">'+esc(I18N.lang === 'it' ? 'Ogni lead inviato a Brevo viene aggiunto anche come riga nel vostro file Excel condiviso. Le colonne si abbinano per nome dell\'intestazione, quindi potete riordinarle o aggiungerne di vostre.' : 'Every lead sent to Brevo is also appended as a row in your shared workbook. Columns are matched by header name, so you can reorder or add your own.')+'</p>' +
      '<h4 style="margin:0 0 8px;font-size:14px">1 · '+esc(t('Authorise Bizca'))+'</h4>' + consent + ownFields +
      '<h4 style="margin:18px 0 8px;font-size:14px">2 · '+esc(t('Choose the file'))+'</h4>' + fileBlock +
      '<h4 style="margin:18px 0 8px;font-size:14px">3 · '+esc(t('Check and switch on'))+'</h4>' +
      '<div class="btnrow"><button class="btn soft sm" id="msTest">'+esc(t('Test connection'))+'</button><button class="btn ghost sm" id="msTestRow">'+esc(t('Write a test row'))+'</button></div>' +
      report +
      '<div class="kv" style="margin-top:12px;border:none"><span class="k">'+esc(t('Send leads to Excel'))+'</span><div class="switch '+(m.enabled?'on':'')+'" id="msOn"></div></div>' +
      '</div>';
  }

  function bindMsCard() {
    const busy = (el, label) => { el.disabled = true; el.innerHTML = '<div class="spinner"></div> ' + label; };

    const consentFlag = /[?&]msconsent=1/.test(location.hash);
    if (consentFlag) {
      location.hash = '#/admin/dest';
      toast(t('Microsoft tenant authorised'), 'ok');
      pullState().then(() => adminDest()).catch(() => {});
      return;
    }
    if (/[?&]msconsent=0/.test(location.hash)) {
      const why = (location.hash.match(/msreason=([^&]*)/) || [])[1];
      location.hash = '#/admin/dest';
      toast(t('Consent was not granted') + (why ? ': ' + decodeURIComponent(why) : ''), 'err');
    }

    const own = $('#msOwn'); if (own) own.onclick = () => { msShowOwn = true; adminDest(); };

    const consent = $('#msConsent'); if (consent) consent.onclick = async () => {
      busy(consent, t('Opening…'));
      try {
        const d = await api('GET', '/ms/consent-url');
        window.open(d.url, '_blank', 'noopener');
        toast(t('Complete the approval in the Microsoft window, then come back'), 'ok');
      } catch (e) { toast(e.message, 'err'); }
      adminDest();
    };

    const saveApp = $('#msSaveApp'); if (saveApp) saveApp.onclick = async () => {
      const body = { tenantId: ($('#msTenant').value || '').trim(), clientId: ($('#msClient').value || '').trim() };
      const sec = ($('#msSecret').value || '').trim();
      if (sec) body.clientSecret = sec;
      if (!body.tenantId) { toast(t('Tenant ID is required'), 'err'); return; }
      busy(saveApp, t('Saving…'));
      try { const d = await api('PATCH', '/ms/config', body); DB.ms = d.ms; toast(t('Saved'), 'ok'); }
      catch (e) { toast(e.message, 'err'); }
      adminDest();
    };

    const clearApp = $('#msClearApp'); if (clearApp) clearApp.onclick = async () => {
      try { const d = await api('PATCH', '/ms/config', { clearSecret: true }); DB.ms = d.ms; msShowOwn = false; toast(t('Credentials removed'), 'ok'); }
      catch (e) { toast(e.message, 'err'); }
      adminDest();
    };

    const resolve = $('#msResolve'); if (resolve) resolve.onclick = async () => {
      const url = ($('#msUrl').value || '').trim();
      if (!url) { toast(t('Paste the link to the Excel file'), 'err'); return; }
      busy(resolve, t('Opening…'));
      msReport = null;
      try {
        const d = await api('POST', '/ms/resolve', { url });
        DB.ms = d.ms; msTables = d.tables || [];
        toast(msTables.length ? (d.file.name + ' — ' + tp('n_tables', msTables.length)) : t('Opened, but no named table found'), msTables.length ? 'ok' : 'err');
      } catch (e) { toast(e.message, 'err'); }
      adminDest();
    };

    const table = $('#msTable'); if (table) table.onchange = async () => {
      try { const d = await api('PATCH', '/ms/config', { tableName: table.value }); DB.ms = d.ms; toast(t('Table set'), 'ok'); }
      catch (e) { toast(e.message, 'err'); }
    };

    const runTest = async (btn, writeTest) => {
      busy(btn, writeTest ? t('Writing…') : t('Checking…'));
      try {
        const d = await api('POST', '/ms/test', { writeTest: !!writeTest });
        DB.ms = d.ms; msTables = d.tables || msTables;
        const mapped = (d.mapped || []).length, unknown = (d.unknown || []);
        msReport = { ok: true, html: I18N.lang === 'it'
          ? ('<b>La connessione funziona.</b> ' + esc(String(d.file || 'file')) + ' · tabella "' + esc(DB.ms.tableName || '') + '"<br>' +
             mapped + ' colonne su ' + (d.headers || []).length + ' riconosciute' +
             (unknown.length ? ' · non riconosciute, lasciate vuote: ' + esc(unknown.join(', ')) : '') +
             (d.wroteTestRow ? '<br>È stata aggiunta una riga di prova: cancellala quando hai finito.' : ''))
          : ('<b>Connection works.</b> ' + esc(String(d.file || 'workbook')) + ' · table "' + esc(DB.ms.tableName || '') + '"<br>' +
             mapped + ' of ' + (d.headers || []).length + ' columns matched' +
             (unknown.length ? ' · not recognised, left blank: ' + esc(unknown.join(', ')) : '') +
             (d.wroteTestRow ? '<br>A test row was added — delete it when you are done.' : '')) };
        toast(writeTest ? t('Test row written') : t('Connection OK'), 'ok');
      } catch (e) { msReport = { ok: false, html: esc(e.message) }; toast(e.message, 'err'); }
      adminDest();
    };
    const t1 = $('#msTest'); if (t1) t1.onclick = () => runTest(t1, false);
    const t2 = $('#msTestRow'); if (t2) t2.onclick = () => runTest(t2, true);

    const sw = $('#msOn'); if (sw) sw.onclick = async () => {
      const next = !(DB.ms && DB.ms.enabled);
      if (next && !(DB.ms && DB.ms.ready)) { toast(t('Finish steps 1 and 2 first'), 'err'); return; }
      try { const d = await api('PATCH', '/ms/config', { enabled: next }); DB.ms = d.ms; toast(t('Send leads to Excel') + ' · ' + (next ? t('enabled') : t('disabled')), 'ok'); }
      catch (e) { toast(e.message, 'err'); }
      adminDest();
    };
  }

  /* Which Brevo list people land in when they tick the newsletter box. Leaving
     it unset means nobody is ever subscribed by accident. */
  function newsletterCard() {
    const lists = brevoLists || [];
    const cur = DB.newsletterListId || '';
    return '<div class="card"><h3>' + esc(t('Newsletter')) + '</h3>' +
      '<p class="hint">' + esc(I18N.lang === 'it'
        ? 'Chi spunta la casella accanto alla firma viene iscritto a questa lista, oltre a quella della sessione. Se non ne scegli nessuna, resta solo l\'attributo sul contatto e nessuno viene iscritto.'
        : 'People who tick the box next to the signature are added to this list, on top of the session list. Leave it unset and only the contact attribute is written — nobody gets subscribed.') + '</p>' +
      (!DB.brevoApiKey
        ? '<p class="hint" style="margin:0">' + esc(I18N.lang === 'it' ? 'Serve prima la chiave Brevo.' : 'Add the Brevo key first.') + '</p>'
        : !lists.length
          ? '<p class="hint" style="margin:0">' + esc(t('Loading your Brevo lists…')) + '</p>'
          : '<div class="field" style="margin-bottom:0"><label>' + esc(t('Newsletter list')) + '</label>' +
            '<select class="input" id="newsList"><option value="">' + esc(t('— none —')) + '</option>' +
            lists.map(l => '<option value="' + l.id + '" ' + (cur === l.id ? 'selected' : '') + '>' + esc(l.name) + ' (#' + l.id + ')</option>').join('') +
            '</select></div>') +
      '</div>';
  }

  function adminDest() {
    const m = DB.ms || {};
    const msLive = m.enabled && m.ready;
    const badge = d => d.type === 'brevo'
      ? '<span class="pill green">' + ic.check + ' ' + esc(t('live')) + '</span>'
      : (msLive ? '<span class="pill green">' + ic.check + ' ' + esc(t('live')) + '</span>'
                : (m.ready ? '<span class="pill amber">' + esc(t('ready — not enabled')) + '</span>' : '<span class="pill gray">' + esc(t('not configured')) + '</span>'));
    const detail = d => d.type === 'excel'
      ? (m.fileName ? (I18N.lang === 'it' ? 'Scrive su ' : 'Writing to ') + m.fileName + (m.tableName ? (I18N.lang === 'it' ? ' · tabella "' : ' · table "') + m.tableName + '"' : '') : t(d.detail))
      : t(d.detail);
    const keyMask = DB.brevoApiKey ? '•••• ' + DB.brevoApiKey.slice(-4) : t('not set — using server default');
    const body = DB.destinations.map(d => '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h3>'+esc(d.label)+'</h3>'+badge(d)+'</div><p class="hint" style="margin:6px 0 0">'+esc(detail(d))+'</p></div>').join('') +
      msCard(m) +
      '<div class="card"><h3>'+esc(t('Brevo account (API key)'))+'</h3><p class="hint">'+esc(I18N.lang === 'it' ? 'L\'amministratore imposta qui la chiave API di Brevo. Cambiala per puntare Bizca su un altro account Brevo. Attuale: ' : 'The admin sets the Brevo API key here. Change it to point Bizca at a different Brevo account. Current: ')+'<b>'+esc(keyMask)+'</b></p>' +
        '<div class="field" style="margin-bottom:10px"><label>'+esc(t('Brevo API key'))+'</label><input class="input" id="brevoKey" type="password" placeholder="xkeysib-…" autocomplete="off"></div>' +
        '<div class="btnrow"><button class="btn soft sm" id="brevoKeySave">'+esc(t('Save key'))+'</button>' + (DB.brevoApiKey ? '<button class="btn ghost sm" id="brevoKeyClear">'+esc(t('Use server default'))+'</button>' : '') + '</div>' +
        '<p class="hint" style="margin:10px 0 0">'+esc(I18N.lang === 'it' ? 'Salvata su questo dispositivo. Per una conservazione condivisa e cifrata usa un segreto lato server (consigliato in produzione).' : 'Stored on this device. For a shared, encrypted store use a server-side secret (recommended for production).')+'</p></div>' +
      '<div class="card"><h3>'+esc(t('Sending & consent'))+'</h3>' +
        '<div class="kv"><span class="k">'+esc(t('Auto-send when lead is Ready'))+'</span><div class="switch '+(DB.autoSend?'on':'')+'" id="auto"></div></div>' +
        '<div class="kv" style="border:none"><span class="k">'+esc(t('Require consent signature before sending'))+'</span><div class="switch '+(DB.requireConsent?'on':'')+'" id="reqConsent"></div></div></div>' +
      newsletterCard() +
      '<div class="card"><h3>'+esc(t('Brevo attributes'))+'</h3><p class="hint">'+esc(I18N.lang === 'it' ? 'Crea nel tuo account Brevo i campi contatto su cui Bizca scrive (nome, azienda, provenienza, paese, segmento, evento, titolare, consenso…). Da lanciare una volta sola per account.' : 'Create the contact fields Bizca maps to (name, company, source, country, interest, event, owner, consent…) in your Brevo account. Run once per account.')+'</p><button class="btn soft" id="brevoSetup">'+esc(t('Prepare Brevo attributes'))+'</button></div>' +
      '<div class="banner">'+ic.info+'<div>'+esc(I18N.lang === 'it' ? 'I lead finiscono nella lista Brevo impostata per ogni evento (Admin → Eventi) e vengono aggiunti alla tabella Excel condivisa quando la destinazione Microsoft è attiva.' : 'Leads route into the Brevo list set per event (Admin → Events), and are appended to the shared Excel table when the Microsoft destination is on.')+'</div></div>';
    shell(t('Destinations'), 'Brevo + Excel', body, null, { back:'#/admin', bind(){
      bindMsCard();
      if (DB.brevoApiKey && !brevoLists) loadBrevoLists().then(r => { if (r && location.hash.indexOf('#/admin/dest') === 0) adminDest(); });
      const nl = $('#newsList'); if (nl) nl.onchange = () => {
        DB.newsletterListId = nl.value ? parseInt(nl.value, 10) : null;
        saveState(); push('PATCH','/settings',{ newsletterListId: DB.newsletterListId });
        toast(t('Newsletter list updated'),'ok');
      };
      $('#auto').onclick = () => { DB.autoSend=!DB.autoSend; saveState(); push('PATCH','/settings',{autoSend:DB.autoSend}); toast(t('Auto-send when lead is Ready')+' · '+(DB.autoSend?t('enabled'):t('disabled')),'ok'); adminDest(); };
      $('#reqConsent').onclick = () => { DB.requireConsent=!DB.requireConsent; saveState(); push('PATCH','/settings',{requireConsent:DB.requireConsent}); toast(t('Consent')+' · '+(DB.requireConsent?(I18N.lang === 'it' ? 'obbligatorio' : 'required'):(I18N.lang === 'it' ? 'facoltativo' : 'optional')),'ok'); adminDest(); };
      const ks = $('#brevoKeySave'); if (ks) ks.onclick = () => { const v=($('#brevoKey').value||'').trim(); if(!v){toast(t('Enter a key'),'err');return;} DB.brevoApiKey=v; brevoLists=null; saveState(); push('PATCH','/settings',{brevoApiKey:v}); toast(t('Brevo key saved'),'ok'); adminDest(); };
      const kc = $('#brevoKeyClear'); if (kc) kc.onclick = () => { DB.brevoApiKey=''; brevoLists=null; saveState(); push('PATCH','/settings',{brevoApiKey:''}); toast(t('Brevo key removed'),'ok'); adminDest(); };
      const bs = $('#brevoSetup'); if (bs) bs.onclick = async () => {
        bs.disabled = true; bs.innerHTML = '<div class="spinner"></div> ' + esc(t('Preparing…'));
        try {
          const r = await fetch('/api/brevo-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: DB.brevoApiKey || undefined }) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
          const done = (d.created||[]).length, had = (d.existed||[]).length, bad = (d.failed||[]).length;
          toast(I18N.lang === 'it'
            ? (done + ' creati, ' + had + ' già presenti' + (bad ? ', ' + bad + ' non riusciti' : ''))
            : (done + ' created, ' + had + ' already existed' + (bad ? ', ' + bad + ' failed' : '')), bad ? 'err' : 'ok');
        } catch (e) { toast((I18N.lang === 'it' ? 'Preparazione non riuscita: ' : 'Setup failed: ') + e.message, 'err'); }
        adminDest();
      };
    }});
  }

  const fmtDates = e => {
    if (!e.startDate && !e.endDate) return e.dates || t('no dates set');
    const f = d => d ? new Date(d + 'T00:00:00').toLocaleDateString(I18N.lang === 'it' ? 'it-IT' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    return e.startDate && e.endDate && e.startDate !== e.endDate ? f(e.startDate) + ' – ' + f(e.endDate) : f(e.startDate || e.endDate);
  };

  function adminEvents() {
    const lists = brevoLists;
    const hasKey = !!DB.brevoApiKey;
    const listName = id => { if (!id) return null; const x = (lists || []).find(l => l.id === id); return x ? x.name : ((I18N.lang === 'it' ? 'lista #' : 'list #') + id); };
    const listSelect = e => {
      if (!hasKey) return '<p class="hint" style="margin:10px 0 0">' + (I18N.lang === 'it' ? 'Aggiungi la chiave API di Brevo in <b>Admin → Destinazioni</b> per scegliere una lista di destinazione.' : 'Add your Brevo API key in <b>Admin → Destinations</b> to choose a destination list.') + '</p>';
      if (!lists) return '<p class="hint" style="margin:10px 0 0">' + esc(t('Loading your Brevo lists…')) + '</p>';
      if (!lists.length) return '<p class="hint" style="margin:10px 0 0">' + esc(t('No lists found in your Brevo account.')) + '</p>';
      return '<div class="field" style="margin:10px 0 0"><label>' + esc(t('Brevo destination list')) + '</label><select class="input" data-evlist="'+e.id+'"><option value="">' + esc(t('— none —')) + '</option>' +
        lists.map(l => '<option value="'+l.id+'" '+(e.brevoListId===l.id?'selected':'')+'>'+esc(l.name)+' (#'+l.id+')</option>').join('') + '</select></div>';
    };
    const presetChips = e => {
      const chips = [e.preset.provenienza, e.preset.country && tc(e.preset.country), e.preset.interesse].filter(Boolean);
      return chips.length ? '<div class="tags" style="margin-top:8px">' + chips.map(c => '<span class="pill indigo">'+esc(c)+'</span>').join('') + '</div>' : '';
    };
    const list = DB.events.length
      ? DB.events.map(e => '<div class="card">' +
          '<div style="display:flex;justify-content:space-between;align-items:center"><h3>'+esc(e.name)+'</h3>' +
            (e.id===S.activeEventId ? '<span class="pill green">'+esc(t('active'))+'</span>' : '<button class="pill gray" data-setactive="'+e.id+'" style="border:none;cursor:pointer">'+esc(t('set active'))+'</button>') + '</div>' +
          '<p class="hint" style="margin:6px 0 0">'+esc(fmtDates(e))+'</p>' +
          presetChips(e) +
          (e.brevoListId ? '<div class="tags" style="margin-top:6px"><span class="pill green">'+ic.send+' Brevo: '+esc(listName(e.brevoListId))+'</span></div>' : '') +
          listSelect(e) +
          '<div class="btnrow" style="margin-top:12px"><button class="btn ghost sm" data-delev="'+e.id+'">'+esc(t('Delete'))+'</button></div>' +
        '</div>').join('')
      : '<div class="list-empty">'+ic.empty+'<p>'+esc(t('No events yet. Create your first trade show or event.'))+'</p></div>';
    const body = '<div class="banner">'+ic.info+'<div>'+esc(I18N.lang === 'it' ? 'Un evento raggruppa i biglietti che scansioni: precompila i campi di qualifica e instrada i lead nella lista Brevo che scegli qui.' : 'An event groups the cards you scan: it pre-fills the qualification fields and routes leads into the Brevo list you pick here.')+'</div></div>' +
      list + '<button class="btn primary" id="newEv" style="margin-top:6px">'+ic.plus+' '+esc(t('Create new event'))+'</button>';
    shell(t('Events'), tp('n_events', DB.events.length), body, '#/admin', { back:'#/admin', bind(){
      if (hasKey && !lists) loadBrevoLists().then(r => { if (r && location.hash.indexOf('#/admin/events') === 0) adminEvents(); });
      app.querySelectorAll('[data-evlist]').forEach(sel => sel.onchange = () => { const e=DB.events.find(x=>x.id===sel.getAttribute('data-evlist')); e.brevoListId = sel.value ? parseInt(sel.value,10) : null; saveState(); push('PATCH','/events/'+e.id,{brevoListId:e.brevoListId}); toast(e.brevoListId?((I18N.lang === 'it' ? 'I lead andranno in ' : 'Leads will go to ')+listName(e.brevoListId)):t('List cleared'),'ok'); adminEvents(); });
      app.querySelectorAll('[data-setactive]').forEach(b => b.onclick = () => { S.activeEventId = b.getAttribute('data-setactive'); saveState(); toast(t('Active event updated'),'ok'); adminEvents(); });
      app.querySelectorAll('[data-delev]').forEach(b => b.onclick = () => {
        const id = b.getAttribute('data-delev');
        const used = DB.leads.filter(l => l.eventId === id).length;
        modal('<h3>'+esc(t('Delete event?'))+'</h3><p class="hint">'+esc(used ? tp('n_leads_at_event', used) : t('This event has no leads.'))+'</p><button class="btn danger" id="delEvYes">'+esc(t('Delete event'))+'</button><button class="btn ghost" onclick="closeModal()" style="margin-top:8px">'+esc(t('Cancel'))+'</button>');
        setTimeout(()=>{ const y=document.getElementById('delEvYes'); if(y) y.onclick=()=>{ DB.events = DB.events.filter(x=>x.id!==id); if(S.activeEventId===id) S.activeEventId = DB.events.length?DB.events[0].id:null; saveState(); push('DELETE','/events/'+id); closeModal(); toast(t('Event deleted'),'ok'); adminEvents(); }; },0);
      });
      $('#newEv').onclick = () => {
        modal('<h3>'+esc(t('Create new event'))+'</h3><p class="hint">'+esc(t('You can set presets and the Brevo list right after.'))+'</p>' +
          '<div class="field"><label>'+esc(t('Event name'))+' <span class="req">*</span></label><input class="input" id="evn" placeholder="MECSPE 2026"></div>' +
          '<div class="grid2"><div class="field"><label>'+esc(t('Start date'))+'</label><input class="input" id="evStart" type="date"></div>' +
          '<div class="field"><label>'+esc(t('End date'))+'</label><input class="input" id="evEnd" type="date"></div></div>' +
          '<button class="btn primary" id="evAdd">'+esc(t('Create event'))+'</button><button class="btn ghost" onclick="closeModal()" style="margin-top:8px">'+esc(t('Cancel'))+'</button>');
        setTimeout(()=>{ const a=document.getElementById('evAdd'); if(a) a.onclick=()=>{
          const nm=(document.getElementById('evn').value||'').trim();
          if(!nm){ toast(t('Enter an event name'),'err'); return; }
          push('POST','/events',{name:nm,startDate:document.getElementById('evStart').value||null,endDate:document.getElementById('evEnd').value||null})
            .then(r=>{ const ne=Object.assign({preset:{provenienza:'',country:'',interesse:''}},r.event); DB.events.push(ne); if(!S.activeEventId) S.activeEventId=ne.id; saveState(); closeModal(); toast(t('Event created'),'ok'); adminEvents(); })
            .catch(()=>{});
        }; },0);
      };
    }});
  }

  /* ================= ROUTER ================= */
  function render() {
    const raw = location.hash || '#/login';
    const [path, query] = raw.split('?');
    const params = {}; if (query) query.split('&').forEach(p => { const [k,v]=p.split('='); params[k]=decodeURIComponent(v); });
    // Unconfigured install → welcome screen (sign in or register a company)
    // The invitation link arrives on a device that knows nothing yet: handle it first.
    if (path === '#/activate' && !S.user) { window.scrollTo(0,0); return activateScreen(params.email, params.token); }
    if (!DB.company.configured) {
      window.scrollTo(0,0);
      if (path === '#/setup') return setupScreen();
      if (path === '#/login') return loginScreen();
      if (path !== '#/welcome') return go('#/welcome');
      return welcomeScreen();
    }
    if (path === '#/setup' || path === '#/welcome' || path === '#/activate') return go(S.user ? '#/home' : '#/login');
    if (path !== '#/login' && !S.user) return go('#/login');
    window.scrollTo(0,0);
    switch (path) {
      case '#/login': return loginScreen();
      case '#/home': return homeScreen();
      case '#/scan': return scanScreen();
      case '#/lead': return leadScreen(params.id);
      case '#/leads': return leadsScreen();
      case '#/batch': return batchScreen();
      case '#/dashboard': return dashScreen();
      case '#/admin': return adminScreen();
      case '#/admin/team': return adminTeam();
      case '#/admin/sources': return adminPickList('provenienza');
      case '#/admin/segments': return adminPickList('interesse');
      case '#/admin/dest': return adminDest();
      case '#/admin/events': return adminEvents();
      default: return go('#/home');
    }
  }
  window.render = render;
  window.addEventListener('hashchange', render);

  /* ---------- start ---------- */
  (async function start() {
    loadState();                       // offline cache first, so something shows instantly
    applyLang();                       // before the first render, so nothing flashes in English

    // Coming back from Microsoft sign-in
    const msCode = (location.hash.match(/[?&]ms=([^&]+)/) || [])[1];
    const msErr = (location.hash.match(/[?&]mserror=([^&]+)/) || [])[1];
    if (msErr) { location.hash = '#/login'; toast(decodeURIComponent(msErr), 'err'); }
    else if (msCode) {
      location.hash = '#/login';
      try {
        const d = await api('POST', '/auth/microsoft/exchange', { code: decodeURIComponent(msCode) });
        setToken(d.token);
        await pullState();
        toast(t('Signed in with Microsoft'), 'ok');
        location.hash = '#/home';
        render();
        window.addEventListener('online', () => { if (getToken()) pullState().then(() => render()).catch(() => {}); });
        return;
      } catch (e) { toast(e.message, 'err'); }
    }

    // Coming back from the email confirmation link
    if (/[?&]verified=1/.test(location.hash)) { toast('Email confirmed — you can sign in now', 'ok'); location.hash = '#/login'; }
    else if (/[?&]verified=0/.test(location.hash)) { toast('That confirmation link is no longer valid', 'err'); location.hash = '#/login'; }

    if (getToken()) {
      try {
        await pullState();             // server is the source of truth
        if (!location.hash || ['#/login', '#/', '#/setup', '#/welcome'].indexOf(location.hash) >= 0) location.hash = '#/home';
      } catch (e) {
        if (e.status === 401) { setToken(''); S.user = null; location.hash = '#/login'; }
        else if (!DB.company.configured) location.hash = '#/welcome';
        // otherwise: stay on the cached workspace (offline)
      }
    } else {
      S.user = null;
      // Compare the path only: the activation link carries email and token in the query.
      const path = (location.hash || '').split('?')[0];
      if (['#/setup', '#/login', '#/activate'].indexOf(path) === -1) location.hash = DB.company.configured ? '#/login' : '#/welcome';
    }
    render();
    // Refresh from the server when the connection comes back
    window.addEventListener('online', () => { if (getToken()) pullState().then(() => render()).catch(() => {}); });
  })();
})();
