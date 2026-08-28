/* Bizca — Microsoft 365 connector (Excel on SharePoint / OneDrive via Graph).

   Two ways to authenticate, both supported at the same time:

   1. Platform app (SaaS model). Bryan registers ONE multi-tenant app in its own
      Entra ID tenant; each customer's admin grants consent once from Admin →
      Destinations. We only store their tenant id. Env: MS_CLIENT_ID / MS_CLIENT_SECRET.

   2. Per-company app. A customer whose IT insists on registering the app in their
      own tenant pastes tenant id + client id + secret in Admin → Destinations.
      Those credentials live in companies.settings.ms and never leave the server.

   The client secret is never returned to the browser: everything Graph-related
   happens here, and the app only ever asks us to append a row. */

const GRAPH = 'https://graph.microsoft.com/v1.0';
const LOGIN = 'https://login.microsoftonline.com';

const PLATFORM_CLIENT_ID = process.env.MS_CLIENT_ID || '';
const PLATFORM_CLIENT_SECRET = process.env.MS_CLIENT_SECRET || '';

/* ---------- small helpers ---------- */

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Graph "sharing URL" encoding: lets us resolve any SharePoint/OneDrive link
// straight to a driveItem without knowing site or drive ids up front.
const shareId = url =>
  'u!' + Buffer.from(String(url), 'utf8').toString('base64')
    .replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');

const norm = s => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

// Column headers we recognise, Italian and English. Anything else is left blank,
// so the customer can keep their own extra columns without breaking the append.
const HEADER_MAP = {
  data: 'ts', dataacquisizione: 'ts', dataeora: 'ts', date: 'ts', captured: 'ts', capturedat: 'ts', timestamp: 'ts',
  evento: 'event', event: 'event', fiera: 'event', tradeshow: 'event',
  nome: 'first', first: 'first', firstname: 'first',
  cognome: 'last', last: 'last', lastname: 'last', surname: 'last',
  nomecompleto: 'fullname', fullname: 'fullname', name: 'fullname',
  azienda: 'company', company: 'company', societa: 'company', companyname: 'company', organizzazione: 'company',
  ruolo: 'role', role: 'role', jobtitle: 'role', title: 'role', posizione: 'role',
  email: 'email', mail: 'email', indirizzoemail: 'email', emailaddress: 'email',
  telefono: 'phone', phone: 'phone', tel: 'phone', mobile: 'phone', cellulare: 'phone',
  sito: 'website', sitoweb: 'website', website: 'website', web: 'website', url: 'website',
  indirizzo: 'address', address: 'address',
  provenienza: 'source', source: 'source', origine: 'source',
  country: 'country', paese: 'country', nazione: 'country',
  segmento: 'segment', segment: 'segment', interesse: 'segment', interest: 'segment', lineadiprodotto: 'segment',
  assegnatoa: 'owner', owner: 'owner', venditore: 'owner', assignedto: 'owner', commerciale: 'owner',
  caricatoda: 'createdby', createdby: 'createdby', capturedby: 'createdby', raccoltoda: 'createdby',
  stato: 'status', status: 'status',
  consenso: 'consent', consent: 'consent', consensodata: 'consent', consentdate: 'consent', dataconsenso: 'consent',
  note: 'notes', notes: 'notes'
};

const isoDate = d => {
  if (!d) return '';
  const t = d instanceof Date ? d : new Date(d);
  return isNaN(t) ? '' : t.toISOString().slice(0, 10);
};
const isoDateTime = d => {
  if (!d) return '';
  const t = d instanceof Date ? d : new Date(d);
  return isNaN(t) ? '' : t.toISOString().slice(0, 16).replace('T', ' ');
};

/* ---------- configuration ---------- */

