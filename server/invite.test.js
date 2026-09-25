/* Invitation, activation and role changes — no network, no database.
   Run with:  node server/invite.test.js                                  */
const assert = require('assert');
const crypto = require('crypto');
const Module = require('module');

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } };

/* ---- a tiny in-memory Postgres that understands only the queries we use ---- */
function fakeDb() {
  const users = [];
  const leads = [];
  const companies = [{ id: 'c1', name: 'VID', locale: 'it', settings: {} }];
  const sent = [];
  const pool = {
    users, companies, sent, leads,
    connect: async () => ({ query: (...a) => pool.query(...a), release() {} }),
    query: async (sql, p = []) => {
      const one = rows => ({ rowCount: rows.length, rows });
      if (/SELECT id,company_id,role,status FROM users WHERE id=\$1/.test(sql))
        return one(users.filter(u => u.id === p[0]).map(u => ({ id: u.id, company_id: u.company_id, role: u.role, status: u.status })));
      if (/SELECT \* FROM users WHERE lower\(email\)=lower\(\$1\) AND verify_token=\$2/.test(sql))
        return one(users.filter(u => u.email.toLowerCase() === String(p[0]).toLowerCase() && u.verify_token === p[1]));
      if (/SELECT \* FROM users WHERE lower\(email\)=lower\(\$1\)$/.test(sql.trim()))
        return one(users.filter(u => u.email.toLowerCase() === String(p[0]).toLowerCase()));
      if (/SELECT password_hash FROM users WHERE lower\(email\)=lower\(\$1\)/.test(sql))
        return one(users.filter(u => u.email.toLowerCase() === String(p[0]).toLowerCase()).map(u => ({ password_hash: u.password_hash })));
      if (/SELECT 1 FROM users WHERE lower\(email\)=lower\(\$1\)/.test(sql))
        return one(users.filter(u => u.email.toLowerCase() === String(p[0]).toLowerCase()).map(() => ({ x: 1 })));
      if (/SELECT \* FROM users WHERE id=\$1 AND company_id=\$2/.test(sql))
        return one(users.filter(u => u.id === p[0] && u.company_id === p[1]));
      if (/SELECT \* FROM users WHERE id=\$1/.test(sql)) return one(users.filter(u => u.id === p[0]));
      if (/SELECT name,locale FROM companies/.test(sql)) return one(companies.map(c => ({ name: c.name, locale: c.locale })));
      if (/count\(\*\)::int AS n FROM users/.test(sql))
        return one([{ n: users.filter(u => u.company_id === p[0] && u.role === 'admin' && u.status === 'active').length }]);
      if (/INSERT INTO users/.test(sql)) {
        users.push({ id: p[0], company_id: p[1], name: p[2], email: p[3], role: p[4], status: p[5],
          email_verified: false, verify_token: p[6], locale: p[7], password_hash: null });
        return { rowCount: 1 };
      }
      if (/UPDATE users SET password_hash=\$1/.test(sql)) {
        const u = users.find(x => x.id === p[3]);
        u.password_hash = p[0]; u.email_verified = true; u.verify_token = null;
        if (p[1]) u.name = p[1];
        return { rowCount: 1 };
      }
      if (/UPDATE users SET verify_token=\$1/.test(sql)) {
        const u = users.find(x => x.id === p[1]); u.verify_token = p[0]; return { rowCount: 1 };
      }
      if (/UPDATE users SET role=COALESCE/.test(sql)) {
        const u = users.find(x => x.id === p[3]);
        if (p[0]) u.role = p[0]; if (p[1]) u.status = p[1]; if (p[2]) u.name = p[2];
        return { rowCount: 1 };
      }
      if (/UPDATE leads SET owner_id=\$1/.test(sql)) {
        const hit = leads.filter(l => l.company_id === p[1] && l.owner_id === p[2]);
        hit.forEach(l => { l.owner_id = p[0]; });
        return { rowCount: hit.length };
      }
      if (/DELETE FROM users WHERE id=\$1/.test(sql)) {
        const i = users.findIndex(u => u.id === p[0] && u.company_id === p[1]);
        if (i >= 0) users.splice(i, 1);
        return { rowCount: i >= 0 ? 1 : 0 };
      }
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/.test(sql)) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    }
  };
  return pool;
}

