/* Regressioni di sicurezza trovate nell'audit. Nessuna rete, nessun database.
   Run with:  node server/security.test.js                                   */
const assert = require('assert');
const crypto = require('crypto');
const Module = require('module');

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } };

const SECRET = 'test-secret';
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const sign = p => { const h=b64u(JSON.stringify({alg:'HS256',typ:'JWT'})), b=b64u(JSON.stringify(p));
  return h+'.'+b+'.'+b64u(crypto.createHmac('sha256',SECRET).update(h+'.'+b).digest()); };

function fakeDb() {
  const users = [
    { id:'uA', company_id:'cA', role:'admin', status:'active', email:'boss@vid.it' },
    { id:'uA2', company_id:'cA', role:'seller', status:'active', email:'laura@vid.it' },
    { id:'uB', company_id:'cB', role:'seller', status:'active', email:'altro@celte.it' } ];
  const leads = [{ id:'shared1', company_id:'cB', created_by:'uB', owner_id:'uB', first_name:'Originale' }];
  const pool = {
    users, leads,
    connect: async () => ({ query: (...a) => pool.query(...a), release() {} }),
    query: async (sql, p=[]) => {
      const one = rows => ({ rowCount: rows.length, rows });
      if (/SELECT id,company_id,role,status FROM users WHERE id=\$1/.test(sql)) return one(users.filter(u => u.id === p[0]));
      if (/SELECT created_by, owner_id FROM leads WHERE id=\$1 AND company_id=\$2/.test(sql))
        return one(leads.filter(l => l.id === p[0] && l.company_id === p[1]));
      if (/SELECT 1 FROM users WHERE id=\$1 AND company_id=\$2/.test(sql)) return one(users.filter(u => u.id === p[0] && u.company_id === p[1]));
      if (/SELECT 1 FROM events WHERE id=\$1 AND company_id=\$2/.test(sql)) return one([]);
      if (/INSERT INTO leads/.test(sql)) {
        const ex = leads.find(l => l.id === p[0]);
        if (!ex) { leads.push({ id:p[0], company_id:p[1], owner_id:p[3], created_by:p[4], first_name:p[5], card_image:p[19] }); return one([{id:p[0]}]); }
        if (ex.company_id !== p[1]) return one([]);            // WHERE leads.company_id = EXCLUDED.company_id
        Object.assign(ex, { owner_id:p[3], first_name:p[5], card_image:p[19] }); return one([{id:p[0]}]);
      }
      if (/SELECT created_by FROM leads WHERE id=\$1 AND company_id=\$2/.test(sql))
        return one(leads.filter(l => l.id === p[0] && l.company_id === p[1]).map(l => ({ created_by: l.created_by })));
      if (/DELETE FROM leads WHERE id=\$1 AND company_id=\$2/.test(sql)) {
        const i = leads.findIndex(l => l.id === p[0] && l.company_id === p[1]);
        if (i >= 0) leads.splice(i, 1);
        return { rowCount: i >= 0 ? 1 : 0, rows: [] };
      }
      if (/SELECT settings FROM companies/.test(sql)) return one([{ settings: { ms: { tenantId:'t', clientId:'c', clientSecret:'s' } } }]);
      if (/FROM users WHERE lower\(email\)=lower\(\$1\)/.test(sql)) return one(users.filter(u => u.email === String(p[0]).toLowerCase()));
      return { rowCount: 0, rows: [] };
    }
  };
  return pool;
}

