module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Content-Type'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { bandName, critique } = req.body || {};
  if (!bandName || !critique) {
    return res.status(400).json({ error: 'Band name and critique are required.' });
  }

  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  // Standardize Redis Key slug
  const cacheKey = `band:${bandName.toLowerCase().trim().replace(/[^a-z0-9]/g, '')}`;

  // 1. Purge existing cache entry in Upstash Redis
  if (KV_URL && KV_TOKEN) {
    try {
      await fetch(`${KV_URL}/del/${cacheKey}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
    } catch (e) {
      console.warn("Upstash cache purge error:", e.message);
    }
  }

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY environment variable is missing.' });
  }

  const systemInstruction = `
    You are the official lead inspector for BandStamp (bandstamp.com). Conduct a live search to re-audit the requested band based on user feedback.

    CRITICAL RE-AUDIT INSTRUCTIONS:
    - User Critique: "${critique}".
    - Perform a live web search to fact-check this critique. If valid, adjust baseline_members, touring_members_present, or is_currently_touring accordingly.
    - Standard BandStamp Audit Rules:
      1. DEBUT & BREAKTHROUGH BASELINE: Default to debut album core members (e.g. Rolling Stones = Jagger, Richards, Jones, Wyman, Watts). Exception for classic defining rosters (Nirvana = Cobain, Novoselic, Grohl; Deep Purple Mark II = Gillan, Blackmore, Glover, Lord, Paice).
      2. SOLO MASTERMIND EXCEPTION: Solo auteur projects (QOTSA, Foo Fighters, NIN, Tame Impala) baseline as EXACTLY 1 sole founder.
      3. HARD CROSS-CHECK MANDATE: Any baseline member mentioned as deceased, missing, or sitting out MUST be present in baseline_members and ABSENT from touring_members_present.
      4. ACTIVE TOUR DATE & MONIKER VERIFICATION: Verify active 2025/2026 tour dates under this exact band name. Defunct/disbanded bands must have is_currently_touring set to FALSE and touring_members_present set to [].
    - DO NOT write raw percentage figures or math strings in the summary text.

    Return ONLY valid JSON:
    {
      "band_name": "Standardized Band Name",
      "debut_album": "Landmark Era Title",
      "baseline_members": ["Member 1", "Member 2"],
      "touring_members_present": [],
      "frontman_name": "Frontman Name",
      "frontman_present": false,
      "is_currently_touring": false,
      "editorial_summary": "Witty audit blurb acknowledging the re-verified lineup..."
    }
  `;

  try {
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
          { role: "user", content: `Search the web and re-audit lineup for ${bandName} incorporating critique: "${critique}"` }
        ],
        response_format: { type: "json_object" },
        max_tokens: 600,
        temperature: 0.0
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `OpenRouter Error (${response.status}): ${errText}` });
    }

    const rawData = await response.json();
    let textOutput = rawData.choices[0].message.content.trim();
    const jsonMatch = textOutput.match(/\{[\s\S]*\}/);
    if (jsonMatch) textOutput = jsonMatch[0];

    const data = JSON.parse(textOutput);

    // Deterministic Math in JS
    const baselineList = data.baseline_members || [];
    let touringList = data.touring_members_present || [];

    if (data.is_currently_touring === false) {
      touringList = [];
    }

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

    let tier_label = "";
    let badge_type = "";
    if (finalScore === 100) {
      tier_label = "Tier 1: Unbroken Circle"; badge_type = "gold";
    } else if (finalScore >= 75) {
      tier_label = "Tier 2: Near-Mint Vintage"; badge_type = "green";
    } else if (finalScore >= 50) {
      tier_label = "Tier 3: Co-Founder Equity"; badge_type = "yellow";
    } else if (finalScore >= 25) {
      tier_label = "Tier 4: Solo Project in Disguise"; badge_type = "orange";
    } else {
      tier_label = "Tier 5: The Ghost Ship (Zombie Franchise)"; badge_type = "red";
    }

    const summary = data.editorial_summary || `Re-audited ${data.band_name}: ${presentBase} of ${totalBase} baseline members on stage.`;

    const resultPayload = {
      band_name: data.band_name,
      currently_touring: data.is_currently_touring,
      calculated_score: finalScore,
      tier_label: tier_label,
      badge_type: badge_type,
      summary: summary
    };

    // Save Updated Result to Upstash Redis
    if (KV_URL && KV_TOKEN) {
      try {
        const ttlSeconds = data.is_currently_touring ? 1209600 : 31536000;
        await fetch(`${KV_URL}/set/${cacheKey}/${encodeURIComponent(JSON.stringify(resultPayload))}/EX/${ttlSeconds}`, {
          headers: { Authorization: `Bearer ${KV_TOKEN}` }
        });
      } catch (e) {
        console.warn("Upstash cache re-write error:", e.message);
      }
    }

    return res.status(200).json({ ...resultPayload, reaudited: true });

  } catch (err) {
    return res.status(500).json({ error: `Server Exception: ${err.message}` });
  }
};