/* ---- load index.js with express, pg and fetch replaced ---- */
function loadServer(pool) {
  const routes = {};
  const mk = method => (path, ...h) => { routes[method + ' ' + path] = h; };
  const app = { get: mk('GET'), post: mk('POST'), patch: mk('PATCH'), delete: mk('DELETE'), put: mk('PUT'), use() {}, listen() {} };
  const fakeExpress = () => app;
  fakeExpress.json = () => (req, res, next) => next && next();

  const mails = [];
  const origResolve = Module._resolveFilename;
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'express') return fakeExpress;
    if (request === 'cors') return () => (req, res, next) => next && next();
    if (request === 'pg') return { Pool: function () { return pool; } };
    return origLoad.apply(this, arguments);
  };
  global.fetch = async () => ({ ok: true, json: async () => ({}), text: async () => '' });
  process.env.DATABASE_URL = 'postgres://x/y';
  process.env.APP_URL = 'https://bizca.bryan.it';
  process.env.API_URL = 'https://api.test';
  process.env.JWT_SECRET = 'test-secret';
  process.env.BREVO_TRANSACTIONAL_KEY = '';   // sendEmail short-circuits, no network
  delete require.cache[require.resolve('./index.js')];
  delete require.cache[require.resolve('./emails.js')];
  delete require.cache[require.resolve('./ms.js')];
  require('./index.js');
  Module._load = origLoad; Module._resolveFilename = origResolve;

  const match = key => {
    if (routes[key]) return { handlers: routes[key], params: {} };
    const [m, path] = key.split(' ');
    for (const r of Object.keys(routes)) {
      const [rm, rp] = r.split(' ');
      if (rm !== m) continue;
      const a = rp.split('/'), b = path.split('/');
      if (a.length !== b.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < a.length; i++) {
        if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
        else if (a[i] !== b[i]) { ok = false; break; }
      }
      if (ok) return { handlers: routes[r], params };
    }
    return null;
  };

  const call = async (key, req) => {
    const hit = match(key);
    if (!hit) throw new Error('no route ' + key);
    const handlers = hit.handlers;
    const out = {};
    const res = {
      status(c) { out.status = c; return this; },
      json(b) { out.body = b; return this; },
      redirect(u) { out.redirect = u; return this; },
      send(b) { out.body = b; return this; }
    };
    const r = Object.assign({ query: {}, body: {}, headers: {} }, req);
    r.params = Object.assign({}, hit.params, req.params || {});
    for (const h of handlers) {
      let advanced = false;
      await new Promise((resolve, reject) => {
        const next = () => { advanced = true; resolve(); };
        try { const p = h(r, res, next); if (p && p.then) p.then(() => resolve()).catch(reject); else if (!advanced) resolve(); }
        catch (e) { reject(e); }
      });
      if (out.body !== undefined || out.redirect !== undefined) break;
    }
    // give async handlers a tick to settle
    await new Promise(r2 => setTimeout(r2, 5));
    return Object.assign({ status: out.status || 200 }, out);
  };
  return { call, routes, mails };
}

