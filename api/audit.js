module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Content-Type'
  );
  
  res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=21600');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { bandName } = req.body || {};
  if (!bandName) return res.status(400).json({ error: 'Band name is required' });

  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  
  let KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (KV_URL && !KV_URL.startsWith('http')) KV_URL = null;
  if (KV_URL && KV_URL.endsWith('/')) KV_URL = KV_URL.slice(0, -1);

  const cacheKey = `band:${bandName.toLowerCase().trim().replace(/[^a-z0-9]/g, '')}`;

  if (KV_URL && KV_TOKEN) {
    try {
      const kvController = new AbortController();
      const kvTimer = setTimeout(() => kvController.abort(), 600);

      const cacheRes = await fetch(`${KV_URL}/get/${cacheKey}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
        signal: kvController.signal
      });
      clearTimeout(kvTimer);

      if (cacheRes.ok) {
        const cacheData = await cacheRes.json();
        if (cacheData.result) {
          const cachedJson = typeof cacheData.result === 'string' ? JSON.parse(cacheData.result) : cacheData.result;
          return res.status(200).json({ ...cachedJson, cached: true });
        }
      }
    } catch (e) {
      console.warn("Cache read skipped:", e.message);
    }
  }

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY missing in Vercel environment variables.' });
  }

  const systemInstruction = `
    You are BandStamp lead inspector. Search the web for UPCOMING/FUTURE live tour dates and active stage lineup for: ${bandName}.

    STRICT AUDIT RULES:
    1. FUTURE TOUR CHECK: Search for upcoming/future announced shows relative to today. If no future tour dates exist or the band is defunct/dormant, set is_currently_touring = false and touring_members_present = [].
    
    2. MEMBER AUDIT MANDATE: 
       - Identify the baseline classic/landmark members.
       - Identify who among them is physically performing on stage for upcoming dates.
       - Identify who is missing, deceased, or studio-only, and name their live touring replacements.
       - Replacement musicians are NOT baseline members, so they CANNOT count toward touring_members_present.

    3. EDITORIAL SUMMARY FORMAT (3 to 5 full sentences):
       - Sentence 1: Upcoming tour status and context (or explicit notice that no future shows are scheduled).
       - Sentences 2-3: Explicitly name who is physically on stage vs. who is absent/replaced (e.g., "Original members on stage include [Names]. Missing from the lineup are [Names], with [Replacements] filling the seats.").
       - Sentences 4-5: Sharp, sardonic BandStamp editorial verdict on ticket authenticity and whether buyers are getting the real deal.

    4. NO META-COMMENTARY OR MATH: Do NOT write "Audit note:", "Audit corrected:", or raw percentage figures inside editorial_summary text.

    CRITICAL: Output MUST be valid raw JSON only:
    {
      "band_name": "Standardized Name",
      "debut_album": "Landmark Album/Era",
      "baseline_members": ["Member 1", "Member 2"],
      "touring_members_present": [],
      "frontman_name": "Original Lead Singer",
      "frontman_present": false,
      "is_currently_touring": true,
      "editorial_summary": "3 to 5 sentence detailed paragraph explicitly naming on-stage vs missing members and editorial verdict..."
    }
  `;

  let aiTimer;
  try {
    const aiController = new AbortController();
    aiTimer = setTimeout(() => aiController.abort(), 20000);

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
          { role: "user", content: `Search upcoming future tour dates and touring lineup for: ${bandName}` }
        ],
        max_tokens: 500,
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

    const summary = data.editorial_summary || `Auditing ${data.band_name}: ${presentBase} of ${totalBase} baseline members on stage.`;

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
      fetch(`${KV_URL}/set/${cacheKey}/${encodeURIComponent(JSON.stringify(resultPayload))}?EX=${ttlSeconds}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      }).catch(e => console.warn("Redis write warning:", e.message));
    }

    return res.status(200).json({ ...resultPayload, cached: false });

  } catch (err) {
    if (aiTimer) clearTimeout(aiTimer);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: "Audit request timed out searching web." });
    }
    return res.status(500).json({ error: `Server Exception: ${err.message}` });
  }
};
