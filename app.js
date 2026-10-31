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

    // 2. Fetch AI audit from Vercel backend endpoint
    const auditData = await fetchAIAudit(query);

    // 3. Render results on screen
    renderResult(imageUrl, auditData);
  } catch (error) {
    console.error("BandStamp Audit Error:", error);
    alert(error.message);
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
    if (!response.ok) throw new Error("Wikipedia image not found");
    const data = await response.json();
    if (data.thumbnail && data.thumbnail.source) {
      return data.thumbnail.source;
    }
  } catch (e) {
    console.log("Image search fallback triggered:", e);
  }
  return "https://via.placeholder.com/600x400/2b2b2b/ffffff?text=Band+Photo+Not+Found";
}

// ==========================================
// AI AUDIT ENGINE (CALLS VERCEL BACKEND)
// ==========================================
async function fetchAIAudit(bandName) {
  let response = await fetch("/api/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bandName: bandName })
  });

  // Fallback check if route requires explicit .js extension
  if (response.status === 404) {
    response = await fetch("/api/audit.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bandName: bandName })
    });
  }

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    throw new Error(`Server endpoint returned error (${response.status}): ${rawText.slice(0, 150)}`);
  }

  if (!response.ok) {
    throw new Error(data.error || `Server error (${response.status})`);
  }

  return data;
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