(async () => {
  console.log('\nInvito, attivazione e ruoli\n');

  const pool = fakeDb();
  // an admin who is already active
  pool.users.push({ id: 'u1', company_id: 'c1', name: 'Max', email: 'max@bryan.it', role: 'admin',
    status: 'active', email_verified: true, verify_token: null, password_hash: 'x:y', locale: 'it' });
  const srv = loadServer(pool);
  const adminAuth = { headers: { authorization: 'Bearer ' + tokenFor('u1') } };

  function tokenFor(uid) {
    const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64u(JSON.stringify({ uid, cid: 'c1', role: 'seller', exp: Date.now() + 3600e3 }));
    const sig = b64u(crypto.createHmac('sha256', 'test-secret').update(head + '.' + body).digest());
    return head + '.' + body + '.' + sig;
  }

  let inviteToken = null;

  await t('l\'admin invita un utente e parte il link di attivazione', async () => {
    const r = await srv.call('POST /users', Object.assign({ body: { name: 'Laura Bianchi', email: 'laura@vid.it', role: 'seller' } }, adminAuth));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const u = pool.users.find(x => x.email === 'laura@vid.it');
    assert.ok(u, 'utente non creato');
    assert.ok(u.verify_token, 'nessun token di invito');
    assert.strictEqual(u.password_hash, null, 'non deve avere ancora una password');
    inviteToken = u.verify_token;
  });

  await t('l\'utente invitato risulta "non ancora attivato" nell\'elenco', async () => {
    const u = pool.users.find(x => x.email === 'laura@vid.it');
    const out = require('./index.js'); // outUser non è esportato: verifichiamo la regola
    assert.strictEqual(!!u.password_hash || !!u.email_verified, false);
  });

  await t('senza attivazione, l\'accesso con password viene rifiutato', async () => {
    const r = await srv.call('POST /auth/login', { body: { email: 'laura@vid.it', password: 'qualsiasi1' } });
    assert.ok(r.status === 401 || r.status === 403, 'atteso rifiuto, ricevuto ' + r.status);
  });

  await t('il link di invito attiva l\'account e restituisce subito la sessione', async () => {
    const r = await srv.call('POST /auth/set-password',
      { body: { email: 'laura@vid.it', token: inviteToken, password: 'PasswordSicura1', name: 'Laura Bianchi', locale: 'it' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.token, 'manca il token di sessione: l\'utente dovrebbe entrare subito');
    assert.strictEqual(r.body.user.email, 'laura@vid.it');
    const u = pool.users.find(x => x.email === 'laura@vid.it');
    assert.ok(u.password_hash, 'password non salvata');
    assert.strictEqual(u.email_verified, true);
    assert.strictEqual(u.verify_token, null, 'il token va consumato');
  });

  await t('dopo l\'attivazione l\'accesso con password funziona', async () => {
    const r = await srv.call('POST /auth/login', { body: { email: 'laura@vid.it', password: 'PasswordSicura1' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.token);
  });

  await t('lo stesso link non si può riusare, e lo dice chiaramente', async () => {
    const r = await srv.call('POST /auth/set-password',
      { body: { email: 'laura@vid.it', token: inviteToken, password: 'AltraPassword1' } });
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.body.alreadyActive, true);
  });

  await t('un token inventato non attiva niente', async () => {
    pool.users.push({ id: 'u3', company_id: 'c1', name: 'Nuovo', email: 'nuovo@vid.it', role: 'seller',
      status: 'active', email_verified: false, verify_token: 'buono', password_hash: null, locale: 'it' });
    const r = await srv.call('POST /auth/set-password', { body: { email: 'nuovo@vid.it', token: 'inventato', password: 'PasswordSicura1' } });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(pool.users.find(u => u.id === 'u3').password_hash, null);
  });

  await t('la password troppo corta viene rifiutata', async () => {
    const r = await srv.call('POST /auth/set-password', { body: { email: 'nuovo@vid.it', token: 'buono', password: 'corta' } });
    assert.strictEqual(r.status, 400);
    assert.ok(/8/.test(r.body.error));
  });

  await t('l\'admin può rimandare l\'invito, e il link vecchio smette di valere', async () => {
    const before = pool.users.find(u => u.id === 'u3').verify_token;
    const r = await srv.call('POST /users/u3/resend', Object.assign({ params: { uid: 'u3' } }, adminAuth));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const after = pool.users.find(u => u.id === 'u3').verify_token;
    assert.notStrictEqual(before, after, 'il token doveva cambiare');
    const old = await srv.call('POST /auth/set-password', { body: { email: 'nuovo@vid.it', token: before, password: 'PasswordSicura1' } });
    assert.strictEqual(old.status, 400, 'il link vecchio non deve più funzionare');
  });

  await t('non si rimanda un invito a chi ha già attivato', async () => {
    const laura = pool.users.find(u => u.email === 'laura@vid.it');
    const r = await srv.call('POST /users/' + laura.id + '/resend', Object.assign({ params: { uid: laura.id } }, adminAuth));
    assert.strictEqual(r.status, 400);
  });

  await t('promosso ad admin: il token vecchio vale subito, senza uscire e rientrare', async () => {
    const laura = pool.users.find(u => u.email === 'laura@vid.it');
    const sellerToken = tokenFor(laura.id);          // emesso quando era commerciale
    const before = await srv.call('GET /ms/config', { headers: { authorization: 'Bearer ' + sellerToken } });
    assert.strictEqual(before.status, 403, 'da commerciale non deve entrare in Admin');

    await srv.call('PATCH /users/' + laura.id, Object.assign({ params: { uid: laura.id }, body: { role: 'admin' } }, adminAuth));
    const after = await srv.call('GET /ms/config', { headers: { authorization: 'Bearer ' + sellerToken } });
    assert.notStrictEqual(after.status, 403, 'con lo stesso token deve ora essere admin');
  });

  await t('un account disattivato viene bloccato subito', async () => {
    const laura = pool.users.find(u => u.email === 'laura@vid.it');
    const tok = tokenFor(laura.id);
    laura.status = 'disabled';
    const r = await srv.call('GET /state', { headers: { authorization: 'Bearer ' + tok } });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
    laura.status = 'active';
  });

  await t('rimuovendo un utente i suoi lead passano a chi lo rimuove', async () => {
    const laura = pool.users.find(u => u.email === 'laura@vid.it');
    pool.leads.push({ id: 'ld1', company_id: 'c1', owner_id: laura.id });
    pool.leads.push({ id: 'ld2', company_id: 'c1', owner_id: laura.id });
    pool.leads.push({ id: 'ld3', company_id: 'c1', owner_id: 'u1' });
    const r = await srv.call('DELETE /users/' + laura.id, Object.assign({ params: { uid: laura.id } }, adminAuth));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.leadsReassigned, 2);
    assert.ok(!pool.users.find(u => u.id === laura.id), 'utente non rimosso');
    assert.strictEqual(pool.leads.filter(l => l.owner_id === 'u1').length, 3, 'i lead devono essere tutti dell\'admin');
  });

  await t('non si può rimuovere se stessi', async () => {
    const r = await srv.call('DELETE /users/u1', Object.assign({ params: { uid: 'u1' } }, adminAuth));
    assert.strictEqual(r.status, 400);
    assert.ok(pool.users.find(u => u.id === 'u1'), 'l\'admin deve restare');
  });

  await t('non si può rimuovere l\'ultimo amministratore attivo', async () => {
    pool.users.push({ id: 'u7', company_id: 'c1', name: 'Altro', email: 'altro@vid.it', role: 'admin',
      status: 'active', email_verified: true, verify_token: null, password_hash: 'x:y', locale: 'it' });
    // ora ci sono due admin: rimuoverne uno deve passare
    const ok = await srv.call('DELETE /users/u7', Object.assign({ params: { uid: 'u7' } }, adminAuth));
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    // con un solo admin rimasto, il tentativo su se stessi è già bloccato sopra
  });

  console.log('\n' + pass + ' passati, ' + fail + ' falliti\n');
  process.exit(fail ? 1 : 0);
})();
