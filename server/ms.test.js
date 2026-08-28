/* Tests for the Microsoft/Excel connector — no network, no database.
   Run with:  node server/ms.test.js                                     */

const assert = require('assert');
const ms = require('./ms');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

/* ---------- fakes ---------- */

// Minimal Graph + login stub. `calls` records everything for assertions.
function fakeMs(opts) {
  const o = opts || {};
  const calls = [];
  const headers = o.headers || ['Data acquisizione', 'Evento', 'Nome', 'Cognome', 'Azienda', 'Email', 'Paese', 'Segmento', 'Assegnato a', 'Note interne'];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const json = (status, body) => ({
      ok: status < 400, status,
      json: async () => body,
      text: async () => JSON.stringify(body)
    });
    if (/oauth2\/v2\.0\/token/.test(url)) {
      if (o.tokenFails) return json(401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret.\r\nTrace ID: x' });
      return json(200, { access_token: 'tok-' + calls.length, expires_in: 3600 });
    }
    if (/\/shares\//.test(url)) {
      if (o.shareIsFolder) return json(200, { id: 'i1', name: 'Sales', parentReference: { driveId: 'd1' } });
      return json(200, { id: 'item-1', name: o.fileName || 'Leads.xlsx', webUrl: 'https://sp/Leads.xlsx', parentReference: { driveId: 'drive-1' } });
    }
    if (/workbook\/tables\?/.test(url)) {
      return json(200, { value: (o.tables || ['LeadsTable']).map(n => ({ id: n, name: n })) });
    }
    if (/headerRowRange/.test(url)) return json(200, { values: [headers] });
    if (/rows\/add/.test(url)) {
      if (o.appendDenied) return json(403, { error: { code: 'accessDenied', message: 'Item not found or access denied' } });
      return json(201, { index: 0 });
    }
    return json(404, { error: { code: 'itemNotFound', message: 'nope' } });
  };
  return { fetch, calls, headers };
}

// Postgres stand-in: one company, one lead, one event, two users.
function fakePool(settings) {
  const store = { settings: settings || {} };
  const rows = {
    event: { name: 'MECSPE 2026' },
    owner: { name: 'Laura Bianchi', email: 'laura@vid.it' },
    creator: { name: 'Marco Rossi', email: 'marco@vid.it' },
    lead: {
      id: 'l1', company_id: 'c1', event_id: 'e1', owner_id: 'u2', created_by: 'u1',
      first_name: 'Anna', last_name: 'Müller', company_name: 'Müller GmbH', role_title: 'Buyer',
      email: 'anna@muller.de', phone: '+49 30 1234', website: 'muller.de', address: 'Berlin',
      source: 'Fiera', country: 'Germany', segment: 'Automazione', status: 'Sent',
      consent_at: new Date('2026-03-04T10:00:00Z'), captured_at: new Date('2026-03-04T09:30:00Z')
    }
  };
  const inserted = [];
  const pool = {
    inserted, store,
    query: async (sql, params) => {
      if (/SELECT settings FROM companies/.test(sql)) return { rowCount: 1, rows: [{ settings: store.settings }] };
      if (/UPDATE companies SET settings/.test(sql)) { store.settings = params[0]; return { rowCount: 1 }; }
      if (/FROM events/.test(sql)) return { rowCount: 1, rows: [rows.event] };
      if (/FROM users/.test(sql)) return { rowCount: 1, rows: [params[0] === 'u2' ? rows.owner : rows.creator] };
      if (/FROM leads/.test(sql)) return params[0] === 'l1' ? { rowCount: 1, rows: [rows.lead] } : { rowCount: 0, rows: [] };
      if (/INSERT INTO sync_log/.test(sql)) { inserted.push({ dest: params[2], ok: params[3], msg: params[4] }); return { rowCount: 1 }; }
      return { rowCount: 0, rows: [] };
    }
  };
  return pool;
}

// Express stand-in: collects routes so we can invoke them directly.
function fakeApp() {
  const routes = {};
  const reg = method => (path, ...h) => { routes[method + ' ' + path] = h[h.length - 1]; };
  return {
    routes, get: reg('GET'), post: reg('POST'), patch: reg('PATCH'),
    async call(key, req) {
      const out = {};
      const res = {
        statusCode: 200,
        status(c) { out.status = c; this.statusCode = c; return this; },
        json(b) { out.body = b; return this; },
        redirect(u) { out.redirect = u; return this; }
      };
      await routes[key](Object.assign({ query: {}, body: {}, params: {} }, req), res);
      return Object.assign({ status: out.status || 200 }, out);
    }
  };
}

