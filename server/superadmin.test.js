/* Console superadmin: accesso via magic link e gestione aziende/utenti.
   Nessuna rete, nessun database.   Run with:  node server/superadmin.test.js */
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
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function fakeDb() {
  const db = {
    companies: [{ id:'cA', name:'VID', domain:'vid.it', locale:'it', status:'active', settings:{}, created_at:new Date() },
                { id:'cB', name:'CELTE', domain:'celte.it', locale:'it', status:'active', settings:{}, created_at:new Date() }],
    users: [
      { id:'uA', company_id:'cA', role:'admin', status:'active', email:'boss@vid.it', name:'Boss', password_hash:'s:h', email_verified:true, created_at:new Date() },
      { id:'uA2', company_id:'cA', role:'seller', status:'active', email:'laura@vid.it', name:'Laura', password_hash:null, email_verified:false, created_at:new Date() },
      { id:'uB', company_id:'cB', role:'admin', status:'active', email:'capo@celte.it', name:'Capo', password_hash:'s:h', email_verified:true, created_at:new Date() } ],
    leads: [{ id:'l1', company_id:'cA', owner_id:'uA2' }, { id:'l2', company_id:'cA', owner_id:'uA2' }],
    links: [], audit: []
  };
  const one = rows => ({ rowCount: rows.length, rows });
  const pool = {
    db,
    connect: async () => ({ query: (...a) => pool.query(...a), release() {} }),
    query: async (sql, p = []) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return one([]);
      if (/FROM users u JOIN companies c ON c.id=u.company_id WHERE u.id=\$1/.test(sql))
        return one(db.users.filter(u => u.id === p[0]).map(u => Object.assign({}, u, { company_status: (db.companies.find(c => c.id === u.company_id) || {}).status })));
      if (/SELECT created_at FROM superadmin_links WHERE email=\$1/.test(sql))
        return one(db.links.filter(l => l.email === p[0]).sort((a, b) => b.created_at - a.created_at).slice(0, 1));
      if (/INSERT INTO superadmin_links/.test(sql)) { db.links.push({ token_hash:p[0], email:p[1], expires_at:p[2], used_at:null, created_at:new Date() }); return one([]); }
      if (/UPDATE superadmin_links SET used_at=now\(\)/.test(sql)) {
        const l = db.links.find(x => x.token_hash === p[0] && !x.used_at && x.expires_at > new Date());
        if (!l) return one([]); l.used_at = new Date(); return one([{ email: l.email }]);
      }
      if (/INSERT INTO super_audit/.test(sql)) { db.audit.push({ actor:p[0], action:p[1], target:p[2] }); return one([]); }
      if (/SELECT 1 FROM users WHERE lower\(email\)=lower\(\$1\)/.test(sql)) return one(db.users.filter(u => u.email === String(p[0]).toLowerCase()));
      if (/INSERT INTO companies/.test(sql)) { db.companies.push({ id:p[0], name:p[1], domain:p[2], locale:p[3], settings:p[4], status:p[5], created_at:new Date() }); return one([]); }
      if (/INSERT INTO users/.test(sql)) { db.users.push({ id:p[0], company_id:p[1], name:p[2], email:p[3], role:p[4], status:p[5], verify_token:p[6], locale:p[7], password_hash:null, email_verified:false, created_at:new Date() }); return one([]); }
      if (/SELECT name FROM companies WHERE id=\$1/.test(sql)) return one(db.companies.filter(c => c.id === p[0]));
      if (/SELECT name,locale FROM companies WHERE id=\$1/.test(sql)) return one(db.companies.filter(c => c.id === p[0]));
      if (/SELECT id FROM companies WHERE id=\$1/.test(sql)) return one(db.companies.filter(c => c.id === p[0]));
      if (/SELECT status FROM companies WHERE id=\$1/.test(sql)) return one(db.companies.filter(c => c.id === p[0]));
      if (/UPDATE companies SET name=COALESCE/.test(sql)) { const c = db.companies.find(x => x.id === p[4]); if (p[3]) c.status = p[3]; if (p[0]) c.name = p[0]; return one([]); }
      if (/SELECT \(SELECT count/.test(sql)) return one([{ users: 1, leads: 0 }]);
      if (/DELETE FROM companies WHERE id=\$1/.test(sql)) { db.companies = db.companies.filter(c => c.id !== p[0]); db.users = db.users.filter(u => u.company_id !== p[0]); return one([]); }
      if (/SELECT id,company_id,name,email,role,status,password_hash/.test(sql)) return one(db.users.filter(u => u.id === p[0]));
      if (/SELECT id FROM users WHERE company_id=\$1 AND role='admin' AND status='active' AND id<>\$2/.test(sql))
        return one(db.users.filter(u => u.company_id === p[0] && u.role === 'admin' && u.status === 'active' && u.id !== p[1]).map(u => ({ id: u.id })));
      if (/UPDATE users SET role=COALESCE/.test(sql)) { const u = db.users.find(x => x.id === p[3]); if (p[0]) u.role = p[0]; if (p[1]) u.status = p[1]; return one([]); }
      if (/UPDATE users SET verify_token=\$1/.test(sql)) { const u = db.users.find(x => x.id === p[1]); u.verify_token = p[0]; return one([]); }
      if (/UPDATE leads SET owner_id=\$1/.test(sql)) { const m = db.leads.filter(l => l.company_id === p[1] && l.owner_id === p[2]); m.forEach(l => l.owner_id = p[0]); return { rowCount: m.length, rows: [] }; }
      if (/DELETE FROM users WHERE id=\$1/.test(sql)) { db.users = db.users.filter(u => u.id !== p[0]); return one([]); }
      if (/SELECT \* FROM users WHERE lower\(email\)=lower\(\$1\)/.test(sql)) return one(db.users.filter(u => u.email === String(p[0]).toLowerCase()));
      if (/SELECT id,name,domain,locale,status,settings,created_at FROM companies/.test(sql)) return one(db.companies);
      if (/GROUP BY company_id/.test(sql)) return one([]);
      if (/FROM super_audit/.test(sql)) return one([]);
      return one([]);
    }
  };
  return pool;
}

