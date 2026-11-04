/* Bizca — sign in with a Microsoft work account.

   This is a different mechanism from the Excel connector in ms.js, even though
   both live on the same app registration:

     ms.js      application permissions, server to server, writes the workbook
     msauth.js  delegated sign-in, a person authenticates in front of Microsoft

   Because the registration is per company, the flow needs to know which tenant
   to send the person to before it can start. So it asks for the work email
   first, looks up the company from it, and only then redirects.

   Who gets in:
     - people the admin has already invited, as with Google;
     - and, only if the company switched on "msAutoJoin", anyone from the
       company's own Microsoft tenant whose address is on one of the company's
       domains. They are created on the spot as sellers. Microsoft vouches for
       the tenant (tid), the domain check keeps out guest accounts that live in
       that tenant with outside addresses.

   The app registration needs one extra redirect URI, of type Web:
     {API_URL}/auth/microsoft/callback
*/

const LOGIN = 'https://login.microsoftonline.com';

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

const b64uDecode = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

// Read an id_token without verifying the signature. That is sound here only
// because we fetched it ourselves over TLS straight from the tenant's token
// endpoint, authenticating with the client secret — never trust a token that
// arrived any other way.
function readIdToken(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw httpError(400, 'Microsoft returned an unreadable token');
  try { return JSON.parse(b64uDecode(parts[1])); }
  catch (e) { throw httpError(400, 'Microsoft returned an unreadable token'); }
}

const emailFromClaims = c =>
  String(c.email || c.preferred_username || c.upn || '').trim().toLowerCase();

/* One-time codes handed to the browser after a successful sign-in. The session
   token itself never travels in a URL. In memory on purpose: they live for a
   couple of minutes, and a restart only means signing in again. */
const handoff = new Map();
function stash(payload) {
  const code = require('crypto').randomBytes(24).toString('hex');
  handoff.set(code, { payload, exp: Date.now() + 5 * 60 * 1000 });
  return code;
}
function claim(code) {
  const hit = handoff.get(code);
  if (!hit) return null;
  handoff.delete(code);                       // single use
  return hit.exp > Date.now() ? hit.payload : null;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of handoff) if (v.exp <= now) handoff.delete(k);
}, 60 * 1000).unref?.();

const domainOf = e => String(e || '').split('@')[1] || '';
const companyDomains = c => [c.domain].concat(Array.isArray(c.extra_domains) ? c.extra_domains : [])
  .map(d => String(d || '').trim().toLowerCase()).filter(Boolean);
const msComplete = cfg => !!(cfg.tenantId && cfg.clientId && cfg.clientSecret);

