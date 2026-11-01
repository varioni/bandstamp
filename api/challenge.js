module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Content-Type'
  );

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { bandName, critique } = req.body || {};
  if (!bandName || !critique) {
    return res.status(400).json({ error: 'Band name and critique required.' });
  }

  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  let KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (KV_URL && KV_URL.endsWith('/')) KV_URL = KV_URL.slice(0, -1);
  const cacheKey = `band:${bandName.toLowerCase().trim().replace(/[^a-z0-9]/g, '')}`;

  // Delete cache key asynchronously
  if (KV_URL && KV_TOKEN) {
    fetch(KV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(["DEL", cacheKey])
    }).catch(e => console.warn("Cache delete error:", e.message));
  }

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY missing on Vercel.' });
  }

  const systemInstruction = `
    You are BandStamp lead inspector. Live search & re-audit ${bandName} using user critique: "${critique}".
    Fact-check this critique via live search. Adjust baseline_members, touring_members_present, or is_currently_touring if valid.
    NO numeric percentages or math inside text summary.

    Return ONLY JSON:
    {
      "band_name": "Standardized Name",
      "debut_album": "Landmark Era Title",
      "baseline_members": ["Member 1", "Member 2"],
      "touring_members_present": [],
      "frontman_name": "Frontman",
      "frontman_present": false,
      "is_currently_touring": false,
      "editorial_summary": "Witty audit blurb..."
    }
  `;

  try {
    const aiController = new AbortController();
    const aiTimer = setTimeout(() => aiController.abort(), 6500);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://bandstamp.com",
        "X-Title": "BandStamp"
      },
      body: JSON.stringify({
        model: "perplexity/sonar",
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: `Re-audit ${bandName} incorporating critique: "${critique}"` }
        ],
        response_format: { type: "json_object" },
        max_tokens: 350,
        temperature: 0.0
      }),
      signal: aiController.signal
    });
    clearTimeout(aiTimer);

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `OpenRouter Error (${response.status}): ${errText}` });
    }

    const rawData = await response.json();
    let textOutput = rawData.choices[0].message.content.trim();
    const jsonMatch = textOutput.match(/\{[\s\S]*\}/);
    if (jsonMatch) textOutput = jsonMatch[0];

    const data = JSON.parse(textOutput);

    const baselineList = data.baseline_members || [];
    let touringList = data.touring_members_present || [];
    if (data.is_currently_touring === false) touringList = [];

    const totalBase = baselineList.length || 1;
    const presentBase = touringList.length;

    let baseScore = Math.round((presentBase / totalBase) * 100);
    let finalScore = baseScore;

    if (presentBase === 0) {
      finalScore = 0;
    } else if (presentBase === 1 && !data.frontman_present) {
      finalScore = 25;
    } else if (!data.frontman_present && presentBase > 1) {
      finalScore -= 30;
    }

    finalScore = Math.max(0, Math.min(100, finalScore));

    let tier_label = "", badge_type = "";
    if (finalScore === 100) { tier_label = "Tier 1: Unbroken Circle"; badge_type = "gold"; }
    else if (finalScore >= 75) { tier_label = "Tier 2: Near-Mint Vintage"; badge_type = "green"; }
    else if (finalScore >= 50) { tier_label = "Tier 3: Co-Founder Equity"; badge_type = "yellow"; }
    else if (finalScore >= 25) { tier_label = "Tier 4: Solo Project in Disguise"; badge_type = "orange"; }
    else { tier_label = "Tier 5: The Ghost Ship (Zombie Franchise)"; badge_type = "red"; }

    const summary = data.editorial_summary || `Re-audited ${data.band_name}: ${presentBase} of ${totalBase} baseline members on stage.`;

    const resultPayload = {
      band_name: data.band_name,
      currently_touring: data.is_currently_touring,
      calculated_score: finalScore,
      tier_label: tier_label,
      badge_type: badge_type,
      summary: summary
    };

    if (KV_URL && KV_TOKEN) {
      const ttlSeconds = data.is_currently_touring ? 1209600 : 31536000;
      fetch(KV_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(["SET", cacheKey, JSON.stringify(resultPayload), "EX", ttlSeconds])
      }).catch(e => console.warn("Redis re-write warning:", e.message));
    }

    return res.status(200).json({ ...resultPayload, reaudited: true });

  } catch (err) {
    return res.status(500).json({ error: `Server Exception: ${err.message}` });
  }
};
