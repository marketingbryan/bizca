/* Bizca — list the Brevo account's contact lists (id + name), so an admin can
   pick which list new leads should be routed into (set via BREVO_LIST_ID env). */

module.exports = async (req, res) => {
  const key = process.env.BREVO_API_KEY;
  if (!key) { res.status(500).json({ error: 'BREVO_API_KEY not configured on the server' }); return; }
  try {
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