function loadServer(pool) {
  const routes = {};
  const mk = m => (path, ...h) => { routes[m + ' ' + path] = h; };
  const app = { get: mk('GET'), post: mk('POST'), patch: mk('PATCH'), delete: mk('DELETE'), put: mk('PUT'), use() {}, listen() {} };
  const fx = () => app; fx.json = () => (q, r, n) => n && n();
  const orig = Module._load;
  Module._load = function (req) {
    if (req === 'express') return fx;
    if (req === 'cors') return () => (q, r, n) => n && n();
    if (req === 'pg') return { Pool: function () { return pool; } };
    return orig.apply(this, arguments);
  };
  process.env.DATABASE_URL = 'postgres://x/y'; process.env.JWT_SECRET = SECRET;
  process.env.APP_URL = 'https://bizca.bryan.it'; process.env.API_URL = 'https://api.test';
  process.env.BREVO_TRANSACTIONAL_KEY = '';
  for (const f of ['./index.js','./ms.js','./msauth.js','./emails.js']) delete require.cache[require.resolve(f)];
  require('./index.js');
  Module._load = orig;
  const match = key => {
    const [m, path] = key.split(' ');
    for (const r of Object.keys(routes)) {
      const [rm, rp] = r.split(' '); if (rm !== m) continue;
      const a = rp.split('/'), b = path.split('/'); if (a.length !== b.length) continue;
      const params = {}; let ok = true;
      for (let i = 0; i < a.length; i++) { if (a[i].startsWith(':')) params[a[i].slice(1)] = b[i]; else if (a[i] !== b[i]) { ok = false; break; } }
      if (ok) return { h: routes[r], params };
    }
  };
  return async (key, req) => {
    const hit = match(key); if (!hit) throw new Error('no route ' + key);
    const out = {};
    const res = { status(c){ out.status=c; return this; }, json(b){ out.body=b; return this; }, redirect(u){ out.redirect=u; return this; } };
    const r = Object.assign({ query:{}, body:{}, headers:{} }, req); r.params = hit.params;
    for (const h of hit.h) {
      let next = false;
      await new Promise((res2, rej) => { try { const p = h(r, res, () => { next = true; res2(); }); if (p && p.then) p.then(() => res2(), rej); else if (!next && out.body === undefined) setTimeout(res2, 15); else res2(); } catch (e) { rej(e); } });
      if (out.body !== undefined) break;
    }
    await new Promise(z => setTimeout(z, 10));
    return Object.assign({ status: out.status || 200 }, out);
  };
}

