module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  // Cache at Vercel Edge for 60 seconds to slash Redis reads during traffic spikes
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN;

  if (KV_URL && !KV_URL.startsWith('http')) KV_URL = `https://${KV_URL}`;
  if (KV_URL && KV_URL.endsWith('/')) KV_URL = KV_URL.slice(0, -1);

  if (!KV_URL || !KV_TOKEN) {
    return res.status(200).json({ bands: [] });
  }

  try {
    // 1. Fetch both the active_bands set AND all band:* keys to ensure older audits are never orphaned
    const [membersRes, keysRes] = await Promise.all([
      fetch(`${KV_URL}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KV_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['SMEMBERS', 'active_bands'])
      }),
      fetch(`${KV_URL}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KV_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['KEYS', 'band:*'])
      })
    ]);

    let activeSetKeys = [];
    if (membersRes.ok) {
      const membersData = await membersRes.json();
      activeSetKeys = membersData.result || [];
    }

    let allBandKeys = [];
    if (keysRes.ok) {
      const keysData = await keysRes.json();
      allBandKeys = keysData.result || [];
    }

    // Merge and deduplicate keys
    const mergedKeys = Array.from(new Set([...activeSetKeys, ...allBandKeys]));

    if (mergedKeys.length === 0) return res.status(200).json({ bands: [] });

    // 2. BATCH MGET: Fetch ALL band objects in 1 single command
    const mgetRes = await fetch(`${KV_URL}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['MGET', ...mergedKeys])
    });

    const bands = [];
    const missingFromSet = [];

    if (mgetRes.ok) {
      const mgetData = await mgetRes.json();
      const rawResults = mgetData.result || [];

      for (let i = 0; i < rawResults.length; i++) {
        const item = rawResults[i];
        const key = mergedKeys[i];
        if (!item) continue;

        try {
          const parsed = typeof item === 'string' ? JSON.parse(item) : item;
          if (parsed.currently_touring && parsed.calculated_score >= 0) {
            bands.push(parsed);
            if (!activeSetKeys.includes(key)) {
              missingFromSet.push(key);
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }

    // 3. Auto-heal: Backfill any older active bands into the active_bands set
    if (missingFromSet.length > 0) {
      fetch(`${KV_URL}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KV_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['SADD', 'active_bands', ...missingFromSet])
      }).catch(() => {});
    }

    // 4. Sort descending by calculated score
    bands.sort((a, b) => b.calculated_score - a.calculated_score);

    return res.status(200).json({ bands });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