// Merge stored settings with the platform app, and say which one is in play.
function readCfg(settings) {
  const m = (settings && settings.ms) || {};
  const own = !!(m.clientId && m.clientSecret);
  return {
    tenantId: m.tenantId || '',
    clientId: own ? m.clientId : PLATFORM_CLIENT_ID,
    clientSecret: own ? m.clientSecret : PLATFORM_CLIENT_SECRET,
    mode: own ? 'own' : (PLATFORM_CLIENT_ID ? 'platform' : 'none'),
    driveId: m.driveId || '',
    itemId: m.itemId || '',
    tableName: m.tableName || '',
    fileName: m.fileName || '',
    fileUrl: m.fileUrl || '',
    enabled: !!m.enabled,
    consentedAt: m.consentedAt || null,
    lastOk: m.lastOk || null,
    lastError: m.lastError || null
  };
}

// What the browser is allowed to see. No secret, ever.
function publicCfg(settings) {
  const m = (settings && settings.ms) || {};
  const c = readCfg(settings);
  return {
    tenantId: c.tenantId,
    clientId: m.clientId || '',          // only the customer's own id, not ours
    hasOwnSecret: !!m.clientSecret,
    mode: c.mode,
    platformApp: !!PLATFORM_CLIENT_ID,
    driveId: c.driveId,
    itemId: c.itemId,
    tableName: c.tableName,
    fileName: c.fileName,
    fileUrl: c.fileUrl,
    enabled: c.enabled,
    consentedAt: c.consentedAt,
    lastOk: c.lastOk,
    lastError: c.lastError,
    ready: !!(c.tenantId && c.clientId && c.clientSecret && c.driveId && c.itemId && c.tableName)
  };
}

/* ---------- Graph plumbing ---------- */

const tokenCache = new Map(); // companyId -> { token, exp, fingerprint }

async function getToken(cid, cfg, fetchImpl) {
  // The secret is part of the cache key: rotating it must invalidate the token
  // even if nobody remembered to call forgetToken.
  const fp = cfg.tenantId + '|' + cfg.clientId + '|' +
    require('crypto').createHash('sha256').update(String(cfg.clientSecret || '')).digest('hex').slice(0, 12);
  const hit = tokenCache.get(cid);
  if (hit && hit.fingerprint === fp && hit.exp > Date.now() + 60000) return hit.token;

  if (!cfg.tenantId) throw httpError(400, 'Microsoft tenant not set — run the admin consent step first');
  if (!cfg.clientId || !cfg.clientSecret) {
    throw httpError(400, 'No Microsoft app credentials — either grant consent to the Bizca app or enter your own Client ID and secret');
  }

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  }).toString();

  const r = await fetchImpl(LOGIN + '/' + encodeURIComponent(cfg.tenantId) + '/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    const raw = d.error_description || d.error || ('Token request failed (' + r.status + ')');
    throw httpError(400, String(raw).split(/\r?\n/)[0]);
  }
  tokenCache.set(cid, { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000, fingerprint: fp });
  return d.access_token;
}

function forgetToken(cid) { tokenCache.delete(cid); }

async function graph(token, urlPath, opts, fetchImpl) {
  const o = opts || {};
  const r = await fetchImpl(GRAPH + urlPath, {
    method: o.method || 'GET',
    headers: Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, o.headers || {}),
    body: o.body ? JSON.stringify(o.body) : undefined
  });
  const text = await r.text().catch(() => '');
  let d = {};
  if (text) { try { d = JSON.parse(text); } catch (e) { d = { raw: text }; } }
  if (!r.ok) {
    const g = d.error || {};
    let msg = g.message || g.code || ('Graph error ' + r.status);
    if (r.status === 403) msg = 'Access denied by Microsoft — the app has no permission on this file. ' + msg;
    if (r.status === 404) msg = 'Not found on Microsoft — check the file link or the table name. ' + msg;
    throw httpError(r.status === 401 ? 401 : (r.status === 403 ? 403 : 400), msg);
  }
  return d;
}

/* ---------- workbook operations ---------- */

