/* Bizca — password check for email sign-in.
   The shared password stays server-side (Vercel env var BIZCA_APP_PASSWORD),
   so it is never exposed in the public front-end code. */

function readRaw(req) {
  return new Promise((resolve, reject) => { let d = ''; req.on('data', c => (d += c)); req.on('end', () => resolve(d)); req.on('error', reject); });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const expected = process.env.BIZCA_APP_PASSWORD;
  if (!expected) { res.status(500).json({ error: 'Sign-in not configured — set BIZCA_APP_PASSWORD on the server' }); return; }
  try {
    let body = req.body;
    if (!body || typeof body === 'string') { const raw = await readRaw(req); body = raw ? JSON.parse(raw) : {}; }
    const password = String(body.password || '');
    res.status(200).json({ ok: password === expected });
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || 'Server error' });
  }
};
