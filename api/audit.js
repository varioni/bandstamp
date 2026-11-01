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
    You are the official lead inspector for BandStamp (bandstamp.com). Search the web for official discography and current touring roster facts for the requested band.

    STRICT DEBUT BASELINE RULES:
    1. STRICT DEBUT ALBUM BASELINE RULE:
       - You MUST identify the band's FIRST COMMERCIAL STUDIO ALBUM and its release year.
       - baseline_members MUST list ONLY the core musicians credited on that FIRST DEBUT ALBUM (or 1st founding release).
       - DO NOT use later "breakthrough" lineups! Famous members who joined after the debut album ARE NOT baseline members!
         * Red Hot Chili Peppers (1984 Debut): Baseline = 4 members (Anthony Kiedis, Flea, Jack Sherman, Cliff Martinez [or 1983 founders Slovak/Irons]). John Frusciante and Chad Smith joined in 1988 -> NOT debut baseline members! Active on stage today = 2 of 4 baseline members (Kiedis, Flea) = 50%.
         * The Rolling Stones (1964 Debut): Ronnie Wood joined in 1975 -> NOT a debut baseline member! Baseline = 5 members (Jagger, Richards, Jones, Wyman, Watts). Active on stage today = 2 of 5 = 40%.
         * Blink-182 (1995 Debut): Travis Barker joined in 1998 -> NOT a debut baseline member! (Scott Raynor was the debut drummer).

    2. SOLO MASTERMIND / AUTOCRATIC PROJECT EXCEPTION:
       - If a band was conceived, written, and recorded primarily as a solo auteur vehicle (e.g., Queens of the Stone Age = Josh Homme; Foo Fighters = Dave Grohl; Nine Inch Nails = Trent Reznor; Tame Impala = Kevin Parker), baseline them as EXACTLY 1 sole founder.

    3. TOURING ROSTER MATCH:
       - touring_members_present: List ONLY members from the baseline_members array who are ACTUALLY performing on stage for current/recent tour dates.
       - If retired/disbanded (e.g., The Beatles, Led Zeppelin, R.E.M.), set is_currently_touring to FALSE and touring_members_present to [].

    4. FRONTMAN AUDIT:
       - frontman_name: Iconic primary lead vocalist from debut era.
       - frontman_present: true if lead vocalist performs on stage today, false otherwise.

    5. EDITORIAL SUMMARY:
       - Write a 2-3 sentence audit narrative in the voice of a witty music auditor. Mention the debut album/year, explicitly state who from that original debut remains on stage vs who joined later, and explain the purity score. DO NOT write raw math formulas like "(2/4)*100=50%".

    Return ONLY valid JSON:
    {
      "band_name": "Standardized Band Name",
      "debut_album": "Debut Album Title (Year)",
      "baseline_members": ["Member 1", "Member 2"],
      "touring_members_present": ["Member 1"],
      "frontman_name": "Frontman Name",
      "frontman_present": true,
      "is_currently_touring": true,
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
          { role: "user", content: `Audit the debut vs current touring lineup for: ${bandName}` }
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

    const summary = data.editorial_summary || `Auditing ${data.band_name}: ${presentBase} of ${totalBase} debut baseline members performed on stage.`;

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
