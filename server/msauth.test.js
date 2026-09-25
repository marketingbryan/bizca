/* Sign in with Microsoft — no network, no database.
   Run with:  node server/msauth.test.js                                  */
const assert = require('assert');
const crypto = require('crypto');
const msauth = require('./msauth');
const ms = require('./ms');

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } };

const SECRET = 'test-secret';
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const sign = p => { const h=b64u(JSON.stringify({alg:'HS256',typ:'JWT'})), b=b64u(JSON.stringify(p));
  return h+'.'+b+'.'+b64u(crypto.createHmac('sha256',SECRET).update(h+'.'+b).digest()); };
const verifyToken = tok => { try { const [h,b,s]=String(tok).split('.');
  const exp=b64u(crypto.createHmac('sha256',SECRET).update(h+'.'+b).digest());
  if(!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(exp))) return null;
  const p=JSON.parse(Buffer.from(b.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString());
  return (p.exp && p.exp < Date.now()) ? null : p; } catch(e){ return null; } };

const idToken = claims => 'x.' + b64u(JSON.stringify(claims)) + '.y';

const CFG = { tenantId: 'tenant-vid', clientId: 'client-vid', clientSecret: 'secret-vid',
  driveId:'d', itemId:'i', tableName:'Lead' };

function fakePool(users, settings) {
  return { query: async (sql, p=[]) => {
    const one = rows => ({ rowCount: rows.length, rows });
    if (/FROM users WHERE lower\(email\)=lower\(\$1\) AND company_id=\$2/.test(sql))
      return one(users.filter(u => u.email.toLowerCase()===String(p[0]).toLowerCase() && u.company_id===p[1]));
    if (/FROM users WHERE lower\(email\)=lower\(\$1\)/.test(sql))
      return one(users.filter(u => u.email.toLowerCase()===String(p[0]).toLowerCase()));
    if (/SELECT settings FROM companies WHERE id=\$1/.test(sql))
      return one(settings[p[0]] ? [{ settings: settings[p[0]] }] : []);
    if (/UPDATE users/.test(sql)) return { rowCount: 1 };
    return one([]);
  }};
}

function build(opts={}) {
  const users = opts.users || [{ id:'u2', company_id:'c1', name:'Laura', email:'laura@vid.it',
    role:'seller', status:'active', email_verified:false }];
  const settings = opts.settings || { c1: { ms: CFG } };
  const pool = fakePool(users, settings);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init && init.body });
    if (opts.tokenFails) return { ok:false, status:400, json: async()=>({ error:'invalid_grant', error_description:'AADSTS70008: expired\r\nTrace' }) };
    return { ok:true, status:200, json: async()=>({ id_token: idToken(opts.claims || {
      tid:'tenant-vid', aud:'client-vid', email:'laura@vid.it', name:'Laura Bianchi', exp: Math.floor(Date.now()/1000)+600 }) }) };
  };
  const routes = {};
  const mk = m => (p, h) => { routes[m+' '+p] = h; };
  msauth.mount({ get: mk('GET'), post: mk('POST') },
    { pool, ms, sign, verifyToken, session: u => 'session-for-' + u.id, outUser: u => ({ id:u.id, email:u.email }),
      APP_URL: 'https://bizca.bryan.it', API_URL: 'https://api.test', fetch: fetchImpl });
  const call = async (key, req) => {
    const out = {};
    const res = { status(c){ out.status=c; return this; }, json(b){ out.body=b; return this; }, redirect(u){ out.redirect=u; return this; } };
    await routes[key](Object.assign({ query:{}, body:{} }, req), res);
    await new Promise(r=>setTimeout(r,5));
    return Object.assign({ status: out.status || 200 }, out);
  };
  return { call, calls, users };
}

