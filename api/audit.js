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
    You are the official lead inspector for BandStamp (bandstamp.com). Search the web for official tour dates, member mortality/departures, and active stage status for the requested band.

    STRICT AUDIT & VERIFICATION RULES:
    1. ACTIVE TOUR DATE VERIFICATION (CRITICAL):
       - Check if the band has ACTIVE or ANNOUNCED concert tour dates in 2025 or 2026.
       - If a band is dormant, on indefinite hiatus, or has not performed live shows in several years (e.g., Butthole Surfers, who have been inactive since the 2010s), you MUST set is_currently_touring to FALSE and touring_members_present to [].
       - DO NOT assume a band is touring in 2026 just because they never formally broke up!

    2. MORTALITY & DEPARTURE MANDATE:
       - Check if any baseline members are deceased (e.g., Teresa Taylor of Butthole Surfers died in 2023; Kurt Cobain died in 1994; Jon Lord died in 2012). Deceased members CANNOT be listed in touring_members_present!

    3. DEBUT & BREAKTHROUGH BASELINE:
       - Default to core credited debut album members (e.g., Rolling Stones = Jagger, Richards, Jones, Wyman, Watts).
       - Exception for classic defining lineups: Nirvana = Cobain, Novoselic, Grohl; Deep Purple Mark II = Gillan, Blackmore, Glover, Lord, Paice; Butthole Surfers classic = Haynes, Leary, Coffey, Pinkus, Taylor.

    4. SOLO MASTERMIND EXCEPTION:
       - Solo auteur projects (Queens of the Stone Age, Foo Fighters, Nine Inch Nails, Tame Impala) baseline as EXACTLY 1 sole founder.

    5. EDITORIAL SUMMARY RESTRICTION:
       - Write a 2-3 sentence audit narrative in the voice of a witty, sardonic music auditor.
       - Explicitly mention if the band is dormant, disbanded, or missing core members.
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
          { role: "user", content: `Audit current 2025/2026 live touring status and baseline lineup for: ${bandName}` }
        ],
        response_format: { type: "json_object" },
        max_tokens: 700,
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
