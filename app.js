// ==========================================
// CONFIGURATION (Using OpenRouter Key)
// ==========================================
const OPENROUTER_API_KEY = "Sk-or-v1-1c20c0152cfa5c6b8a319c25ea2304c61b60d999ddac4a439ff49cd8b86aecbb";

// ==========================================
// DOM ELEMENTS
// ==========================================
const bandInput = document.getElementById("band-input");
const stampBtn = document.getElementById("stamp-btn");
const loadingDiv = document.getElementById("loading");
const resultCard = document.getElementById("result-card");

const bandPhoto = document.getElementById("band-photo");
const stampOverlay = document.getElementById("stamp-overlay");
const bandNameHeading = document.getElementById("band-name-heading");
const tierBadge = document.getElementById("tier-badge");
const scoreValue = document.getElementById("score-value");
const auditSummary = document.getElementById("audit-summary");

// ==========================================
// EVENT LISTENERS
// ==========================================
stampBtn.addEventListener("click", runBandAudit);
bandInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") runBandAudit();
});

// ==========================================
// MAIN AUDIT FUNCTION
// ==========================================
async function runBandAudit() {
  const query = bandInput.value.trim();
  if (!query) return;

  loadingDiv.classList.remove("hidden");
  resultCard.classList.add("hidden");

  try {
    // 1. Fetch band image from Wikipedia API
    const imageUrl = await fetchBandImage(query);

    // 2. Fetch AI audit from OpenRouter API
    const auditData = await fetchAIAudit(query);

    // 3. Render results on screen
    renderResult(imageUrl, auditData);
  } catch (error) {
    console.error(error);
    alert("Audit failed. Please check your network and try again.");
  } finally {
    loadingDiv.classList.add("hidden");
  }
}

// ==========================================
// WIKIPEDIA IMAGE FETCH
// ==========================================
async function fetchBandImage(bandName) {
  try {
    const response = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(bandName)}`
    );
    const data = await response.json();
    if (data.thumbnail && data.thumbnail.source) {
      return data.thumbnail.source;
    }
  } catch (e) {
    console.log("Image search fallback triggered", e);
  }
  return "https://via.placeholder.com/600x400/2b2b2b/ffffff?text=Band+Photo+Not+Found";
}

// ==========================================
// AI AUDIT ENGINE (OPENROUTER API)
// ==========================================
async function fetchAIAudit(bandName) {
  const systemInstruction = `
    You are the official diagnostic auditor for BandStamp (bandstamp.com). Your job is to calculate the "Lineup Purity Score" for a requested music band based on their original vs. active touring members.

    EVALUATION RULES:
    1. Tour Status Check: Check if the band actively toured in the past 12 months or has an upcoming tour.
       - If INACTIVE (not toured in past 12 months), evaluate their LAST KNOWN TOURING LINEUP in past tense, and explicitly state in the summary that the band is not currently on tour.
    2. Original Member Baseline: Defined as members credited on the first commercial studio album OR iconic breakthrough lineup (e.g., Ringo Starr, Travis Barker, Chad Smith/John Frusciante).
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
      "currently_touring": true or false,
      "calculated_score": 0-100,
      "tier_label": "Tier name string",
      "badge_type": "gold" or "green" or "yellow" or "orange" or "red",
      "summary": "Detailed 3-4 sentence explanation. Explicitly list original members, who played on stage during the current/last tour, whether they are currently touring, and step-by-step why they received this score."
    }
  `;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://bandstamp.com",
      "X-Title": "BandStamp",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "meta-llama/llama-3.3-70b-instruct",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: `Audit this band: ${bandName}` }
      ]
    })
  });

  const rawData = await response.json();
  const textOutput = rawData.choices[0].message.content;
  return JSON.parse(textOutput);
}

// ==========================================
// DISPLAY RESULTS
// ==========================================
function renderResult(imageUrl, data) {
  bandPhoto.src = imageUrl;
  bandNameHeading.textContent = data.band_name;
  tierBadge.textContent = data.tier_label;
  scoreValue.textContent = `${data.calculated_score}%`;
  auditSummary.textContent = data.summary;

  stampOverlay.className = `stamp ${data.badge_type}`;
  stampOverlay.textContent = `${data.calculated_score}% PURITY`;

  resultCard.classList.remove("hidden");
}
