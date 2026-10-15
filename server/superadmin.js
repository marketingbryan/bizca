/* Bizca — superadmin console (Bryan only).

   Who: only the addresses in SUPERADMIN_EMAILS (default: max@bryan.it,
   davide.berardino@bryan.it). Nothing in the database can make someone a
   superadmin, so no workspace admin can ever promote themselves.

   How they sign in: a magic link sent by email.
     - one use, valid 15 minutes, stored only as a SHA-256 hash;
     - the link carries the token in the URL fragment (#), so it never reaches
       server logs or Referer headers;
     - the request always answers the same way, so it does not reveal which
       addresses are enabled.

   The session it opens is a token with k:'super'. The normal auth middleware
   rejects every token carrying a "k", so a superadmin session never opens the
   app API, and an app session never opens these routes. The allowlist is
   checked again on every request: removing an address from the variable
   revokes its sessions at once.

   Every change is written to super_audit. */

const crypto = require('crypto');

const LINK_TTL = 15 * 60 * 1000;
const SESSION_TTL = 8 * 3600 * 1000;
const DEFAULT_SUPERS = 'max@bryan.it,davide.berardino@bryan.it';

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const allowlist = () => String(process.env.SUPERADMIN_EMAILS || DEFAULT_SUPERS)
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const isSuper = e => !!e && allowlist().indexOf(String(e).trim().toLowerCase()) >= 0;

