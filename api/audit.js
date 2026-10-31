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

  const systemInstruction = `
    You are the official diagnostic auditor for BandStamp (bandstamp.com). Calculate the "Lineup Purity Score" for a requested music band based on their original vs. active/last-known touring members.

    STEP-BY-STEP AUDIT LOGIC:
    1. Baseline Lineup: Identify core members credited on the first commercial studio album OR classic breakthrough lineup.
       (e.g., R.E.M. baseline: Michael Stipe, Peter Buck, Mike Mills, Bill Berry = 4 members).
    2. Active vs Inactive Band Check:
       - Active Bands: Evaluate their current/recent touring stage lineup.
       - Retired/Disbanded Bands (e.g., R.E.M., The Beatles, Led Zeppelin): Evaluate their LAST OFFICIAL TOURING LINEUP prior to breakup/retirement. DO NOT give 0% simply because they are currently retired.
    3. Match Count: Count how many baseline members played together in the active or last touring lineup.
       (e.g., R.E.M. last tour: Stipe, Buck, Mills present, Berry absent = 3 of 4 baseline members present).
    4. Base Score Math: (Present Baseline Members / Total Baseline Members) * 100.
    5. Frontman Penalty: If the iconic lead vocalist was missing/replaced on that tour, deduct 30% from the base score.
    6. Last Man Standing Cap: If ONLY ONE original member remained and was NOT the lead singer, cap max score at 25%.
    7. Rounding: Final score must be an INTEGER (0 to 100).

    TIERS & BADGES:
    - 100%: "Tier 1: Unbroken Circle" | badge: "gold"
    - 75%-99%: "Tier 2: Near-Mint Vintage" | badge: "green"
    - 50%-74%: "Tier 3: Co-Founder Equity" | badge: "yellow"
    - 25%-49%: "Tier 4: Solo Project in Disguise" | badge: "orange"
    - 0%-24%: "Tier 5: The Ghost Ship (Zombie Franchise)" | badge: "red"

    OUTPUT REQUIREMENT:
    Return ONLY valid JSON matching this schema:
    {
      "band_name": "Standardized Band Name",
      "currently_touring": false,
      "calculated_score": 75,
      "tier_label": "Tier 2: Near-Mint Vintage",
      "badge_type": "green",
      "summary": "Clear 2-3 sentence audit explanation explicitly naming the baseline debut lineup, their last active touring stage roster (noting that the band is currently retired/inactive), and the exact step-by-step math for the final score."
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
          { role: "user", content: `Audit this band: ${bandName}` }
        ],
        response_format: { type: "json_object" },
        max_tokens: 600,
        temperature: 0.1
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

    const auditData = JSON.parse(textOutput);

    if (typeof auditData.calculated_score === 'number') {
      auditData.calculated_score = Math.round(auditData.calculated_score);
    }

    return res.status(200).json(auditData);
  } catch (err) {
    return res.status(500).json({ error: `Server Exception: ${err.message}` });
  }
};
