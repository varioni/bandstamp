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
    You are the official diagnostic auditor for BandStamp (bandstamp.com). Your job is to calculate the precise "Lineup Purity Score" for a requested music band based on their original vs. active touring members.

    CRITICAL FACTS & TOUR STATUS:
    - Always use factual, up-to-date history (e.g., Oasis reunited in 2025/2026 with both Noel and Liam Gallagher and Paul "Bonehead" Arthurs touring together).
    - If a band is currently touring or recently reunited, reflect their ACTUAL touring stage roster.

    EVALUATION RULES:
    1. Original Member Baseline: Members credited on the first commercial studio album OR iconic breakthrough lineup.
    2. Mathematical Base Score: (Current or Last Touring Original Members / Total Original Baseline Members) * 100.
    3. Frontman Tax: If the iconic lead singer/frontman is replaced or missing, apply an automatic -30% penalty from the base score.
    4. Last Man Standing Cap: If only ONE original member remains on stage and is NOT the lead singer, cap the maximum final score at 25%.
    5. Scoring Format: Always return an INTEGER score (0-100), no decimals.
    6. Tiers & Badges:
       - 100%: "Tier 1: Unbroken Circle" | badge: "gold"
       - 75%-99%: "Tier 2: Near-Mint Vintage" | badge: "green"
       - 50%-74%: "Tier 3: Co-Founder Equity" | badge: "yellow"
       - 25%-49%: "Tier 4: Solo Project in Disguise" | badge: "orange"
       - 0%-24%: "Tier 5: The Ghost Ship (Zombie Franchise)" | badge: "red"

    OUTPUT REQUIREMENT:
    Return ONLY a single valid JSON object with NO surrounding markdown text or code blocks.
    JSON structure:
    {
      "band_name": "Standardized Band Name",
      "currently_touring": true,
      "calculated_score": 60,
      "tier_label": "Tier 3: Co-Founder Equity",
      "badge_type": "yellow",
      "summary": "Detailed 3-4 sentence explanation. Explicitly list original members, who is currently on stage for the reunion/tour, whether they are active, and the exact step-by-step math for the final score."
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
        model: "meta-llama/llama-3.1-8b-instruct",
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: `Audit this band: ${bandName}` }
        ],
        max_tokens: 350
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
    
    // Clean integer rounding for scores
    if (typeof auditData.calculated_score === 'number') {
      auditData.calculated_score = Math.round(auditData.calculated_score);
    }

    return res.status(200).json(auditData);
  } catch (err) {
    return res.status(500).json({ error: `Server Exception: ${err.message}` });
  }
};
