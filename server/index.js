/* Bizca API — shared multi-tenant backend (Railway + Postgres).
   Auth: email+password (verified by email) and Google Sign-In.
   Every query is scoped by the company_id carried in the session token. */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const APP_URL = (process.env.APP_URL || 'https://bizca.vercel.app').replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const BREVO_KEY = process.env.BREVO_TRANSACTIONAL_KEY || '';
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'no-reply@bryan.it';
const SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Bizca';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
// Public URL of this API (Railway domain) — used to build email confirmation links
const API_URL = (process.env.API_URL || '').replace(/\/$/, '');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  ssl: /railway|proxy\.rlwy/.test(process.env.DATABASE_URL || '') && !/localhost/.test(process.env.DATABASE_URL || '')
    ? { rejectUnauthorized: false } : false
});

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '12mb' }));

/* ---------- helpers ---------- */
const id = p => p + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uDec = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();

function sign(payload) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(crypto.createHmac('sha256', JWT_SECRET).update(head + '.' + body).digest());
  return head + '.' + body + '.' + sig;
}
function verifyToken(token) {
  try {
    const [h, b, s] = String(token).split('.');
    const expected = b64u(crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + b).digest());
    if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
    const payload = JSON.parse(b64uDec(b));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch (e) { return null; }
}
function hashPassword(pw, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pw), s, 32).toString('hex');
  return s + ':' + h;
}
function checkPassword(pw, stored) {
  if (!stored || stored.indexOf(':') < 0) return false;
  const [s, h] = stored.split(':');
  const calc = crypto.scryptSync(String(pw), s, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(calc));
}
const isEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || ''));

async function sendEmail(to, subject, html) {
  if (!BREVO_KEY) { console.warn('No BREVO_TRANSACTIONAL_KEY — email not sent to', to); return { ok: false, skipped: true }; }
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { email: SENDER_EMAIL, name: SENDER_NAME }, to: [{ email: to }], subject, htmlContent: html })
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.error('Brevo email failed', r.status, t);
    let msg = 'Brevo rejected the email (' + r.status + ')';
    try { const j = JSON.parse(t); if (j && j.message) msg = j.message; } catch (e) {}
    return { ok: false, error: msg };
  }
  return { ok: true };
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const p = verifyToken(h.replace(/^Bearer\s+/i, ''));
  if (!p) return res.status(401).json({ error: 'Not signed in' });
  req.session = p;
  next();
}
const requireAdmin = (req, res, next) => req.session.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' });
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: e.message || 'Server error' }); });

/* ---------- bootstrap ---------- */
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Schema ready');
}

/* ---------- mapping ---------- */
const outLead = r => ({
  id: r.id, eventId: r.event_id, ownerId: r.owner_id, createdBy: r.created_by,
  first: r.first_name, last: r.last_name, company: r.company_name, role: r.role_title,
  email: r.email, phone: r.phone, website: r.website, address: r.address,
  provenienza: r.source, country: r.country, interesse: r.segment,
  status: r.status, override: r.override_flag, error: r.error, image: r.card_image,
  consentAt: r.consent_at ? new Date(r.consent_at).getTime() : null, consentSignature: r.consent_sig,
  ts: new Date(r.captured_at).getTime()
});
const outUser = r => ({ id: r.id, name: r.name, email: r.email, role: r.role, status: r.status, verified: r.email_verified });
const outEvent = r => ({
  id: r.id, name: r.name, startDate: r.start_date ? new Date(r.start_date).toISOString().slice(0, 10) : '',
  endDate: r.end_date ? new Date(r.end_date).toISOString().slice(0, 10) : '',
  status: r.status, preset: r.preset || {}, brevoListId: r.brevo_list_id
});
const outRule = r => ({ id: r.id, priority: r.priority, countries: r.countries || [], interests: r.segments || [], owner: r.owner_id, active: r.active });

/* ================= AUTH ================= */

