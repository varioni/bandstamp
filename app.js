document.addEventListener('DOMContentLoaded', () => {
  const searchForm = document.getElementById('search-form');
  const bandInput = document.getElementById('band-input');
  const stampBtn = document.getElementById('stamp-btn');
  const loading = document.getElementById('loading');
  const resultCard = document.getElementById('result-card');

  const bandHeading = document.getElementById('band-name-heading');
  const tierBadge = document.getElementById('tier-badge');
  const bandPhoto = document.getElementById('band-photo');
  const stampOverlay = document.getElementById('stamp-overlay');
  const auditSummary = document.getElementById('audit-summary');

  const challengeToggleBtn = document.getElementById('challenge-toggle-btn');
  const challengeBox = document.getElementById('challenge-box');
  const challengeInput = document.getElementById('challenge-input');
  const submitChallengeBtn = document.getElementById('submit-challenge-btn');

  let currentBandName = '';

  stampBtn.addEventListener('click', (e) => {
    e.preventDefault();
    handleSearch();
  });

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSearch();
  });

  challengeToggleBtn.addEventListener('click', () => {
    challengeBox.classList.toggle('hidden');
    if (!challengeBox.classList.contains('hidden')) {
      challengeInput.focus();
    }
  });

  submitChallengeBtn.addEventListener('click', async () => {
    const critique = challengeInput.value.trim();
    if (!critique || !currentBandName) return;

    loading.classList.remove('hidden');
    resultCard.classList.add('hidden');

    try {
      const response = await fetch('/api/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bandName: currentBandName, critique })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server Exception (${response.status})`);
      }

      const data = await response.json();
      renderAuditResult(data);
    } catch (err) {
      alert(`Challenge Error: ${err.message}`);
    } finally {
      loading.classList.add('hidden');
    }
  });

  async function handleSearch() {
    const query = bandInput.value.trim();
    if (!query) return;

    currentBandName = query;
    loading.classList.remove('hidden');
    resultCard.classList.add('hidden');
    challengeBox.classList.add('hidden');
    challengeInput.value = '';

    try {
      const response = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bandName: query })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server Exception (${response.status})`);
      }

      const data = await response.json();
      renderAuditResult(data);
    } catch (err) {
      alert(`Audit Error: ${err.message}`);
    } finally {
      loading.classList.add('hidden');
    }
  }

  function renderAuditResult(data) {
    bandHeading.textContent = data.band_name || currentBandName;
    tierBadge.textContent = data.tier_label || 'Audit Result';

    const encodedName = encodeURIComponent(data.band_name || currentBandName);
    bandPhoto.src = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodedName}.jpg`;
    bandPhoto.onerror = () => {
      bandPhoto.src = `https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=800&q=80`;
    };

    if (!data.currently_touring) {
      stampOverlay.textContent = 'NOT TOURING';
      stampOverlay.className = 'stamp black';
    } else {
      stampOverlay.textContent = `${data.calculated_score}% PURITY`;
      stampOverlay.className = `stamp ${data.badge_type || 'red'}`;
    }

    // Process summary text: convert markdown bold & build HTML paragraphs
    let summaryText = data.summary || '';
    summaryText = summaryText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    summaryText = summaryText.replace(/(?:<strong>)?On stage:(?:<\/strong>)?/gi, '<strong>On stage:</strong>');
    summaryText = summaryText.replace(/(?:<strong>)?Absent\/Missing:(?:<\/strong>)?/gi, '<strong>Absent/Missing:</strong>');

    const paragraphs = summaryText.split(/\\n\\n|\n\n/).filter(p => p.trim().length > 0);
    auditSummary.innerHTML = paragraphs.map(p => `<p>${p.trim()}</p>`).join('');

    resultCard.classList.remove('hidden');
  }
});