const passthrough = (req, res, next) => next();
const deps = (pool, fetchImpl) => ({
  pool,
  auth: passthrough,
  requireAdmin: passthrough,
  wrap: fn => (req, res) => fn(req, res).catch(e => res.status(e.status || 500).json({ error: e.message })),
  sign: p => 'signed:' + JSON.stringify(p),
  verifyToken: s => { try { return JSON.parse(String(s).replace(/^signed:/, '')); } catch (e) { return null; } },
  APP_URL: 'https://bizca.bryan.it',
  API_URL: 'https://api.bizca.test',
  fetch: fetchImpl
});
const admin = { session: { cid: 'c1', uid: 'u1', role: 'admin' } };

/* ---------- tests ---------- */

(async () => {
  console.log('\nMicrosoft connector\n');

  await t('header names map across Italian, English and accents', () => {
    const map = h => ms.HEADER_MAP[ms.norm(h)];
    assert.strictEqual(map('Data acquisizione'), 'ts');
    assert.strictEqual(map('E-mail'), 'email');
    assert.strictEqual(map('Sito Web'), 'website');
    assert.strictEqual(map('Assegnato a'), 'owner');
    assert.strictEqual(map('Società'), 'company');
    assert.strictEqual(map('Interesse'), 'segment');
    assert.strictEqual(map('Colonna a caso'), undefined);
  });

  await t('rowFor follows the sheet column order, blanking unknown headers', () => {
    const headers = ['Azienda', 'Nome', 'Note interne', 'Email'];
    const row = ms.rowFor(headers, { company: 'ACME', first: 'Anna', email: 'a@acme.it' });
    assert.deepStrictEqual(row, ['ACME', 'Anna', '', 'a@acme.it']);
  });

  await t('publicCfg never leaks the client secret', () => {
    const pub = ms.publicCfg({ ms: { tenantId: 't1', clientId: 'c', clientSecret: 'SUPER-SECRET', driveId: 'd', itemId: 'i', tableName: 'T' } });
    assert.strictEqual(JSON.stringify(pub).indexOf('SUPER-SECRET'), -1);
    assert.strictEqual(pub.hasOwnSecret, true);
    assert.strictEqual(pub.ready, true);
  });

  await t('ready stays false while any piece is missing', () => {
    assert.strictEqual(ms.publicCfg({ ms: { tenantId: 't1', clientId: 'c', clientSecret: 's' } }).ready, false);
    assert.strictEqual(ms.publicCfg({}).ready, false);
  });

  await t('resolve stores the file and auto-picks a single table', async () => {
    const g = fakeMs();
    const pool = fakePool({ ms: { tenantId: 't1', clientId: 'cid', clientSecret: 'sec' } });
    const app = fakeApp(); ms.mount(app, deps(pool, g.fetch));
    const r = await app.call('POST /ms/resolve', Object.assign({ body: { url: 'https://contoso.sharepoint.com/Leads.xlsx' } }, admin));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.tables, ['LeadsTable']);
    assert.strictEqual(pool.store.settings.ms.tableName, 'LeadsTable');
    assert.strictEqual(pool.store.settings.ms.driveId, 'drive-1');
    assert.strictEqual(r.body.ms.hasOwnSecret, true);
    assert.strictEqual(JSON.stringify(r.body).indexOf('sec'), -1);
  });

  await t('resolve refuses a link that is not a workbook', async () => {
    const g = fakeMs({ shareIsFolder: true });
    const app = fakeApp(); ms.mount(app, deps(fakePool({ ms: { tenantId: 't', clientId: 'c', clientSecret: 's' } }), g.fetch));
    const r = await app.call('POST /ms/resolve', Object.assign({ body: { url: 'https://sp/sites/Sales' } }, admin));
    assert.strictEqual(r.status, 400);
    assert.ok(/not an Excel workbook/.test(r.body.error), r.body.error);
  });

  await t('a bad client secret surfaces one readable line', async () => {
    const g = fakeMs({ tokenFails: true });
    const app = fakeApp(); ms.mount(app, deps(fakePool({ ms: { tenantId: 't', clientId: 'c', clientSecret: 'wrong' } }), g.fetch));
    const r = await app.call('POST /ms/resolve', Object.assign({ body: { url: 'https://sp/Leads.xlsx' } }, admin));
    assert.strictEqual(r.status, 400);
    assert.ok(/Invalid client secret/.test(r.body.error), r.body.error);
    assert.strictEqual(r.body.error.indexOf('Trace ID'), -1); // only the first line
  });

  await t('missing consent is explained, not thrown as a 500', async () => {
    const g = fakeMs();
    const app = fakeApp(); ms.mount(app, deps(fakePool({}), g.fetch));
    const r = await app.call('POST /ms/resolve', Object.assign({ body: { url: 'https://sp/Leads.xlsx' } }, admin));
    assert.strictEqual(r.status, 400);
    assert.ok(/tenant not set/.test(r.body.error), r.body.error);
  });

  await t('test reports mapped and unrecognised columns', async () => {
    const g = fakeMs();
    const pool = fakePool({ ms: { tenantId: 't', clientId: 'c', clientSecret: 's', driveId: 'd', itemId: 'i', tableName: 'LeadsTable' } });
    const app = fakeApp(); ms.mount(app, deps(pool, g.fetch));
    const r = await app.call('POST /ms/test', Object.assign({ body: {} }, admin));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.unknown, ['Note interne']);
    assert.strictEqual(r.body.mapped.length, 9);
    assert.strictEqual(r.body.wroteTestRow, false);
    assert.ok(!g.calls.some(c => /rows\/add/.test(c.url)), 'must not write without writeTest');
  });

  await t('test with writeTest appends exactly one row', async () => {
    const g = fakeMs();
    const pool = fakePool({ ms: { tenantId: 't', clientId: 'c', clientSecret: 's', driveId: 'd', itemId: 'i', tableName: 'LeadsTable' } });
    const app = fakeApp(); ms.mount(app, deps(pool, g.fetch));
    const r = await app.call('POST /ms/test', Object.assign({ body: { writeTest: true } }, admin));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const writes = g.calls.filter(c => /rows\/add/.test(c.url));
    assert.strictEqual(writes.length, 1);
    const values = JSON.parse(writes[0].init.body).values[0];
    assert.strictEqual(values.length, g.headers.length);
    assert.strictEqual(values[2], 'Bizca'); // Nome
  });

  await t('test rejects a table name the workbook does not have', async () => {
    const g = fakeMs({ tables: ['Contatti'] });
    const pool = fakePool({ ms: { tenantId: 't', clientId: 'c', clientSecret: 's', driveId: 'd', itemId: 'i', tableName: 'LeadsTable' } });
    const app = fakeApp(); ms.mount(app, deps(pool, g.fetch));
    const r = await app.call('POST /ms/test', Object.assign({ body: {} }, admin));
    assert.strictEqual(r.status, 400);
    assert.ok(/Available: Contatti/.test(r.body.error), r.body.error);
  });

  await t('append writes the lead in the sheet column order', async () => {
    const g = fakeMs();
    const pool = fakePool({ ms: { enabled: true, tenantId: 't', clientId: 'c', clientSecret: 's', driveId: 'd', itemId: 'i', tableName: 'LeadsTable', fileName: 'Leads.xlsx' } });
    const app = fakeApp(); ms.mount(app, deps(pool, g.fetch));
    const r = await app.call('POST /ms/append', Object.assign({ body: { leadId: 'l1' } }, admin));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const values = JSON.parse(g.calls.filter(c => /rows\/add/.test(c.url))[0].init.body).values[0];
    // headers: Data, Evento, Nome, Cognome, Azienda, Email, Paese, Segmento, Assegnato a, Note interne
    assert.strictEqual(values[0], '2026-03-04 09:30');
    assert.strictEqual(values[1], 'MECSPE 2026');
    assert.strictEqual(values[2], 'Anna');
    assert.strictEqual(values[3], 'Müller');
    assert.strictEqual(values[5], 'anna@muller.de');
    assert.strictEqual(values[6], 'Germany');
    assert.strictEqual(values[8], 'Laura Bianchi');   // assigned owner, not the capturer
    assert.strictEqual(values[9], '');                 // unknown column left alone
    assert.deepStrictEqual(pool.inserted[0], { dest: 'Excel', ok: true, msg: 'Row added to Leads.xlsx' });
  });

  await t('append is a no-op when the destination is off', async () => {
    const g = fakeMs();
    const pool = fakePool({ ms: { enabled: false, tenantId: 't', clientId: 'c', clientSecret: 's', driveId: 'd', itemId: 'i', tableName: 'T' } });
    const app = fakeApp(); ms.mount(app, deps(pool, g.fetch));
    const r = await app.call('POST /ms/append', Object.assign({ body: { leadId: 'l1' } }, admin));
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.skipped);
    assert.strictEqual(g.calls.length, 0);
    assert.strictEqual(pool.inserted.length, 0);
  });

  await t('a denied append is logged and reported, not swallowed', async () => {
    const g = fakeMs({ appendDenied: true });
    const pool = fakePool({ ms: { enabled: true, tenantId: 't', clientId: 'c', clientSecret: 's', driveId: 'd', itemId: 'i', tableName: 'T' } });
    const app = fakeApp(); ms.mount(app, deps(pool, g.fetch));
    const r = await app.call('POST /ms/append', Object.assign({ body: { leadId: 'l1' } }, admin));
    assert.strictEqual(r.status, 403);
    assert.ok(/Access denied by Microsoft/.test(r.body.error), r.body.error);
    assert.strictEqual(pool.inserted[0].ok, false);
    assert.strictEqual(pool.store.settings.ms.lastError.indexOf('Access denied'), 0);
  });

  await t('a seller cannot append someone else\'s lead', async () => {
    const g = fakeMs();
    const pool = fakePool({ ms: { enabled: true, tenantId: 't', clientId: 'c', clientSecret: 's', driveId: 'd', itemId: 'i', tableName: 'T' } });
    const app = fakeApp(); ms.mount(app, deps(pool, g.fetch));
    const r = await app.call('POST /ms/append', { body: { leadId: 'l1' }, session: { cid: 'c1', uid: 'u9', role: 'seller' } });
    assert.strictEqual(r.status, 403);
    assert.ok(!g.calls.some(c => /rows\/add/.test(c.url)));
  });

  await t('saving config keeps the stored secret when the field is left blank', async () => {
    const pool = fakePool({ ms: { tenantId: 'old', clientId: 'c', clientSecret: 'keep-me' } });
    const app = fakeApp(); ms.mount(app, deps(pool, fakeMs().fetch));
    await app.call('PATCH /ms/config', Object.assign({ body: { tenantId: 'new', clientSecret: '   ' } }, admin));
    assert.strictEqual(pool.store.settings.ms.clientSecret, 'keep-me');
    assert.strictEqual(pool.store.settings.ms.tenantId, 'new');
  });

  await t('consent callback stores the tenant only with a valid signed state', async () => {
    const pool = fakePool({});
    const app = fakeApp(); ms.mount(app, deps(pool, fakeMs().fetch));
    const good = 'signed:' + JSON.stringify({ cid: 'c1', k: 'ms' });
    const r1 = await app.call('GET /ms/consent-callback', { query: { state: good, admin_consent: 'True', tenant: 'tenant-guid' } });
    assert.ok(/msconsent=1/.test(r1.redirect), r1.redirect);
    assert.strictEqual(pool.store.settings.ms.tenantId, 'tenant-guid');

    const pool2 = fakePool({});
    const app2 = fakeApp(); ms.mount(app2, deps(pool2, fakeMs().fetch));
    const r2 = await app2.call('GET /ms/consent-callback', { query: { state: 'garbage', admin_consent: 'True', tenant: 'evil-tenant' } });
    assert.ok(/msconsent=0/.test(r2.redirect), r2.redirect);
    assert.strictEqual(pool2.store.settings.ms, undefined);
  });

  await t('consent url is refused when no shared app is configured', async () => {
    const app = fakeApp(); ms.mount(app, deps(fakePool({}), fakeMs().fetch));
    const r = await app.call('GET /ms/consent-url', admin);
    assert.strictEqual(r.status, 400);           // MS_CLIENT_ID unset in tests
    assert.ok(/your own Client ID/.test(r.body.error));
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
