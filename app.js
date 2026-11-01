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
  let isProcessing = false;
  let activeRequestController = null;

  function updateLoadingText(msg) {
    if (loadingDiv) {
      const p = loadingDiv.querySelector('p') || loadingDiv;
      p.textContent = msg;
    }
  }

  async function fetchWikiImage(queryName) {
    const clean = queryName.trim();
    const candidates = [
      clean,
      `${clean} (band)`,
      `${clean} (musical group)`
    ];

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

  async function performAudit(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (!bandInput) return;

    const query = bandInput.value.trim();
    if (!query || isProcessing) return;

    if (activeRequestController) activeRequestController.abort();
    activeRequestController = new AbortController();
    
    isProcessing = true;
    currentBandName = query;
    updateLoadingText(`Auditing lineup for ${query}...`);
    
    loadingDiv?.classList.remove('hidden');
    resultCard?.classList.add('hidden');
    challengeBox?.classList.add('hidden');
    if (stampOverlay) stampOverlay.className = 'stamp';
    if (imageWrapper) imageWrapper.style.display = 'block';

    try {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bandName: query }),
        signal: activeRequestController.signal
      });

      const textResponse = await res.text();
      let data;

      try {
        data = JSON.parse(textResponse);
      } catch (jsonErr) {
        throw new Error(`Server returned invalid format (${res.status})`);
      }

      if (!res.ok) {
        throw new Error(data.error || `Server Error ${res.status}`);
      }

      await renderCard(data);

    } catch (err) {
      if (err.name === 'AbortError') return;
      alert(`Audit Error: ${err.message}`);
    } finally {
      isProcessing = false;
      loadingDiv?.classList.add('hidden');
    }
  }

  async function submitChallenge() {
    if (!challengeInput) return;
    const critique = challengeInput.value.trim();
    if (!critique || !currentBandName || isProcessing) return;

    if (activeRequestController) activeRequestController.abort();
    activeRequestController = new AbortController();

    isProcessing = true;
    updateLoadingText(`Re-auditing ${currentBandName} with your challenge...`);
    
    loadingDiv?.classList.remove('hidden');
    resultCard?.classList.add('hidden');

    try {
      const res = await fetch('/api/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bandName: currentBandName, critique: critique }),
        signal: activeRequestController.signal
      });

      const textResponse = await res.text();
      let data;

      try {
        data = JSON.parse(textResponse);
      } catch (jsonErr) {
        throw new Error(`Server returned invalid format (${res.status})`);
      }

      if (!res.ok) {
        throw new Error(data.error || `Server Error ${res.status}`);
      }

      challengeInput.value = '';
      challengeBox?.classList.add('hidden');
      await renderCard(data);

    } catch (err) {
      if (err.name === 'AbortError') return;
      resultCard?.classList.remove('hidden');
      alert(`Re-Audit Error: ${err.message}`);
    } finally {
      isProcessing = false;
      loadingDiv?.classList.add('hidden');
    }
  }

  async function renderCard(data) {
    currentBandName = data.band_name;
    const imgSrc = await fetchWikiImage(data.band_name);

    if (imgSrc && bandPhoto) {
      bandPhoto.src = imgSrc;
      bandPhoto.onerror = () => { if (imageWrapper) imageWrapper.style.display = 'none'; };
    } else if (imageWrapper) {
      imageWrapper.style.display = 'none';
    }

    if (bandNameHeading) bandNameHeading.textContent = data.band_name;
    if (scoreValue) scoreValue.textContent = `${data.calculated_score}%`;
    if (tierBadge) {
      tierBadge.textContent = data.tier_label;
      tierBadge.className = 'badge';
    }
    if (auditSummary) auditSummary.textContent = data.summary;

    if (stampOverlay) {
      stampOverlay.textContent = `${data.calculated_score}% PURITY`;
      stampOverlay.classList.add(data.badge_type);
    }

    resultCard?.classList.remove('hidden');
  }

  stampBtn?.addEventListener('click', performAudit);
  bandInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performAudit(e);
  });

  challengeToggleBtn?.addEventListener('click', () => {
    challengeBox?.classList.toggle('hidden');
  });

  submitChallengeBtn?.addEventListener('click', submitChallenge);
});
