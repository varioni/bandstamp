module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Content-Type'
  );
  
  res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=21600');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { bandName } = req.body || {};
  if (!bandName) return res.status(400).json({ error: 'Band name is required' });

  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  
  let KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (KV_URL && !KV_URL.startsWith('http')) KV_URL = null;
  if (KV_URL && KV_URL.endsWith('/')) KV_URL = KV_URL.slice(0, -1);

  const cacheKey = `band:${bandName.toLowerCase().trim().replace(/[^a-z0-9]/g, '')}`;

  if (KV_URL && KV_TOKEN) {
    try {
      const kvController = new AbortController();
      const kvTimer = setTimeout(() => kvController.abort(), 600);

      const cacheRes = await fetch(`${KV_URL}/get/${cacheKey}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
        signal: kvController.signal
      });
      clearTimeout(kvTimer);

      if (cacheRes.ok) {
        const cacheData = await cacheRes.json();
        if (cacheData.result) {
          const cachedJson = typeof cacheData.result === 'string' ? JSON.parse(cacheData.result) : cacheData.result;
          return res.status(200).json({ ...cachedJson, cached: true });
        }
      }
    } catch (e) {
      console.warn("Cache read skipped:", e.message);
    }
  }

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY missing in Vercel environment variables.' });
  }

  const systemInstruction = `
    You are BandStamp lead inspector—a sharp, energetic, Pitchfork-style rock music critic. 
    Audit the live lineup authenticity for: ${bandName}.

    STRICT AUDIT & ACCURACY RULES:
    1. HISTORICAL BASELINE MANDATE:
       - Define the definitive, classic breakthrough / peak commercial lineup for ${bandName}.
       - For classic acts (e.g. The Offspring), baseline_members MUST include all classic core members (e.g. Dexter Holland, Noodles, Greg K., Ron Welty).
       - Never restrict baseline_members to only the currently active touring members.

    2. ZERO-FOUNDER / STAGE AUDIT MANDATE:
       - touring_members_present MUST ONLY contain classic baseline members who are physically performing on stage right now. 
       - Replacement or touring musicians (e.g. Todd Morse, Jonah Nimoy, Brandon Pertzborn) DO NOT count in touring_members_present.
       - If classic members are absent (e.g. Noodles taking a leave, Greg K. fired), they MUST be listed under Absent/Missing.

    3. EDITORIAL SUMMARY FORMAT (BRANCHING LOGIC):

       IF IS_CURRENTLY_TOURING = FALSE (SHORT 2-PARAGRAPH SUMMARY):
       - STRICTLY FORBIDDEN: Do NOT include "**On stage:**" or "**Absent/Missing:**" roster breakdowns.
       - Paragraph 1 (1-2 short sentences): Confirm there are no active tour dates.
       - Paragraph 2 (1 short sentence): Direct Pitchfork-style closing statement.

       IF IS_CURRENTLY_TOURING = TRUE (MANDATORY 3 PARAGRAPHS SEPARATED BY \\n\\n):
       - Paragraph 1: 1-2 short sentences max confirming active tour status. STRICTLY FORBIDDEN: Do NOT list cities, venue names, or date itineraries.
       - Paragraph 2 (LINEUP BREAKDOWN):
         "**On stage:** [Names and annotated roles]\\n\\n**Absent/Missing:** [Classic baseline members not present OR 'None']."
       - Paragraph 3: 2 sentences of sharp, energetic Pitchfork-style verdict.

    4. STRICT FORBIDDEN ITEMS:
       - NEVER output 100% purity if key classic members are missing under Absent/Missing.
       - NEVER list venue names, city lists, or date itineraries.
       - NEVER output raw literal line breaks inside JSON strings. Use \\n\\n instead.
       - NEVER output bracketed citations like [1], [2], [8], or reference URLs.

    CRITICAL: Output MUST be valid single-line raw JSON only without markdown formatting:
    {
      "band_name": "Standardized Name",
      "debut_album": "Landmark Album/Era",
      "baseline_members": ["Dexter Holland", "Noodles", "Greg K."],
      "touring_members_present": ["Dexter Holland"],
      "zero_classic_members_on_stage": false,
      "frontman_name": "Dexter Holland",
      "frontman_present": true,
      "is_currently_touring": true,
      "editorial_summary": "Short paragraph 1\\n\\n**On stage:** ...\\n\\n**Absent/Missing:** ...\\n\\nShort paragraph 3..."
    }
  `;

  let aiTimer;
  try {
    const aiController = new AbortController();
    aiTimer = setTimeout(() => aiController.abort(), 20000);

    const openRouterEndpoint = "https://openrouter.ai/api/v1/chat/completions";

    const response = await fetch(openRouterEndpoint, {
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
          { role: "user", content: `Perform lineup accuracy audit and search active tour dates for: ${bandName}` }
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
      data = JSON.parse(textOutput);
    } catch (parseErr) {
      if (!textOutput.endsWith('"}') && !textOutput.endsWith('}')) {
        textOutput += '"}';
      }
      try {
        data = JSON.parse(textOutput);
      } catch (secondErr) {
        data = {
          band_name: bandName,
          baseline_members: [],
          touring_members_present: [],
          zero_classic_members_on_stage: false,
          frontman_present: false,
          is_currently_touring: true,
          editorial_summary: `Lineup inspection completed for ${bandName}.`
        };
      }
    }

    let baselineList = data.baseline_members || [];
    let touringList = data.touring_members_present || [];
    let summaryText = data.editorial_summary || '';

    // HARD GUARDRAIL: Cross-verify Absent/Missing text against touring payload
    const absentMatch = summaryText.match(/Absent\/Missing:\s*([^.\n]+)/i);
    if (absentMatch) {
      const absentSection = absentMatch[1].trim();
      if (!absentSection.toLowerCase().includes('none')) {
        // If Absent/Missing names members, filter out those members from touringList
        touringList = touringList.filter(m => {
          const mName = m.toLowerCase();
          return !absentSection.toLowerCase().includes(mName);
        });
        
        // Ensure baseline includes missing members if AI omitted them from baseline
        if (touringList.length === baselineList.length && baselineList.length > 0) {
          baselineList.push("Missing Core Member");
        }
      }
    }

    if (data.is_currently_touring === false || data.zero_classic_members_on_stage === true) {
      touringList = [];
    }

    const totalBase = baselineList.length || 1;
    const presentBase = touringList.length;

    let baseScore = Math.round((presentBase / totalBase) * 100);
    let finalScore = baseScore;

    if (presentBase === 0 || data.zero_classic_members_on_stage === true) {
      finalScore = 0;
    } else if (presentBase === 1 && !data.frontman_present) {
      finalScore = 25;
    } else if (!data.frontman_present && presentBase > 1) {
      finalScore -= 10;
    }

    finalScore = Math.max(0, Math.min(100, finalScore));

    let tier_label = "", badge_type = "";

    if (data.is_currently_touring === false) {
      tier_label = "Currently Not Touring";
      badge_type = "black";
      finalScore = 0;
    } else if (finalScore === 100) { 
      tier_label = "Tier 1: Unbroken Circle"; 
      badge_type = "gold"; 
    } else if (finalScore >= 75) { 
      tier_label = "Tier 2: Near-Mint Vintage"; 
      badge_type = "green"; 
    } else if (finalScore >= 50) { 
      tier_label = "Tier 3: Co-Founder Equity"; 
      badge_type = "yellow"; 
    } else if (finalScore >= 25) { 
      tier_label = "Tier 4: Solo Project in Disguise"; 
      badge_type = "orange"; 
    } else { 
      tier_label = "Tier 5: The Ghost Ship (Zombie Franchise)"; 
      badge_type = "red"; 
    }

    let summary = summaryText.replace(/\[\d+\]/g, '');

    const resultPayload = {
      band_name: data.band_name || bandName,
      currently_touring: data.is_currently_touring,
      calculated_score: finalScore,
      tier_label: tier_label,
      badge_type: badge_type,
      summary: summary
    };

    if (KV_URL && KV_TOKEN) {
      const ttlSeconds = data.is_currently_touring ? 1209600 : 31536000;
      fetch(`${KV_URL}/set/${cacheKey}/${encodeURIComponent(JSON.stringify(resultPayload))}?EX=${ttlSeconds}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
        method: 'POST',
        body: JSON.stringify(resultPayload)
      }).catch(e => console.warn("Redis write warning:", e.message));

      if (data.is_currently_touring) {
        fetch(`${KV_URL}/sadd/active_bands/${encodeURIComponent(cacheKey)}`, {
          headers: { Authorization: `Bearer ${KV_TOKEN}` }
        }).catch(e => console.warn("Redis index error:", e.message));
      }
    }

    return res.status(200).json({ ...resultPayload, cached: false });

  } catch (err) {
    if (aiTimer) clearTimeout(aiTimer);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: "Audit request timed out searching web." });
    }
    return res.status(500).json({ error: `Server Exception: ${err.message}` });
  }
};
