const { isValidBandName, checkRateLimit } = require('./utils');

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
  
  // 1. Validate Input Strings
  if (!bandName || !isValidBandName(bandName)) {
    return res.status(400).json({ error: 'Invalid band name submitted.' });
  }

  if (!critique || typeof critique !== 'string' || critique.trim().length < 5 || critique.trim().length > 300) {
    return res.status(400).json({ error: 'Please provide a meaningful challenge description (5-300 characters).' });
  }

  // 2. Enforce IP Rate Limit (Max 5 total challenges per IP per hour)
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const rateCheck = await checkRateLimit(clientIp, 'challenge', 5, 3600);
  if (!rateCheck.allowed) {
    return res.status(429).json({ 
      error: 'Hourly challenge limit reached for your IP address. Please try again later!' 
    });
  }

  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  let KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN;

  if (KV_URL && !KV_URL.startsWith('http')) KV_URL = `https://${KV_URL}`;
  if (KV_URL && KV_URL.endsWith('/')) KV_URL = KV_URL.slice(0, -1);

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY missing in Vercel environment variables.' });
  }

  const cacheKey = `band:${bandName.toLowerCase().trim().replace(/[^a-z0-9]/g, '')}`;
  const challengeCountKey = `challenges:count:${cacheKey}`;

  // 3. Track and verify per-band challenge threshold in Redis
  let challengeCount = 1;
  if (KV_URL && KV_TOKEN) {
    try {
      const incrRes = await fetch(`${KV_URL}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KV_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['INCR', challengeCountKey])
      });
      if (incrRes.ok) {
        const countData = await incrRes.json();
        challengeCount = countData.result || 1;
      }
    } catch (e) {
      console.warn("Challenge count increment error:", e.message);
    }
  }

  // 4. QUARANTINE TRIGGER: 3 challenges on this specific band removes it from public index
  if (challengeCount >= 3) {
    const quarantinedPayload = {
      band_name: bandName,
      currently_touring: true,
      calculated_score: -1,
      tier_label: "Under Audit Review",
      badge_type: "quarantine",
      summary: `This audit has been challenged multiple times by the community and is currently removed from the public index pending manual inspector review.`
    };

    if (KV_URL && KV_TOKEN) {
      try {
        await fetch(`${KV_URL}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${KV_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(['SET', cacheKey, JSON.stringify(quarantinedPayload)])
        });

        await fetch(`${KV_URL}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${KV_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(['SREM', 'active_bands', cacheKey])
        });
      } catch (err) {
        console.error("Redis quarantine save error:", err.message);
      }
    }

    return res.status(200).json({ ...quarantinedPayload, cached: false });
  }

  // 5. Regular Challenge AI Re-Audit Logic (Challenges 1 and 2)
  const systemInstruction = `
    You are BandStamp lead inspector evaluating a live lineup audit for: ${bandName}.
    New fact-checking pointer provided for web search: "${critique}".

    STRICT RE-AUDIT RULES:
    1. FACT-CHECK MANDATE:
       - Use the web search pointer to verify updated tour dates, departures, or returns.
       - Ensure touring_members_present ONLY contains classic baseline members physically on stage.

    2. ABSOLUTE FORBIDDEN META-COMMENTARY & USER INPUT OMISSION:
       - NEVER mention or quote the user input, challenge submission, or critique text.
       - NEVER use phrases like "In response to...", "According to the user...", "As challenged...", or "After re-evaluating...".
       - Write as if this is the clean, authoritative, original Pitchfork-style rock journalism piece for BandStamp.

    3. EDITORIAL SUMMARY FORMAT (BRANCHING LOGIC):
       IF IS_CURRENTLY_TOURING = FALSE:
       - Write 2 short paragraphs confirming no active tour dates.

       IF IS_CURRENTLY_TOURING = TRUE:
       - Paragraph 1: 1-2 short sentences max confirming active tour status.
       - Paragraph 2 (LINEUP BREAKDOWN):
         "**On stage:** [Names and annotated roles]\\n\\n**Absent/Missing:** [Classic baseline members not present]."
       - Paragraph 3: 2 sentences of direct Pitchfork-style verdict.

    CRITICAL: Output MUST be valid single-line raw JSON only without markdown formatting:
    {
      "band_name": "Standardized Name",
      "debut_album": "Landmark Album/Era",
      "baseline_members": ["Member 1", "Member 2"],
      "touring_members_present": ["Member 1"],
      "zero_classic_members_on_stage": false,
      "frontman_name": "Lead Singer",
      "frontman_present": true,
      "is_currently_touring": true,
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
          { role: "user", content: `Re-verify lineup for ${bandName} using search pointer: ${critique}` }
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
          editorial_summary: `Re-audit completed for ${bandName}.`
        };
      }
    }

    let baselineList = data.baseline_members || [];
    let touringList = data.touring_members_present || [];
    let summaryText = data.editorial_summary || '';

    const absentMatch = summaryText.match(/Absent\/Missing:\s*([^.\n]+)/i);
    if (absentMatch) {
      const absentSection = absentMatch[1].trim();
      if (!absentSection.toLowerCase().includes('none')) {
        touringList = touringList.filter(m => {
          const mName = m.toLowerCase();
          return !absentSection.toLowerCase().includes(mName);
        });

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

      try {
        await fetch(`${KV_URL}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${KV_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(['SET', cacheKey, JSON.stringify(resultPayload), 'EX', ttlSeconds])
        });

        if (data.is_currently_touring) {
          await fetch(`${KV_URL}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${KV_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(['SADD', 'active_bands', cacheKey])
          });
        } else {
          await fetch(`${KV_URL}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${KV_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(['SREM', 'active_bands', cacheKey])
          });
        }
      } catch (redisErr) {
        console.error("Upstash Redis challenge overwrite failed:", redisErr.message);
      }
    }

    return res.status(200).json({ ...resultPayload, cached: false });

  } catch (err) {
    if (aiTimer) clearTimeout(aiTimer);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: "Challenge evaluation timed out." });
    }
    return res.status(500).json({ error: `Server Exception: ${err.message}` });
  }
};