(async () => {
  console.log('\nSicurezza\n');
  const pool = fakeDb();
  const call = loadServer(pool);

  await t('un token di stato Microsoft non vale come sessione (l\'attacco dell\'audit)', async () => {
    // l'attaccante chiede lo start con l'email della vittima e ricava lo state
    const st = await call('POST /auth/microsoft/start', { body: { email: 'boss@vid.it' } });
    assert.strictEqual(st.status, 200, JSON.stringify(st.body));
    const state = new URL(st.body.url).searchParams.get('state');
    const r = await call('GET /state', { headers: { authorization: 'Bearer ' + state } });
    assert.strictEqual(r.status, 401, 'lo state NON deve aprire l\'API, ricevuto ' + r.status);
  });

  await t('neanche un token di consenso vale come sessione', async () => {
    const tok = sign({ cid: 'cA', k: 'ms', uid: 'uA', exp: Date.now() + 60000 });
    const r = await call('GET /state', { headers: { authorization: 'Bearer ' + tok } });
    assert.strictEqual(r.status, 401);
  });

  await t('una sessione vera funziona ancora (nessun utente viene disconnesso)', async () => {
    const tok = sign({ uid: 'uA', cid: 'cA', role: 'admin', exp: Date.now() + 60000 });
    const r = await call('PUT /leads/nuovo1', { headers: { authorization: 'Bearer ' + tok }, body: { first: 'Anna' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  });

  await t('un lead di un\'altra azienda non si sovrascrive riusandone l\'id', async () => {
    const tok = sign({ uid: 'uA', cid: 'cA', role: 'admin', exp: Date.now() + 60000 });
    const r = await call('PUT /leads/shared1', { headers: { authorization: 'Bearer ' + tok }, body: { first: 'Manomesso' } });
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(pool.leads.find(l => l.id === 'shared1').first_name, 'Originale');
  });

  await t('il creatore non si può falsificare dal corpo della richiesta', async () => {
    const tok = sign({ uid: 'uA2', cid: 'cA', role: 'seller', exp: Date.now() + 60000 });
    await call('PUT /leads/nuovo2', { headers: { authorization: 'Bearer ' + tok }, body: { first: 'X', createdBy: 'uA' } });
    assert.strictEqual(pool.leads.find(l => l.id === 'nuovo2').created_by, 'uA2');
  });

  await t('un titolare di un\'altra azienda viene ignorato', async () => {
    const tok = sign({ uid: 'uA2', cid: 'cA', role: 'seller', exp: Date.now() + 60000 });
    await call('PUT /leads/nuovo3', { headers: { authorization: 'Bearer ' + tok }, body: { first: 'X', ownerId: 'uB' } });
    assert.strictEqual(pool.leads.find(l => l.id === 'nuovo3').owner_id, 'uA2');
  });

  await t('chi riceve un lead assegnato può salvarlo (prima riceveva 403)', async () => {
    pool.leads.push({ id: 'assegnato', company_id: 'cA', created_by: 'uA', owner_id: 'uA2', first_name: 'Y' });
    const tok = sign({ uid: 'uA2', cid: 'cA', role: 'seller', exp: Date.now() + 60000 });
    const r = await call('PUT /leads/assegnato', { headers: { authorization: 'Bearer ' + tok }, body: { first: 'Y2', ownerId: 'uA2', status: 'Sent' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  });

  await t('un\'immagine che non è una foto viene scartata (niente script nascosti)', async () => {
    const tok = sign({ uid: 'uA', cid: 'cA', role: 'admin', exp: Date.now() + 60000 });
    await call('PUT /leads/nuovo4', { headers: { authorization: 'Bearer ' + tok }, body: { first: 'X', image: 'x" onerror="alert(1)' } });
    assert.strictEqual(pool.leads.find(l => l.id === 'nuovo4').card_image, null);
    await call('PUT /leads/nuovo5', { headers: { authorization: 'Bearer ' + tok }, body: { first: 'X', image: 'data:image/jpeg;base64,AAAA' } });
    assert.strictEqual(pool.leads.find(l => l.id === 'nuovo5').card_image, 'data:image/jpeg;base64,AAAA');
  });

  await t('un commerciale elimina i propri lead', async () => {
    pool.leads.push({ id: 'mio', company_id: 'cA', created_by: 'uA2', owner_id: 'uA2' });
    const tok = sign({ uid: 'uA2', cid: 'cA', role: 'seller', exp: Date.now() + 60000 });
    const r = await call('DELETE /leads/mio', { headers: { authorization: 'Bearer ' + tok } });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.deleted, 1);
    assert.ok(!pool.leads.some(l => l.id === 'mio'));
  });

  await t('ma non quelli acquisiti da un collega', async () => {
    pool.leads.push({ id: 'delcollega', company_id: 'cA', created_by: 'uA', owner_id: 'uA2' });
    const tok = sign({ uid: 'uA2', cid: 'cA', role: 'seller', exp: Date.now() + 60000 });
    const r = await call('DELETE /leads/delcollega', { headers: { authorization: 'Bearer ' + tok } });
    assert.strictEqual(r.status, 403);
    assert.ok(pool.leads.some(l => l.id === 'delcollega'), 'deve restare');
  });

  await t('un admin elimina qualunque lead della sua azienda', async () => {
    const tok = sign({ uid: 'uA', cid: 'cA', role: 'admin', exp: Date.now() + 60000 });
    const r = await call('DELETE /leads/delcollega', { headers: { authorization: 'Bearer ' + tok } });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.deleted, 1);
  });

  await t('nessuno elimina i lead di un\'altra azienda', async () => {
    const tok = sign({ uid: 'uA', cid: 'cA', role: 'admin', exp: Date.now() + 60000 });
    const r = await call('DELETE /leads/shared1', { headers: { authorization: 'Bearer ' + tok } });
    assert.strictEqual(r.body.deleted, 0);
    assert.ok(pool.leads.some(l => l.id === 'shared1'), 'il lead dell\'altra azienda deve restare');
  });

  console.log('\n' + pass + ' passati, ' + fail + ' falliti\n');
  process.exit(fail ? 1 : 0);
})();