(async () => {
  console.log('\nAccesso con Microsoft\n');

  await t('lo start rimanda al tenant giusto, con i parametri attesi', async () => {
    const { call } = build();
    const r = await call('POST /auth/microsoft/start', { body: { email: 'laura@vid.it' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const u = new URL(r.body.url);
    assert.ok(u.pathname.startsWith('/tenant-vid/'), 'tenant sbagliato: ' + u.pathname);
    assert.strictEqual(u.searchParams.get('client_id'), 'client-vid');
    assert.strictEqual(u.searchParams.get('response_type'), 'code');
    assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://api.test/auth/microsoft/callback');
    assert.strictEqual(u.searchParams.get('scope'), 'openid profile email');
    assert.ok(u.searchParams.get('state'), 'manca lo state firmato');
  });

  await t('chi non è stato invitato non parte nemmeno', async () => {
    const { call } = build();
    const r = await call('POST /auth/microsoft/start', { body: { email: 'estraneo@altro.it' } });
    assert.strictEqual(r.status, 404);
  });

  await t('se l\'azienda non ha configurato Microsoft, lo dice', async () => {
    const { call } = build({ settings: { c1: {} } });
    const r = await call('POST /auth/microsoft/start', { body: { email: 'laura@vid.it' } });
    assert.strictEqual(r.status, 400);
    assert.ok(/not set up/.test(r.body.error), r.body.error);
  });

  await t('il giro completo restituisce un codice usa e getta, non il token', async () => {
    const { call } = build();
    const start = await call('POST /auth/microsoft/start', { body: { email: 'laura@vid.it' } });
    const state = new URL(start.body.url).searchParams.get('state');
    const cb = await call('GET /auth/microsoft/callback', { query: { code: 'auth-code', state } });
    assert.ok(cb.redirect, 'nessun redirect');
    assert.ok(/[?&]ms=/.test(cb.redirect), 'manca il codice: ' + cb.redirect);
    assert.ok(cb.redirect.indexOf('session-for-') < 0, 'il token di sessione non deve stare nell\'URL');
    const code = cb.redirect.match(/[?&]ms=([^&]+)/)[1];
    const ex = await call('POST /auth/microsoft/exchange', { body: { code } });
    assert.strictEqual(ex.status, 200, JSON.stringify(ex.body));
    assert.strictEqual(ex.body.token, 'session-for-u2');
  });

  await t('il codice vale una volta sola', async () => {
    const { call } = build();
    const start = await call('POST /auth/microsoft/start', { body: { email: 'laura@vid.it' } });
    const state = new URL(start.body.url).searchParams.get('state');
    const cb = await call('GET /auth/microsoft/callback', { query: { code: 'c', state } });
    const code = cb.redirect.match(/[?&]ms=([^&]+)/)[1];
    await call('POST /auth/microsoft/exchange', { body: { code } });
    const again = await call('POST /auth/microsoft/exchange', { body: { code } });
    assert.strictEqual(again.status, 400);
  });

  await t('un token di un altro tenant viene respinto', async () => {
    const { call } = build({ claims: { tid:'tenant-altro', aud:'client-vid', email:'laura@vid.it', exp: Math.floor(Date.now()/1000)+600 } });
    const start = await call('POST /auth/microsoft/start', { body: { email: 'laura@vid.it' } });
    const state = new URL(start.body.url).searchParams.get('state');
    const cb = await call('GET /auth/microsoft/callback', { query: { code: 'c', state } });
    assert.ok(/mserror=/.test(cb.redirect), cb.redirect);
    assert.ok(/different%20Microsoft%20tenant/.test(cb.redirect), decodeURIComponent(cb.redirect));
  });

  await t('un token emesso per un\'altra applicazione viene respinto', async () => {
    const { call } = build({ claims: { tid:'tenant-vid', aud:'altra-app', email:'laura@vid.it', exp: Math.floor(Date.now()/1000)+600 } });
    const start = await call('POST /auth/microsoft/start', { body: { email: 'laura@vid.it' } });
    const state = new URL(start.body.url).searchParams.get('state');
    const cb = await call('GET /auth/microsoft/callback', { query: { code: 'c', state } });
    assert.ok(/different%20application/.test(cb.redirect), decodeURIComponent(cb.redirect));
  });

  await t('un indirizzo non invitato non entra, anche se il tenant è giusto', async () => {
    const { call } = build({ claims: { tid:'tenant-vid', aud:'client-vid', email:'altro@vid.it', exp: Math.floor(Date.now()/1000)+600 } });
    const start = await call('POST /auth/microsoft/start', { body: { email: 'laura@vid.it' } });
    const state = new URL(start.body.url).searchParams.get('state');
    const cb = await call('GET /auth/microsoft/callback', { query: { code: 'c', state } });
    assert.ok(/No%20Bizca%20account/.test(cb.redirect), decodeURIComponent(cb.redirect));
  });

  await t('uno state falsificato non apre niente', async () => {
    const { call } = build();
    const cb = await call('GET /auth/microsoft/callback', { query: { code: 'c', state: 'inventato' } });
    assert.ok(/mserror=/.test(cb.redirect), cb.redirect);
    assert.ok(cb.redirect.indexOf('ms=') < 0 || /mserror/.test(cb.redirect));
  });

  await t('un errore di Microsoft torna leggibile, su una riga', async () => {
    const { call } = build({ tokenFails: true });
    const start = await call('POST /auth/microsoft/start', { body: { email: 'laura@vid.it' } });
    const state = new URL(start.body.url).searchParams.get('state');
    const cb = await call('GET /auth/microsoft/callback', { query: { code: 'c', state } });
    const msg = decodeURIComponent(cb.redirect.match(/mserror=(.+)$/)[1]);
    assert.ok(/AADSTS70008/.test(msg), msg);
    assert.ok(msg.indexOf('Trace') < 0, 'solo la prima riga: ' + msg);
  });

  await t('l\'utente disattivato non entra', async () => {
    const { call } = build({ users: [{ id:'u2', company_id:'c1', name:'Laura', email:'laura@vid.it', role:'seller', status:'disabled', email_verified:true }] });
    const r = await call('POST /auth/microsoft/start', { body: { email: 'laura@vid.it' } });
    assert.strictEqual(r.status, 403);
  });

  await t('le rivendicazioni dell\'email si leggono in ordine di preferenza', () => {
    const f = msauth._internals.emailFromClaims;
    assert.strictEqual(f({ email:'a@x.it', preferred_username:'b@x.it' }), 'a@x.it');
    assert.strictEqual(f({ preferred_username:'B@X.it' }), 'b@x.it');
    assert.strictEqual(f({ upn:'c@x.it' }), 'c@x.it');
    assert.strictEqual(f({}), '');
  });

  console.log('\n' + pass + ' passati, ' + fail + ' falliti\n');
  process.exit(fail ? 1 : 0);
})();
