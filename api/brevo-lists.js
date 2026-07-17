/* Bizca — list the Brevo account's contact lists (id + name), so an admin can
   pick which list new leads should be routed into (set via BREVO_LIST_ID env). */

function readRaw(req) {
  return new Promise((resolve, reject) => { let d = ''; req.on('data', c => (d += c)); req.on('end', () => resolve(d)); req.on('error', reject); });
}

module.exports = async (req, res) => {
  let body = {};
  if (req.method === 'POST') {
    body = req.body;
    if (!body || typeof body === 'string') { try { const raw = await readRaw(req); body = raw ? JSON.parse(raw) : {}; } catch (e) { body = {}; } }
  }
  const q = new URL(req.url, 'http://localhost').searchParams;
  const key = (body.apiKey || '').trim() || process.env.BREVO_API_KEY;
  if (!key) { res.status(500).json({ error: 'No Brevo API key — set it in Admin → Destinations, or as BREVO_API_KEY on the server' }); return; }
  try {
    // Optional: email (body or ?email=) returns that contact's list membership (for verification)
    const email = body.email || q.get('email');
    if (email) {
      const cr = await fetch('https://api.brevo.com/v3/contacts/' + encodeURIComponent(email), {
        headers: { 'api-key': key, accept: 'application/json' }
      });
      const cd = await cr.json();
      if (!cr.ok) { res.status(cr.status).json({ error: (cd && cd.message) || 'Contact not found' }); return; }
      res.status(200).json({ email: cd.email, listIds: cd.listIds || [], attributes: cd.attributes || {} });
      return;
    }
    const r = await fetch('https://api.brevo.com/v3/contacts/lists?limit=50&sort=desc', {
      headers: { 'api-key': key, accept: 'application/json' }
    });
    const data = await r.json();
    if (!r.ok) { res.status(r.status).json({ error: (data && data.message) || ('Brevo error ' + r.status) }); return; }
    const lists = (data.lists || []).map(l => ({ id: l.id, name: l.name, folderId: l.folderId, contacts: l.totalSubscribers }));
    res.status(200).json({ count: data.count, current: process.env.BREVO_LIST_ID || null, lists });
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || 'Server error' });
  }
};
