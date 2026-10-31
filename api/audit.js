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

  const { bandName } = req.body || {};
  if (!bandName) {
    return res.status(400).json({ error: 'Band name is required' });
  }

  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY environment variable is missing.' });
  }

  // System prompt focuses ONLY on pure historical data retrieval
  const systemInstruction = `
    You are a music historian data extractor for BandStamp (bandstamp.com). Extract accurate facts for the requested music band.

    DATA RETRIEVAL RULES:
    1. baseline_members: List original members credited on debut album OR classic breakthrough lineup.
    2. touring_members_present: Baseline members active in the current stage lineup (or last official tour if disbanded/retired).
    3. frontman_name: Primary iconic lead vocalist.
    4. frontman_present: Set to true if frontman performed in the evaluated touring lineup, false otherwise.
    5. is_currently_touring: true if active in 2025/2026, false if retired/disbanded.
    6. tour_context: Short descriptor (e.g. "2025/2026 Reunion Tour" or "1995 Final Tour").

    Return ONLY valid JSON:
    {
      "band_name": "Standardized Band Name",
      "baseline_members": ["Member 1", "Member 2"],
      "touring_members_present": ["Member 1"],
      "frontman_name": "Frontman Name",
      "frontman_present": true,
      "is_currently_touring": true,
      "tour_context": "2026 Tour"
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
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: `Extract band facts for: ${bandName}` }
        ],
        response_format: { type: "json_object" },
        max_tokens: 500,
        temperature: 0.0
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `OpenRouter API Error (${response.status}): ${errText}` });
    }

    const rawData = await response.json();
    let textOutput = rawData.choices[0].message.content.trim();
    const jsonMatch = textOutput.match(/\{[\s\S]*\}/);
    if (jsonMatch) textOutput = jsonMatch[0];

    const data = JSON.parse(textOutput);

    // =========================================================
    // DETERMINISTIC JAVASCRIPT MATH (Eliminates Hallucinations)
    // =========================================================
    const baselineList = data.baseline_members || [];
    const touringList = data.touring_members_present || [];
    const totalBase = baselineList.length || 1;
    const presentBase = touringList.length;

    let baseScore = Math.round((presentBase / totalBase) * 100);
    let finalScore = baseScore;
    let penaltyNotes = [];

    // 1. Frontman Tax (-30%)
    if (!data.frontman_present) {
      finalScore -= 30;
      penaltyNotes.push("a 30% penalty for missing iconic lead frontman");
    }

    // 2. Last Man Standing Cap (Max 25%)
    if (presentBase === 1 && !data.frontman_present) {
      if (finalScore > 25) {
        finalScore = 25;
        penaltyNotes.push("capped at 25% under the Last Man Standing rule");
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

    // Programmatic Summary Construction
    const tourStatusText = data.is_currently_touring
      ? `Evaluating their ${data.tour_context || 'current stage lineup'}`
      : `Evaluating their ${data.tour_context || 'last official tour'} (currently retired/inactive)`;

    const membersText = presentBase > 0 ? touringList.join(', ') : 'none';
    const penaltyText = penaltyNotes.length > 0 ? ` Applied ${penaltyNotes.join(" and ")}.` : '';

    const summary = `Baseline lineup (${totalBase} members): ${baselineList.join(', ')}. ${tourStatusText}, ${presentBase} of ${totalBase} original members performed on stage (${membersText}). Base score: (${presentBase}/${totalBase}) * 100 = ${baseScore}%.${penaltyText} Final Purity Score: ${finalScore}%.`;

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