// Turn a SharePoint / OneDrive link into { driveId, itemId, name, webUrl }.
async function resolveFile(token, url, fetchImpl) {
  const d = await graph(token, '/shares/' + shareId(url) + '/driveItem?$select=id,name,webUrl,parentReference',
    null, fetchImpl);
  const driveId = (d.parentReference && d.parentReference.driveId) || '';
  if (!d.id || !driveId) throw httpError(400, 'That link does not point to a file we can open');
  if (!/\.xlsx?$|\.xlsm$/i.test(d.name || '')) {
    throw httpError(400, 'That link points to "' + (d.name || 'something') + '", which is not an Excel workbook');
  }
  return { driveId, itemId: d.id, name: d.name, webUrl: d.webUrl || url };
}

const itemPath = cfg => '/drives/' + encodeURIComponent(cfg.driveId) + '/items/' + encodeURIComponent(cfg.itemId);

async function listTables(token, cfg, fetchImpl) {
  const d = await graph(token, itemPath(cfg) + '/workbook/tables?$select=id,name', null, fetchImpl);
  return (d.value || []).map(t => t.name);
}

async function tableHeaders(token, cfg, tableName, fetchImpl) {
  const t = encodeURIComponent(tableName);
  const d = await graph(token, itemPath(cfg) + "/workbook/tables('" + t + "')/headerRowRange?$select=values", null, fetchImpl);
  const row = (d.values && d.values[0]) || [];
  return row.map(v => String(v == null ? '' : v));
}

async function appendRow(token, cfg, values, fetchImpl) {
  const t = encodeURIComponent(cfg.tableName);
  return graph(token, itemPath(cfg) + "/workbook/tables('" + t + "')/rows/add",
    { method: 'POST', body: { values: [values] } }, fetchImpl);
}

/* ---------- lead → row ---------- */

async function leadValues(pool, cid, lead) {
  const [ev, own, cre] = await Promise.all([
    lead.event_id ? pool.query('SELECT name FROM events WHERE id=$1 AND company_id=$2', [lead.event_id, cid]) : { rows: [] },
    lead.owner_id ? pool.query('SELECT name,email FROM users WHERE id=$1 AND company_id=$2', [lead.owner_id, cid]) : { rows: [] },
    lead.created_by ? pool.query('SELECT name,email FROM users WHERE id=$1 AND company_id=$2', [lead.created_by, cid]) : { rows: [] }
  ]);
  const who = r => (r.rows[0] ? (r.rows[0].name || r.rows[0].email || '') : '');
  const first = lead.first_name || '';
  const last = lead.last_name || '';
  return {
    ts: isoDateTime(lead.captured_at),
    event: ev.rows[0] ? ev.rows[0].name : '',
    first, last, fullname: (first + ' ' + last).trim(),
    company: lead.company_name || '',
    role: lead.role_title || '',
    email: lead.email || '',
    phone: lead.phone || '',
    website: lead.website || '',
    address: lead.address || '',
    source: lead.source || '',
    country: lead.country || '',
    segment: lead.segment || '',
    owner: who(own),
    createdby: who(cre),
    status: lead.status || '',
    consent: isoDate(lead.consent_at),
    notes: ''
  };
}

// Match by header name, not by position: the customer can reorder or add columns.
function rowFor(headers, values) {
  return headers.map(h => {
    const key = HEADER_MAP[norm(h)];
    return key && values[key] != null ? String(values[key]) : '';
  });
}

/* ---------- routes ---------- */

