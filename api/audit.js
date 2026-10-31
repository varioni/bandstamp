module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Content-Type'
  );
  
  // Cache audit responses at Vercel's Edge CDN for 12 hours
  res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=21600');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { bandName } = req.body || {};
  if (!bandName) {
    return res.status(400).json({ error: 'Band name is required' });
  }

  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY environment variable is missing.' });
  }

  const systemInstruction = `
    You are the official lead inspector for BandStamp (bandstamp.com). Search the web for active touring news, stage rosters, hiatuses, and departure facts for the requested band.

    CRITICAL RULES & DISBANDED BAND PROTOCOL:
    1. DISBANDED/RETIRED BANDS (e.g. The Beatles, Led Zeppelin, Nirvana, Talking Heads, R.E.M.):
       - Set is_currently_touring to FALSE.
       - DO NOT invent or fabricate active 2025/2026 tours for defunct bands just because surviving members tour solo.
       - Evaluate their LAST OFFICIAL FULL-BAND TOUR prior to breakup/retirement (e.g., The Beatles' 1966 final tour featured ALL 4 core members: John Lennon, Paul McCartney, George Harrison, Ringo Starr).
    2. baseline_members: Include ALL primary founding members AND iconic core breakthrough era members.
    3. touring_members_present: List ONLY baseline_members who actually performed on stage during the evaluated tour (the current 2025/2026 tour for active bands, or the last official tour for defunct bands).
    4. CROSS-CHECK MANDATE: Any baseline or long-standing core member mentioned as missing or departed in editorial_summary MUST be in baseline_members and ABSENT from touring_members_present.
    5. frontman_name: Primary lead singer.
    6. frontman_present: true if frontman performed on the evaluated tour, false otherwise.
    7. tour_context: Short descriptor (e.g. "2026 Tour" or "1966 Final Tour").
    8. editorial_summary: A punchy 2-3 sentence audit narrative in the voice of a witty music auditor. Note tour status, who was on stage, and who was missing. DO NOT write raw math equations like "(4/4)*100=100%".

    Return ONLY valid JSON matching this schema:
    {
      "band_name": "Standardized Band Name",
      "baseline_members": ["Member 1", "Member 2"],
      "touring_members_present": ["Member 1", "Member 2"],
      "frontman_name": "Frontman Name",
      "frontman_present": true,
      "is_currently_touring": true,
      "tour_context": "2026 Tour",
      "editorial_summary": "Witty audit blurb here..."
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
        model: "openai/gpt-4o-mini",
        plugins: [{ id: "web" }],
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: `Audit the touring lineup for: ${bandName}` }
        ],
        response_format: { type: "json_object" },
        max_tokens: 700,
        temperature: 0.1
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
    const touringList = data.touring_members_present || [];
    const totalBase = baselineList.length || 1;
    const presentBase = touringList.length;

    let baseScore = Math.round((presentBase / totalBase) * 100);
    let finalScore = baseScore;

    // 1. Frontman Tax (-30%)
    if (!data.frontman_present) {
      finalScore -= 30;
    }

    // 2. Last Man Standing Cap (Max 25%)
    if (presentBase === 1 && !data.frontman_present) {
      if (finalScore > 25) {
        finalScore = 25;
      }
    }

    // Clamp score between 0% and 100%
    finalScore = Math.max(0, Math.min(100, finalScore));

    // Assign Official Tiers
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

    const summary = data.editorial_summary || `Auditing ${data.band_name}: ${presentBase} of ${totalBase} baseline members performed on stage.`;

    return res.status(200).json({
      band_name: data.band_name,
      currently_touring: data.is_currently_touring,
      calculated_score: finalScore,
      tier_label: tier_label,
      badge_type: badge_type,
      summary: summary
    });

  } catch (err) {
    return res.status(500).json({ error: `Server Exception: ${err.message}` });
  }
};
