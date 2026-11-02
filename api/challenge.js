module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Content-Type'
  );

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { bandName, critique } = req.body || {};
  if (!bandName || !critique) {
    return res.status(400).json({ error: 'Band name and critique are required' });
  }

  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  let KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (KV_URL && !KV_URL.startsWith('http')) KV_URL = null;
  if (KV_URL && KV_URL.endsWith('/')) KV_URL = KV_URL.slice(0, -1);

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY missing in Vercel environment variables.' });
  }

  const systemInstruction = `
    You are BandStamp lead inspector reviewing a user challenge for: ${bandName}.
    User critique: "${critique}".

    STRICT RE-AUDIT RULES:
    1. FUTURE TOUR CHECK: If no active/upcoming tour exists under this band name, set is_currently_touring = false and touring_members_present = [].

    2. EDITORIAL SUMMARY FORMAT (BRANCHING LOGIC):
       IF IS_CURRENTLY_TOURING = FALSE:
       - Do NOT list "**On stage:**" or "**Absent/Missing:**" rosters.
       - Write 2 short paragraphs explaining that the band is not touring.

       IF IS_CURRENTLY_TOURING = TRUE:
       - Paragraph 1: 1-2 short sentences max confirming active tour status. STRICTLY FORBIDDEN: Do NOT list cities, venue names, or date itineraries.
       - Paragraph 2: Roster breakdown:
         "**On stage:** [Full Name (Instrument - Role)] joined by [Full Name (Instrument - Replacement)].\\n\\n**Absent/Missing:** [Full Name (Instrument - Role) OR 'None']."
       - Paragraph 3: 2 sentences of direct, energetic Pitchfork-style verdict.

    3. STRICT FORBIDDEN ITEMS:
       - NEVER list venue names, city lists, or date itineraries.
       - NEVER write florid poetic clichés.
       - NEVER output bracketed citations like [1], [2], [8], or reference URLs.

    CRITICAL: Output MUST be valid single-line raw JSON only without markdown formatting:
    {
      "band_name": "Standardized Name",
      "debut_album": "Landmark Album/Era",
      "baseline_members": ["Member 1", "Member 2"],
      "touring_members_present": [],
      "frontman_name": "Original Lead Singer",
      "frontman_present": false,
      "is_currently_touring": false,
      "editorial_summary": "Short paragraph 1\\n\\n**On stage:** ...\\n\\n**Absent/Missing:** ...\\n\\nShort paragraph 3..."
    }
  `;

  let aiTimer;
  try {
    const aiController = new AbortController();
    aiTimer = setTimeout(() => aiController.abort(), 20000);

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
          { role: "user", content: `Re-evaluate lineup for ${bandName} considering critique: ${critique}` }
        ],
        max_tokens: 800,
        temperature: 0.0
      }),
      signal: aiController.signal
    });
    clearTimeout(aiTimer);

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `OpenRouter Error: ${errText}` });
    }

    const rawData = await response.json();
    let textOutput = rawData.choices[0]?.message?.content?.trim() || "";
    textOutput = textOutput.replace(/```json/gi, '').replace(/```/g, '').trim();
    textOutput = textOutput.replace(/\[\d+\]/g, '');

    const firstBrace = textOutput.indexOf('{');
    const lastBrace = textOutput.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      textOutput = textOutput.substring(firstBrace, lastBrace + 1);
    }

    textOutput = textOutput.replace(/(\r\n|\n|\r)/g, "\\n");

    let data;
    try {
      data
