module.exports = async function handler(req, res) {
  // CORS & Edge Caching Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Content-Type'
  );
  
  // Edge Caching: 12 Hours
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
    You are the official lead inspector for BandStamp (bandstamp.com). Perform live web searches to verify official discography, lineup changes, hiatuses, and active touring status for the requested band.

    CRITICAL AUDIT & BASELINE RULES:
    1. DEBUT BASELINE DEFAULT:
       - By default, baseline_members MUST list ONLY core members credited on the FIRST COMMERCIAL DEBUT ALBUM (e.g., Rolling Stones = Jagger, Richards, Jones, Wyman, Watts [Ronnie Wood joined in 1975]; RHCP = Kiedis, Flea, Jack Sherman, Cliff Martinez or 1983 founders Slovak/Irons [Frusciante/Smith joined in 1988]).

    2. BREAKTHROUGH ROSTER CLAUSE (EXCEPTION TO RULE 1):
       - If an early replacement member permanently defined the band's signature classic legacy, include them in the classic baseline roster:
         * Nirvana = Kurt Cobain, Krist Novoselic, Dave Grohl
         * Deep Purple (Mark II) = Ian Gillan, Ritchie Blackmore, Roger Glover, Jon Lord, Ian Paice
         * Blink-182 = Mark Hoppus, Tom DeLonge, Travis Barker

    3. SOLO MASTERMIND EXCEPTION:
       - If a project is a solo auteur vehicle (e.g., Queens of the Stone Age = Josh Homme; Foo Fighters = Dave Grohl; Nine Inch Nails = Trent Reznor; Tame Impala = Kevin Parker), baseline them as EXACTLY 1 sole founder. Ignore studio session musicians or hired drummers.

    4. HARD CROSS-CHECK MANDATE:
       - ANY core member you mention as deceased, missing, sitting out, or replaced in editorial_summary MUST be present in baseline_members and ABSENT from touring_members_present.

    5. DISBANDED BANDS & MONIKER RULE:
       - A band is ONLY "is_currently_touring: true" if baseline members perform TOGETHER UNDER THAT EXACT BAND NAME in 2025/2026.
       - Defunct/disbanded groups (Nirvana, The Beatles, Led Zeppelin, R.E.M.) MUST have is_currently_touring set to FALSE and touring_members_present set to [].
       - Surviving members touring in solo projects or other bands DOES NOT count towards active touring status!

    6. EDITORIAL SUMMARY RESTRICTION:
       - Write a 2-3 sentence audit narrative in the voice of a witty, sardonic music auditor.
       - DO NOT write specific numeric percentage figures or raw math equations in the summary text (e.g. do NOT write "giving them a score of 25%").

    Return ONLY valid JSON matching this schema:
    {
      "band_name": "Standardized Band Name",
      "debut_album": "Debut / Landmark Era Title",
      "baseline_members": ["Member 1", "Member 2"],
      "touring_members_present": ["Member 1"],
      "frontman_name": "Frontman Name",
      "frontman_present": true,
      "is_currently_touring": true,
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
          { role: "user", content: `Audit the touring lineup and baseline roster for: ${bandName}` }
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
      // Last Man Standing Rule: Lock at 25% when 1 non-frontman original member remains
      finalScore = 25;
    } else if (!data.frontman_present && presentBase > 1) {
      // Frontman Tax (-30%) applies when multiple original members tour without lead singer
      finalScore -= 30;
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
