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
    DB.fallbackOwner = s.fallbackOwner || (DB.users[0] && DB.users[0].id) || null;
    S.user = DB.users.find(u => u.id === d.me.id) || null;
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

  /* ---------- helpers ---------- */
  const $ = sel => document.querySelector(sel);
  const esc = s => (s == null ? '' : String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])));
  const go = h => { location.hash = h; };
  const user = () => S.user;
  const isAdmin = () => S.user && S.user.role === 'admin';
  const initials = n => n.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
  const userName = id => (DB.users.find(u => u.id === id) || {}).name || '—';
  const activeEvent = () => DB.events.find(e => e.id === S.activeEventId) || DB.events[0];
  const pick = t => DB.pickLists[t].filter(v => v.active);

  /* ---------- persistence (localStorage) ---------- */
  const STORE_KEY = 'bizca-state-v1';
  function saveState() {
    try {
      const snap = {
        company: DB.company,
        leads: DB.leads, pickLists: DB.pickLists, events: DB.events,
        assignmentRules: DB.assignmentRules, users: DB.users, destinations: DB.destinations,
        fallbackOwner: DB.fallbackOwner, allowOverride: DB.allowOverride, autoSend: DB.autoSend,
        requireConsent: DB.requireConsent, brevoApiKey: DB.brevoApiKey,
        syncLog: DB.syncLog.slice(0, 300),
        session: { activeEventId: S.activeEventId, userId: S.user ? S.user.id : null }
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
      ['fallbackOwner','allowOverride','autoSend','requireConsent','brevoApiKey'].forEach(k => { if (d[k] !== undefined) DB[k] = d[k]; });
      if (d.session) {
        if (d.session.activeEventId) S.activeEventId = d.session.activeEventId;
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

  /* ---------- delivery (Brevo real · Excel simulated) ---------- */
  async function pushToBrevo(l) {
    const ownerName = userName(l.ownerId);
    const ev = DB.events.find(e => e.id === l.eventId) || {};
    const evName = ev.name || '';
    try {
      const res = await fetch('/api/send-brevo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: DB.brevoApiKey || undefined, listId: ev.brevoListId || undefined, lead: {
          first: l.first, last: l.last, company: l.company, role: l.role, email: l.email,
          phone: l.phone, website: l.website, address: l.address,
          provenienza: l.provenienza, country: l.country, interesse: l.interesse, event: evName, owner: ownerName,
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
    DB.syncLog.unshift({ leadId: l.id, dest: 'Excel', ok: true, ts: Date.now(), msg: 'Row added (simulated — Graph not configured)' });
    if (r.ok) { l.status = 'Sent'; l.error = null; l.queuedOffline = false; }
    else { l.status = 'Error'; l.error = 'Brevo: ' + r.msg; }
    saveLead(l);
    api('POST', '/sync-log', { leadId: l.id, dest: 'Brevo', ok: r.ok, msg: r.ok ? (r.action || 'sent') : r.msg }).catch(() => {});
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
    const t = document.getElementById('toast');
    t.className = ''; t.innerHTML = (kind === 'ok' ? ic.check : kind === 'err' ? ic.alert : '') + '<span>' + esc(msg) + '</span>';
    if (kind) t.classList.add(kind);
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600);
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

  /* ---------- status ---------- */
  const STATUS = {
    'Captured':    { pill:'gray',  label:'Captured' },
    'To finalize': { pill:'amber', label:'To finalize' },
    'Ready':       { pill:'blue',  label:'Ready' },
    'Sent':        { pill:'green', label:'Sent' },
    'Error':       { pill:'red',   label:'Error' }
  };
  const statusPill = s => '<span class="pill ' + STATUS[s].pill + '">' + STATUS[s].label + '</span>';
  const requiredFilled = l => l.provenienza && l.country && l.interesse && (l.first || l.last);

  /* ---------- assignment engine ---------- */
  function assign(country, interesse) {
    for (const r of DB.assignmentRules.filter(r => r.active).sort((a,b) => a.priority - b.priority)) {
      const cOk = !r.countries.length || r.countries.includes(country);
      const iOk = !r.interests.length || r.interests.includes(interesse);
      if (cOk && iOk) return { owner: r.owner, ruleId: r.id, rule: r };
    }
    return { owner: DB.fallbackOwner, ruleId: null, rule: null };
  }
  function ruleSummary(r) {
    if (!r) return 'Fallback → default owner';
    const c = r.countries.length ? r.countries.join('/') : 'any country';
    const i = r.interests.length ? r.interests.join('/') : 'any segment';
    return 'Rule #' + r.priority + ': ' + c + ' + ' + i;
  }

  /* ================= SCREENS ================= */

  function shell(title, sub, body, activeTab, opts) {
    opts = opts || {};
    const back = opts.back ? '<button class="back" data-nav="' + opts.back + '">' + ic.chevL + 'Back</button>' : '';
    const brand = opts.brand ? '<div class="brandrow"><img src="icon-192.png" alt=""><div><div class="title">' + esc(title) + '</div><div class="sub">' + esc(sub) + '</div></div></div>' : '<div><div class="title">' + esc(title) + '</div>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>';
    const right = opts.right || '';
    const off = S.online ? '' : '<span class="pill offline-tag" style="margin-left:6px">Offline</span>';
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
      ['#/home','Home',ic.home],
      ['#/scan','Scan',ic.scan],
      ['#/leads','Leads',ic.leads],
      ['#/dashboard','Stats',ic.dash]
    ];
    if (isAdmin()) tabs.push(['#/admin','Admin',ic.admin]);
    return '<nav class="tabbar">' + tabs.map(t =>
      '<button class="tab ' + (active === t[0] ? 'active' : '') + '" data-nav="' + t[0] + '">' + t[2] + '<span>' + t[1] + '</span></button>'
    ).join('') + '</nav>';
  }

  function bindCommon() {
    app.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => go(b.getAttribute('data-nav'))));
  }

  /* ---------- Welcome (sign in or register a company) ---------- */
  function welcomeScreen() {
    app.innerHTML =
      '<div class="login">' +
        '<div class="brand"><img src="icon-512.png" alt="Bizca"><h1>Bizca</h1><p>Turn business cards into qualified leads</p></div>' +
        '<div class="card" style="box-shadow:var(--shadow-lg)">' +
          '<h3 style="text-align:center">Welcome</h3>' +
          '<p class="hint" style="text-align:center">Sign in if your company already uses Bizca, or create a new workspace.</p>' +
          '<button class="btn primary" id="wSignIn">Sign in</button>' +
          '<button class="btn ghost" id="wRegister" style="margin-top:10px">' + ic.plus + ' Register your company</button>' +
        '</div>' +
      '</div>';
    $('#wSignIn').onclick = () => go('#/login');
    $('#wRegister').onclick = () => go('#/setup');
  }

  /* ---------- Setup wizard (register a company) ---------- */
  function setupScreen() {
    app.innerHTML =
      '<div class="login" style="justify-content:flex-start;padding-top:40px">' +
        '<div class="brand"><img src="icon-512.png" alt="Bizca"><h1>Bizca</h1><p>Register your company</p></div>' +
        '<div class="card" style="box-shadow:var(--shadow-lg)">' +
          '<h3>Company</h3><p class="hint">This creates your workspace. You can configure everything else later in Admin.</p>' +
          '<div class="field"><label>Company name <span class="req">*</span></label><input class="input" id="coName" placeholder="Acme S.p.A."></div>' +
          '<div class="field"><label>Company domain <span class="req">*</span></label><input class="input" id="coDomain" placeholder="acme.com"></div>' +
          '<h3 style="margin-top:18px">Your admin account</h3>' +
          '<div class="field"><label>Full name <span class="req">*</span></label><input class="input" id="adName" placeholder="Jane Doe"></div>' +
          '<div class="field"><label>Work email <span class="req">*</span></label><input class="input" id="adEmail" type="email" placeholder="jane@acme.com"></div>' +
          '<div class="field"><label>Password <span class="req">*</span></label><input class="input" id="adPwd" type="password" placeholder="At least 8 characters" autocomplete="new-password"></div>' +
          '<label class="select-item" for="privacyOk" style="cursor:pointer;margin-top:14px">' +
            '<input type="checkbox" id="privacyOk" style="width:20px;height:20px;accent-color:var(--indigo)">' +
            '<span style="font-size:13px;color:var(--slate)">I have read and accept the <a href="https://www.bryan.it/privacy-policy" target="_blank" rel="noopener">privacy policy</a> and agree to the processing of my data. <span class="req">*</span></span>' +
          '</label>' +
          '<button class="btn primary" id="doSetup" style="margin-top:14px">Create workspace</button>' +
          (DB.company.configured ? '' : '<button class="btn ghost" id="backWelcome" style="margin-top:10px">Back</button>') +
        '</div>' +
      '</div>';
    const bw = $('#backWelcome'); if (bw) bw.onclick = () => go('#/welcome');
    $('#doSetup').onclick = async () => {
      const name = ($('#coName').value || '').trim();
      const domain = ($('#coDomain').value || '').trim().toLowerCase().replace(/^@/, '');
      const adName = ($('#adName').value || '').trim();
      const adEmail = ($('#adEmail').value || '').trim().toLowerCase();
      const pwd = $('#adPwd').value || '';
      if (!name || !domain || !adName || !adEmail || !pwd) { toast('Fill in the required fields', 'err'); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adEmail)) { toast('Enter a valid email address', 'err'); return; }
      if (pwd.length < 8) { toast('Password must be at least 8 characters', 'err'); return; }
      if (!$('#privacyOk').checked) { toast('Please accept the privacy policy to continue', 'err'); return; }
      const btn = $('#doSetup'); btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Creating…';
      try {
        const r = await api('POST', '/auth/register', { company: name, domain, name: adName, email: adEmail, password: pwd, privacy: true });
        checkEmailScreen(adEmail, r.emailSent === false ? (r.emailError || 'the confirmation email could not be sent') : null);
      } catch (e) {
        toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'Create workspace';
      }
    };
  }

  /* ---------- "check your inbox" after registering ---------- */
  function checkEmailScreen(email, mailProblem) {
    app.innerHTML =
      '<div class="login">' +
        '<div class="brand"><img src="icon-512.png" alt="Bizca"><h1>Bizca</h1><p>One last step</p></div>' +
        '<div class="card" style="box-shadow:var(--shadow-lg);text-align:center">' +
          '<h3>Check your inbox</h3>' +
          (mailProblem
            ? '<div class="banner" style="background:#FEF2F2;border-color:#FECACA;color:#991B1B;text-align:left">' + ic.alert + '<div>Your account was created, but we could not send the confirmation email: ' + esc(mailProblem) + '. Contact your Bizca administrator.</div></div>'
            : '<p class="hint">We sent a confirmation link to <b>' + esc(email) + '</b>. Click it to activate your workspace, then sign in.</p>') +
          '<button class="btn primary" id="goLogin">Go to sign in</button>' +
          '<button class="btn ghost" id="resend" style="margin-top:10px">Resend email</button>' +
        '</div>' +
      '</div>';
    $('#goLogin').onclick = () => go('#/login');
    $('#resend').onclick = async () => {
      const b = $('#resend'); b.disabled = true;
      try { const r = await api('POST', '/auth/resend', { email }); toast(r.emailSent === false ? ('Could not send: ' + (r.emailError || 'email not configured')) : 'Email sent again', r.emailSent === false ? 'err' : 'ok'); }
      catch (e) { toast(e.message, 'err'); }
      b.disabled = false;
    };
  }

  /* ---------- Login ---------- */
  let googleReady = false;
  function loginScreen() {
    app.innerHTML =
      '<div class="login">' +
        '<div class="brand"><img src="icon-512.png" alt="Bizca"><h1>Bizca</h1><p>Event Leads to CRM' + (DB.company.name ? ' · ' + esc(DB.company.name) : '') + '</p></div>' +
        '<div class="card" style="box-shadow:var(--shadow-lg)">' +
          '<div id="gBtn" style="display:flex;justify-content:center;min-height:44px"></div>' +
          '<button class="ms-btn" id="sso" style="margin-top:10px">' + ic.ms + 'Sign in with Microsoft</button>' +
          '<div class="divider">or</div>' +
          '<div class="field"><label>Work email</label><input class="input" id="email" type="email" placeholder="name@' + esc(DB.company.domain || 'company.com') + '" autocomplete="username"></div>' +
          '<div class="field"><label>Password</label><input class="input" id="pwd" type="password" placeholder="••••••••" autocomplete="current-password"></div>' +
          '<button class="btn primary" id="login">Sign in</button>' +
          (DB.company.configured
            ? '<p class="hint" style="text-align:center;margin:12px 0 0">Access is limited to users invited by your admin.</p>'
            : '<div class="banner" style="margin:14px 0 0">' + ic.info + '<div>No workspace on this device yet. If your company already uses Bizca, sign in with Google using your work account — otherwise register your company.</div></div>' +
              '<button class="btn ghost" id="backWelcome" style="margin-top:10px">Back</button>') +
        '</div>' +
      '</div>';
    const bw = $('#backWelcome'); if (bw) bw.onclick = () => go('#/welcome');
    const signInEmail = async () => {
      const email = ($('#email').value || '').trim().toLowerCase();
      const pwd = $('#pwd').value || '';
      if (!email || !pwd) { toast('Enter your work email and password', 'err'); return; }
      const btn = $('#login'); if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Signing in…'; }
      const reset = () => { if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; } };
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
    $('#sso').onclick = () => toast('Microsoft SSO is enabled once your IT completes the Azure AD setup');
    $('#login').onclick = signInEmail;
    $('#pwd').addEventListener('keydown', e => { if (e.key === 'Enter') signInEmail(); });
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
    if (!clientId) { host.innerHTML = '<p class="hint" style="margin:0">Google sign-in not configured yet.</p>'; return; }
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
    s.onerror = () => { host.innerHTML = '<p class="hint" style="margin:0">Google sign-in unavailable.</p>'; };
    document.head.appendChild(s);
  }

  window.onGoogleCredential = onGoogleCredential;
  async function onGoogleCredential(resp) {
    try {
      const d = await api('POST', '/auth/google', { credential: resp.credential });
      setToken(d.token);
      await pullState();
      toast('Signed in with Google', 'ok');
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
      (deferredPrompt ? '<button class="btn soft" id="installApp" style="margin-bottom:12px">' + ic.plus + ' Install Bizca on your device</button>' : '') +
      (S.online ? '' : '<div class="banner offline-tag" style="background:#FEF3C7;border-color:#FDE68A;color:#92400E">' + ic.info + '<div>You are offline. Captures and sends are queued and will sync automatically when you are back online.</div></div>') +
      (ev ? '<div class="banner">' + ic.info + '<div>Active event applies presets to every card you scan. Switch it anytime.</div></div>' +
        '<div class="card" style="background:linear-gradient(135deg,#EEF2FF,#ECFEFF)">' +
          '<div class="section-title" style="margin:0 0 6px">Active event</div>' +
          '<h3 style="font-size:18px">' + esc(ev.name) + '</h3>' +
          '<p class="hint" style="margin:2px 0 12px">' + esc(fmtDates(ev)) + ' · ' + presetSummary(ev) + '</p>' +
          '<button class="btn ghost sm" id="switchEv">Switch event</button>' +
        '</div>'
      : '<div class="card" style="background:linear-gradient(135deg,#EEF2FF,#ECFEFF)">' +
          '<div class="section-title" style="margin:0 0 6px">No event yet</div>' +
          '<p class="hint" style="margin:2px 0 12px">Create an event (trade show, fair) to apply presets to every card you scan.</p>' +
          (isAdmin() ? '<button class="btn ghost sm" data-nav="#/admin/events">Create event</button>' : '<p class="hint" style="margin:0">Ask your admin to create one.</p>') +
        '</div>') +
      '<button class="btn primary" data-nav="#/scan" style="margin-bottom:12px">' + ic.camera + ' Scan a business card</button>' +
      '<div class="btnrow" style="margin-bottom:8px">' +
        '<button class="btn soft" data-nav="#/batch">' + ic.grid + ' Batch (' + drafts + ')</button>' +
        '<button class="btn soft" data-nav="#/leads">' + ic.leads + ' My leads</button>' +
      '</div>' +
      '<div class="section-title">Quick status</div>' +
      '<div class="stats">' +
        stat(mine.length, 'Captured total', 'i') +
        stat(drafts, 'To finalize', 'a') +
        stat(ready, 'Ready to send', 'i') +
        stat(mine.filter(l=>l.status==='Sent').length, 'Sent', 'g') +
      '</div>';
    shell('Hi, ' + (user().name || user().email).split(' ')[0], DB.company.name + ' · ' + (isAdmin()?'Admin':'Seller'), body, '#/home', { brand:true, right:'<button class="iconbtn" id="userMenu" title="Account">'+ic.leads+'</button>',
      bind(){
        const sw = $('#switchEv'); if (sw) sw.onclick = eventPicker;
        $('#userMenu').onclick = () => {
          modal('<h3>Account</h3>' +
            '<div class="kv"><span class="k">Name</span><span class="v">'+esc(user().name||'—')+'</span></div>' +
            '<div class="kv"><span class="k">Email</span><span class="v">'+esc(user().email)+'</span></div>' +
            '<div class="kv"><span class="k">Role</span><span class="v">'+esc(user().role)+'</span></div>' +
            '<div class="kv" style="border:none"><span class="k">Company</span><span class="v">'+esc(DB.company.name)+'</span></div>' +
            '<button class="btn danger" id="doLogout" style="margin-top:14px">Sign out</button>' +
            '<button class="btn ghost" onclick="closeModal()" style="margin-top:8px">Close</button>');
          setTimeout(()=>{ const b=document.getElementById('doLogout'); if(b) b.onclick=()=>{ setToken(''); S.user=null; DB.leads=[]; saveState(); closeModal(); go('#/login'); }; },0);
        };
        const inst = $('#installApp'); if (inst) inst.onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); try { await deferredPrompt.userChoice; } catch(e){} deferredPrompt = null; render(); };
      }});
  }
  const presetSummary = ev => ['provenienza','country','interesse'].map(k => ev.preset[k]).filter(Boolean).join(' · ') || 'no presets';
  const stat = (n,l,c) => '<div class="stat"><div class="num '+(c||'')+'">'+n+'</div><div class="lbl">'+esc(l)+'</div></div>';

  function eventPicker() {
    modal('<h3 style="margin:0 0 4px">Select active event</h3><p class="hint">Presets pre-fill qualification fields.</p>' +
      DB.events.map(e => '<div class="select-item ' + (e.id===S.activeEventId?'sel':'') + '" data-ev="' + e.id + '"><div style="flex:1"><div style="font-weight:600">' + esc(e.name) + '</div><div class="hint" style="margin:0">' + esc(fmtDates(e)) + ' · ' + presetSummary(e) + '</div></div>' + (e.id===S.activeEventId?ic.check:'') + '</div>').join('') +
      '<button class="btn ghost" onclick="closeModal()" style="margin-top:8px">Close</button>');
    modalRoot.querySelectorAll('[data-ev]').forEach(x => x.onclick = () => { S.activeEventId = x.getAttribute('data-ev'); closeModal(); toast('Active event updated','ok'); render(); });
  }

  /* ---------- Scan ---------- */
  function scanScreen() {
    const body =
      '<div class="card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
          '<div><h3 style="margin:0">Scan card</h3><p class="hint" style="margin:0">Event: ' + esc(activeEvent() ? activeEvent().name : 'none') + '</p></div>' +
          '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:13px;font-weight:600;color:var(--slate)">Batch</span><div class="switch ' + (batchMode?'on':'') + '" id="batchToggle"></div></div>' +
        '</div>' +
        '<div class="scanview" id="scanview"><div class="frame"></div><div style="text-align:center;color:#94A3B8"><div style="width:46px;height:46px;margin:0 auto;color:#CBD5E1">' + ic.camera + '</div><div style="font-size:13px;margin-top:10px">Point at a business card</div></div></div>' +
        '<p class="hint" style="text-align:center;margin:12px 0">' + (batchMode ? 'Batch mode: shoot several cards in a row.' : 'Single mode: capture, then finalize now.') + '</p>' +
        '<button class="btn primary" id="capture">' + ic.camera + ' Capture card</button>' +
        '<button class="btn ghost" id="gallery" style="margin-top:10px">Choose from gallery</button>' +
        '<input type="file" accept="image/*" capture="environment" id="camInput" style="display:none">' +
        '<input type="file" accept="image/*" id="galInput" style="display:none">' +
      '</div>' +
      '<div class="banner">' + ic.bolt + '<div>A vision AI model reads the card and pre-fills name, company, role, email, phone, website and address. You confirm in a tap.</div></div>' +
      queuePreview();
    shell('Scan', null, body, '#/scan', { back:'#/home', bind(){
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
    return '<div class="section-title">In queue (' + q.length + ')</div>' +
      '<button class="rowbtn" data-nav="#/batch"><div class="lead-ic">' + ic.grid + '</div><div style="flex:1"><div style="font-weight:600">Batch queue</div><div class="hint" style="margin:0">' + q.length + ' card(s) to finalize</div></div>' + ic.chevR + '</button>';
  }
  function handleCardFile(file) {
    const sv = $('#scanview');
    if (sv) sv.innerHTML = '<div class="scanline"></div><div style="text-align:center"><div class="spinner" style="margin:0 auto 10px"></div><div style="color:#CBD5E1;font-size:13px">Reading card with AI…</div></div>';
    const cap = $('#capture'), gal = $('#gallery'); if (cap) cap.disabled = true; if (gal) gal.disabled = true;
    fileToDataURL(file, 1100, url => {
      if (!url) { toast('Could not read image', 'err'); scanScreen(); return; }
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
      provenienza: preset.provenienza || '', country: d.country || preset.country || '', interesse: preset.interesse || '',
      eventId: ev ? ev.id : null, ownerId: null, createdBy: user().id, status: 'To finalize', override: false, image: image, ts: Date.now()
    };
    if (lead.country && lead.interesse) lead.ownerId = assign(lead.country, lead.interesse).owner;
    DB.leads.unshift(lead);
    saveState(); saveLead(lead);
    if (isReal) toast('Card read with AI', 'ok');
    else toast('AI could not read the card — fill fields manually' + (errMsg ? ' (' + errMsg + ')' : ''), 'err');
    if (batchMode) scanScreen();
    else go('#/lead?id=' + lead.id);
  }

  /* ---------- Lead finalize / detail ---------- */
  function leadScreen(id) {
    const l = DB.leads.find(x => x.id === id);
    if (!l) return go('#/leads');
    const readOnly = l.status === 'Sent';
    const a = assign(l.country, l.interesse);
    if (l.status !== 'Sent' && !l.override) l.ownerId = (l.country && l.interesse) ? a.owner : l.ownerId;
    const provOpts = optList(pick('provenienza').map(v=>v.value), l.provenienza);
    const intOpts = optList(pick('interesse').map(v=>v.value), l.interesse);
    const ctryOpts = optList(DB.countries, l.country);
    const ownerOpts = DB.users.filter(u=>u.role==='seller').map(u=>'<option value="'+u.id+'" '+(u.id===l.ownerId?'selected':'')+'>'+esc(u.name)+'</option>').join('');

    const contact = ['first','last','company','role','email','phone','website','address'];
    const labels = { first:'First name', last:'Last name', company:'Company', role:'Role', email:'Email', phone:'Phone', website:'Website', address:'Address' };
    const contactFields = '<div class="grid2">' + contact.map((f,idx) =>
      (f==='address'||f==='company' ? '</div><div class="field" style="margin-bottom:10px"><label>'+labels[f]+'</label><input class="input" data-f="'+f+'" value="'+esc(l[f])+'" '+(readOnly?'disabled':'')+'></div><div class="grid2">'
       : '<div class="field"><label>'+labels[f]+'</label><input class="input" data-f="'+f+'" value="'+esc(l[f])+'" '+(readOnly?'disabled':'')+'></div>')
    ).join('') + '</div>';

    const body =
      '<div class="lead" style="margin-bottom:16px"><div class="avatar">' + esc(initials((l.first||'?')+' '+(l.last||''))) + '</div>' +
        '<div class="meta"><div class="name">' + esc((l.first+' '+l.last).trim()||'Unnamed') + '</div><div class="co">' + esc(l.company||'—') + '</div>' +
        '<div class="tags">' + statusPill(l.status) + (l.override?'<span class="pill indigo">override</span>':'') + '</div></div></div>' +

      (l.status==='Error' ? '<div class="banner" style="background:#FEF2F2;border-color:#FECACA;color:#991B1B">'+ic.alert+'<div>'+esc(l.error||'Send failed')+'</div></div>' : '') +

      '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3>Contact</h3><span class="pill indigo">'+ic.bolt+' AI extracted</span></div><p class="hint">Confirm or fix the fields below.</p>' + (l.image ? '<img src="'+l.image+'" alt="business card" style="width:100%;max-height:160px;object-fit:cover;border-radius:12px;margin-bottom:12px;border:1px solid var(--line)">' : '') + contactFields + '</div>' +

      '<div class="card"><h3>Qualification</h3><p class="hint">Required before sending. Managed as closed lists by admin.</p>' +
        '<div class="field"><label>Source <span class="req">*</span></label><select class="input" data-q="provenienza" '+(readOnly?'disabled':'')+'>'+provOpts+'</select></div>' +
        '<div class="field"><label>Country <span class="req">*</span></label><select class="input" data-q="country" '+(readOnly?'disabled':'')+'>'+ctryOpts+'</select></div>' +
        '<div class="field" style="margin-bottom:0"><label>Segment <span class="req">*</span></label><select class="input" data-q="interesse" '+(readOnly?'disabled':'')+'>'+intOpts+'</select></div>' +
      '</div>' +

      '<div class="card"><h3>Assignment</h3><p class="hint" id="ruleHint">' + esc(ruleSummary(a.rule)) + '</p>' +
        '<div class="field" style="margin-bottom:0"><label>Owner (seller)</label><select class="input" data-owner '+(readOnly||!DB.allowOverride?'disabled':'')+'>'+ownerOpts+'</select>' +
        (DB.allowOverride && !readOnly ? '<p class="hint" style="margin:6px 0 0">You can override the suggested owner.</p>' : '') + '</div>' +
      '</div>' +

      consentCard(l, readOnly) +

      (readOnly ? syncLogCard(l) :
        '<div class="btnrow"><button class="btn ghost" id="saveDraft">Save draft</button>' +
        '<button class="btn primary" id="send">' + ic.send + ' ' + (l.status==='Error'?'Retry send':'Send to Brevo') + '</button></div>' +
        '<p class="hint" style="text-align:center;margin-top:10px">Destinations: Brevo (CRM) + Excel on SharePoint · auto-dedupe by email</p>');

    shell('Lead', l.company||'', body, null, { back: history.length>1 ? null : '#/leads', right:'<button class="back" data-nav="#/leads">'+ic.chevL+'Leads</button>', bind(){
      // live updates
      app.querySelectorAll('[data-f]').forEach(inp => inp.oninput = () => { l[inp.getAttribute('data-f')] = inp.value; });
      app.querySelectorAll('[data-q]').forEach(sel => sel.onchange = () => {
        l[sel.getAttribute('data-q')] = sel.value;
        if (!l.override) { const na = assign(l.country, l.interesse); if (l.country && l.interesse) { l.ownerId = na.owner; } app.querySelector('[data-owner]').value = l.ownerId || ''; }
        $('#ruleHint').textContent = ruleSummary(assign(l.country, l.interesse).rule);
      });
      const ow = app.querySelector('[data-owner]'); if (ow) ow.onchange = () => { l.ownerId = ow.value; l.override = true; };
      const sd = $('#saveDraft'); if (sd) sd.onclick = () => { l.status = requiredFilled(l)?'Ready':'To finalize'; saveState(); saveLead(l); toast('Draft saved','ok'); go('#/leads'); };
      const sb = $('#send'); if (sb) sb.onclick = () => sendLead(l);
      const rs = $('#reSign'); if (rs) rs.onclick = () => { l.consentSignature = null; l.consentAt = null; saveState(); saveLead(l); leadScreen(l.id); };
      initSigPad(l);
    }});
  }

  function consentCard(l, readOnly) {
    const has = !!l.consentAt;
    const when = has ? new Date(l.consentAt).toLocaleString() : '';
    if (readOnly) {
      return '<div class="card"><h3>Consent</h3>' + (has
        ? '<div class="tags"><span class="pill green">'+ic.check+' Consent signed</span></div><p class="hint" style="margin:8px 0 0">'+esc(when)+'</p>' + (l.consentSignature ? '<img src="'+l.consentSignature+'" alt="signature" style="margin-top:8px;max-height:90px;border:1px solid var(--line);border-radius:10px;background:#fff">' : '')
        : '<p class="hint">No consent captured.</p>') + '</div>';
    }
    const req = DB.requireConsent;
    return '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3>Consent'+(req?' <span class="req">*</span>':'')+'</h3>'+(has?'<span class="pill green">'+ic.check+' signed</span>':'')+'</div>' +
      '<p class="hint">The contact agrees to be contacted by '+esc(DB.company.name)+' about the products and services discussed. Sign below.</p>' +
      (has && l.consentSignature
        ? '<img src="'+l.consentSignature+'" alt="signature" style="width:100%;max-height:120px;object-fit:contain;border:1px solid var(--line);border-radius:12px;background:#fff">' +
          '<button class="btn ghost sm" id="reSign" style="margin-top:10px">Re-sign</button>'
        : '<canvas id="sigPad" style="width:100%;height:150px;border:1.5px dashed var(--line);border-radius:12px;background:#fff;touch-action:none"></canvas>' +
          '<div class="btnrow" style="margin-top:10px"><button class="btn ghost sm" id="sigClear">Clear</button><button class="btn soft sm" id="sigSave">Save signature</button></div>') +
      (has ? '<p class="hint" style="margin:8px 0 0">Signed '+esc(when)+'</p>' : '') +
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
      if (!dirty) { toast('Please sign first', 'err'); return; }
      l.consentSignature = cv.toDataURL('image/png'); l.consentAt = Date.now(); saveState(); saveLead(l); toast('Consent captured', 'ok'); leadScreen(l.id);
    };
  }
  function optList(arr, sel) { return '<option value="">— select —</option>' + arr.map(v => '<option '+(v===sel?'selected':'')+'>'+esc(v)+'</option>').join(''); }

  async function sendLead(l) {
    if (!requiredFilled(l)) { toast('Fill all required qualification fields', 'err'); return; }
    if (DB.requireConsent && !l.consentAt) { toast('Consent signature required before sending', 'err'); return; }
    if (!S.online) { l.status = 'Ready'; l.queuedOffline = true; saveState(); toast('Offline — queued, will sync automatically', ''); go('#/leads'); return; }
    const btn = $('#send'); if (btn){ btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Sending…'; }
    const ok = await deliverLead(l);
    saveState();
    if (ok) toast('Sent to Brevo (+ Excel simulated)', 'ok');
    else toast('Brevo send failed — see details', 'err');
    go('#/leads');
  }
  function syncLogCard(l) {
    const logs = DB.syncLog.filter(s => s.leadId === l.id);
    return '<div class="card"><h3>Delivery</h3>' + (logs.length ? logs.map(s =>
      '<div class="kv"><span class="k">'+esc(s.dest)+'</span><span class="v">'+(s.ok?'<span class="pill green">'+ic.check+' '+esc(s.msg)+'</span>':'<span class="pill red">'+esc(s.msg)+'</span>')+'</span></div>').join('')
      : '<p class="hint">No delivery records.</p>') +
      '<div class="kv"><span class="k">Owner</span><span class="v">'+esc(userName(l.ownerId))+'</span></div>' +
      '<div class="kv"><span class="k">Captured by</span><span class="v">'+esc(userName(l.createdBy))+'</span></div></div>';
  }

  /* ---------- Leads list ---------- */
  let leadFilter = 'all';
  function leadsScreen() {
    const mine = isAdmin() ? DB.leads : DB.leads.filter(l => l.createdBy === user().id || l.ownerId === user().id);
    const filters = ['all','To finalize','Ready','Sent','Error'];
    const counts = f => f==='all' ? mine.length : mine.filter(l=>l.status===f).length;
    const chips = filters.map(f => '<button class="pill '+(leadFilter===f?'indigo':'gray')+'" data-filter="'+f+'" style="border:none">'+(f==='all'?'All':STATUS[f].label)+' · '+counts(f)+'</button>').join(' ');
    const list = mine.filter(l => leadFilter==='all' || l.status===leadFilter).sort((a,b)=>b.ts-a.ts);
    const body =
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">' + chips + '</div>' +
      (list.length ? list.map(leadRow).join('') :
        '<div class="list-empty">'+ic.empty+'<p>No leads here yet.</p><button class="btn primary sm" data-nav="#/scan" style="margin:0 auto">Scan a card</button></div>');
    shell('Leads', isAdmin()?'All company leads':'My leads', body, '#/leads', { fab:true, bind(){
      app.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { leadFilter = b.getAttribute('data-filter'); leadsScreen(); });
      app.querySelectorAll('[data-lead]').forEach(b => b.onclick = () => go('#/lead?id=' + b.getAttribute('data-lead')));
    }});
  }
  function leadRow(l) {
    return '<div class="lead" data-lead="'+l.id+'"><div class="avatar">'+esc(initials((l.first||'?')+' '+(l.last||'')))+'</div>' +
      '<div class="meta"><div class="name">'+esc((l.first+' '+l.last).trim()||'Unnamed')+'</div><div class="co">'+esc(l.company||'—')+' · '+esc(userName(l.ownerId)||'unassigned')+'</div>' +
      '<div class="tags">'+statusPill(l.status)+(l.country?'<span class="pill gray">'+esc(l.country)+'</span>':'')+(l.interesse?'<span class="pill blue">'+esc(l.interesse)+'</span>':'')+'</div></div>'+ic.chevR+'</div>';
  }

  /* ---------- Batch ---------- */
  const batchSel = new Set();
  function batchScreen() {
    const q = DB.leads.filter(l => l.createdBy === user().id && l.status !== 'Sent').sort((a,b)=>b.ts-a.ts);
    const body =
      '<div class="banner">'+ic.grid+'<div>Review captured cards, apply the event preset in bulk, auto-assign and send the ready ones.</div></div>' +
      (q.length ? (
        '<div class="btnrow" style="margin-bottom:14px"><button class="btn soft sm" id="applyPreset" style="flex:1">Apply preset</button><button class="btn soft sm" id="autoAssign" style="flex:1">Auto-assign</button></div>' +
        q.map(l => {
          const ready = requiredFilled(l);
          return '<div class="lead"><div class="checkbox '+(batchSel.has(l.id)?'on':'')+'" data-sel="'+l.id+'">'+(batchSel.has(l.id)?ic.check:'')+'</div>' +
            '<div class="meta" data-open="'+l.id+'"><div class="name">'+esc((l.first+' '+l.last).trim()||'Unnamed')+'</div><div class="co">'+esc(l.company||'—')+'</div>' +
            '<div class="tags">'+statusPill(l.status)+(ready?'<span class="pill green">complete</span>':'<span class="pill amber">missing fields</span>')+'</div></div>'+ic.chevR+'</div>';
        }).join('') +
        '<button class="btn primary" id="sendSel" style="margin-top:6px">'+ic.send+' Send selected ('+batchSel.size+')</button>'
      ) : '<div class="list-empty">'+ic.empty+'<p>Queue is empty.</p><button class="btn primary sm" data-nav="#/scan" style="margin:0 auto">Capture cards</button></div>');
    shell('Batch queue', q.length+' card(s)', body, null, { back:'#/home', bind(){
      app.querySelectorAll('[data-sel]').forEach(c => c.onclick = () => { const id=c.getAttribute('data-sel'); batchSel.has(id)?batchSel.delete(id):batchSel.add(id); batchScreen(); });
      app.querySelectorAll('[data-open]').forEach(m => m.onclick = () => go('#/lead?id=' + m.getAttribute('data-open')));
      const ap=$('#applyPreset'); if(ap) ap.onclick = () => { const ev=activeEvent(); if(!ev){ toast('No active event','err'); return; } q.forEach(l=>{ if(ev.preset.provenienza)l.provenienza=ev.preset.provenienza; if(ev.preset.country)l.country=ev.preset.country; if(ev.preset.interesse)l.interesse=ev.preset.interesse; if(requiredFilled(l)){const a=assign(l.country,l.interesse); if(!l.override)l.ownerId=a.owner; l.status='Ready';} }); q.forEach(saveLead); toast('Preset applied to queue','ok'); batchScreen(); };
      const aa=$('#autoAssign'); if(aa) aa.onclick = () => { let n=0; q.forEach(l=>{ if(l.country&&l.interesse){const a=assign(l.country,l.interesse); if(!l.override)l.ownerId=a.owner; if(requiredFilled(l))l.status='Ready'; n++;} }); q.forEach(saveLead); toast(n+' lead(s) assigned','ok'); batchScreen(); };
      const ss=$('#sendSel'); if(ss) ss.onclick = async () => {
        if(!batchSel.size){ toast('Select at least one lead','err'); return; }
        if(!S.online){ let q2=0; batchSel.forEach(id=>{ const l=DB.leads.find(x=>x.id===id); if(l&&requiredFilled(l)){ l.status='Ready'; l.queuedOffline=true; q2++; } }); batchSel.clear(); saveState(); toast(q2+' queued (offline) — will sync','' ); batchScreen(); return; }
        ss.disabled=true; ss.innerHTML='<div class="spinner"></div> Sending…';
        let sent=0, fail=0, skip=0;
        const ids=Array.from(batchSel);
        for(const id of ids){ const l=DB.leads.find(x=>x.id===id); if(!l){continue;} if(!requiredFilled(l)||(DB.requireConsent&&!l.consentAt)){ skip++; continue; } const ok=await deliverLead(l); ok?sent++:fail++; }
        batchSel.clear(); saveState();
        toast(sent+' sent'+(fail?', '+fail+' failed':'')+(skip?', '+skip+' skipped (incomplete)':''), fail?'err':'ok'); batchScreen();
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
        stat(total,'Total leads','i') + stat(sent,'Sent to CRM','g') +
        stat(scope.filter(l=>l.status==='To finalize'||l.status==='Captured').length,'To finalize','a') +
        stat(scope.filter(l=>l.status==='Error').length,'Errors','r') +
      '</div>' +
      '<div class="card"><h3>Send rate</h3><p class="hint">Leads delivered to Brevo + Excel</p><div class="bar"><span style="width:'+rate+'%"></span></div><p style="text-align:right;font-weight:700;margin:8px 0 0">'+rate+'%</p></div>' +
      '<div class="card"><h3>By status</h3>' + byState.map(([s,n]) => '<div class="kv"><span class="k">'+statusPill(s)+'</span><span class="v">'+n+'</span></div>').join('') + '</div>';

    if (admin) {
      const byEvent = DB.events.map(e => [e.name, DB.leads.filter(l=>l.eventId===e.id).length]).filter(x=>x[1]);
      const bySeller = DB.users.filter(u=>u.role==='seller').map(u=>[u.name, DB.leads.filter(l=>l.ownerId===u.id).length]).filter(x=>x[1]);
      const auto = DB.leads.filter(l=>l.ownerId&&!l.override).length, manual = DB.leads.filter(l=>l.override).length;
      body +=
        '<div class="card"><h3>Leads by event</h3>' + byEvent.map(([n,c])=>'<div class="kv"><span class="k">'+esc(n)+'</span><span class="v">'+c+'</span></div>').join('') + '</div>' +
        '<div class="card"><h3>Leads by owner</h3>' + bySeller.map(([n,c])=>'<div class="kv"><span class="k">'+esc(n)+'</span><span class="v">'+c+'</span></div>').join('') + '</div>' +
        '<div class="card"><h3>Assignment</h3><div class="kv"><span class="k">Auto-assigned</span><span class="v">'+auto+'</span></div><div class="kv"><span class="k">Manual override</span><span class="v">'+manual+'</span></div></div>' +
        '<div class="btnrow"><button class="btn ghost" id="csv">Export CSV</button><button class="btn ghost" id="xlsx">Open Excel</button></div>';
    } else {
      body += '<div class="btnrow"><button class="btn ghost" id="csv">Export CSV</button></div>';
    }
    shell('Dashboard', admin?'Company overview':'My performance', body, '#/dashboard', { bind(){
      const c=$('#csv'); if(c) c.onclick=()=>toast('CSV exported (mock)','ok');
      const x=$('#xlsx'); if(x) x.onclick=()=>toast('Opening shared Excel… (mock)');
    }});
  }

  /* ---------- Admin ---------- */
  function adminScreen() {
    const rows = [
      ['Events', DB.events.length+' event(s)', '#/admin/events', ic.home],
      ['Team & access', DB.users.length+' user(s)', '#/admin/team', ic.leads],
      ['Sources', pick('provenienza').length+' value(s)', '#/admin/sources', ic.grid],
      ['Segments', pick('interesse').length+' value(s)', '#/admin/segments', ic.grid],
      ['Assignment rules', DB.assignmentRules.filter(r=>r.active).length+' active rule(s)', '#/admin/rules', ic.bolt],
      ['Destinations', (DB.brevoApiKey?'Brevo connected':'Brevo not configured'), '#/admin/dest', ic.send]
    ];
    const body =
      rows.map(r => '<button class="rowbtn" data-nav="'+r[2]+'"><div class="lead-ic">'+r[3]+'</div><div style="flex:1"><div style="font-weight:600">'+esc(r[0])+'</div><div class="hint" style="margin:0">'+esc(r[1])+'</div></div>'+ic.chevR+'</button>').join('') +
      '<div class="section-title">Data</div>' +
      '<button class="btn danger" id="resetDemo">Reset app data on this device</button>' +
      '<p class="hint" style="text-align:center;margin-top:8px">Clears locally-saved leads and configuration on this device. Does not affect Brevo.</p>';
    shell('Admin', DB.company.name, body, '#/admin', { bind(){
      $('#resetDemo').onclick = () => modal('<h3>Reset app data?</h3><p class="hint">This clears all locally-saved leads and settings on this device. It does not affect Brevo.</p><button class="btn danger" id="doReset">Yes, reset</button><button class="btn ghost" onclick="closeModal()" style="margin-top:8px">Cancel</button>') || setTimeout(()=>{ const b=document.getElementById('doReset'); if(b) b.onclick=resetState; },0);
    }});
  }

  function adminTeam() {
    const me = user();
    const body = '<div class="banner">'+ic.info+'<div>Users listed here can sign in with Google or with their work email. Anyone not listed is blocked.</div></div>' +
      DB.users.map(u => '<div class="lead"><div class="avatar">'+esc(initials(u.name||u.email))+'</div>' +
        '<div class="meta"><div class="name">'+esc(u.name||u.email)+(u.id===me.id?' <span class="pill gray">you</span>':'')+'</div>' +
        '<div class="co">'+esc(u.email)+'</div>' +
        '<div class="tags"><span class="pill '+(u.role==='admin'?'indigo':'gray')+'">'+esc(u.role)+'</span>'+(u.status==='active'?'':'<span class="pill red">disabled</span>')+'</div></div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">' +
          '<div class="switch '+(u.status==='active'?'on':'')+'" data-u="'+u.id+'" title="Enable / disable"></div>' +
          (u.id!==me.id?'<button class="pill gray" data-role="'+u.id+'" style="border:none;cursor:pointer">make '+(u.role==='admin'?'seller':'admin')+'</button>':'') +
        '</div></div>').join('') +
      '<button class="btn primary" id="invite" style="margin-top:8px">'+ic.plus+' Add user</button>';
    shell('Team & access', DB.users.length + ' user(s)', body, null, { back:'#/admin', bind(){
      app.querySelectorAll('[data-u]').forEach(sw => sw.onclick = () => {
        const u=DB.users.find(x=>x.id===sw.getAttribute('data-u'));
        if (u.id===me.id) { toast('You cannot disable your own account','err'); return; }
        if (u.role==='admin' && u.status==='active' && DB.users.filter(x=>x.role==='admin'&&x.status==='active').length<=1) { toast('Keep at least one active admin','err'); return; }
        u.status = u.status==='active'?'disabled':'active'; saveState(); push('PATCH','/users/'+u.id,{status:u.status}); toast(esc(u.name||u.email)+' '+u.status,'ok'); adminTeam();
      });
      app.querySelectorAll('[data-role]').forEach(b => b.onclick = () => {
        const u=DB.users.find(x=>x.id===b.getAttribute('data-role'));
        if (u.role==='admin' && DB.users.filter(x=>x.role==='admin'&&x.status==='active').length<=1) { toast('Keep at least one admin','err'); return; }
        u.role = u.role==='admin'?'seller':'admin'; saveState(); push('PATCH','/users/'+u.id,{role:u.role}); toast(esc(u.name||u.email)+' is now '+u.role,'ok'); adminTeam();
      });
      $('#invite').onclick = () => {
        modal('<h3>Add user</h3><p class="hint">They can then sign in with Google or their work email.</p>' +
          '<div class="field"><label>Full name</label><input class="input" id="invName" placeholder="Jane Doe"></div>' +
          '<div class="field"><label>Work email</label><input class="input" id="invEmail" type="email" placeholder="name@'+esc(DB.company.domain||'company.com')+'"></div>' +
          '<div class="field"><label>Role</label><select class="input" id="invRole"><option value="seller">Seller</option><option value="admin">Admin</option></select></div>' +
          '<button class="btn primary" id="doInv">Add user</button><button class="btn ghost" onclick="closeModal()" style="margin-top:8px">Cancel</button>');
        setTimeout(()=>{ const d=document.getElementById('doInv'); if(d) d.onclick=()=>{
          const email=(document.getElementById('invEmail').value||'').trim().toLowerCase();
          const name=(document.getElementById('invName').value||'').trim();
          const role=document.getElementById('invRole').value;
          if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ toast('Enter a valid email','err'); return; }
          if(DB.users.some(u=>u.email.toLowerCase()===email)){ toast('That user already exists','err'); return; }
          push('POST','/users',{name:name,email:email,role:role})
            .then(r=>{ DB.users.push(r.user); saveState(); closeModal(); toast('User added — invitation email sent','ok'); adminTeam(); }).catch(()=>{});
        }; },0);
      };
    }});
  }

  // One screen per list: 'provenienza' → Sources, 'interesse' → Segments
  function adminPickList(type) {
    const meta = type === 'provenienza'
      ? { title: 'Sources', hint: 'Where the contact came from (e.g. "MECSPE 2026", "Booth walk-in", "Referral"). Sellers pick one when qualifying a lead.', ph: 'e.g. Booth walk-in' }
      : { title: 'Segments', hint: 'What the contact is interested in — your product lines or business areas. Sellers pick one when qualifying a lead.', ph: 'e.g. Industrial Automation' };
    const values = DB.pickLists[type];
    const rows = values.length
      ? values.map(v => '<div class="lead" style="padding:10px 12px"><div class="meta"><div class="name">'+esc(v.value)+'</div>' +
          '<div class="hint" style="margin:0">'+(v.active?'Visible to sellers':'Hidden — kept on existing leads')+'</div></div>' +
          '<div style="display:flex;align-items:center;gap:10px"><div class="switch '+(v.active?'on':'')+'" data-toggle="'+v.id+'" title="Show / hide"></div>' +
          '<button class="pill red" data-del="'+v.id+'" style="border:none;cursor:pointer">delete</button></div></div>').join('')
      : '<div class="list-empty">'+ic.empty+'<p>No values yet. Add the first one below.</p></div>';
    const body = '<div class="banner">'+ic.info+'<div>'+esc(meta.hint)+'</div></div>' + rows +
      '<div class="card" style="margin-top:14px"><h3>Add value</h3>' +
        '<div class="field" style="margin-bottom:10px"><input class="input" id="newVal" placeholder="'+esc(meta.ph)+'"></div>' +
        '<button class="btn primary" id="addVal">'+ic.plus+' Add</button></div>';
    shell(meta.title, values.length + ' value(s)', body, '#/admin', { back:'#/admin', bind(){
      app.querySelectorAll('[data-toggle]').forEach(sw => sw.onclick = () => { const v=values.find(x=>x.id===sw.getAttribute('data-toggle')); v.active=!v.active; saveState(); push('PATCH','/picklists/'+v.id,{active:v.active}); adminPickList(type); });
      app.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
        const v = values.find(x=>x.id===b.getAttribute('data-del'));
        const used = DB.leads.filter(l => (type==='provenienza'?l.provenienza:l.interesse) === v.value).length;
        modal('<h3>Delete "'+esc(v.value)+'"?</h3><p class="hint">'+(used ? 'It is used by '+used+' lead(s); their existing value is kept. ' : '')+'It will no longer be selectable.</p>' +
          '<button class="btn danger" id="delYes">Delete</button><button class="btn ghost" onclick="closeModal()" style="margin-top:8px">Cancel</button>');
        setTimeout(()=>{ const y=document.getElementById('delYes'); if(y) y.onclick=()=>{ DB.pickLists[type]=values.filter(x=>x.id!==v.id); saveState(); push('DELETE','/picklists/'+v.id); closeModal(); toast('Value deleted','ok'); adminPickList(type); }; },0);
      });
      const add = () => {
        const inp = $('#newVal'); const val = (inp.value||'').trim();
        if (!val) { toast('Type a value first','err'); return; }
        if (values.some(x => x.value.toLowerCase() === val.toLowerCase())) { toast('That value already exists','err'); return; }
        push('POST','/picklists',{ kind: type==='provenienza'?'source':'segment', value: val })
          .then(r => { DB.pickLists[type].push(r.item); saveState(); toast('Value added','ok'); adminPickList(type); })
          .catch(()=>{});
      };
      $('#addVal').onclick = add;
      $('#newVal').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    }});
  }

  function adminRules() {
    const sellers = DB.users.filter(u => u.status === 'active');
    const rules = DB.assignmentRules.slice().sort((a,b)=>a.priority-b.priority);
    const chips = (arr, label) => arr && arr.length
      ? arr.map(v => '<span class="pill gray">'+esc(v)+'</span>').join('')
      : '<span class="pill gray">any ' + label + '</span>';
    const list = rules.length
      ? rules.map((r, i) => '<div class="card" style="padding:14px">' +
          '<div style="display:flex;justify-content:space-between;align-items:start;gap:10px">' +
            '<div style="flex:1"><div style="font-weight:700">#'+(i+1)+' → '+esc(userName(r.owner))+'</div>' +
            '<div class="tags" style="margin-top:8px">'+chips(r.countries,'country')+'</div>' +
            '<div class="tags" style="margin-top:6px">'+chips(r.interests,'segment')+'</div></div>' +
            '<div class="switch '+(r.active?'on':'')+'" data-r="'+r.id+'" title="Enable / disable"></div>' +
          '</div>' +
          '<div class="btnrow" style="margin-top:12px">' +
            (i>0?'<button class="btn ghost sm" data-up="'+r.id+'">↑ Up</button>':'') +
            '<button class="btn ghost sm" data-edit="'+r.id+'">Edit</button>' +
            '<button class="btn ghost sm" data-delr="'+r.id+'">Delete</button>' +
          '</div></div>').join('')
      : '<div class="list-empty">'+ic.empty+'<p>No rules yet. Without rules, every lead goes to the default owner.</p></div>';
    const body = '<div class="banner">'+ic.info+'<div>Rules run top to bottom: the first match wins. A rule matches when the lead\'s country <b>and</b> segment are both in the rule (leave one empty to match any).</div></div>' +
      list +
      '<button class="btn primary" id="newRule" style="margin-top:6px">'+ic.plus+' Add rule</button>' +
      '<div class="card" style="margin-top:14px"><h3>Default owner</h3><p class="hint">Used when no rule matches.</p>' +
        '<select class="input" id="fallback">' + sellers.map(u=>'<option value="'+u.id+'" '+(DB.fallbackOwner===u.id?'selected':'')+'>'+esc(u.name||u.email)+'</option>').join('') + '</select></div>' +
      '<div class="card"><h3>Override</h3><div class="kv" style="border:none"><span class="k">Allow sellers to change the owner on a lead</span><div class="switch '+(DB.allowOverride?'on':'')+'" id="ovr"></div></div></div>';

    const ruleForm = (r) => {
      const countries = DB.countries;
      const segs = pick('interesse').map(v=>v.value);
      const selC = (r && r.countries) || [], selI = (r && r.interests) || [];
      return '<h3>'+(r?'Edit rule':'New rule')+'</h3>' +
        '<p class="hint">Pick one or more values. Leave a list empty to match anything.</p>' +
        '<div class="field"><label>Countries</label><select class="input" id="rCountries" multiple size="6">' +
          countries.map(c=>'<option value="'+esc(c)+'" '+(selC.indexOf(c)>=0?'selected':'')+'>'+esc(c)+'</option>').join('') + '</select></div>' +
        '<div class="field"><label>Segments</label><select class="input" id="rSegments" multiple size="'+Math.min(6,Math.max(3,segs.length||3))+'">' +
          (segs.length? segs.map(s=>'<option value="'+esc(s)+'" '+(selI.indexOf(s)>=0?'selected':'')+'>'+esc(s)+'</option>').join('') : '<option disabled>No segments defined yet</option>') + '</select></div>' +
        '<div class="field"><label>Assign to <span class="req">*</span></label><select class="input" id="rOwner">' +
          sellers.map(u=>'<option value="'+u.id+'" '+(r&&r.owner===u.id?'selected':'')+'>'+esc(u.name||u.email)+'</option>').join('') + '</select></div>' +
        '<button class="btn primary" id="rSave">'+(r?'Save rule':'Add rule')+'</button>' +
        '<button class="btn ghost" onclick="closeModal()" style="margin-top:8px">Cancel</button>';
    };
    const vals = id => Array.from(document.getElementById(id).selectedOptions).map(o=>o.value);

    shell('Assignment rules', rules.length + ' rule(s)', body, '#/admin', { back:'#/admin', bind(){
      app.querySelectorAll('[data-r]').forEach(sw => sw.onclick = () => { const r=DB.assignmentRules.find(x=>x.id===sw.getAttribute('data-r')); r.active=!r.active; saveState(); push('PATCH','/rules/'+r.id,{active:r.active}); adminRules(); });
      app.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
        const id=b.getAttribute('data-up'); const arr=DB.assignmentRules.slice().sort((a,b2)=>a.priority-b2.priority);
        const i=arr.findIndex(x=>x.id===id); if(i<=0) return;
        const tmp=arr[i-1].priority; arr[i-1].priority=arr[i].priority; arr[i].priority=tmp;
        saveState(); push('PATCH','/rules/'+arr[i-1].id,{priority:arr[i-1].priority}); push('PATCH','/rules/'+arr[i].id,{priority:arr[i].priority}); adminRules();
      });
      app.querySelectorAll('[data-delr]').forEach(b => b.onclick = () => {
        const id=b.getAttribute('data-delr');
        DB.assignmentRules = DB.assignmentRules.filter(x=>x.id!==id);
        DB.assignmentRules.sort((a,b2)=>a.priority-b2.priority).forEach((r,i)=>r.priority=i+1);
        saveState(); push('DELETE','/rules/'+id); toast('Rule deleted','ok'); adminRules();
      });
      app.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
        const r = DB.assignmentRules.find(x=>x.id===b.getAttribute('data-edit'));
        modal(ruleForm(r));
        setTimeout(()=>{ const s=document.getElementById('rSave'); if(s) s.onclick=()=>{
          r.countries=vals('rCountries'); r.interests=vals('rSegments'); r.owner=document.getElementById('rOwner').value;
          saveState(); push('PATCH','/rules/'+r.id,{countries:r.countries,interests:r.interests,owner:r.owner}); closeModal(); toast('Rule saved','ok'); adminRules();
        }; },0);
      });
      $('#newRule').onclick = () => {
        if (!sellers.length) { toast('Add a user first','err'); return; }
        modal(ruleForm(null));
        setTimeout(()=>{ const s=document.getElementById('rSave'); if(s) s.onclick=()=>{
          const nr={ id:'r'+Date.now(), priority:(DB.assignmentRules.length+1), countries:vals('rCountries'), interests:vals('rSegments'), owner:document.getElementById('rOwner').value, active:true };
          if(!nr.countries.length && !nr.interests.length){ toast('Pick at least one country or segment','err'); return; }
          push('POST','/rules',{countries:nr.countries,interests:nr.interests,owner:nr.owner,priority:nr.priority})
            .then(r=>{ DB.assignmentRules.push(r.rule); saveState(); closeModal(); toast('Rule added','ok'); adminRules(); }).catch(()=>{});
        }; },0);
      };
      $('#fallback').onchange = () => { DB.fallbackOwner = $('#fallback').value; saveState(); push('PATCH','/settings',{fallbackOwner:DB.fallbackOwner}); toast('Default owner updated','ok'); };
      $('#ovr').onclick = () => { DB.allowOverride=!DB.allowOverride; saveState(); push('PATCH','/settings',{allowOverride:DB.allowOverride}); toast('Override '+(DB.allowOverride?'enabled':'disabled'),'ok'); adminRules(); };
    }});
  }

  function adminDest() {
    const badge = d => d.type === 'brevo'
      ? '<span class="pill green">' + ic.check + ' live</span>'
      : '<span class="pill amber">simulated</span>';
    const keyMask = DB.brevoApiKey ? '•••• ' + DB.brevoApiKey.slice(-4) : 'not set — using server default';
    const body = DB.destinations.map(d => '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3>'+esc(d.label)+'</h3>'+badge(d)+'</div><p class="hint" style="margin:6px 0 0">'+esc(d.detail)+'</p></div>').join('') +
      '<div class="card"><h3>Brevo account (API key)</h3><p class="hint">The admin sets the Brevo API key here. Change it to point Bizca at a different Brevo account. Current: <b>'+esc(keyMask)+'</b></p>' +
        '<div class="field" style="margin-bottom:10px"><label>Brevo API key</label><input class="input" id="brevoKey" type="password" placeholder="xkeysib-…" autocomplete="off"></div>' +
        '<div class="btnrow"><button class="btn soft sm" id="brevoKeySave">Save key</button>' + (DB.brevoApiKey ? '<button class="btn ghost sm" id="brevoKeyClear">Use server default</button>' : '') + '</div>' +
        '<p class="hint" style="margin:10px 0 0">Stored on this device. For a shared, encrypted store use a server-side secret (recommended for production).</p></div>' +
      '<div class="card"><h3>Sending & consent</h3>' +
        '<div class="kv"><span class="k">Auto-send when lead is Ready</span><div class="switch '+(DB.autoSend?'on':'')+'" id="auto"></div></div>' +
        '<div class="kv" style="border:none"><span class="k">Require consent signature before sending</span><div class="switch '+(DB.requireConsent?'on':'')+'" id="reqConsent"></div></div></div>' +
      '<div class="card"><h3>Brevo attributes</h3><p class="hint">Create the contact fields Bizca maps to (name, company, source, country, interest, event, owner, consent…) in your Brevo account. Run once per account.</p><button class="btn soft" id="brevoSetup">Prepare Brevo attributes</button></div>' +
      '<div class="banner">'+ic.info+'<div>Leads route into the Brevo list set per event (Admin → Events). Excel on SharePoint is simulated until a Microsoft Graph / Azure AD app is configured with admin consent.</div></div>';
    shell('Destinations', 'Brevo + Excel', body, null, { back:'#/admin', bind(){
      $('#auto').onclick = () => { DB.autoSend=!DB.autoSend; saveState(); push('PATCH','/settings',{autoSend:DB.autoSend}); toast('Auto-send '+(DB.autoSend?'on':'off'),'ok'); adminDest(); };
      $('#reqConsent').onclick = () => { DB.requireConsent=!DB.requireConsent; saveState(); push('PATCH','/settings',{requireConsent:DB.requireConsent}); toast('Consent '+(DB.requireConsent?'required':'optional'),'ok'); adminDest(); };
      const ks = $('#brevoKeySave'); if (ks) ks.onclick = () => { const v=($('#brevoKey').value||'').trim(); if(!v){toast('Enter a key','err');return;} DB.brevoApiKey=v; brevoLists=null; saveState(); push('PATCH','/settings',{brevoApiKey:v}); toast('Brevo key saved','ok'); adminDest(); };
      const kc = $('#brevoKeyClear'); if (kc) kc.onclick = () => { DB.brevoApiKey=''; brevoLists=null; saveState(); push('PATCH','/settings',{brevoApiKey:''}); toast('Brevo key removed','ok'); adminDest(); };
      const bs = $('#brevoSetup'); if (bs) bs.onclick = async () => {
        bs.disabled = true; bs.innerHTML = '<div class="spinner"></div> Preparing…';
        try {
          const r = await fetch('/api/brevo-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: DB.brevoApiKey || undefined }) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
          const done = (d.created||[]).length, had = (d.existed||[]).length, bad = (d.failed||[]).length;
          toast(done + ' created, ' + had + ' already existed' + (bad ? ', ' + bad + ' failed' : ''), bad ? 'err' : 'ok');
        } catch (e) { toast('Setup failed: ' + e.message, 'err'); }
        adminDest();
      };
    }});
  }

  const fmtDates = e => {
    if (!e.startDate && !e.endDate) return e.dates || 'no dates set';
    const f = d => d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    return e.startDate && e.endDate && e.startDate !== e.endDate ? f(e.startDate) + ' – ' + f(e.endDate) : f(e.startDate || e.endDate);
  };

  function adminEvents() {
    const lists = brevoLists;
    const hasKey = !!DB.brevoApiKey;
    const listName = id => { if (!id) return null; const x = (lists || []).find(l => l.id === id); return x ? x.name : ('list #' + id); };
    const listSelect = e => {
      if (!hasKey) return '<p class="hint" style="margin:10px 0 0">Add your Brevo API key in <b>Admin → Destinations</b> to choose a destination list.</p>';
      if (!lists) return '<p class="hint" style="margin:10px 0 0">Loading your Brevo lists…</p>';
      if (!lists.length) return '<p class="hint" style="margin:10px 0 0">No lists found in your Brevo account.</p>';
      return '<div class="field" style="margin:10px 0 0"><label>Brevo destination list</label><select class="input" data-evlist="'+e.id+'"><option value="">— none —</option>' +
        lists.map(l => '<option value="'+l.id+'" '+(e.brevoListId===l.id?'selected':'')+'>'+esc(l.name)+' (#'+l.id+')</option>').join('') + '</select></div>';
    };
    const presetChips = e => {
      const chips = [e.preset.provenienza, e.preset.country, e.preset.interesse].filter(Boolean);
      return chips.length ? '<div class="tags" style="margin-top:8px">' + chips.map(c => '<span class="pill indigo">'+esc(c)+'</span>').join('') + '</div>' : '';
    };
    const list = DB.events.length
      ? DB.events.map(e => '<div class="card">' +
          '<div style="display:flex;justify-content:space-between;align-items:center"><h3>'+esc(e.name)+'</h3>' +
            (e.id===S.activeEventId ? '<span class="pill green">active</span>' : '<button class="pill gray" data-setactive="'+e.id+'" style="border:none;cursor:pointer">set active</button>') + '</div>' +
          '<p class="hint" style="margin:6px 0 0">'+esc(fmtDates(e))+'</p>' +
          presetChips(e) +
          (e.brevoListId ? '<div class="tags" style="margin-top:6px"><span class="pill green">'+ic.send+' Brevo: '+esc(listName(e.brevoListId))+'</span></div>' : '') +
          listSelect(e) +
          '<div class="btnrow" style="margin-top:12px"><button class="btn ghost sm" data-delev="'+e.id+'">Delete</button></div>' +
        '</div>').join('')
      : '<div class="list-empty">'+ic.empty+'<p>No events yet. Create your first trade show or event.</p></div>';
    const body = '<div class="banner">'+ic.info+'<div>An event groups the cards you scan: it pre-fills the qualification fields and routes leads into the Brevo list you pick here.</div></div>' +
      list + '<button class="btn primary" id="newEv" style="margin-top:6px">'+ic.plus+' Create new event</button>';
    shell('Events', DB.events.length + ' event(s)', body, '#/admin', { back:'#/admin', bind(){
      if (hasKey && !lists) loadBrevoLists().then(r => { if (r && location.hash.indexOf('#/admin/events') === 0) adminEvents(); });
      app.querySelectorAll('[data-evlist]').forEach(sel => sel.onchange = () => { const e=DB.events.find(x=>x.id===sel.getAttribute('data-evlist')); e.brevoListId = sel.value ? parseInt(sel.value,10) : null; saveState(); push('PATCH','/events/'+e.id,{brevoListId:e.brevoListId}); toast(e.brevoListId?('Leads will go to '+listName(e.brevoListId)):'List cleared','ok'); adminEvents(); });
      app.querySelectorAll('[data-setactive]').forEach(b => b.onclick = () => { S.activeEventId = b.getAttribute('data-setactive'); saveState(); toast('Active event updated','ok'); adminEvents(); });
      app.querySelectorAll('[data-delev]').forEach(b => b.onclick = () => {
        const id = b.getAttribute('data-delev');
        const used = DB.leads.filter(l => l.eventId === id).length;
        modal('<h3>Delete event?</h3><p class="hint">'+(used ? used + ' lead(s) were captured at this event — they will be kept but lose the event reference.' : 'This event has no leads.')+'</p><button class="btn danger" id="delEvYes">Delete event</button><button class="btn ghost" onclick="closeModal()" style="margin-top:8px">Cancel</button>');
        setTimeout(()=>{ const y=document.getElementById('delEvYes'); if(y) y.onclick=()=>{ DB.events = DB.events.filter(x=>x.id!==id); if(S.activeEventId===id) S.activeEventId = DB.events.length?DB.events[0].id:null; saveState(); push('DELETE','/events/'+id); closeModal(); toast('Event deleted','ok'); adminEvents(); }; },0);
      });
      $('#newEv').onclick = () => {
        modal('<h3>Create new event</h3><p class="hint">You can set presets and the Brevo list right after.</p>' +
          '<div class="field"><label>Event name <span class="req">*</span></label><input class="input" id="evn" placeholder="MECSPE 2026"></div>' +
          '<div class="grid2"><div class="field"><label>Start date</label><input class="input" id="evStart" type="date"></div>' +
          '<div class="field"><label>End date</label><input class="input" id="evEnd" type="date"></div></div>' +
          '<button class="btn primary" id="evAdd">Create event</button><button class="btn ghost" onclick="closeModal()" style="margin-top:8px">Cancel</button>');
        setTimeout(()=>{ const a=document.getElementById('evAdd'); if(a) a.onclick=()=>{
          const nm=(document.getElementById('evn').value||'').trim();
          if(!nm){ toast('Enter an event name','err'); return; }
          push('POST','/events',{name:nm,startDate:document.getElementById('evStart').value||null,endDate:document.getElementById('evEnd').value||null})
            .then(r=>{ const ne=Object.assign({preset:{provenienza:'',country:'',interesse:''}},r.event); DB.events.push(ne); if(!S.activeEventId) S.activeEventId=ne.id; saveState(); closeModal(); toast('Event created','ok'); adminEvents(); })
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
    if (!DB.company.configured) {
      window.scrollTo(0,0);
      if (path === '#/setup') return setupScreen();
      if (path === '#/login') return loginScreen();
      if (path !== '#/welcome') return go('#/welcome');
      return welcomeScreen();
    }
    if (path === '#/setup' || path === '#/welcome') return go(S.user ? '#/home' : '#/login');
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
      case '#/admin/rules': return adminRules();
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
      if (['#/setup', '#/login'].indexOf(location.hash) === -1) location.hash = DB.company.configured ? '#/login' : '#/welcome';
    }
    render();
    // Refresh from the server when the connection comes back
    window.addEventListener('online', () => { if (getToken()) pullState().then(() => render()).catch(() => {}); });
  })();
})();