// Register a company + its first admin. The admin must confirm by email.
app.post('/auth/register', wrap(async (req, res) => {
  const { company, domain, name, email, password, privacy } = req.body || {};
  if (!company || !domain || !name || !isEmail(email) || !password) return res.status(400).json({ error: 'Missing or invalid fields' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!privacy) return res.status(400).json({ error: 'Privacy policy must be accepted' });

  const exists = await pool.query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [email]);
  if (exists.rowCount) return res.status(409).json({ error: 'An account with this email already exists' });

  const cid = id('c_');
  const uid = id('u_');
  const token = crypto.randomBytes(24).toString('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO companies (id,name,domain,settings,privacy_at) VALUES ($1,$2,$3,$4,now())',
      [cid, company, String(domain).toLowerCase().replace(/^@/, ''), { autoSend: true, requireConsent: false, allowOverride: true, brevoApiKey: '', fallbackOwner: uid }]
    );
    await client.query(
      'INSERT INTO users (id,company_id,name,email,password_hash,role,status,email_verified,verify_token,verify_sent_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())',
      [uid, cid, name, String(email).toLowerCase(), hashPassword(password), 'admin', 'active', false, token]
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }

  const link = (API_URL || '') + '/auth/verify?token=' + token;
  const mail = await sendEmail(email, 'Confirm your Bizca account',
    '<div style="font-family:Arial,sans-serif;font-size:15px;color:#0F172A">' +
    '<p>Hi ' + escapeHtml(name) + ',</p>' +
    '<p>Confirm your email address to activate the Bizca workspace for <b>' + escapeHtml(company) + '</b>.</p>' +
    '<p><a href="' + link + '" style="display:inline-block;padding:12px 22px;background:#0284C7;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Confirm my email</a></p>' +
    '<p style="color:#64748B;font-size:13px">Or paste this link in your browser:<br>' + link + '</p>' +
    '<p style="color:#64748B;font-size:13px">If you did not request this, you can ignore this email.</p></div>');

  res.json({ ok: true, pendingVerification: true, emailSent: !!mail.ok, emailError: mail.ok ? null : (mail.error || 'Email not configured') });
}));

function escapeHtml(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Confirm email (link target)
app.get('/auth/verify', wrap(async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).send('Missing token');
  const r = await pool.query('UPDATE users SET email_verified=true, verify_token=NULL WHERE verify_token=$1 RETURNING id', [token]);
  const ok = r.rowCount > 0;
  res.redirect(APP_URL + '/#/login?verified=' + (ok ? '1' : '0'));
}));

// Resend the confirmation email
app.post('/auth/resend', wrap(async (req, res) => {
  const { email } = req.body || {};
  const r = await pool.query('SELECT id,name,email,email_verified FROM users WHERE lower(email)=lower($1)', [email || '']);
  if (!r.rowCount || r.rows[0].email_verified) return res.json({ ok: true }); // do not reveal account state
  const token = crypto.randomBytes(24).toString('hex');
  await pool.query('UPDATE users SET verify_token=$1, verify_sent_at=now() WHERE id=$2', [token, r.rows[0].id]);
  const link = (API_URL || '') + '/auth/verify?token=' + token;
  const mail = await sendEmail(r.rows[0].email, 'Confirm your Bizca account',
    '<div style="font-family:Arial,sans-serif"><p>Confirm your email to activate your Bizca account.</p>' +
    '<p><a href="' + link + '">Confirm my email</a></p></div>');
  res.json({ ok: true, emailSent: !!mail.ok, emailError: mail.ok ? null : (mail.error || 'Email not configured') });
}));

app.post('/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const r = await pool.query('SELECT * FROM users WHERE lower(email)=lower($1)', [email || '']);
  if (!r.rowCount) return res.status(401).json({ error: 'Account not found — ask your admin to invite you' });
  const u = r.rows[0];
  if (u.status !== 'active') return res.status(403).json({ error: 'This account is disabled' });
  if (!u.password_hash || !checkPassword(password || '', u.password_hash)) return res.status(401).json({ error: 'Wrong email or password' });
  if (!u.email_verified) return res.status(403).json({ error: 'Please confirm your email first', needsVerification: true });
  res.json({ ok: true, token: session(u), user: outUser(u) });
}));

