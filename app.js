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
    loadingDiv.classList.remove('hidden');
    resultCard.classList.add('hidden');
    challengeBox.classList.add('hidden');
    stampOverlay.className = 'stamp';
    if (imageWrapper) imageWrapper.style.display = 'block';

    try {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bandName: query })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Audit request failed');
      }

      const data = await res.json();
      renderCard(data);

    } catch (err) {
      loadingDiv.classList.add('hidden');
      alert(`Audit Error: ${err.message}`);
    }
  }

  async function submitChallenge() {
    const critique = challengeInput.value.trim();
    if (!critique || !currentBandName) return;

    loadingDiv.classList.remove('hidden');
    resultCard.classList.add('hidden');

    try {
      const res = await fetch('/api/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bandName: currentBandName, critique: critique })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Re-audit request failed');
      }

      const data = await res.json();
      challengeInput.value = '';
      challengeBox.classList.add('hidden');
      renderCard(data);

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
