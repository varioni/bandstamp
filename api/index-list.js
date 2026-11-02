module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (KV_URL && !KV_URL.startsWith('http')) KV_URL = null;
  if (KV_URL && KV_URL.endsWith('/')) KV_URL = KV_URL.slice(0, -1);

  if (!KV_URL || !KV_TOKEN) {
    return res.status(200).json({ bands: [] });
  }

  try {
    // 1. Get all active touring band cache keys from Redis set
    const membersRes = await fetch(`${KV_URL}/smembers/active_bands`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    
    let keys = [];
    if (membersRes.ok) {
      const membersData = await membersRes.json();
      keys = membersData.result || [];
    }

    // Fallback to pattern matching if active_bands set is empty
    if (keys.length === 0) {
      const keysRes = await fetch(`${KV_URL}/keys/band:*`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      if (keysRes.ok) {
        const keysData = await keysRes.json();
        keys = keysData.result || [];
      }
    }

    if (keys.length === 0) return res.status(200).json({ bands: [] });

    // 2. Fetch all band payloads from Redis
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
            if (parsed.currently_touring) {
              bands.push(parsed);
            }
          }
        }
      } catch (e) {
        console.warn("Error reading key:", key, e.message);
      }
    }

    // 3. Sort descending by calculated score
    bands.sort((a, b) => b.calculated_score - a.calculated_score);

    return res.status(200).json({ bands });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
