module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (KV_URL && !KV_URL.startsWith('http')) KV_URL = null;
  if (KV_URL && KV_URL.endsWith('/')) KV_URL = KV_URL.slice(0, -1);

  if (!KV_URL || !KV_TOKEN) {
    return res.status(200).json({ bands: [] });
  }

  try {
    // 1. Fetch all keys stored in Redis starting with 'band:'
    const keysRes = await fetch(`${KV_URL}/keys/band:*`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    
    if (!keysRes.ok) return res.status(200).json({ bands: [] });
    const keysData = await keysRes.json();
    const keys = keysData.result || [];

    if (keys.length === 0) return res.status(200).json({ bands: [] });

    // 2. Fetch payloads for all cached bands
    const bands = [];
    for (const key of keys) {
      try {
        const getRes = await fetch(`${KV_URL}/get/${key}`, {
          headers: { Authorization: `Bearer ${KV_TOKEN}` }
        });
        if (getRes.ok) {
          const item = await getRes.json();
          if (item.result) {
            const parsed = typeof item.result === 'string' ? JSON.parse(item.result) : item.result;
            // Filter: Only include active touring bands
            if (parsed.currently_touring) {
              bands.push(parsed);
            }
          }
        }
      } catch (e) {
        console.warn("Error reading key:", key, e.message);
      }
    }

    // 3. Stack rank descending by calculated_score
    bands.sort((a, b) => b.calculated_score - a.calculated_score);

    return res.status(200).json({ bands });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
