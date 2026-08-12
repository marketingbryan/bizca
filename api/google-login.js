/* Bizca — verifies a Google Identity Services ID token server-side.
   Returns the verified email/name. Authorisation (is this user invited?) is
   enforced by the app against the admin-managed user list. */

function readRaw(req) {
  return new Promise((resolve, reject) => { let d = ''; req.on('data', c => (d += c)); req.on('end', () => resolve(d)); req.on('error', reject); });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) { res.status(500).json({ error: 'Google sign-in not configured — set GOOGLE_CLIENT_ID on the server' }); return; }
  try {
    let body = req.body;
    if (!body || typeof body === 'string') { const raw = await readRaw(req); body = raw ? JSON.parse(raw) : {}; }
    const credential = body.credential;
    if (!credential) { res.status(400).json({ error: 'Missing credential' }); return; }

    // Verify the ID token with Google's tokeninfo endpoint
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { res.status(401).json({ error: 'Invalid Google token' }); return; }

    // Token must be issued for this app, by Google, and not expired
    if (d.aud !== clientId) { res.status(401).json({ error: 'Token audience mismatch' }); return; }
    if (d.iss !== 'accounts.google.com' && d.iss !== 'https://accounts.google.com') { res.status(401).json({ error: 'Invalid token issuer' }); return; }
    if (d.exp && (parseInt(d.exp, 10) * 1000) < Date.now()) { res.status(401).json({ error: 'Token expired' }); return; }
    if (d.email_verified !== 'true' && d.email_verified !== true) { res.status(401).json({ error: 'Google email not verified' }); return; }

    res.status(200).json({ ok: true, email: (d.email || '').toLowerCase(), name: d.name || '', picture: d.picture || '' });
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || 'Server error' });
  }
};