function mount(app, deps) {
  const { pool, ms, sign, verifyToken, session, outUser, APP_URL, API_URL } = deps;
  const fetchImpl = deps.fetch || global.fetch;
  const redirectUri = () => (process.env.MS_LOGIN_REDIRECT_URI || (API_URL + '/auth/microsoft/callback'));

  const back = (params) => APP_URL + '/#/login?' + params;

  /* The one company that owns this email domain and lets Microsoft users join on
     their own. Two candidates = ambiguous = nobody: we never guess a workspace. */
  async function autoJoinCompany(domain) {
    if (!domain) return null;
    const r = await pool.query("SELECT id,domain,extra_domains,status,settings FROM companies WHERE lower(domain)=$1 OR extra_domains ? $1", [domain]);
    const ok = r.rows.filter(c => c.status !== 'suspended' && (c.settings || {}).msAutoJoin === true && companyDomains(c).indexOf(domain) >= 0)
      .map(c => Object.assign({}, c, { cfg: ms.readCfg(c.settings) })).filter(c => msComplete(c.cfg));
    return ok.length === 1 ? ok[0] : null;
  }

  /* Step 1 — which tenant does this person belong to? */
  app.post('/auth/microsoft/start', async (req, res) => {
    try {
      const email = String((req.body || {}).email || '').trim().toLowerCase();
      if (!email) throw httpError(400, 'Enter your work email first');

      const u = await pool.query('SELECT id,company_id,status FROM users WHERE lower(email)=lower($1)', [email]);
      let cid, uid = null, cfg;
      if (u.rowCount) {
        if (u.rows[0].status !== 'active') throw httpError(403, 'This account is disabled');
        cid = u.rows[0].company_id; uid = u.rows[0].id;
        const co = await pool.query('SELECT settings FROM companies WHERE id=$1', [cid]);
        cfg = ms.readCfg(co.rows[0] && co.rows[0].settings);
        if (!msComplete(cfg)) {
          throw httpError(400, 'Microsoft sign-in is not set up for your company yet — your admin can add it in Admin → Destinations');
        }
      } else {
        // Not invited: is there exactly one company that lets its people in automatically?
        const hit = await autoJoinCompany(domainOf(email));
        if (!hit) throw httpError(404, 'No Bizca account for ' + email + ' — ask your admin to invite you');
        cid = hit.id; cfg = hit.cfg;
      }

      const state = sign({ k: 'mslogin', cid, uid, auto: !uid, exp: Date.now() + 10 * 60 * 1000 });
      const url = LOGIN + '/' + encodeURIComponent(cfg.tenantId) + '/oauth2/v2.0/authorize'
        + '?client_id=' + encodeURIComponent(cfg.clientId)
        + '&response_type=code'
        + '&redirect_uri=' + encodeURIComponent(redirectUri())
        + '&response_mode=query'
        + '&scope=' + encodeURIComponent('openid profile email')
        + '&login_hint=' + encodeURIComponent(email)
        + '&state=' + encodeURIComponent(state);
      res.json({ ok: true, url });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || 'Server error' });
    }
  });

  /* Create the account of someone from the company's tenant (already checked by
     the caller: tid and aud match this company's app). */
  async function autoJoin(cid, email, claims) {
    const noAccount = { error: 'No Bizca account for ' + email + ' — ask your admin to invite that address' };
    const co = await pool.query('SELECT id,domain,extra_domains,status,settings,locale FROM companies WHERE id=$1', [cid]);
    if (!co.rowCount) return noAccount;
    const c = co.rows[0];
    if ((c.settings || {}).msAutoJoin !== true) return noAccount;
    if (c.status === 'suspended') return { error: 'This workspace is suspended — contact Bryan' };
    if (companyDomains(c).indexOf(domainOf(email)) < 0) {
      return { error: email + ' is not on one of ' + (c.domain || 'the company') + '\'s email domains — ask your admin to invite you' };
    }
    const taken = await pool.query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [email]);
    if (taken.rowCount) return { error: 'This address already has a Bizca account in another workspace' };
    const uid = 'u_' + Date.now().toString(36) + require('crypto').randomBytes(4).toString('hex');
    const name = String(claims.name || '').trim() || email.split('@')[0];
    await pool.query("INSERT INTO users (id,company_id,name,email,role,status,email_verified,locale) VALUES ($1,$2,$3,$4,'seller','active',true,$5)",
      [uid, cid, name, email, c.locale || null]);
    console.log('Microsoft auto-join:', email, '→', cid);
    return { ok: true, uid };
  }

  /* Step 2 — Microsoft sends the person back here with a code */
  app.get('/auth/microsoft/callback', async (req, res) => {
    const fail = reason => res.redirect(back('mserror=' + encodeURIComponent(String(reason).slice(0, 180))));
    try {
      if (req.query.error) return fail(req.query.error_description || req.query.error);
      const p = verifyToken(req.query.state || '');
      if (!p || p.k !== 'mslogin') return fail('The sign-in request expired — please try again');

      const co = await pool.query('SELECT settings FROM companies WHERE id=$1', [p.cid]);
      if (!co.rowCount) return fail('Workspace not found');
      const cfg = ms.readCfg(co.rows[0].settings);
      if (!cfg.tenantId || !cfg.clientId || !cfg.clientSecret) return fail('Microsoft sign-in is no longer configured');

      const body = new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: 'authorization_code',
        code: String(req.query.code || ''),
        redirect_uri: redirectUri(),
        scope: 'openid profile email'
      }).toString();

      const r = await fetchImpl(LOGIN + '/' + encodeURIComponent(cfg.tenantId) + '/oauth2/v2.0/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.id_token) {
        return fail(String(d.error_description || d.error || 'Microsoft refused the sign-in').split(/\r?\n/)[0]);
      }

      const claims = readIdToken(d.id_token);
      // The checks that keep one customer out of another's workspace.
      if (claims.tid !== cfg.tenantId) return fail('That account belongs to a different Microsoft tenant');
      if (claims.aud !== cfg.clientId) return fail('The token was issued for a different application');
      if (claims.exp && claims.exp * 1000 < Date.now()) return fail('Microsoft returned an expired token');

      const email = emailFromClaims(claims);
      if (!email) return fail('Microsoft did not return an email address for that account');

      let ur = await pool.query('SELECT * FROM users WHERE lower(email)=lower($1) AND company_id=$2', [email, p.cid]);
      if (!ur.rowCount) {
        const created = await autoJoin(p.cid, email, claims);
        if (created.error) return fail(created.error);
        ur = await pool.query('SELECT * FROM users WHERE lower(email)=lower($1) AND company_id=$2', [email, p.cid]);
        if (!ur.rowCount) return fail('Sign-in failed');
      }
      const user = ur.rows[0];
      if (user.status !== 'active') return fail('This account is disabled');

      // Signing in through the tenant proves the address, exactly like Google.
      if (!user.email_verified) {
        await pool.query('UPDATE users SET email_verified=true, verify_token=NULL WHERE id=$1', [user.id]);
        user.email_verified = true;
      }
      if (!user.name && claims.name) {
        await pool.query('UPDATE users SET name=$1 WHERE id=$2', [claims.name, user.id]);
        user.name = claims.name;
      }

      const code = stash({ token: session(user), user: outUser(user) });
      res.redirect(back('ms=' + code));
    } catch (e) {
      console.error('Microsoft sign-in failed', e);
      fail(e.message || 'Sign-in failed');
    }
  });

  /* Step 3 — the app trades the one-time code for its session */
  app.post('/auth/microsoft/exchange', async (req, res) => {
    const payload = claim(String((req.body || {}).code || ''));
    if (!payload) return res.status(400).json({ error: 'That sign-in link has already been used or has expired' });
    res.json(Object.assign({ ok: true }, payload));
  });

  /* Does this workspace have Microsoft sign-in configured? Used to decide
     whether the button is worth showing. */
  app.get('/auth/microsoft/available', async (req, res) => {
    try {
      const email = String(req.query.email || '').trim().toLowerCase();
      if (!email) return res.json({ available: false });
      const u = await pool.query('SELECT company_id FROM users WHERE lower(email)=lower($1)', [email]);
      if (!u.rowCount) return res.json({ available: !!(await autoJoinCompany(domainOf(email))) });
      const co = await pool.query('SELECT settings FROM companies WHERE id=$1', [u.rows[0].company_id]);
      const cfg = ms.readCfg(co.rows[0] && co.rows[0].settings);
      res.json({ available: !!(cfg.tenantId && cfg.clientId && cfg.clientSecret) });
    } catch (e) { res.json({ available: false }); }
  });
}

module.exports = { mount, companyDomains, _internals: { readIdToken, emailFromClaims, stash, claim, handoff, companyDomains } };
