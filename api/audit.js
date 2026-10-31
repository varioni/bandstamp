module.exports = async function handler(req, res) {
  // Set CORS headers so browser calls are never blocked
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

  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "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";

  const systemInstruction = `
    You are the official diagnostic auditor for BandStamp (bandstamp.com). Your job is to calculate the "Lineup Purity Score" for a requested music band based on their original vs. active touring members.

    EVALUATION RULES:
    1. Tour Status Check: Check if the band actively toured in the past 12 months or has an upcoming tour.
       - If INACTIVE (not toured in past 12 months), evaluate their LAST KNOWN TOURING LINEUP in past tense, and explicitly state in the summary that the band is not currently on tour.
    2. Original Member Baseline: Defined as members credited on the first commercial studio album OR iconic breakthrough lineup.
    3. Mathematical Base Score: (Current or Last Touring Original Members / Total Original Members) * 100.
    4. Frontman Tax: If the iconic lead singer/frontman is replaced/missing, apply an automatic -30% penalty.
    5. Last Man Standing Cap: If only ONE original member remains and is NOT the lead singer, cap the maximum score at 25%.
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
      "calculated_score": 50,
      "tier_label": "Tier 3: Co-Founder Equity",
      "badge_type": "yellow",
      "summary": "Detailed 3-4 sentence explanation. Explicitly list original members, who played on stage during the current/last tour, whether they are currently touring, and step-by-step why they received this score."
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
        model: "meta-llama/llama-3.3-70b-instruct",
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: `Audit this band: ${bandName}` }
        ]
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
    return res.status(200).json(auditData);
  } catch (err) {
    return res.status(500).json({ error: `Server Exception: ${err.message}` });
  }
};
