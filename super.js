/* Bizca — superadmin console (Bryan only). Italian, desktop-first.
   Sign-in by magic link; the session token lives in this browser only and
   never opens the normal app. */
(function () {
  const API = 'https://bizca-production.up.railway.app';
  const KEY = 'bizca-super';
  const root = document.getElementById('sa');
  const modalRoot = document.getElementById('modal-root');
  const getT = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const setT = v => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch (e) {} };

  const esc = s => (s == null ? '' : String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const $ = s => document.querySelector(s);
  const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtWhen = ts => ts ? new Date(ts).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

  async function api(method, path, body) {
    const res = await fetch(API + path, {
      method, headers: Object.assign({ 'Content-Type': 'application/json' }, getT() ? { Authorization: 'Bearer ' + getT() } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    let d = {}; try { d = await res.json(); } catch (e) {}
    if (res.status === 401 && path !== '/super/verify') { setT(''); loginView('La sessione è scaduta: chiedi un nuovo link.'); throw new Error('Sessione scaduta'); }
    if (!res.ok) { const e = new Error(d.error || ('Errore ' + res.status)); e.status = res.status; throw e; }
    return d;
  }
  function toast(msg, kind) {
    const el = document.getElementById('toast');
    el.className = ''; el.textContent = msg; if (kind) el.classList.add(kind);
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 3000);
  }
  function modal(html) {
    modalRoot.innerHTML = '<div class="modal-bg"><div class="modal-sa">' + html + '</div></div>';
    modalRoot.querySelector('.modal-bg').addEventListener('click', e => { if (e.target.classList.contains('modal-bg')) closeModal(); });
  }
  const closeModal = () => { modalRoot.innerHTML = ''; };
  window.closeModal = closeModal;

  /* ---------- sign in ---------- */
  function loginView(msg) {
    closeModal(); closeDrawer();
    root.innerHTML =
      '<div class="login-sa"><div class="card">' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px"><img src="icon-192.png" alt="" style="width:44px;height:44px;border-radius:12px">' +
        '<div><div style="font-weight:800;font-size:20px">Bizca</div><div class="hint" style="margin:0">Console superadmin</div></div><span class="badge-sa" style="margin-left:auto">Bryan</span></div>' +
        (msg ? '<div class="banner" style="margin-bottom:14px"><div>' + esc(msg) + '</div></div>' : '') +
        '<div id="lgBody">' +
          '<p class="hint">Ricevi un link di accesso via email. Vale una volta sola e scade in 15 minuti.</p>' +
          '<div class="field"><label>Email</label><input class="input" id="lgEmail" type="email" placeholder="nome@bryan.it" autocomplete="username"></div>' +
          '<button class="btn primary" id="lgGo">Inviami il link</button>' +
        '</div>' +
      '</div></div>';
    const go = async () => {
      const email = ($('#lgEmail').value || '').trim();
      if (!email) return;
      const b = $('#lgGo'); b.disabled = true; b.innerHTML = '<div class="spinner"></div> Invio…';
      try { await api('POST', '/super/magic', { email }); } catch (e) {}
      $('#lgBody').innerHTML =
        '<h3>Controlla la posta</h3><p class="hint" style="margin-bottom:0">Se <b>' + esc(email) + '</b> è abilitato, è appena arrivato un link per entrare. ' +
        'Aprilo da questo browser entro 15 minuti.</p>' +
        '<button class="btn ghost sm" id="lgAgain" style="margin-top:14px">Usa un altro indirizzo</button>';
      $('#lgAgain').onclick = () => loginView();
    };
    $('#lgGo').onclick = go;
    $('#lgEmail').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  /* ---------- overview ---------- */
  let data = null, query = '', openCid = null;

  async function load() {
    data = await api('GET', '/super/overview');
    mainView();
    if (openCid) openCompany(openCid, true);
  }

  function mainView() {
    const t = data.totals;
    const q = query.trim().toLowerCase();
    const list = data.companies.filter(c => !q || (c.name + ' ' + c.domain).toLowerCase().indexOf(q) >= 0);
    root.innerHTML =
      '<div class="sa-top"><img src="icon-192.png" alt=""><div><div class="t">Bizca · Superadmin</div><div class="s">' + esc(data.me) + '</div></div>' +
        '<span class="badge-sa">Solo Bryan</span><div class="sp"></div>' +
        '<button class="btn ghost sm" id="reload">Aggiorna</button><button class="btn ghost sm" id="logout">Esci</button></div>' +
      '<div class="tiles">' +
        tile(t.companies, 'Aziende') + tile(t.users, 'Utenti') + tile(t.leads, 'Lead raccolti') + tile(t.sent, 'Lead inviati') +
      '</div>' +
      '<div class="sa-bar"><input class="input" id="q" placeholder="Cerca azienda o dominio" value="' + esc(query) + '"><div style="flex:1"></div>' +
        '<button class="btn primary sm" id="newCo">+ Nuova azienda</button></div>' +
      '<table class="sa"><thead><tr><th>Azienda</th><th>Utenti</th><th>Lead</th><th class="hide-s">Ultimo lead</th><th class="hide-s">Collegamenti</th><th class="hide-s">Creata</th><th></th></tr></thead><tbody>' +
      (list.length ? list.map(c =>
        '<tr class="click" data-co="' + esc(c.id) + '"><td><div class="nm">' + esc(c.name) + '</div><div class="sub">' + esc(c.domain) + '</div></td>' +
        '<td class="num">' + c.users + (c.pending ? ' <span class="pill amber">' + c.pending + ' da attivare</span>' : '') + '</td>' +
        '<td class="num">' + c.leads + ' <span class="sub">· ' + c.sent + ' inviati</span></td>' +
        '<td class="hide-s muted">' + fmtDate(c.lastLead) + '</td>' +
        '<td class="hide-s"><div class="tags">' + (c.brevo ? '<span class="pill green">Brevo</span>' : '<span class="pill gray">Brevo —</span>') +
          (c.excel ? '<span class="pill green">Excel</span>' : '<span class="pill gray">Excel —</span>') + '</div></td>' +
        '<td class="hide-s muted">' + fmtDate(c.createdAt) + '</td>' +
        '<td style="text-align:right">' + (c.status === 'suspended' ? '<span class="pill red">Sospesa</span>' : '<span class="pill blue">Attiva</span>') + '</td></tr>'
      ).join('') : '<tr><td colspan="7" class="muted" style="text-align:center;padding:30px">Nessuna azienda</td></tr>') +
      '</tbody></table>' +
      '<div class="section-title" style="margin-top:28px">Attività recenti</div>' +
      '<div class="card audit">' + (data.audit.length ? data.audit.map(a =>
        '<div class="row"><div class="when">' + fmtWhen(a.at) + '</div><div style="flex:1"><b>' + esc(a.actor) + '</b> · ' + esc(auditLabel(a)) + '</div></div>').join('')
        : '<p class="hint" style="margin:0">Ancora nulla.</p>') + '</div>';
    $('#reload').onclick = () => load().then(() => toast('Aggiornato', 'ok')).catch(() => {});
    $('#logout').onclick = () => { setT(''); loginView('Sei uscito.'); };
    $('#newCo').onclick = newCompany;
    const qi = $('#q');
    qi.oninput = () => { query = qi.value; const pos = qi.selectionStart; mainView(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
    root.querySelectorAll('[data-co]').forEach(r => r.onclick = () => openCompany(r.getAttribute('data-co')));
  }
  const tile = (n, l) => '<div class="tile"><div class="n num">' + n + '</div><div class="l">' + esc(l) + '</div></div>';
  function auditLabel(a) {
    const d = a.detail || {};
    const L = {
      'login': 'è entrato nella console',
      'company.create': 'ha creato l\'azienda ' + (d.name || '') + (d.adminEmail ? ' (admin ' + d.adminEmail + ')' : ''),
      'company.update': 'ha modificato un\'azienda' + (d.name ? ' → ' + d.name : ''),
      'company.suspended': 'ha sospeso un\'azienda', 'company.active': 'ha riattivato un\'azienda',
      'company.delete': 'ha eliminato l\'azienda ' + (d.name || '') + (d.leads != null ? ' (' + d.users + ' utenti, ' + d.leads + ' lead)' : ''),
      'user.create': 'ha aggiunto ' + (d.email || 'un utente'),
      'user.update': 'ha modificato ' + (d.email || 'un utente') + (d.role ? ' → ' + d.role : '') + (d.status ? ' → ' + (d.status === 'active' ? 'attivo' : 'disattivato') : ''),
      'user.invite-link': 'ha generato un link d\'invito per ' + (d.email || ''),
      'user.reset-link': 'ha generato un link per reimpostare la password di ' + (d.email || ''),
      'user.delete': 'ha rimosso ' + (d.email || 'un utente') + (d.moved ? ' (' + d.moved + ' lead riassegnati)' : '')
    };
    return L[a.action] || a.action;
  }

  /* ---------- link handover ---------- */
  function showLink(title, r, note) {
    modal('<h3>' + esc(title) + '</h3>' +
      '<p class="hint">' + esc(note || 'Mandalo alla persona: aprendolo sceglie la password oppure entra con Microsoft o Google.') + '</p>' +
      '<div class="linkbox"><input class="input" id="lnk" readonly value="' + esc(r.link) + '"><button class="btn primary sm" id="cp">Copia</button></div>' +
      (r.emailSent === true ? '<div class="banner" style="background:#ECFDF5;border-color:#A7F3D0;color:#065F46"><div>Email inviata anche alla persona.</div></div>' : '') +
      (r.emailSent === false ? '<div class="banner" style="background:#FEF2F2;border-color:#FECACA;color:#991B1B"><div>Email non inviata: ' + esc(r.emailError || '') + '. Il link qui sopra funziona comunque.</div></div>' : '') +
      '<p class="hint" style="margin:8px 0 14px">Il link è personale e vale finché non viene usato o rigenerato.</p>' +
      '<button class="btn ghost" onclick="closeModal()">Chiudi</button>');
    $('#cp').onclick = async () => {
      const v = $('#lnk').value;
      try { await navigator.clipboard.writeText(v); } catch (e) { $('#lnk').select(); document.execCommand('copy'); }
      toast('Link copiato', 'ok');
    };
  }

  /* ---------- new company ---------- */
  function newCompany() {
    modal('<h3>Nuova azienda</h3><p class="hint">Crea lo spazio di lavoro e il suo primo admin. Riceverai il link di attivazione da consegnare.</p>' +
      '<div class="field"><label>Nome azienda</label><input class="input" id="ncName" placeholder="ACME S.r.l."></div>' +
      '<div class="field"><label>Dominio email</label><input class="input" id="ncDom" placeholder="acme.it"></div>' +
      '<div class="grid2"><div class="field"><label>Nome admin</label><input class="input" id="ncAn" placeholder="Mario Rossi"></div>' +
      '<div class="field"><label>Email admin</label><input class="input" id="ncAe" type="email" placeholder="mario.rossi@acme.it"></div></div>' +
      '<div class="field"><label>Lingua predefinita</label><select class="input" id="ncLang"><option value="it">Italiano</option><option value="en">English</option></select></div>' +
      '<label class="chk"><input type="checkbox" id="ncMail"> Invia anche l\'email d\'invito all\'admin</label>' +
      '<div class="btnrow"><button class="btn ghost" onclick="closeModal()">Annulla</button><button class="btn primary" id="ncGo">Crea azienda</button></div>');
    const dom = $('#ncDom'), ae = $('#ncAe');
    ae.oninput = () => { if (!dom.value && ae.value.indexOf('@') > 0) dom.placeholder = ae.value.split('@')[1]; };
    $('#ncGo').onclick = async () => {
      const b = $('#ncGo');
      const body = { name: $('#ncName').value, domain: dom.value || dom.placeholder.replace('acme.it', ''), adminName: $('#ncAn').value, adminEmail: ae.value, locale: $('#ncLang').value, sendEmail: $('#ncMail').checked };
      b.disabled = true;
      try {
        const r = await api('POST', '/super/companies', body);
        await load();
        showLink('Azienda creata', r, 'Questo è il link di attivazione per ' + body.adminEmail + '. Aprendolo sceglie la password oppure entra con Microsoft o Google.');
      } catch (e) { toast(e.message, 'err'); b.disabled = false; }
    };
  }

  /* ---------- company drawer ---------- */
  function closeDrawer() { const d = document.querySelector('.drawer-bg'); if (d) d.remove(); openCid = null; }
  async function openCompany(cid, keepScroll) {
    openCid = cid;
    let d;
    try { d = await api('GET', '/super/companies/' + encodeURIComponent(cid)); } catch (e) { toast(e.message, 'err'); return; }
    const c = d.company, sum = (data.companies.find(x => x.id === cid) || {});
    let host = document.querySelector('.drawer-bg');
    const prevScroll = host && keepScroll ? host.firstChild.scrollTop : 0;
    if (!host) { host = document.createElement('div'); host.className = 'drawer-bg'; document.body.appendChild(host);
      host.addEventListener('click', e => { if (e.target === host) closeDrawer(); }); }
    const suspended = c.status === 'suspended';
    host.innerHTML = '<div class="drawer">' +
      '<div class="dhead"><div><h2>' + esc(c.name) + '</h2><div class="sub">' + esc(c.domain) + ' · creata il ' + fmtDate(c.createdAt) + ' · lingua ' + (c.locale === 'it' ? 'italiano' : 'inglese') + '</div></div>' +
        '<div class="sp"></div>' + (suspended ? '<span class="pill red">Sospesa</span>' : '<span class="pill blue">Attiva</span>') + '<button class="x" id="dx">×</button></div>' +
      '<div class="tiles" style="grid-template-columns:repeat(4,1fr)">' + tile(sum.users || d.users.length, 'Utenti') + tile(sum.leads || 0, 'Lead') + tile(sum.sent || 0, 'Inviati') +
        '<div class="tile"><div class="tags" style="margin-top:4px">' + (sum.brevo ? '<span class="pill green">Brevo</span>' : '<span class="pill gray">Brevo —</span>') + (sum.excel ? '<span class="pill green">Excel</span>' : '<span class="pill gray">Excel —</span>') + '</div><div class="l">Collegamenti</div></div></div>' +

      '<div class="card"><div style="display:flex;align-items:center;margin-bottom:10px"><h3 style="margin:0">Utenti</h3><div style="flex:1"></div><button class="btn primary sm" id="addU">+ Aggiungi utente</button></div>' +
      '<table class="sa" style="box-shadow:none"><tbody>' + d.users.map(u =>
        '<tr><td><div class="nm">' + esc(u.name || u.email) + '</div><div class="sub">' + esc(u.email) + ' · ' + u.leads + ' lead</div>' +
          '<div class="tags" style="margin-top:6px"><span class="pill ' + (u.role === 'admin' ? 'indigo' : 'gray') + '">' + (u.role === 'admin' ? 'Admin' : 'Commerciale') + '</span>' +
          (u.status !== 'active' ? '<span class="pill red">disattivato</span>' : '') + (!u.activated ? '<span class="pill amber">invito da accettare</span>' : '') + '</div></td>' +
        '<td><div class="acts">' +
          '<button class="pill blue" data-link="' + u.id + '">' + (u.activated ? 'Link reset password' : 'Link d\'invito') + '</button>' +
          '<button class="pill gray" data-role="' + u.id + '" data-to="' + (u.role === 'admin' ? 'seller' : 'admin') + '">' + (u.role === 'admin' ? 'Rendi commerciale' : 'Rendi admin') + '</button>' +
          '<button class="pill gray" data-st="' + u.id + '" data-to="' + (u.status === 'active' ? 'disabled' : 'active') + '">' + (u.status === 'active' ? 'Disattiva' : 'Riattiva') + '</button>' +
          '<button class="pill red" data-del="' + u.id + '" data-email="' + esc(u.email) + '" data-n="' + u.leads + '">Rimuovi</button>' +
        '</div></td></tr>').join('') + '</tbody></table></div>' +

      '<div class="card"><h3>Dati azienda</h3><p class="hint">Il dominio serve a riconoscere gli indirizzi del team.</p>' +
        '<div class="grid3"><div class="field"><label>Nome</label><input class="input" id="eName" value="' + esc(c.name) + '"></div>' +
        '<div class="field"><label>Dominio</label><input class="input" id="eDom" value="' + esc(c.domain) + '"></div>' +
        '<div class="field"><label>Lingua predefinita</label><select class="input" id="eLang"><option value="it"' + (c.locale === 'it' ? ' selected' : '') + '>Italiano</option><option value="en"' + (c.locale !== 'it' ? ' selected' : '') + '>English</option></select></div></div>' +
        '<button class="btn soft sm" id="eSave">Salva modifiche</button></div>' +

      '<div class="card"><h3>' + (suspended ? 'Riattiva l\'azienda' : 'Sospendi l\'azienda') + '</h3><p class="hint">' + (suspended
        ? 'Gli utenti tornano a entrare subito. Nessun dato è stato toccato.'
        : 'Nessuno dell\'azienda può più entrare né inviare lead, finché non la riattivi. I dati restano intatti.') + '</p>' +
        '<button class="btn ' + (suspended ? 'primary' : 'ghost') + ' sm" id="susp">' + (suspended ? 'Riattiva' : 'Sospendi accesso') + '</button></div>' +

      '<div class="card danger-zone"><h3 style="color:#991B1B">Elimina l\'azienda</h3><p class="hint" style="color:#B91C1C">Cancella definitivamente lo spazio di lavoro, gli utenti, gli eventi e tutti i lead. ' +
        'Brevo ed Excel del cliente non vengono toccati. Non si può annullare.</p><button class="btn danger sm" id="delCo">Elimina definitivamente…</button></div>' +
    '</div>';
    if (prevScroll) host.firstChild.scrollTop = prevScroll;
    const refresh = () => load();
    $('#dx').onclick = closeDrawer;
    $('#addU').onclick = () => addUser(c);
    $('#eSave').onclick = async () => {
      try { await api('PATCH', '/super/companies/' + cid, { name: $('#eName').value, domain: $('#eDom').value, locale: $('#eLang').value }); toast('Salvato', 'ok'); refresh(); }
      catch (e) { toast(e.message, 'err'); }
    };
    $('#susp').onclick = () => {
      const to = suspended ? 'active' : 'suspended';
      const go = async () => { try { await api('PATCH', '/super/companies/' + cid, { status: to }); closeModal(); toast(to === 'suspended' ? 'Azienda sospesa' : 'Azienda riattivata', 'ok'); refresh(); } catch (e) { toast(e.message, 'err'); } };
      if (to === 'active') return go();
      modal('<h3>Sospendere ' + esc(c.name) + '?</h3><p class="hint">Tutti i suoi utenti escono dall\'app e non possono rientrare finché non la riattivi. I dati restano intatti.</p>' +
        '<div class="btnrow"><button class="btn ghost" onclick="closeModal()">Annulla</button><button class="btn danger" id="sYes">Sospendi</button></div>');
      $('#sYes').onclick = go;
    };
    $('#delCo').onclick = () => {
      modal('<h3>Eliminare ' + esc(c.name) + '?</h3><p class="hint">Verranno cancellati ' + (sum.users || 0) + ' utenti e ' + (sum.leads || 0) + ' lead. Per confermare scrivi il nome esatto dell\'azienda.</p>' +
        '<div class="field"><input class="input" id="dcName" placeholder="' + esc(c.name) + '"></div>' +
        '<div class="btnrow"><button class="btn ghost" onclick="closeModal()">Annulla</button><button class="btn danger" id="dcYes" disabled>Elimina per sempre</button></div>');
      const inp = $('#dcName'), yes = $('#dcYes');
      inp.oninput = () => { yes.disabled = inp.value !== c.name; };
      yes.onclick = async () => {
        yes.disabled = true;
        try { await api('DELETE', '/super/companies/' + cid, { confirm: inp.value }); closeModal(); closeDrawer(); toast('Azienda eliminata', 'ok'); load(); }
        catch (e) { toast(e.message, 'err'); yes.disabled = false; }
      };
    };
    host.querySelectorAll('[data-link]').forEach(b => b.onclick = () => {
      const u = d.users.find(x => x.id === b.getAttribute('data-link'));
      modal('<h3>' + (u.activated ? 'Link per reimpostare la password' : 'Nuovo link d\'invito') + '</h3><p class="hint">Per <b>' + esc(u.email) + '</b>. ' +
        (u.activated ? 'L\'account è già attivo: con questo link sceglie una nuova password.' : 'L\'invito precedente smette di funzionare.') + '</p>' +
        '<label class="chk"><input type="checkbox" id="lkMail"> Invialo anche per email</label>' +
        '<div class="btnrow"><button class="btn ghost" onclick="closeModal()">Annulla</button><button class="btn primary" id="lkGo">Genera link</button></div>');
      $('#lkGo').onclick = async () => {
        try { const r = await api('POST', '/super/users/' + u.id + '/link', { sendEmail: $('#lkMail').checked }); showLink(r.reset ? 'Link per reimpostare la password' : 'Link d\'invito', r); refresh(); }
        catch (e) { toast(e.message, 'err'); }
      };
    });
    host.querySelectorAll('[data-role]').forEach(b => b.onclick = async () => {
      try { await api('PATCH', '/super/users/' + b.getAttribute('data-role'), { role: b.getAttribute('data-to') }); toast('Ruolo aggiornato', 'ok'); refresh(); }
      catch (e) { toast(e.message, 'err'); }
    });
    host.querySelectorAll('[data-st]').forEach(b => b.onclick = async () => {
      try { await api('PATCH', '/super/users/' + b.getAttribute('data-st'), { status: b.getAttribute('data-to') }); toast('Stato aggiornato', 'ok'); refresh(); }
      catch (e) { toast(e.message, 'err'); }
    });
    host.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const n = +b.getAttribute('data-n');
      modal('<h3>Rimuovere ' + esc(b.getAttribute('data-email')) + '?</h3><p class="hint">Perde subito l\'accesso. ' +
        (n ? 'I suoi ' + n + ' lead non vengono cancellati: passano a un altro admin dell\'azienda.' : 'Non ha lead a suo nome.') + '</p>' +
        '<div class="btnrow"><button class="btn ghost" onclick="closeModal()">Annulla</button><button class="btn danger" id="duYes">Rimuovi</button></div>');
      $('#duYes').onclick = async () => {
        try { const r = await api('DELETE', '/super/users/' + b.getAttribute('data-del')); closeModal(); toast(r.leadsReassigned ? 'Utente rimosso · ' + r.leadsReassigned + ' lead riassegnati' : 'Utente rimosso', 'ok'); refresh(); }
        catch (e) { toast(e.message, 'err'); }
      };
    });
  }

  function addUser(c) {
    modal('<h3>Aggiungi utente a ' + esc(c.name) + '</h3>' +
      '<div class="grid2"><div class="field"><label>Nome</label><input class="input" id="auN" placeholder="Mario Rossi"></div>' +
      '<div class="field"><label>Email</label><input class="input" id="auE" type="email" placeholder="nome@' + esc(c.domain) + '"></div></div>' +
      '<div class="field"><label>Ruolo</label><select class="input" id="auR"><option value="seller">Commerciale</option><option value="admin">Admin</option></select></div>' +
      '<label class="chk"><input type="checkbox" id="auM"> Invia anche l\'email d\'invito</label>' +
      '<div class="btnrow"><button class="btn ghost" onclick="closeModal()">Annulla</button><button class="btn primary" id="auGo">Aggiungi</button></div>');
    $('#auGo').onclick = async () => {
      const b = $('#auGo'); b.disabled = true;
      try {
        const r = await api('POST', '/super/companies/' + c.id + '/users', { name: $('#auN').value, email: $('#auE').value, role: $('#auR').value, sendEmail: $('#auM').checked });
        await load();
        showLink('Utente aggiunto', r);
      } catch (e) { toast(e.message, 'err'); b.disabled = false; }
    };
  }

  /* ---------- start ---------- */
  async function start() {
    const m = location.hash.match(/token=([a-f0-9]{64})/);
    if (m) {
      // Take the token out of the address bar and history straight away.
      history.replaceState(null, '', location.pathname);
      try {
        const r = await api('POST', '/super/verify', { token: m[1] });
        setT(r.token);
      } catch (e) { return loginView(e.message); }
    }
    if (!getT()) return loginView();
    try { await load(); } catch (e) { if (getT()) root.innerHTML = '<div class="login-sa"><div class="card"><p>' + esc(e.message) + '</p><button class="btn primary" onclick="location.reload()">Riprova</button></div></div>'; }
  }
  // A link pasted into a tab where the console is already open changes only the hash.
  window.addEventListener('hashchange', () => { if (/token=/.test(location.hash)) start(); });
  start();
})();