const mails = [];
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
  process.env.BREVO_TRANSACTIONAL_KEY = 'test-key';
  global.fetch = async (url, o) => { mails.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}), text: async () => '' }; };
  for (const f of ['./index.js','./ms.js','./msauth.js','./emails.js','./superadmin.js']) delete require.cache[require.resolve(f)];
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
const bearer = tok => ({ authorization: 'Bearer ' + tok });

(async () => {
  console.log('\nSuperadmin\n');
  delete process.env.SUPERADMIN_EMAILS;
  const pool = fakeDb();
  const call = loadServer(pool);
  let session = '';

  await t('un indirizzo non abilitato riceve la stessa risposta ma nessun link', async () => {
    const r = await call('POST /super/magic', { body: { email: 'boss@vid.it' } });
    assert.deepStrictEqual(r.body, { ok: true });
    assert.strictEqual(pool.db.links.length, 0); assert.strictEqual(mails.length, 0);
  });

  let token = '';
  await t('max@bryan.it riceve un link monouso nel frammento #', async () => {
    const r = await call('POST /super/magic', { body: { email: ' Max@Bryan.it ' } });
    assert.deepStrictEqual(r.body, { ok: true });
    assert.strictEqual(mails.length, 1);
    assert.strictEqual(mails[0].to[0].email, 'max@bryan.it');
    const m = mails[0].htmlContent.match(/super\.html#token=([a-f0-9]{64})/);
    assert.ok(m, 'il link deve portare il token dopo #');
    token = m[1];
    assert.strictEqual(pool.db.links.length, 1);
    assert.strictEqual(pool.db.links[0].token_hash, sha(token), 'nel database solo l\'hash');
    assert.ok(!JSON.stringify(pool.db.links).includes(token), 'il token in chiaro non è salvato');
  });

  await t('anche davide.berardino@bryan.it è abilitato', async () => {
    await call('POST /super/magic', { body: { email: 'davide.berardino@bryan.it' } });
    assert.strictEqual(mails.length, 2);
  });

  await t('una seconda richiesta entro un minuto non manda un altro link', async () => {
    await call('POST /super/magic', { body: { email: 'max@bryan.it' } });
    assert.strictEqual(mails.length, 2);
  });

  await t('il link apre una sessione superadmin', async () => {
    const r = await call('POST /super/verify', { body: { token } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    session = r.body.token;
    const me = await call('GET /super/me', { headers: bearer(session) });
    assert.strictEqual(me.body.email, 'max@bryan.it');
  });

  await t('lo stesso link non vale una seconda volta', async () => {
    const r = await call('POST /super/verify', { body: { token } });
    assert.strictEqual(r.status, 400);
  });

  await t('un link scaduto non apre nulla', async () => {
    const tk = 'a'.repeat(64);
    pool.db.links.push({ token_hash: sha(tk), email: 'max@bryan.it', expires_at: new Date(Date.now() - 1000), used_at: null, created_at: new Date() });
    const r = await call('POST /super/verify', { body: { token: tk } });
    assert.strictEqual(r.status, 400);
  });

  await t('la sessione superadmin NON apre l\'API dell\'app', async () => {
    const r = await call('GET /state', { headers: bearer(session) });
    assert.strictEqual(r.status, 401);
  });

  await t('una sessione dell\'app (anche admin) NON apre il superadmin', async () => {
    const app = sign({ uid: 'uA', cid: 'cA', role: 'admin', exp: Date.now() + 60000 });
    const r = await call('GET /super/overview', { headers: bearer(app) });
    assert.strictEqual(r.status, 401);
  });

  await t('un token di stato Microsoft NON apre il superadmin', async () => {
    const st = sign({ k: 'mslogin', uid: 'uA', cid: 'cA', sa: 'max@bryan.it', exp: Date.now() + 60000 });
    const r = await call('GET /super/overview', { headers: bearer(st) });
    assert.strictEqual(r.status, 401);
  });

  await t('un token super per un indirizzo non in elenco non vale', async () => {
    const forged = sign({ k: 'super', sa: 'boss@vid.it', exp: Date.now() + 60000 });
    const r = await call('GET /super/overview', { headers: bearer(forged) });
    assert.strictEqual(r.status, 401);
  });

  await t('togliere un indirizzo da SUPERADMIN_EMAILS revoca subito le sue sessioni', async () => {
    process.env.SUPERADMIN_EMAILS = 'davide.berardino@bryan.it';
    const r = await call('GET /super/overview', { headers: bearer(session) });
    delete process.env.SUPERADMIN_EMAILS;
    assert.strictEqual(r.status, 401);
  });

  await t('crea un\'azienda con il primo admin e restituisce il link di attivazione', async () => {
    const r = await call('POST /super/companies', { headers: bearer(session), body: { name: 'ACME', domain: '@Acme.it', adminEmail: 'Ceo@Acme.it', adminName: 'Ceo', locale: 'it' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(/^https:\/\/bizca\.bryan\.it\/#\/activate\?email=ceo%40acme\.it&token=[a-f0-9]{48}$/.test(r.body.link), r.body.link);
    const u = pool.db.users.find(x => x.email === 'ceo@acme.it');
    assert.strictEqual(u.role, 'admin');
    assert.strictEqual(pool.db.companies.find(c => c.id === r.body.companyId).domain, 'acme.it');
    assert.strictEqual(r.body.emailSent, null, 'senza richiesta non parte nessuna email');
    assert.ok(pool.db.audit.some(a => a.action === 'company.create' && a.actor === 'max@bryan.it'));
  });

  await t('non crea un secondo account con la stessa email', async () => {
    const r = await call('POST /super/companies', { headers: bearer(session), body: { name: 'X', domain: 'x.it', adminEmail: 'boss@vid.it' } });
    assert.strictEqual(r.status, 409);
  });

  await t('non degrada né rimuove l\'ultimo admin attivo', async () => {
    const a = await call('PATCH /super/users/uB', { headers: bearer(session), body: { role: 'seller' } });
    assert.strictEqual(a.status, 400);
    const b = await call('DELETE /super/users/uB', { headers: bearer(session) });
    assert.strictEqual(b.status, 400);
  });

  await t('rimuovendo un commerciale i suoi lead passano a un admin della stessa azienda', async () => {
    const r = await call('DELETE /super/users/uA2', { headers: bearer(session) });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.leadsReassigned, 2);
    assert.ok(pool.db.leads.every(l => l.owner_id === 'uA'));
  });

  await t('un nuovo link per un account attivo è un link per reimpostare la password', async () => {
    const r = await call('POST /super/users/uA/link', { headers: bearer(session), body: {} });
    assert.strictEqual(r.body.reset, true);
    assert.ok(r.body.link.includes('token=' + pool.db.users.find(u => u.id === 'uA').verify_token));
  });

  await t('sospendere un\'azienda chiude l\'app ai suoi utenti', async () => {
    await call('PATCH /super/companies/cA', { headers: bearer(session), body: { status: 'suspended' } });
    const app = sign({ uid: 'uA', cid: 'cA', role: 'admin', exp: Date.now() + 60000 });
    const r = await call('GET /state', { headers: bearer(app) });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.body.suspended, true);
    const other = sign({ uid: 'uB', cid: 'cB', role: 'admin', exp: Date.now() + 60000 });
    const ok = await call('GET /auth/check', { headers: bearer(other) });
    assert.strictEqual(ok.status, 200, 'le altre aziende non sono toccate');
  });

  await t('per eliminare un\'azienda bisogna scriverne il nome esatto', async () => {
    const no = await call('DELETE /super/companies/cB', { headers: bearer(session), body: { confirm: 'celte' } });
    assert.strictEqual(no.status, 400);
    assert.ok(pool.db.companies.some(c => c.id === 'cB'));
    const yes = await call('DELETE /super/companies/cB', { headers: bearer(session), body: { confirm: 'CELTE' } });
    assert.strictEqual(yes.status, 200);
    assert.ok(!pool.db.companies.some(c => c.id === 'cB'));
    assert.ok(pool.db.audit.some(a => a.action === 'company.delete'));
  });

  await t('«Entra come»: codice monouso → sessione dell\'utente marcata come superadmin', async () => {
    const no = await call('POST /super/users/uA/impersonate', {});
    assert.strictEqual(no.status, 401, 'senza sessione superadmin non si entra');
    const r = await call('POST /super/users/uA/impersonate', { headers: bearer(session) });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const m = r.body.url.match(/^https:\/\/bizca\.bryan\.it\/#\/login\?imp=([a-f0-9]{48})$/);
    assert.ok(m, r.body.url);
    assert.ok(!/\./.test(m[1]), 'nell\'URL c\'è un codice, non il token di sessione');
    const x = await call('POST /auth/impersonate', { body: { code: m[1] } });
    assert.strictEqual(x.status, 200);
    const payload = JSON.parse(Buffer.from(x.body.token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString());
    assert.strictEqual(payload.uid, 'uA'); assert.strictEqual(payload.imp, 'max@bryan.it'); assert.ok(!payload.k);
    assert.ok(payload.exp - Date.now() <= 2 * 3600 * 1000 + 1000, 'dura al massimo 2 ore');
    const again = await call('POST /auth/impersonate', { body: { code: m[1] } });
    assert.strictEqual(again.status, 400, 'il codice vale una volta sola');
    // l'azienda cA è sospesa (test precedente): il supporto entra lo stesso
    const ok = await call('GET /auth/check', { headers: bearer(x.body.token) });
    assert.strictEqual(ok.status, 200, 'il superadmin vede anche un\'azienda sospesa');
    assert.ok(pool.db.audit.some(a => a.action === 'user.impersonate' && a.target === 'uA'));
    pool.db.audit.length = 0;
    await call('PATCH /me', { headers: bearer(x.body.token), body: { locale: 'it' } });
    assert.ok(pool.db.audit.some(a => a.action === 'as-user' && a.actor === 'max@bryan.it' && a.target === 'uA'), 'le modifiche fatte come utente sono registrate');
    process.env.SUPERADMIN_EMAILS = 'davide.berardino@bryan.it';
    const off = await call('GET /auth/check', { headers: bearer(x.body.token) });
    delete process.env.SUPERADMIN_EMAILS;
    assert.strictEqual(off.status, 401, 'tolto dall\'elenco, la sessione «come utente» si chiude');
  });

  await t('un codice scaduto non apre nulla', async () => {
    const sa = require('./superadmin.js')._internals;
    sa.impHandoff.set(sa.sha('b'.repeat(48)), { token: 'x', exp: Date.now() - 1 });
    const r = await call('POST /auth/impersonate', { body: { code: 'b'.repeat(48) } });
    assert.strictEqual(r.status, 400);
  });

  await t('le rotte di gestione rifiutano chi non ha la sessione', async () => {
    for (const k of ['GET /super/overview', 'POST /super/companies', 'PATCH /super/companies/cA', 'DELETE /super/companies/cA',
                     'POST /super/companies/cA/users', 'PATCH /super/users/uA', 'POST /super/users/uA/link', 'DELETE /super/users/uA', 'GET /super/companies/cA', 'POST /super/users/uA/impersonate']) {
      const r = await call(k, {});
      assert.strictEqual(r.status, 401, k + ' → ' + r.status);
    }
  });

  console.log('\n' + pass + ' passati, ' + fail + ' falliti\n');
  process.exit(fail ? 1 : 0);
})();