function mount(app, deps) {
  const { pool, auth, requireAdmin, wrap, sign, verifyToken, APP_URL, API_URL } = deps;
  const fetchImpl = deps.fetch || global.fetch;

  const loadSettings = async cid => {
    const r = await pool.query('SELECT settings FROM companies WHERE id=$1', [cid]);
    if (!r.rowCount) throw httpError(404, 'Workspace not found');
    return r.rows[0].settings || {};
  };
  const patchMs = async (cid, patch) => {
    const s = await loadSettings(cid);
    s.ms = Object.assign({}, s.ms, patch);
    await pool.query('UPDATE companies SET settings=$1 WHERE id=$2', [s, cid]);
    return s;
  };
  const send = (res, e) => res.status(e.status || 500).json({ error: e.message || 'Server error' });

  /* current configuration (no secrets) */
  app.get('/ms/config', auth, requireAdmin, wrap(async (req, res) => {
    res.json({ ok: true, ms: publicCfg(await loadSettings(req.session.cid)) });
  }));

  /* save credentials / file coordinates */
  app.patch('/ms/config', auth, requireAdmin, wrap(async (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (typeof b.tenantId === 'string') patch.tenantId = b.tenantId.trim();
    if (typeof b.clientId === 'string') patch.clientId = b.clientId.trim();
    if (typeof b.clientSecret === 'string' && b.clientSecret.trim()) patch.clientSecret = b.clientSecret.trim();
    if (b.clearSecret) { patch.clientSecret = ''; patch.clientId = ''; }
    if (typeof b.tableName === 'string') patch.tableName = b.tableName.trim();
    if (typeof b.enabled === 'boolean') patch.enabled = b.enabled;
    const s = await patchMs(req.session.cid, patch);
    forgetToken(req.session.cid);
    res.json({ ok: true, ms: publicCfg(s) });
  }));

  /* admin consent link for the shared Bizca app */
  app.get('/ms/consent-url', auth, requireAdmin, wrap(async (req, res) => {
    if (!PLATFORM_CLIENT_ID) {
      return res.status(400).json({ error: 'No shared Bizca app is configured on this server — enter your own Client ID and secret instead' });
    }
    const redirect = (process.env.MS_REDIRECT_URI || (API_URL + '/ms/consent-callback'));
    const state = sign({ cid: req.session.cid, k: 'ms', exp: Date.now() + 20 * 60 * 1000 });
    const url = LOGIN + '/organizations/v2.0/adminconsent'
      + '?client_id=' + encodeURIComponent(PLATFORM_CLIENT_ID)
      + '&scope=' + encodeURIComponent('https://graph.microsoft.com/.default')
      + '&redirect_uri=' + encodeURIComponent(redirect)
      + '&state=' + encodeURIComponent(state);
    res.json({ ok: true, url, redirect });
  }));

  /* Microsoft sends the admin back here after consent */
  app.get('/ms/consent-callback', wrap(async (req, res) => {
    const p = verifyToken(req.query.state || '');
    const granted = String(req.query.admin_consent || '').toLowerCase() === 'true';
    const tenant = req.query.tenant || '';
    let ok = false;
    if (p && p.k === 'ms' && granted && tenant) {
      await patchMs(p.cid, { tenantId: tenant, consentedAt: Date.now(), lastError: null });
      forgetToken(p.cid);
      ok = true;
    }
    const why = req.query.error_description || req.query.error || '';
    res.redirect(APP_URL + '/#/admin/dest?msconsent=' + (ok ? '1' : '0') + (ok ? '' : '&msreason=' + encodeURIComponent(String(why).slice(0, 160))));
  }));

  /* paste a SharePoint link → resolve the workbook and list its tables */
  app.post('/ms/resolve', auth, requireAdmin, wrap(async (req, res) => {
    const url = String((req.body || {}).url || '').trim();
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Paste the full link to the Excel file' });
    const cid = req.session.cid;
    try {
      const cfg = readCfg(await loadSettings(cid));
      const token = await getToken(cid, cfg, fetchImpl);
      const file = await resolveFile(token, url, fetchImpl);
      const next = Object.assign({}, cfg, { driveId: file.driveId, itemId: file.itemId });
      const tables = await listTables(token, next, fetchImpl);
      const patch = { driveId: file.driveId, itemId: file.itemId, fileName: file.name, fileUrl: file.webUrl, lastError: null };
      if (tables.length === 1) patch.tableName = tables[0];
      const s = await patchMs(cid, patch);
      res.json({ ok: true, file: { name: file.name, webUrl: file.webUrl }, tables, ms: publicCfg(s) });
    } catch (e) { send(res, e); }
  }));

  /* dry run: prove the whole chain works, optionally writing one row */
  app.post('/ms/test', auth, requireAdmin, wrap(async (req, res) => {
    const cid = req.session.cid;
    try {
      const cfg = readCfg(await loadSettings(cid));
      if (!cfg.driveId || !cfg.itemId) throw httpError(400, 'No file selected yet — paste the link to your Excel file first');
      const token = await getToken(cid, cfg, fetchImpl);
      const tables = await listTables(token, cfg, fetchImpl);
      if (!cfg.tableName) throw httpError(400, tables.length ? 'Pick which table to write into' : 'That workbook has no named table — create one in Excel (Insert → Table) and reload');
      if (tables.indexOf(cfg.tableName) < 0) throw httpError(400, 'Table "' + cfg.tableName + '" is not in that workbook. Available: ' + (tables.join(', ') || 'none'));

      const headers = await tableHeaders(token, cfg, cfg.tableName, fetchImpl);
      const mapped = headers.filter(h => HEADER_MAP[norm(h)]);
      const unknown = headers.filter(h => !HEADER_MAP[norm(h)]);

      let wrote = false;
      if ((req.body || {}).writeTest) {
        const sample = {
          ts: isoDateTime(new Date()), event: 'Bizca test', first: 'Bizca', last: 'Test',
          fullname: 'Bizca Test', company: 'Bizca', role: 'Connection check',
          email: 'test@bizca.local', phone: '', website: '', address: '',
          source: 'Bizca', country: 'IT', segment: '', owner: '', createdby: '',
          status: 'Test row — safe to delete', consent: '', notes: ''
        };
        await appendRow(token, cfg, rowFor(headers, sample), fetchImpl);
        wrote = true;
      }
      const s = await patchMs(cid, { lastOk: Date.now(), lastError: null });
      res.json({ ok: true, file: cfg.fileName, tables, headers, mapped, unknown, wroteTestRow: wrote, ms: publicCfg(s) });
    } catch (e) {
      await patchMs(cid, { lastError: e.message || 'Test failed' }).catch(() => {});
      send(res, e);
    }
  }));

  /* append one lead — called by the app right after the Brevo push */
  app.post('/ms/append', auth, wrap(async (req, res) => {
    const cid = req.session.cid;
    const leadId = String((req.body || {}).leadId || '');
    let cfg;
    try {
      cfg = readCfg(await loadSettings(cid));
      if (!cfg.enabled) return res.json({ ok: true, skipped: 'Excel destination is off' });
      if (!cfg.driveId || !cfg.itemId || !cfg.tableName) throw httpError(400, 'Excel destination is not configured');

      const lr = await pool.query('SELECT * FROM leads WHERE id=$1 AND company_id=$2', [leadId, cid]);
      if (!lr.rowCount) throw httpError(404, 'Lead not found');
      const lead = lr.rows[0];
      if (req.session.role !== 'admin' && lead.created_by !== req.session.uid && lead.owner_id !== req.session.uid) {
        throw httpError(403, 'Not your lead');
      }

      const token = await getToken(cid, cfg, fetchImpl);
      const headers = await tableHeaders(token, cfg, cfg.tableName, fetchImpl);
      const values = await leadValues(pool, cid, lead);
      await appendRow(token, cfg, rowFor(headers, values), fetchImpl);

      await pool.query('INSERT INTO sync_log (company_id,lead_id,dest,ok,msg) VALUES ($1,$2,$3,$4,$5)',
        [cid, leadId, 'Excel', true, 'Row added to ' + (cfg.fileName || 'workbook')]);
      await patchMs(cid, { lastOk: Date.now(), lastError: null }).catch(() => {});
      res.json({ ok: true, file: cfg.fileName });
    } catch (e) {
      const msg = e.message || 'Excel append failed';
      await pool.query('INSERT INTO sync_log (company_id,lead_id,dest,ok,msg) VALUES ($1,$2,$3,$4,$5)',
        [cid, leadId || null, 'Excel', false, msg]).catch(() => {});
      if (cfg) await patchMs(cid, { lastError: msg }).catch(() => {});
      send(res, e);
    }
  }));
}

module.exports = {
  mount, publicCfg, readCfg, rowFor, shareId, norm, HEADER_MAP,
  _internals: { getToken, graph, resolveFile, listTables, tableHeaders, appendRow, leadValues, forgetToken, tokenCache }
};
