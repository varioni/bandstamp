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
    return res.status(400).json({ error: 'Band name and critique are required' });
  }

  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  let KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (KV_URL && !KV_URL.startsWith('http')) KV_URL = null;
  if (KV_URL && KV_URL.endsWith('/')) KV_URL = KV_URL.slice(0, -1);

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY missing in Vercel environment variables.' });
  }

  const systemInstruction = `
    You are BandStamp lead inspector reviewing a user challenge for: ${bandName}.
    User critique: "${critique}".

    STRICT RE-AUDIT RULES:
    1. FUTURE TOUR CHECK: If no active/upcoming tour exists under this band name, set is_currently_touring = false and touring_members_present = [].

    2. EDITORIAL SUMMARY FORMAT (BRANCHING LOGIC):
       IF IS_CURRENTLY_TOURING = FALSE:
       - Do NOT list "On stage:" or "Absent/Missing:" rosters.
       - Write 2 short paragraphs explaining that the band is not touring, where surviving founders are now, and a brief Pitchfork closing statement.

       IF IS_CURRENTLY_TOURING = TRUE:
       - Write 3 structured paragraphs including explicit "On stage:" and "Absent/Missing:" role breakdowns and a 2-sentence verdict.

    3. STRICT FORBIDDEN ITEMS:
       - NEVER output raw literal line breaks inside JSON strings. Use \\n\\n instead.
       - NEVER write florid poetic clichés ("corporate chassis humming", "real alchemy", "museum-piece cosplay").
       - NEVER output bracketed citations like [1], [2], [8], or reference URLs.

    CRITICAL: Output MUST be valid single-line raw JSON only without markdown formatting:
    {
      "band_name": "Standardized Name",
      "debut_album": "Landmark Album/Era",
      "baseline_members": ["Member 1", "Member 2"],
      "touring_members_present": [],
      "frontman_name": "Original Lead Singer",
      "frontman_present": false,
      "is_currently_touring": false,
      "editorial_summary": "Short paragraph 1\\n\\nShort paragraph 2..."
    }
  `;

  let aiTimer;
  try {
    const aiController = new AbortController();
    aiTimer = setTimeout(() => aiController.abort(), 20000);

    const openRouterEndpoint = "https://openrouter.ai/api/v1/chat/completions";

    const response = await fetch(openRouterEndpoint, {
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
          { role: "user", content: `Re-evaluate lineup for ${bandName} considering critique: ${critique}` }
        ],
        max_tokens: 800,
        temperature: 0.0
      }),
      signal: aiController.signal
    });
    clearTimeout(aiTimer);

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `OpenRouter Error: ${errText}` });
    }

    const rawData = await response.json();
    let textOutput = rawData.choices[0].message.content.trim();
    textOutput = textOutput.replace(/```json/gi, '').replace(/```/g, '').trim();
    textOutput = textOutput.replace(/\[\d+\]/g, '');

    const firstBrace = textOutput.indexOf('{');
    const lastBrace = textOutput.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      textOutput = textOutput.substring(firstBrace, lastBrace + 1);
    }

    textOutput = textOutput.replace(/(\r\n|\n|\r)/g, "\\n");

    let data;
    try {
      data = JSON.parse(textOutput);
    } catch (parseErr) {
      if (!textOutput.endsWith('"}') && !textOutput.endsWith('}')) {
        textOutput += '"}';
      }
      data = JSON.parse(textOutput);
    }

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
      finalScore -= 10;
    }

    finalScore = Math.max(0, Math.min(100, finalScore));

    let tier_label = "", badge_type = "";

    if (data.is_currently_touring === false) {
      tier_label = "Currently Not Touring";
      badge_type = "black";
      finalScore = 0;
    } else if (finalScore === 100) { 
      tier_label = "Tier 1: Unbroken Circle"; 
      badge_type = "gold"; 
    } else if (finalScore >= 75) { 
      tier_label = "Tier 2: Near-Mint Vintage"; 
      badge_type = "green"; 
    } else if (finalScore >= 50) { 
      tier_label = "Tier 3: Co-Founder Equity"; 
      badge_type = "yellow"; 
    } else if (finalScore >= 25) { 
      tier_label = "Tier 4: Solo Project in Disguise"; 
      badge_type = "orange"; 
    } else { 
      tier_label = "Tier 5: The Ghost Ship (Zombie Franchise)"; 
      badge_type = "red"; 
    }

    let summary = (data.editorial_summary || `Updated audit for ${data.band_name}: ${presentBase} of ${totalBase} baseline members on stage.`).replace(/\[\d+\]/g, '');

    const resultPayload = {
      band_name: data.band_name,
      currently_touring: data.is_currently_touring,
      calculated_score: finalScore,
      tier_label: tier_label,
      badge_type: badge_type,
      summary: summary
    };

    const cacheKey = `band:${bandName.toLowerCase().trim().replace(/[^a-z0-9]/g, '')}`;
    if (KV_URL && KV_TOKEN) {
      const ttlSeconds = data.is_currently_touring ? 1209600 : 31536000;
      fetch(`${KV_URL}/set/${cacheKey}/${encodeURIComponent(JSON.stringify(resultPayload))}?EX=${ttlSeconds}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      }).catch(e => console.warn("Redis write warning:", e.message));
    }

    return res.status(200).json({ ...resultPayload, cached: false });

  } catch (err) {
    if (aiTimer) clearTimeout(aiTimer);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: "Challenge evaluation timed out." });
    }
    return res.status(500).json({ error: `Server Exception: ${err.message}` });
  }
};