function session(u) {
  return sign({ uid: u.id, cid: u.company_id, role: u.role, exp: Date.now() + 30 * 24 * 3600 * 1000 });
}

app.post('/auth/google', wrap(async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google sign-in not configured' });
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'Missing credential' });
  const g = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  const d = await g.json().catch(() => ({}));
  if (!g.ok || d.aud !== GOOGLE_CLIENT_ID) return res.status(401).json({ error: 'Invalid Google token' });
  if (d.email_verified !== 'true' && d.email_verified !== true) return res.status(401).json({ error: 'Google email not verified' });
  const r = await pool.query('SELECT * FROM users WHERE lower(email)=lower($1)', [d.email]);
  if (!r.rowCount) return res.status(404).json({ error: 'No Bizca account for ' + d.email + ' — ask your admin to invite you' });
  const u = r.rows[0];
  if (u.status !== 'active') return res.status(403).json({ error: 'This account is disabled' });
  // Signing in with Google proves the address: treat it as confirmed
  if (!u.email_verified) await pool.query('UPDATE users SET email_verified=true, verify_token=NULL WHERE id=$1', [u.id]);
  if (!u.name && d.name) await pool.query('UPDATE users SET name=$1 WHERE id=$2', [d.name, u.id]);
  res.json({ ok: true, token: session(u), user: outUser(Object.assign({}, u, { email_verified: true, name: u.name || d.name || '' })) });
}));

// Set a password (used when an invited user activates their account)
app.post('/auth/set-password', wrap(async (req, res) => {
  const { email, token, password } = req.body || {};
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const r = await pool.query('SELECT * FROM users WHERE lower(email)=lower($1) AND verify_token=$2', [email || '', token || '']);
  if (!r.rowCount) return res.status(400).json({ error: 'Invalid or expired link' });
  await pool.query('UPDATE users SET password_hash=$1, email_verified=true, verify_token=NULL WHERE id=$2', [hashPassword(password), r.rows[0].id]);
  res.json({ ok: true });
}));

/* ================= WORKSPACE ================= */

app.get('/state', auth, wrap(async (req, res) => {
  const cid = req.session.cid;
  const [co, users, events, picks, rules, leads, logs] = await Promise.all([
    pool.query('SELECT * FROM companies WHERE id=$1', [cid]),
    pool.query('SELECT * FROM users WHERE company_id=$1 ORDER BY created_at', [cid]),
    pool.query('SELECT * FROM events WHERE company_id=$1 ORDER BY created_at', [cid]),
    pool.query('SELECT * FROM picklists WHERE company_id=$1 ORDER BY created_at', [cid]),
    pool.query('SELECT * FROM rules WHERE company_id=$1 ORDER BY priority', [cid]),
    req.session.role === 'admin'
      ? pool.query('SELECT * FROM leads WHERE company_id=$1 ORDER BY captured_at DESC LIMIT 2000', [cid])
      : pool.query('SELECT * FROM leads WHERE company_id=$1 AND (created_by=$2 OR owner_id=$2) ORDER BY captured_at DESC LIMIT 2000', [cid, req.session.uid]),
    pool.query('SELECT * FROM sync_log WHERE company_id=$1 ORDER BY ts DESC LIMIT 200', [cid])
  ]);
  if (!co.rowCount) return res.status(404).json({ error: 'Workspace not found' });
  const c = co.rows[0];
  const s = c.settings || {};
  res.json({
    company: { id: c.id, name: c.name, domain: c.domain, locale: c.locale, configured: true },
    settings: { autoSend: s.autoSend !== false, requireConsent: !!s.requireConsent, allowOverride: s.allowOverride !== false, brevoApiKey: s.brevoApiKey || '', fallbackOwner: s.fallbackOwner || null },
    users: users.rows.map(outUser),
    events: events.rows.map(outEvent),
    picklists: {
      provenienza: picks.rows.filter(p => p.kind === 'source').map(p => ({ id: p.id, value: p.value, active: p.active })),
      interesse: picks.rows.filter(p => p.kind === 'segment').map(p => ({ id: p.id, value: p.value, active: p.active }))
    },
    rules: rules.rows.map(outRule),
    leads: leads.rows.map(outLead),
    syncLog: logs.rows.map(l => ({ leadId: l.lead_id, dest: l.dest, ok: l.ok, msg: l.msg, ts: new Date(l.ts).getTime() })),
    me: { id: req.session.uid, role: req.session.role }
  });
}));