function mount(app, deps) {
  const { pool, sign, verifyToken, sendEmail, emails, APP_URL, id, isEmail, ms } = deps;
  const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: e.message || 'Server error' }); });

  function superAuth(req, res, next) {
    const p = verifyToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    if (!p || p.k !== 'super' || !isSuper(p.sa)) return res.status(401).json({ error: 'Superadmin session required' });
    req.superEmail = String(p.sa).toLowerCase();
    next();
  }
  const audit = (req, action, target, detail) =>
    pool.query('INSERT INTO super_audit (actor,action,target,detail) VALUES ($1,$2,$3,$4)',
      [req.superEmail, action, target || null, detail ? JSON.stringify(detail) : null]).catch(e => console.error('audit', e));

  const inviteLink = (email, token) => APP_URL + '/#/activate?email=' + encodeURIComponent(email) + '&token=' + token;
  const cleanDomain = d => String(d || '').trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  /* ---------- sign in ---------- */
  app.post('/super/magic', wrap(async (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const same = { ok: true };       // identical answer whatever the address
    if (!isSuper(email)) return res.json(same);
    const last = await pool.query('SELECT created_at FROM superadmin_links WHERE email=$1 ORDER BY created_at DESC LIMIT 1', [email]);
    if (last.rowCount && Date.now() - new Date(last.rows[0].created_at).getTime() < 60 * 1000) return res.json(same);
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query('INSERT INTO superadmin_links (token_hash,email,expires_at) VALUES ($1,$2,$3)',
      [sha(token), email, new Date(Date.now() + LINK_TTL)]);
    const msg = emails.build('superlink', 'it', { link: APP_URL + '/super.html#token=' + token });
    await sendEmail(email, msg.subject, msg.html);
    res.json(same);
  }));

  app.post('/super/verify', wrap(async (req, res) => {
    const token = String((req.body || {}).token || '');
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'Link non valido' });
    // Consume atomically: a link can open one session only.
    const r = await pool.query(
      'UPDATE superadmin_links SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now() RETURNING email',
      [sha(token)]);
    if (!r.rowCount || !isSuper(r.rows[0].email)) return res.status(400).json({ error: 'Link scaduto o già usato — chiedine uno nuovo' });
    const email = r.rows[0].email;
    req.superEmail = email; audit(req, 'login', email);
    res.json({ ok: true, email, token: sign({ k: 'super', sa: email, exp: Date.now() + SESSION_TTL }) });
  }));

  app.get('/super/me', superAuth, (req, res) => res.json({ ok: true, email: req.superEmail }));

  /* ---------- overview ---------- */
  app.get('/super/overview', superAuth, wrap(async (req, res) => {
    const [cos, users, leads, log] = await Promise.all([
      pool.query('SELECT id,name,domain,locale,status,settings,created_at FROM companies ORDER BY created_at DESC'),
      pool.query(`SELECT company_id, count(*)::int AS n,
                         count(*) FILTER (WHERE role='admin')::int AS admins,
                         count(*) FILTER (WHERE password_hash IS NULL AND NOT email_verified)::int AS pending
                    FROM users GROUP BY company_id`),
      pool.query(`SELECT company_id, count(*)::int AS n, count(*) FILTER (WHERE status='Sent')::int AS sent,
                         max(captured_at) AS last FROM leads GROUP BY company_id`),
      pool.query('SELECT actor,action,target,detail,at FROM super_audit ORDER BY at DESC LIMIT 60')
    ]);
    const byU = new Map(users.rows.map(r => [r.company_id, r]));
    const byL = new Map(leads.rows.map(r => [r.company_id, r]));
    const companies = cos.rows.map(c => {
      const u = byU.get(c.id) || {}, l = byL.get(c.id) || {}, s = c.settings || {};
      const pc = ms ? ms.publicCfg(s) : {};
      return {
        id: c.id, name: c.name, domain: c.domain, locale: c.locale, status: c.status || 'active',
        createdAt: new Date(c.created_at).getTime(),
        users: u.n || 0, admins: u.admins || 0, pending: u.pending || 0,
        leads: l.n || 0, sent: l.sent || 0, lastLead: l.last ? new Date(l.last).getTime() : null,
        brevo: !!s.brevoApiKey, excel: !!(pc.ready && pc.enabled)
      };
    });
    res.json({
      ok: true, me: req.superEmail, companies,
      totals: {
        companies: companies.length, users: companies.reduce((a, c) => a + c.users, 0),
        leads: companies.reduce((a, c) => a + c.leads, 0), sent: companies.reduce((a, c) => a + c.sent, 0)
      },
      audit: log.rows.map(a => ({ actor: a.actor, action: a.action, target: a.target, detail: a.detail, at: new Date(a.at).getTime() }))
    });
  }));

  app.get('/super/companies/:cid', superAuth, wrap(async (req, res) => {
    const c = await pool.query('SELECT id,name,domain,locale,status,created_at FROM companies WHERE id=$1', [req.params.cid]);
    if (!c.rowCount) return res.status(404).json({ error: 'Azienda non trovata' });
    const u = await pool.query(`SELECT u.id,u.name,u.email,u.role,u.status,u.email_verified,u.created_at,
                                       (u.password_hash IS NOT NULL) AS has_password,
                                       (SELECT count(*)::int FROM leads l WHERE l.company_id=u.company_id AND l.owner_id=u.id) AS leads
                                  FROM users u WHERE u.company_id=$1 ORDER BY u.created_at`, [req.params.cid]);
    const co = c.rows[0];
    res.json({
      ok: true,
      company: { id: co.id, name: co.name, domain: co.domain, locale: co.locale, status: co.status || 'active', createdAt: new Date(co.created_at).getTime() },
      users: u.rows.map(r => ({ id: r.id, name: r.name, email: r.email, role: r.role, status: r.status, leads: r.leads,
        activated: !!r.has_password || !!r.email_verified, createdAt: new Date(r.created_at).getTime() }))
    });
  }));

  /* ---------- companies ---------- */
  // New workspace with its first admin. Returns the activation link to hand over;
  // the email goes out only if asked.
  app.post('/super/companies', superAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim(), domain = cleanDomain(b.domain);
    const adminEmail = String(b.adminEmail || '').trim().toLowerCase(), adminName = String(b.adminName || '').trim();
    const lang = emails.pick(b.locale || 'it');
    if (!name || !domain || !isEmail(adminEmail)) return res.status(400).json({ error: 'Servono nome, dominio ed email dell\'admin' });
    const dup = await pool.query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [adminEmail]);
    if (dup.rowCount) return res.status(409).json({ error: 'Esiste già un account con ' + adminEmail });
    const cid = id('c_'), uid = id('u_'), token = crypto.randomBytes(24).toString('hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO companies (id,name,domain,locale,settings,status) VALUES ($1,$2,$3,$4,$5,$6)',
        [cid, name, domain, lang, { autoSend: true, requireConsent: false, allowOverride: true, brevoApiKey: '', fallbackOwner: uid }, 'active']);
      await client.query('INSERT INTO users (id,company_id,name,email,role,status,email_verified,verify_token,verify_sent_at,locale) VALUES ($1,$2,$3,$4,$5,$6,false,$7,now(),$8)',
        [uid, cid, adminName || adminEmail.split('@')[0], adminEmail, 'admin', 'active', token, lang]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    const link = inviteLink(adminEmail, token);
    let mail = null;
    if (b.sendEmail) { const m = emails.build('invite', lang, { company: name, link }); mail = await sendEmail(adminEmail, m.subject, m.html); }
    audit(req, 'company.create', cid, { name, domain, adminEmail, emailed: !!b.sendEmail });
    res.json({ ok: true, companyId: cid, userId: uid, link, emailSent: mail ? !!mail.ok : null, emailError: mail && !mail.ok ? (mail.error || 'Email non configurata') : null });
  }));

  app.patch('/super/companies/:cid', superAuth, wrap(async (req, res) => {
    const b = req.body || {};
    if (b.status !== undefined && ['active', 'suspended'].indexOf(b.status) < 0) return res.status(400).json({ error: 'Stato non valido' });
    const cur = await pool.query('SELECT id FROM companies WHERE id=$1', [req.params.cid]);
    if (!cur.rowCount) return res.status(404).json({ error: 'Azienda non trovata' });
    const name = b.name !== undefined ? String(b.name).trim() || null : null;
    const domain = b.domain !== undefined ? cleanDomain(b.domain) || null : null;
    const locale = b.locale !== undefined ? emails.pick(b.locale) : null;
    await pool.query('UPDATE companies SET name=COALESCE($1,name), domain=COALESCE($2,domain), locale=COALESCE($3,locale), status=COALESCE($4,status) WHERE id=$5',
      [name, domain, locale, b.status || null, req.params.cid]);
    audit(req, b.status ? 'company.' + b.status : 'company.update', req.params.cid, { name, domain, locale, status: b.status || null });
    res.json({ ok: true });
  }));

  // Deleting a workspace removes everything in it. The caller must type the exact name.
  app.delete('/super/companies/:cid', superAuth, wrap(async (req, res) => {
    const c = await pool.query('SELECT name FROM companies WHERE id=$1', [req.params.cid]);
    if (!c.rowCount) return res.status(404).json({ error: 'Azienda non trovata' });
    if (String((req.body || {}).confirm || '') !== c.rows[0].name) return res.status(400).json({ error: 'Per eliminare scrivi esattamente il nome dell\'azienda' });
    const counts = await pool.query('SELECT (SELECT count(*)::int FROM users WHERE company_id=$1) AS users, (SELECT count(*)::int FROM leads WHERE company_id=$1) AS leads', [req.params.cid]);
    await pool.query('DELETE FROM companies WHERE id=$1', [req.params.cid]);   // ON DELETE CASCADE does the rest
    audit(req, 'company.delete', req.params.cid, Object.assign({ name: c.rows[0].name }, counts.rows[0] || {}));
    res.json({ ok: true });
  }));

  /* ---------- users ---------- */
  app.post('/super/companies/:cid/users', superAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (!isEmail(email)) return res.status(400).json({ error: 'Email non valida' });
    const co = await pool.query('SELECT name,locale FROM companies WHERE id=$1', [req.params.cid]);
    if (!co.rowCount) return res.status(404).json({ error: 'Azienda non trovata' });
    const dup = await pool.query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [email]);
    if (dup.rowCount) return res.status(409).json({ error: 'Esiste già un account con ' + email });
    const uid = id('u_'), token = crypto.randomBytes(24).toString('hex');
    const lang = emails.pick(co.rows[0].locale);
    await pool.query('INSERT INTO users (id,company_id,name,email,role,status,email_verified,verify_token,verify_sent_at,locale) VALUES ($1,$2,$3,$4,$5,$6,false,$7,now(),$8)',
      [uid, req.params.cid, String(b.name || '').trim() || email.split('@')[0], email, b.role === 'admin' ? 'admin' : 'seller', 'active', token, lang]);
    const link = inviteLink(email, token);
    let mail = null;
    if (b.sendEmail) { const m = emails.build('invite', lang, { company: co.rows[0].name, link }); mail = await sendEmail(email, m.subject, m.html); }
    audit(req, 'user.create', uid, { company: req.params.cid, email, role: b.role === 'admin' ? 'admin' : 'seller', emailed: !!b.sendEmail });
    res.json({ ok: true, userId: uid, link, emailSent: mail ? !!mail.ok : null, emailError: mail && !mail.ok ? (mail.error || 'Email non configurata') : null });
  }));

  async function loadUser(uid) {
    const r = await pool.query('SELECT id,company_id,name,email,role,status,password_hash,email_verified,locale FROM users WHERE id=$1', [uid]);
    return r.rowCount ? r.rows[0] : null;
  }
  async function activeAdmins(cid, exceptUid) {
    const r = await pool.query("SELECT id FROM users WHERE company_id=$1 AND role='admin' AND status='active' AND id<>$2 ORDER BY created_at", [cid, exceptUid]);
    return r.rows.map(x => x.id);
  }

  app.patch('/super/users/:uid', superAuth, wrap(async (req, res) => {
    const { role, status, name } = req.body || {};
    if (role !== undefined && ['admin', 'seller'].indexOf(role) < 0) return res.status(400).json({ error: 'Ruolo non valido' });
    if (status !== undefined && ['active', 'disabled'].indexOf(status) < 0) return res.status(400).json({ error: 'Stato non valido' });
    const u = await loadUser(req.params.uid);
    if (!u) return res.status(404).json({ error: 'Utente non trovato' });
    if (u.role === 'admin' && u.status === 'active' && (role === 'seller' || status === 'disabled') && !(await activeAdmins(u.company_id, u.id)).length) {
      return res.status(400).json({ error: 'Ogni azienda deve avere almeno un admin attivo' });
    }
    await pool.query('UPDATE users SET role=COALESCE($1,role), status=COALESCE($2,status), name=COALESCE($3,name) WHERE id=$4',
      [role || null, status || null, name ? String(name).trim() : null, u.id]);
    audit(req, 'user.update', u.id, { email: u.email, role: role || null, status: status || null, name: name || null });
    res.json({ ok: true });
  }));

  /* A fresh access link. For someone who never activated it is the invitation;
     for an active account it lets them choose a new password. Either way the
     previous link stops working. */
  app.post('/super/users/:uid/link', superAuth, wrap(async (req, res) => {
    const u = await loadUser(req.params.uid);
    if (!u) return res.status(404).json({ error: 'Utente non trovato' });
    const token = crypto.randomBytes(24).toString('hex');
    await pool.query('UPDATE users SET verify_token=$1, verify_sent_at=now() WHERE id=$2', [token, u.id]);
    const link = inviteLink(u.email, token);
    let mail = null;
    if ((req.body || {}).sendEmail) {
      const co = await pool.query('SELECT name,locale FROM companies WHERE id=$1', [u.company_id]);
      const m = emails.build('invite', emails.pick(u.locale || (co.rows[0] || {}).locale), { company: (co.rows[0] || {}).name || 'Bizca', link });
      mail = await sendEmail(u.email, m.subject, m.html);
    }
    const reset = !!u.password_hash;
    audit(req, reset ? 'user.reset-link' : 'user.invite-link', u.id, { email: u.email, emailed: !!(req.body || {}).sendEmail });
    res.json({ ok: true, link, reset, emailSent: mail ? !!mail.ok : null, emailError: mail && !mail.ok ? (mail.error || 'Email non configurata') : null });
  }));

  // Remove a user. Their leads move to another active admin of the same company.
  app.delete('/super/users/:uid', superAuth, wrap(async (req, res) => {
    const u = await loadUser(req.params.uid);
    if (!u) return res.status(404).json({ error: 'Utente non trovato' });
    const admins = await activeAdmins(u.company_id, u.id);
    if (!admins.length) return res.status(400).json({ error: 'È l\'ultimo admin attivo: prima nomina un altro admin, oppure elimina l\'azienda' });
    const heir = admins[0];
    const client = await pool.connect();
    let moved = 0;
    try {
      await client.query('BEGIN');
      const r = await client.query('UPDATE leads SET owner_id=$1, updated_at=now() WHERE company_id=$2 AND owner_id=$3', [heir, u.company_id, u.id]);
      moved = r.rowCount || 0;
      await client.query('DELETE FROM users WHERE id=$1', [u.id]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    audit(req, 'user.delete', u.id, { email: u.email, company: u.company_id, leadsMovedTo: heir, moved });
    res.json({ ok: true, leadsReassigned: moved, movedTo: heir });
  }));
}

module.exports = { mount, _internals: { isSuper, allowlist, sha } };
