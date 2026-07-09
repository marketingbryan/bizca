/* Bizca — prototype app logic (vanilla JS, in-memory mock). */
(function () {
  const DB = window.DB, S = window.SESSION;
  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  let scanIndex = 0, batchMode = false;

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
        leads: DB.leads, pickLists: DB.pickLists, events: DB.events,
        assignmentRules: DB.assignmentRules, users: DB.users, destinations: DB.destinations,
        fallbackOwner: DB.fallbackOwner, allowOverride: DB.allowOverride, autoSend: DB.autoSend,
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
          if (l.image) {
            l.image = null;
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
      ['leads','pickLists','events','assignmentRules','users','destinations','syncLog'].forEach(k => { if (d[k]) DB[k] = d[k]; });
      ['fallbackOwner','allowOverride','autoSend'].forEach(k => { if (d[k] !== undefined) DB[k] = d[k]; });
      if (d.session) {
        if (d.session.activeEventId) S.activeEventId = d.session.activeEventId;
        if (d.session.userId) { const u = DB.users.find(x => x.id === d.session.userId); if (u) S.user = u; }
      }
    } catch (e) {}
  }
  function resetState() { try { localStorage.removeItem(STORE_KEY); } catch (e) {} location.hash = '#/login'; location.reload(); }

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
        body: JSON.stringify({ listId: ev.brevoListId || undefined, lead: {
          first: l.first, last: l.last, company: l.company, role: l.role, email: l.email,
          phone: l.phone, website: l.website, address: l.address,
          provenienza: l.provenienza, country: l.country, interesse: l.interesse, event: evName, owner: ownerName
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
    if (brevoLists && !force) return brevoLists;
    try {
      const r = await fetch('/api/brevo-lists');
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
    const i = r.interests.length ? r.interests.join('/') : 'any interest';
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

  /* ---------- Login ---------- */
  function loginScreen() {
    app.innerHTML =
      '<div class="login">' +
        '<div class="brand"><img src="icon-512.png" alt="Bizca"><h1>Bizca</h1><p>Event Leads to CRM · VID</p></div>' +
        '<div class="card" style="box-shadow:var(--shadow-lg)">' +
          '<button class="ms-btn" id="sso">' + ic.ms + 'Sign in with Microsoft</button>' +
          '<div class="divider">or</div>' +
          '<div class="field"><label>Email</label><input class="input" id="email" value="you@vid.example"></div>' +
          '<div class="field"><label>Password</label><input class="input" type="password" id="pwd" value="demo1234"></div>' +
          '<button class="btn primary" id="login">Sign in</button>' +
          '<p class="hint" style="text-align:center;margin:14px 0 0">Prototype — pick a role to explore</p>' +
          '<div class="btnrow" style="margin-top:8px">' +
            '<button class="btn ghost sm" id="asSeller" style="flex:1">Enter as Seller</button>' +
            '<button class="btn ghost sm" id="asAdmin" style="flex:1">Enter as Admin</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    const enter = role => { S.user = role === 'admin' ? DB.users.find(u=>u.id==='u_admin') : DB.users.find(u=>u.id==='u_you'); go('#/home'); };
    $('#sso').onclick = () => { toast('Microsoft 365 SSO (mock)'); setTimeout(()=>enter('seller'),500); };
    $('#login').onclick = () => enter('seller');
    $('#asSeller').onclick = () => enter('seller');
    $('#asAdmin').onclick = () => enter('admin');
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
      '<div class="banner">' + ic.info + '<div>Active event applies presets to every card you scan. Switch it anytime.</div></div>' +
      '<div class="card" style="background:linear-gradient(135deg,#EEF2FF,#ECFEFF)">' +
        '<div class="section-title" style="margin:0 0 6px">Active event</div>' +
        '<h3 style="font-size:18px">' + esc(ev.name) + '</h3>' +
        '<p class="hint" style="margin:2px 0 12px">' + esc(ev.dates) + ' · ' + presetSummary(ev) + '</p>' +
        '<button class="btn ghost sm" id="switchEv">Switch event</button>' +
      '</div>' +
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
    shell('Hi, ' + user().name.split(' ')[0], DB.company.name + ' · ' + (isAdmin()?'Admin':'Seller'), body, '#/home', { brand:true, right:'<button class="iconbtn" id="logout" title="Sign out">'+ic.chevR+'</button>',
      bind(){
        $('#switchEv').onclick = eventPicker;
        $('#logout').onclick = () => { S.user=null; saveState(); go('#/login'); };
        const inst = $('#installApp'); if (inst) inst.onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); try { await deferredPrompt.userChoice; } catch(e){} deferredPrompt = null; render(); };
      }});
  }
  const presetSummary = ev => ['provenienza','country','interesse'].map(k => ev.preset[k]).filter(Boolean).join(' · ') || 'no presets';
  const stat = (n,l,c) => '<div class="stat"><div class="num '+(c||'')+'">'+n+'</div><div class="lbl">'+esc(l)+'</div></div>';

  function eventPicker() {
    modal('<h3 style="margin:0 0 4px">Select active event</h3><p class="hint">Presets pre-fill qualification fields.</p>' +
      DB.events.map(e => '<div class="select-item ' + (e.id===S.activeEventId?'sel':'') + '" data-ev="' + e.id + '"><div style="flex:1"><div style="font-weight:600">' + esc(e.name) + '</div><div class="hint" style="margin:0">' + esc(e.dates) + ' · ' + presetSummary(e) + '</div></div>' + (e.id===S.activeEventId?ic.check:'') + '</div>').join('') +
      '<button class="btn ghost" onclick="closeModal()" style="margin-top:8px">Close</button>');
    modalRoot.querySelectorAll('[data-ev]').forEach(x => x.onclick = () => { S.activeEventId = x.getAttribute('data-ev'); closeModal(); toast('Active event updated','ok'); render(); });
  }

  /* ---------- Scan ---------- */
  function scanScreen() {
    const body =
      '<div class="card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
          '<div><h3 style="margin:0">Scan card</h3><p class="hint" style="margin:0">Event: ' + esc(activeEvent().name) + '</p></div>' +
          '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:13px;font-weight:600;color:var(--slate)">Batch</span><div class="switch ' + (batchMode?'on':'') + '" id="batchToggle"></div></div>' +
        '</div>' +
        '<div class="scanview" id="scanview"><div class="frame"></div><div class="card-demo"><div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><div style="width:26px;height:26px;border-radius:50%;background:#C7D2FE"></div><div><div style="width:80px;height:8px;background:#4F46E5;border-radius:4px"></div><div style="width:54px;height:6px;background:#A5B4FC;border-radius:3px;margin-top:5px"></div></div></div><div style="width:100%;height:6px;background:#CBD5E1;border-radius:3px"></div></div></div>' +
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
    const lead = {
      id: 'l' + Date.now(),
      first: d.first || '', last: d.last || '', company: d.company || '', role: d.role || '',
      email: d.email || '', phone: d.phone || '', website: d.website || '', address: d.address || '',
      provenienza: ev.preset.provenienza || '', country: d.country || ev.preset.country || '', interesse: ev.preset.interesse || '',
      eventId: ev.id, ownerId: null, createdBy: user().id, status: 'To finalize', override: false, image: image, ts: Date.now()
    };
    if (lead.country && lead.interesse) lead.ownerId = assign(lead.country, lead.interesse).owner;
    DB.leads.unshift(lead);
    saveState();
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
        '<div class="field"><label>Source (provenienza) <span class="req">*</span></label><select class="input" data-q="provenienza" '+(readOnly?'disabled':'')+'>'+provOpts+'</select></div>' +
        '<div class="field"><label>Country <span class="req">*</span></label><select class="input" data-q="country" '+(readOnly?'disabled':'')+'>'+ctryOpts+'</select></div>' +
        '<div class="field" style="margin-bottom:0"><label>Interest <span class="req">*</span></label><select class="input" data-q="interesse" '+(readOnly?'disabled':'')+'>'+intOpts+'</select></div>' +
      '</div>' +

      '<div class="card"><h3>Assignment</h3><p class="hint" id="ruleHint">' + esc(ruleSummary(a.rule)) + '</p>' +
        '<div class="field" style="margin-bottom:0"><label>Owner (seller)</label><select class="input" data-owner '+(readOnly||!DB.allowOverride?'disabled':'')+'>'+ownerOpts+'</select>' +
        (DB.allowOverride && !readOnly ? '<p class="hint" style="margin:6px 0 0">You can override the suggested owner.</p>' : '') + '</div>' +
      '</div>' +

      (readOnly ? syncLogCard(l) :
        '<div class="btnrow"><button class="btn ghost" id="saveDraft">Save draft</button>' +
        '<button class="btn primary" id="send">' + ic.send + ' ' + (l.status==='Error'?'Retry send':'Send to Brevo + Excel') + '</button></div>' +
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
      const sd = $('#saveDraft'); if (sd) sd.onclick = () => { l.status = requiredFilled(l)?'Ready':'To finalize'; toast('Draft saved','ok'); go('#/leads'); };
      const sb = $('#send'); if (sb) sb.onclick = () => sendLead(l);
    }});
  }
  function optList(arr, sel) { return '<option value="">— select —</option>' + arr.map(v => '<option '+(v===sel?'selected':'')+'>'+esc(v)+'</option>').join(''); }

  async function sendLead(l) {
    if (!requiredFilled(l)) { toast('Fill all required qualification fields', 'err'); return; }
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
      const ap=$('#applyPreset'); if(ap) ap.onclick = () => { const ev=activeEvent(); q.forEach(l=>{ if(ev.preset.provenienza)l.provenienza=ev.preset.provenienza; if(ev.preset.country)l.country=ev.preset.country; if(ev.preset.interesse)l.interesse=ev.preset.interesse; if(requiredFilled(l)){const a=assign(l.country,l.interesse); if(!l.override)l.ownerId=a.owner; l.status='Ready';} }); toast('Preset applied to queue','ok'); batchScreen(); };
      const aa=$('#autoAssign'); if(aa) aa.onclick = () => { let n=0; q.forEach(l=>{ if(l.country&&l.interesse){const a=assign(l.country,l.interesse); if(!l.override)l.ownerId=a.owner; if(requiredFilled(l))l.status='Ready'; n++;} }); toast(n+' lead(s) assigned','ok'); batchScreen(); };
      const ss=$('#sendSel'); if(ss) ss.onclick = async () => {
        if(!batchSel.size){ toast('Select at least one lead','err'); return; }
        if(!S.online){ let q2=0; batchSel.forEach(id=>{ const l=DB.leads.find(x=>x.id===id); if(l&&requiredFilled(l)){ l.status='Ready'; l.queuedOffline=true; q2++; } }); batchSel.clear(); saveState(); toast(q2+' queued (offline) — will sync','' ); batchScreen(); return; }
        ss.disabled=true; ss.innerHTML='<div class="spinner"></div> Sending…';
        let sent=0, fail=0, skip=0;
        const ids=Array.from(batchSel);
        for(const id of ids){ const l=DB.leads.find(x=>x.id===id); if(!l){continue;} if(!requiredFilled(l)){ skip++; continue; } const ok=await deliverLead(l); ok?sent++:fail++; }
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
      ['Team & access', DB.users.length+' users', '#/admin/team', ic.leads],
      ['Closed lists', pick('provenienza').length+' sources · '+pick('interesse').length+' interests', '#/admin/lists', ic.grid],
      ['Assignment rules', DB.assignmentRules.filter(r=>r.active).length+' active rules', '#/admin/rules', ic.bolt],
      ['Destinations', DB.destinations.filter(d=>d.status==='connected').length+' connected', '#/admin/dest', ic.send],
      ['Events', DB.events.length+' events', '#/admin/events', ic.home]
    ];
    const body = '<div class="banner">'+ic.info+'<div>Tenant configuration for '+esc(DB.company.name)+'. Multi-tenant ready — each company is isolated.</div></div>' +
      rows.map(r => '<button class="rowbtn" data-nav="'+r[2]+'"><div class="lead-ic">'+r[3]+'</div><div style="flex:1"><div style="font-weight:600">'+esc(r[0])+'</div><div class="hint" style="margin:0">'+esc(r[1])+'</div></div>'+ic.chevR+'</button>').join('') +
      '<div class="section-title">Data</div>' +
      '<button class="btn danger" id="resetDemo">Reset demo data</button>' +
      '<p class="hint" style="text-align:center;margin-top:8px">Clears locally-saved leads and configuration and restores the demo seed.</p>';
    shell('Admin', DB.company.name+' tenant', body, '#/admin', { bind(){
      $('#resetDemo').onclick = () => modal('<h3>Reset demo data?</h3><p class="hint">This clears all locally-saved leads and settings on this device and reloads the seed data. It does not affect Brevo.</p><button class="btn danger" id="doReset">Yes, reset</button><button class="btn ghost" onclick="closeModal()" style="margin-top:8px">Cancel</button>') || setTimeout(()=>{ const b=document.getElementById('doReset'); if(b) b.onclick=resetState; },0);
    }});
  }

  function adminTeam() {
    const body = DB.users.map(u => '<div class="lead"><div class="avatar">'+esc(initials(u.name))+'</div><div class="meta"><div class="name">'+esc(u.name)+'</div><div class="co">'+esc(u.email)+' · '+esc(u.role)+'</div></div><div class="switch '+(u.status==='active'?'on':'')+'" data-u="'+u.id+'"></div></div>').join('') +
      '<button class="btn primary" id="invite" style="margin-top:8px">'+ic.plus+' Invite seller</button>';
    shell('Team & access', 'Sellers & admins', body, null, { back:'#/admin', bind(){
      app.querySelectorAll('[data-u]').forEach(sw => sw.onclick = () => { const u=DB.users.find(x=>x.id===sw.getAttribute('data-u')); u.status = u.status==='active'?'disabled':'active'; toast(u.name+' '+u.status,'ok'); adminTeam(); });
      $('#invite').onclick = () => modal('<h3>Invite seller</h3><p class="hint">They receive an email invite (mock).</p><div class="field"><label>Email</label><input class="input" id="invEmail" placeholder="name@vid.example"></div><button class="btn primary" id="doInv">Send invite</button>' + '<button class="btn ghost" onclick="closeModal()" style="margin-top:8px">Cancel</button>');
      // bind inside modal after it renders
      setTimeout(()=>{ const d=document.getElementById('doInv'); if(d) d.onclick=()=>{ const e=document.getElementById('invEmail').value||'new@vid.example'; DB.users.push({id:'u'+Date.now(),name:e.split('@')[0],email:e,role:'seller',status:'active'}); closeModal(); toast('Invite sent','ok'); adminTeam(); }; },0);
    }});
  }

  function adminLists() {
    const block = (type, title) => '<div class="card"><h3>'+title+'</h3><p class="hint">Closed list — used in qualification.</p>' +
      DB.pickLists[type].map(v => '<div class="kv"><span class="k">'+esc(v.value)+'</span><div class="switch '+(v.active?'on':'')+'" data-toggle="'+type+':'+v.id+'"></div></div>').join('') +
      '<div style="display:flex;gap:8px;margin-top:12px"><input class="input" placeholder="Add value…" data-add="'+type+'"><button class="btn primary sm" data-addbtn="'+type+'">'+ic.plus+'</button></div></div>';
    const body = block('provenienza','Sources (provenienza)') + block('interesse','Interests');
    shell('Closed lists', 'Managed by admin', body, null, { back:'#/admin', bind(){
      app.querySelectorAll('[data-toggle]').forEach(sw => sw.onclick = () => { const [t,id]=sw.getAttribute('data-toggle').split(':'); const v=DB.pickLists[t].find(x=>x.id===id); v.active=!v.active; adminLists(); });
      app.querySelectorAll('[data-addbtn]').forEach(b => b.onclick = () => { const t=b.getAttribute('data-addbtn'); const inp=app.querySelector('[data-add="'+t+'"]'); if(inp.value.trim()){ DB.pickLists[t].push({id:t[0]+Date.now(),value:inp.value.trim(),active:true}); toast('Value added','ok'); adminLists(); } });
    }});
  }

  function adminRules() {
    const body = '<div class="banner">'+ic.info+'<div>First matching rule wins (top to bottom). Fallback owner: '+esc(userName(DB.fallbackOwner))+'.</div></div>' +
      DB.assignmentRules.sort((a,b)=>a.priority-b.priority).map(r => '<div class="card" style="padding:14px"><div style="display:flex;justify-content:space-between;align-items:start"><div><div style="font-weight:700">#'+r.priority+' → '+esc(userName(r.owner))+'</div><div class="hint" style="margin:4px 0 0">'+esc(ruleSummary(r).replace(/^Rule #\d+: /,''))+'</div></div><div class="switch '+(r.active?'on':'')+'" data-r="'+r.id+'"></div></div></div>').join('') +
      '<div class="card"><h3>Override</h3><div class="kv" style="border:none"><span class="k">Allow sellers to override owner</span><div class="switch '+(DB.allowOverride?'on':'')+'" id="ovr"></div></div></div>';
    shell('Assignment rules', 'Country + interest → owner', body, null, { back:'#/admin', bind(){
      app.querySelectorAll('[data-r]').forEach(sw => sw.onclick = () => { const r=DB.assignmentRules.find(x=>x.id===sw.getAttribute('data-r')); r.active=!r.active; adminRules(); });
      $('#ovr').onclick = () => { DB.allowOverride=!DB.allowOverride; toast('Override '+(DB.allowOverride?'enabled':'disabled'),'ok'); adminRules(); };
    }});
  }

  function adminDest() {
    const badge = d => d.type === 'brevo'
      ? '<span class="pill green">' + ic.check + ' live</span>'
      : '<span class="pill amber">simulated</span>';
    const body = DB.destinations.map(d => '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3>'+esc(d.label)+'</h3>'+badge(d)+'</div><p class="hint" style="margin:6px 0 0">'+esc(d.detail)+'</p></div>').join('') +
      '<div class="card"><h3>Sending</h3><div class="kv" style="border:none"><span class="k">Auto-send when lead is Ready</span><div class="switch '+(DB.autoSend?'on':'')+'" id="auto"></div></div></div>' +
      '<div class="banner">'+ic.info+'<div>Brevo is connected via a server-side API key (Vercel env). Excel on SharePoint is simulated until a Microsoft Graph / Azure AD app is configured with admin consent.</div></div>';
    shell('Destinations', 'Brevo + Excel', body, null, { back:'#/admin', bind(){
      $('#auto').onclick = () => { DB.autoSend=!DB.autoSend; toast('Auto-send '+(DB.autoSend?'on':'off'),'ok'); adminDest(); };
    }});
  }

  function adminEvents() {
    const lists = brevoLists;
    const listName = id => { if (!id) return null; const x = (lists || []).find(l => l.id === id); return x ? x.name : ('list #' + id); };
    const listSelect = e => {
      if (!lists) return '<p class="hint" style="margin:10px 0 0">Loading Brevo lists…</p>';
      return '<div class="field" style="margin:10px 0 0"><label>Brevo destination list</label><select class="input" data-evlist="'+e.id+'"><option value="">— none —</option>' +
        lists.map(l => '<option value="'+l.id+'" '+(e.brevoListId===l.id?'selected':'')+'>'+esc(l.name)+' (#'+l.id+')</option>').join('') + '</select></div>';
    };
    const body = DB.events.map(e => '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3>'+esc(e.name)+'</h3><span class="pill '+(e.status==='open'?'green':'gray')+'">'+esc(e.status)+'</span></div>' +
      '<p class="hint" style="margin:6px 0 0">'+esc(e.dates)+'</p>' +
      '<div class="tags" style="margin-top:8px">'+['provenienza','country','interesse'].map(k=>e.preset[k]?'<span class="pill indigo">'+esc(e.preset[k])+'</span>':'').join('')+'</div>' +
      (e.brevoListId ? '<div class="tags" style="margin-top:6px"><span class="pill green">'+ic.send+' Brevo: '+esc(listName(e.brevoListId))+'</span></div>' : '') +
      listSelect(e) +
      '</div>').join('') +
      '<button class="btn primary" id="newEv">'+ic.plus+' New event</button>';
    shell('Events', 'Presets & Brevo list per event', body, null, { back:'#/admin', bind(){
      if (!lists) loadBrevoLists().then(r => { if (r && location.hash.indexOf('#/admin/events') === 0) adminEvents(); });
      app.querySelectorAll('[data-evlist]').forEach(sel => sel.onchange = () => { const e=DB.events.find(x=>x.id===sel.getAttribute('data-evlist')); e.brevoListId = sel.value ? parseInt(sel.value,10) : null; saveState(); toast(e.brevoListId?('Routing to '+listName(e.brevoListId)):'List cleared','ok'); adminEvents(); });
      $('#newEv').onclick = () => modal('<h3>New event</h3><div class="field"><label>Name</label><input class="input" id="evn" placeholder="Trade show 2026"></div><div class="field"><label>Dates</label><input class="input" id="evd" placeholder="Sep 1–3, 2026"></div><button class="btn primary" id="evAdd">Create</button><button class="btn ghost" onclick="closeModal()" style="margin-top:8px">Cancel</button>') || setTimeout(()=>{ const a=document.getElementById('evAdd'); if(a) a.onclick=()=>{ DB.events.push({id:'e'+Date.now(),name:document.getElementById('evn').value||'New event',dates:document.getElementById('evd').value||'',status:'open',preset:{provenienza:'',country:'',interesse:''},brevoListId:null}); closeModal(); toast('Event created','ok'); adminEvents(); }; },0);
    }});
  }

  /* ================= ROUTER ================= */
  function render() {
    const raw = location.hash || '#/login';
    const [path, query] = raw.split('?');
    const params = {}; if (query) query.split('&').forEach(p => { const [k,v]=p.split('='); params[k]=decodeURIComponent(v); });
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
      case '#/admin/lists': return adminLists();
      case '#/admin/rules': return adminRules();
      case '#/admin/dest': return adminDest();
      case '#/admin/events': return adminEvents();
      default: return go('#/home');
    }
  }
  window.render = render;
  window.addEventListener('hashchange', render);

  loadState();
  if (S.user && (!location.hash || location.hash === '#/login' || location.hash === '#/')) location.hash = '#/home';
  render();
})();
