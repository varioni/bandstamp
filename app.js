document.addEventListener('DOMContentLoaded', () => {
  const stampBtn = document.getElementById('stamp-btn');
  const bandInput = document.getElementById('band-input');
  const loadingDiv = document.getElementById('loading');
  const resultCard = document.getElementById('result-card');

  const bandPhoto = document.getElementById('band-photo');
  const imageWrapper = document.querySelector('.image-wrapper');
  const stampOverlay = document.getElementById('stamp-overlay');
  const bandNameHeading = document.getElementById('band-name-heading');
  const tierBadge = document.getElementById('tier-badge');
  const scoreValue = document.getElementById('score-value');
  const auditSummary = document.getElementById('audit-summary');

  const challengeToggleBtn = document.getElementById('challenge-toggle-btn');
  const challengeBox = document.getElementById('challenge-box');
  const challengeInput = document.getElementById('challenge-input');
  const submitChallengeBtn = document.getElementById('submit-challenge-btn');

  let currentBandName = '';

  function updateLoadingText(msg) {
    if (loadingDiv) {
      const p = loadingDiv.querySelector('p') || loadingDiv;
      p.textContent = msg;
    }
  }

  async function fetchWikiImage(queryName) {
    const clean = queryName.trim();
    const candidates = [];

    if (clean.toLowerCase().includes('(band)') || clean.toLowerCase().includes('(musical group)')) {
      candidates.push(clean);
    } else {
      candidates.push(`${clean} (band)`);
      candidates.push(clean);
      candidates.push(`${clean} (musical group)`);
    }

    for (const title of candidates) {
      try {
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.type === 'disambiguation') continue;
          
          const imgSrc = data.thumbnail?.source || data.originalimage?.source;
          if (imgSrc) return imgSrc;
        }
      } catch (e) {}
    }
    return null;
  }

  async function performAudit() {
    const query = bandInput.value.trim();
    if (!query) return;

    currentBandName = query;
    updateLoadingText(`Connecting to server for ${query}...`);
    loadingDiv.classList.remove('hidden');
    resultCard.classList.add('hidden');
    challengeBox.classList.add('hidden');
    stampOverlay.className = 'stamp';
    if (imageWrapper) imageWrapper.style.display = 'block';

    try {
      updateLoadingText(`Auditing live roster for ${query}...`);
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bandName: query })
      });

      let data;
      const textResponse = await res.text();

      try {
        data = JSON.parse(textResponse);
      } catch (jsonErr) {
        throw new Error(`Server returned non-JSON response (HTTP ${res.status}): ${textResponse.slice(0, 150)}...`);
      }

      if (!res.ok) {
        const stepInfo = data.failed_step ? ` [Failed Step: ${data.failed_step}]` : '';
        throw new Error((data.error || `Server Error ${res.status}`) + stepInfo);
      }

      updateLoadingText(`Fetching band image...`);
      await renderCard(data);

    } catch (err) {
      loadingDiv.classList.add('hidden');
      alert(`Audit Diagnostics Alert:\n\n${err.message}`);
    }
  }

  async function submitChallenge() {
    const critique = challengeInput.value.trim();
    if (!critique || !currentBandName) return;

    updateLoadingText(`Re-auditing ${currentBandName} with critique...`);
    loadingDiv.classList.remove('hidden');
    resultCard.classList.add('hidden');

    try {
      const res = await fetch('/api/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bandName: currentBandName, critique: critique })
      });

      let data;
      const textResponse = await res.text();

      try {
        data = JSON.parse(textResponse);
      } catch (jsonErr) {
        throw new Error(`Server returned non-JSON response (HTTP ${res.status}): ${textResponse.slice(0, 150)}...`);
      }

      if (!res.ok) {
        throw new Error(data.error || `Server Error ${res.status}`);
      }

      challengeInput.value = '';
      challengeBox.classList.add('hidden');
      await renderCard(data);

    } catch (err) {
      loadingDiv.classList.add('hidden');
      resultCard.classList.remove('hidden');
      alert(`Re-Audit Error: ${err.message}`);
    }
  }

  async function renderCard(data) {
    currentBandName = data.band_name;
    const imgSrc = await fetchWikiImage(data.band_name);

    if (imgSrc) {
      bandPhoto.src = imgSrc;
      bandPhoto.onerror = () => { if (imageWrapper) imageWrapper.style.display = 'none'; };
    } else {
      if (imageWrapper) imageWrapper.style.display = 'none';
    }

    bandNameHeading.textContent = data.band_name;
    scoreValue.textContent = `${data.calculated_score}%`;
    tierBadge.textContent = data.tier_label;
    tierBadge.className = 'badge';
    auditSummary.textContent = data.summary;

    stampOverlay.textContent = `${data.calculated_score}% PURITY`;
    stampOverlay.classList.add(data.badge_type);

    loadingDiv.classList.add('hidden');
    resultCard.classList.remove('hidden');
  }

  stampBtn.addEventListener('click', performAudit);
  bandInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performAudit();
  });

  challengeToggleBtn.addEventListener('click', () => {
    challengeBox.classList.toggle('hidden');
  });

  submitChallengeBtn.addEventListener('click', submitChallenge);
});