/* ---------- settings ---------- */
app.patch('/settings', auth, requireAdmin, wrap(async (req, res) => {
  const cur = await pool.query('SELECT settings FROM companies WHERE id=$1', [req.session.cid]);
  const merged = Object.assign({}, cur.rows[0].settings || {}, req.body || {});
  await pool.query('UPDATE companies SET settings=$1 WHERE id=$2', [merged, req.session.cid]);
  res.json({ ok: true, settings: merged });
}));

/* ---------- users ---------- */
app.post('/users', auth, requireAdmin, wrap(async (req, res) => {
  const { name, email, role } = req.body || {};
  if (!isEmail(email)) return res.status(400).json({ error: 'Invalid email' });
  const dup = await pool.query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [email]);
  if (dup.rowCount) return res.status(409).json({ error: 'That user already exists' });
  const uid = id('u_');
  const token = crypto.randomBytes(24).toString('hex');
  await pool.query('INSERT INTO users (id,company_id,name,email,role,status,email_verified,verify_token,verify_sent_at) VALUES ($1,$2,$3,$4,$5,$6,false,$7,now())',
    [uid, req.session.cid, name || String(email).split('@')[0], String(email).toLowerCase(), role === 'admin' ? 'admin' : 'seller', 'active', token]);
  const co = await pool.query('SELECT name FROM companies WHERE id=$1', [req.session.cid]);
  const link = APP_URL + '/#/activate?email=' + encodeURIComponent(email) + '&token=' + token;
  await sendEmail(email, 'You have been invited to Bizca',
    '<div style="font-family:Arial,sans-serif;font-size:15px;color:#0F172A">' +
    '<p>You have been added to the Bizca workspace of <b>' + escapeHtml(co.rows[0].name) + '</b>.</p>' +
    '<p>Set your password to get started — or simply sign in with Google using this address.</p>' +
    '<p><a href="' + link + '" style="display:inline-block;padding:12px 22px;background:#0284C7;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Activate my account</a></p></div>');
  const r = await pool.query('SELECT * FROM users WHERE id=$1', [uid]);
  res.json({ ok: true, user: outUser(r.rows[0]) });
}));

app.patch('/users/:uid', auth, requireAdmin, wrap(async (req, res) => {
  const { role, status, name } = req.body || {};
  const target = await pool.query('SELECT * FROM users WHERE id=$1 AND company_id=$2', [req.params.uid, req.session.cid]);
  if (!target.rowCount) return res.status(404).json({ error: 'User not found' });
  if (req.params.uid === req.session.uid && (status === 'disabled' || role === 'seller')) {
    return res.status(400).json({ error: 'You cannot demote or disable your own account' });
  }
  const admins = await pool.query("SELECT count(*)::int AS n FROM users WHERE company_id=$1 AND role='admin' AND status='active'", [req.session.cid]);
  if (admins.rows[0].n <= 1 && target.rows[0].role === 'admin' && (role === 'seller' || status === 'disabled')) {
    return res.status(400).json({ error: 'Keep at least one active admin' });
  }
  await pool.query('UPDATE users SET role=COALESCE($1,role), status=COALESCE($2,status), name=COALESCE($3,name) WHERE id=$4',
    [role || null, status || null, name || null, req.params.uid]);
  const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.uid]);
  res.json({ ok: true, user: outUser(r.rows[0]) });
}));

