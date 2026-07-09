/* Bizca — serverless proxy to Brevo (create/update contact, dedupe by email).
   The Brevo API key stays server-side (Vercel env var BREVO_API_KEY). */

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => (d += c));
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}

async function brevoUpsert(key, email, attributes, listIds) {
  const payload = { email, attributes, updateEnabled: true };
  if (listIds && listIds.length) payload.listIds = listIds;
  const r = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload)
  });
  // 201 = created, 204 = updated (dedupe by email handled by Brevo)
  if (r.status === 201) return { ok: true, action: 'created' };
  if (r.status === 204) return { ok: true, action: 'updated' };
  let data = {};
  try { data = await r.json(); } catch (e) {}
  return { ok: false, status: r.status, code: data.code, message: data.message || ('Brevo error ' + r.status) };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const key = process.env.BREVO_API_KEY;
  if (!key) { res.status(500).json({ error: 'BREVO_API_KEY not configured on the server' }); return; }

  try {
    let body = req.body;
    if (!body || typeof body === 'string') { const raw = await readRaw(req); body = raw ? JSON.parse(raw) : {}; }
    const lead = body.lead || {};
    const email = (lead.email || '').trim();
    if (!email) { res.status(400).json({ error: 'Lead has no email — Brevo requires an email address' }); return; }

    // Optional destination list (set BREVO_LIST_ID in Vercel env to route contacts into a Brevo list)
    const listEnv = parseInt(process.env.BREVO_LIST_ID || '', 10);
    const listIds = Number.isFinite(listEnv) ? [listEnv] : undefined;

    // Full attribute set: standard + Bizca custom attributes
    const full = {
      FIRSTNAME: lead.first || '',
      LASTNAME: lead.last || '',
      BIZCA_COMPANY: lead.company || '',
      BIZCA_ROLE: lead.role || '',
      BIZCA_PHONE: lead.phone || '',
      BIZCA_WEBSITE: lead.website || '',
      BIZCA_ADDRESS: lead.address || '',
      BIZCA_SOURCE: lead.provenienza || '',
      BIZCA_COUNTRY: lead.country || '',
      BIZCA_INTEREST: lead.interesse || '',
      BIZCA_EVENT: lead.event || '',
      BIZCA_OWNER: lead.owner || ''
    };

    let result = await brevoUpsert(key, email, full, listIds);

    // If custom attributes aren't defined in this Brevo account, retry with standard-only
    if (!result.ok && result.status === 400) {
      const minimal = { FIRSTNAME: lead.first || '', LASTNAME: lead.last || '' };
      const retry = await brevoUpsert(key, email, minimal, listIds);
      if (retry.ok) { res.status(200).json({ ok: true, action: retry.action, note: 'custom attributes skipped — define BIZCA_* in Brevo to store qualification data' }); return; }
      res.status(retry.status || 400).json({ error: retry.message });
      return;
    }

    if (result.ok) { res.status(200).json({ ok: true, action: result.action }); return; }
    res.status(result.status || 500).json({ error: result.message });
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || 'Server error' });
  }
};
