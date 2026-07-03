/* Bizca — serverless proxy to OpenAI Vision for business-card OCR.
   The OpenAI API key stays server-side (Vercel env var OPENAI_API_KEY).
   Never expose the key in the frontend. */

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    res.status(500).json({ error: 'OPENAI_API_KEY not configured on the server' });
    return;
  }

  try {
    // Parse body (Vercel usually populates req.body; fall back to raw stream)
    let body = req.body;
    if (!body || typeof body === 'string') {
      const raw = await new Promise((resolve, reject) => {
        let d = '';
        req.on('data', c => (d += c));
        req.on('end', () => resolve(d));
        req.on('error', reject);
      });
      body = raw ? JSON.parse(raw) : {};
    }

    const image = body.image;
    if (!image) {
      res.status(400).json({ error: 'Missing image' });
      return;
    }

    const system =
      'You extract contact data from a photo of a business card. ' +
      'Return ONLY a JSON object with exactly these keys: first, last, company, role, email, phone, website, address, country. ' +
      'Use an empty string for any field that is not present on the card. ' +
      '"country" must be the full country name in English, inferred from the address or the phone country code when not stated explicitly. ' +
      'Do not invent data that is not on the card.';

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract the business card fields as JSON.' },
              { type: 'image_url', image_url: { url: image } }
            ]
          }
        ]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      res.status(r.status).json({ error: (data.error && data.error.message) || 'OpenAI request failed' });
      return;
    }

    let parsed = {};
    try {
      parsed = JSON.parse(data.choices[0].message.content);
    } catch (e) {
      parsed = {};
    }
    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || 'Server error' });
  }
};