/* ---------- events ---------- */
app.post('/events', auth, requireAdmin, wrap(async (req, res) => {
  const { name, startDate, endDate } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Event name required' });
  const eid = id('e_');
  await pool.query('INSERT INTO events (id,company_id,name,start_date,end_date,preset) VALUES ($1,$2,$3,$4,$5,$6)',
    [eid, req.session.cid, name, startDate || null, endDate || null, {}]);
  const r = await pool.query('SELECT * FROM events WHERE id=$1', [eid]);
  res.json({ ok: true, event: outEvent(r.rows[0]) });
}));

app.patch('/events/:eid', auth, requireAdmin, wrap(async (req, res) => {
  const { name, startDate, endDate, preset, brevoListId, status } = req.body || {};
  const own = await pool.query('SELECT 1 FROM events WHERE id=$1 AND company_id=$2', [req.params.eid, req.session.cid]);
  if (!own.rowCount) return res.status(404).json({ error: 'Event not found' });
  await pool.query('UPDATE events SET name=COALESCE($1,name), start_date=COALESCE($2,start_date), end_date=COALESCE($3,end_date), preset=COALESCE($4,preset), brevo_list_id=$5, status=COALESCE($6,status) WHERE id=$7',
    [name || null, startDate || null, endDate || null, preset || null, (brevoListId === undefined ? null : brevoListId), status || null, req.params.eid]);
  const r = await pool.query('SELECT * FROM events WHERE id=$1', [req.params.eid]);
  res.json({ ok: true, event: outEvent(r.rows[0]) });
}));

app.delete('/events/:eid', auth, requireAdmin, wrap(async (req, res) => {
  await pool.query('DELETE FROM events WHERE id=$1 AND company_id=$2', [req.params.eid, req.session.cid]);
  res.json({ ok: true });
}));

/* ---------- picklists ---------- */
app.post('/picklists', auth, requireAdmin, wrap(async (req, res) => {
  const { kind, value } = req.body || {};
  if (['source', 'segment'].indexOf(kind) < 0 || !value) return res.status(400).json({ error: 'Invalid list value' });
  const dup = await pool.query('SELECT 1 FROM picklists WHERE company_id=$1 AND kind=$2 AND lower(value)=lower($3)', [req.session.cid, kind, value]);
  if (dup.rowCount) return res.status(409).json({ error: 'That value already exists' });
  const pid = id('p_');
  await pool.query('INSERT INTO picklists (id,company_id,kind,value) VALUES ($1,$2,$3,$4)', [pid, req.session.cid, kind, value]);
  res.json({ ok: true, item: { id: pid, value, active: true } });
}));

app.patch('/picklists/:pid', auth, requireAdmin, wrap(async (req, res) => {
  await pool.query('UPDATE picklists SET active=COALESCE($1,active), value=COALESCE($2,value) WHERE id=$3 AND company_id=$4',
    [typeof req.body.active === 'boolean' ? req.body.active : null, req.body.value || null, req.params.pid, req.session.cid]);
  res.json({ ok: true });
}));

app.delete('/picklists/:pid', auth, requireAdmin, wrap(async (req, res) => {
  await pool.query('DELETE FROM picklists WHERE id=$1 AND company_id=$2', [req.params.pid, req.session.cid]);
  res.json({ ok: true });
}));

