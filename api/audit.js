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
    You are the official lead inspector for BandStamp (bandstamp.com). Search the web for official discography, breakup history, and current touring roster facts for the requested band.

    CRITICAL AUDIT & BASELINE RULES:
    1. DEFINITIVE CORE BASELINE:
       - Baseline members must reflect the core studio album lineup OR the iconic classic breakthrough roster that defined the band's legacy.
       - For Nirvana, the classic baseline is Kurt Cobain, Krist Novoselic, and Dave Grohl.
       - For The Rolling Stones, debut baseline = Jagger, Richards, Jones, Wyman, Watts (Ronnie Wood joined in 1975).

    2. DISBANDED BANDS & MONIKER AUDIT:
       - A band is ONLY "currently touring" if baseline members are actively performing TOGETHER UNDER THAT EXACT BAND NAME.
       - If a band ended due to death or breakup (e.g., Nirvana dissolved in 1994 following Kurt Cobain's death; The Beatles broke up in 1970; Led Zeppelin broke up in 1980), set is_currently_touring to FALSE and touring_members_present to [].
       - DO NOT claim surviving members are "still active in the band" if they are merely touring in side projects, solo acts, or other groups (e.g., Krist Novoselic or Dave Grohl playing in Foo Fighters / 3rd Secret DOES NOT mean Nirvana is touring!).

    3. SOLO MASTERMIND EXCEPTION:
       - If a project is a solo auteur vehicle (e.g., Queens of the Stone Age, Foo Fighters, Nine Inch Nails, Tame Impala), baseline them as EXACTLY 1 sole founder.

    4. EDITORIAL SUMMARY:
       - Write a 2-3 sentence audit narrative in the voice of a witty music auditor.
       - Explicitly state if the band is officially defunct/disbanded.
       - DO NOT write raw percentage figures inside the text summary.

    Return ONLY valid JSON:
    {
      "band_name": "Standardized Band Name",
      "debut_album": "Landmark Album / Era",
      "baseline_members": ["Member 1", "Member 2", "Member 3"],
      "touring_members_present": [],
      "frontman_name": "Frontman Name",
      "frontman_present": false,
      "is_currently_touring": false,
      "editorial_summary": "Witty blurb here..."
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
          { role: "user", content: `Audit the touring status and baseline lineup for: ${bandName}` }
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
