/* Bizca — one-time setup: create the contact attributes used by Bizca in Brevo.
   Idempotent: attributes that already exist are reported as "existed", not errors. */

const ATTRS = [
  'FIRSTNAME', 'LASTNAME',
  'BIZCA_COMPANY', 'BIZCA_ROLE', 'BIZCA_PHONE', 'BIZCA_WEBSITE', 'BIZCA_ADDRESS',
  'BIZCA_SOURCE', 'BIZCA_COUNTRY', 'BIZCA_INTEREST', 'BIZCA_EVENT', 'BIZCA_OWNER', 'BIZCA_CONSENT'
];

function readRaw(req) {
  return new Promise((resolve, reject) => { let d = ''; req.on('data', c => (d += c)); req.on('end', () => resolve(d)); req.on('error', reject); });
}

module.exports = async (req, res) => {
  let body = req.body;
  if (!body || typeof body === 'string') { try { const raw = await readRaw(req); body = raw ? JSON.parse(raw) : {}; } catch (e) { body = {}; } }
  const key = (body.apiKey || '').trim() || process.env.BREVO_API_KEY;
  if (!key) { res.status(500).json({ error: 'No Brevo API key — set it in Admin → Destinations, or as BREVO_API_KEY on the server' }); return; }

  const created = [], existed = [], failed = [];
  for (const name of ATTRS) {
    try {
      const r = await fetch('https://api.brevo.com/v3/contacts/attributes/normal/' + encodeURIComponent(name), {
        method: 'POST',
        headers: { 'api-key': key, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ type: 'text' })
      });
      if (r.status === 201 || r.status === 204) { created.push(name); continue; }
      const d = await r.json().catch(() => ({}));
      const msg = (d && (d.message || d.code)) || '';
      if (r.status === 400 || /exist/i.test(msg)) existed.push(name);
      else failed.push({ name, error: msg || ('HTTP ' + r.status) });
    } catch (e) {
      failed.push({ name, error: (e && e.message) || 'error' });
    }
  }
  res.status(200).json({ created, existed, failed });
};