/* ---------- rules ---------- */
app.post('/rules', auth, requireAdmin, wrap(async (req, res) => {
  const { countries, interests, owner, priority } = req.body || {};
  const rid = id('r_');
  await pool.query('INSERT INTO rules (id,company_id,priority,countries,segments,owner_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [rid, req.session.cid, priority || 1, JSON.stringify(countries || []), JSON.stringify(interests || []), owner || null]);
  const r = await pool.query('SELECT * FROM rules WHERE id=$1', [rid]);
  res.json({ ok: true, rule: outRule(r.rows[0]) });
}));

app.patch('/rules/:rid', auth, requireAdmin, wrap(async (req, res) => {
  const { countries, interests, owner, priority, active } = req.body || {};
  await pool.query('UPDATE rules SET countries=COALESCE($1,countries), segments=COALESCE($2,segments), owner_id=COALESCE($3,owner_id), priority=COALESCE($4,priority), active=COALESCE($5,active) WHERE id=$6 AND company_id=$7',
    [countries ? JSON.stringify(countries) : null, interests ? JSON.stringify(interests) : null, owner || null, priority || null,
     typeof active === 'boolean' ? active : null, req.params.rid, req.session.cid]);
  res.json({ ok: true });
}));

app.delete('/rules/:rid', auth, requireAdmin, wrap(async (req, res) => {
  await pool.query('DELETE FROM rules WHERE id=$1 AND company_id=$2', [req.params.rid, req.session.cid]);
  res.json({ ok: true });
}));

/* ---------- leads ---------- */
app.put('/leads/:lid', auth, wrap(async (req, res) => {
  const l = req.body || {};
  const cid = req.session.cid;
  const existing = await pool.query('SELECT created_by FROM leads WHERE id=$1 AND company_id=$2', [req.params.lid, cid]);
  if (existing.rowCount && req.session.role !== 'admin' && existing.rows[0].created_by !== req.session.uid) {
    return res.status(403).json({ error: 'Not your lead' });
  }
  await pool.query(
    `INSERT INTO leads (id,company_id,event_id,owner_id,created_by,first_name,last_name,company_name,role_title,email,phone,website,address,source,country,segment,status,override_flag,error,card_image,consent_at,consent_sig,captured_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,to_timestamp($23/1000.0),now())
     ON CONFLICT (id) DO UPDATE SET event_id=EXCLUDED.event_id, owner_id=EXCLUDED.owner_id, first_name=EXCLUDED.first_name,
       last_name=EXCLUDED.last_name, company_name=EXCLUDED.company_name, role_title=EXCLUDED.role_title, email=EXCLUDED.email,
       phone=EXCLUDED.phone, website=EXCLUDED.website, address=EXCLUDED.address, source=EXCLUDED.source, country=EXCLUDED.country,
       segment=EXCLUDED.segment, status=EXCLUDED.status, override_flag=EXCLUDED.override_flag, error=EXCLUDED.error,
       card_image=EXCLUDED.card_image, consent_at=EXCLUDED.consent_at, consent_sig=EXCLUDED.consent_sig, updated_at=now()`,
    [req.params.lid, cid, l.eventId || null, l.ownerId || null, l.createdBy || req.session.uid,
     l.first || '', l.last || '', l.company || '', l.role || '', l.email || '', l.phone || '', l.website || '', l.address || '',
     l.provenienza || '', l.country || '', l.interesse || '', l.status || 'To finalize', !!l.override, l.error || null,
     l.image || null, l.consentAt ? new Date(l.consentAt) : null, l.consentSignature || null, l.ts || Date.now()]
  );
  res.json({ ok: true });
}));

app.delete('/leads/:lid', auth, wrap(async (req, res) => {
  const q = req.session.role === 'admin'
    ? await pool.query('DELETE FROM leads WHERE id=$1 AND company_id=$2', [req.params.lid, req.session.cid])
    : await pool.query('DELETE FROM leads WHERE id=$1 AND company_id=$2 AND created_by=$3', [req.params.lid, req.session.cid, req.session.uid]);
  res.json({ ok: q.rowCount > 0 });
}));

app.post('/sync-log', auth, wrap(async (req, res) => {
  const { leadId, dest, ok, msg } = req.body || {};
  await pool.query('INSERT INTO sync_log (company_id,lead_id,dest,ok,msg) VALUES ($1,$2,$3,$4,$5)', [req.session.cid, leadId || null, dest || '', !!ok, msg || '']);
  res.json({ ok: true });
}));

/* ---------- email self-test (safe: reveals no secrets) ---------- */
app.get('/email-status', wrap(async (req, res) => {
  res.json({ configured: !!BREVO_KEY, sender: SENDER_EMAIL, senderName: SENDER_NAME, appUrl: APP_URL, apiUrl: API_URL || null });
}));

/* ---------- health ---------- */
app.get('/health', wrap(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, service: 'bizca-api', time: new Date().toISOString() });
}));

migrate()
  .then(() => app.listen(PORT, () => console.log('Bizca API listening on ' + PORT)))
  .catch(e => { console.error('Migration failed', e); process.exit(1); });
