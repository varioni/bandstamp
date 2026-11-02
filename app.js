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

  // Color-coded tier score map
  const tierColorMap = {
    gold: '#ffd700',
    green: '#4caf50',
    yellow: '#ffeb3b',
    orange: '#ff9800',
    red: '#ff5252',
    black: '#ffffff'
  };

  // Load rotating audit ticker banner with color-coded score badges
  async function loadTicker() {
    const track = document.getElementById('ticker-track');
    if (!track) return;

    try {
      const res = await fetch('/api/index-list');
      const data = await res.json();
      const bands = data.bands || [];

      if (bands.length > 0) {
        const itemsHtml = bands.map(b => {
          const badgeType = b.badge_type || 'gold';
          const scoreColor = tierColorMap[badgeType] || '#ffd700';
          
          return `
            <a href="index-list.html" class="ticker-item">
              ★ <strong>${b.band_name}</strong>: <span class="ticker-score" style="color: ${scoreColor};">${b.calculated_score}% PURITY</span>
            </a>
          `;
        }).join('');

        // Duplicate string to create seamless infinite scrolling effect
        track.innerHTML = itemsHtml + itemsHtml;
      } else {
        track.innerHTML = `<a href="index-list.html" class="ticker-item">★ BANDSTAMP LIVE INDEX: Audit a band to rank them on the leaderboard!</a>`;
      }
    } catch (e) {
      console.warn("Ticker fetch error:", e.message);
    }
  }

  loadTicker();

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
      loadTicker(); // Refresh ticker after challenge re-audit
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
      loadTicker(); // Refresh ticker after new audit
    } catch (err) {
      alert(`Audit Error: ${err.message}`);
    } finally {
      loading.classList.add('hidden');
    }
  }

  function renderAuditResult(data) {
    bandHeading.textContent = data.band_name || currentBandName;
    tierBadge.textContent = data.tier_label || 'Audit Result';
    tierBadge.className = `tier-badge-text ${data.badge_type || 'gold'}`;

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
      stampOverlay.className = `stamp ${data.badge_type || 'gold'}`;
    }

    // Clean up summary string & format bold tags
    let rawText = data.summary || '';
    rawText = rawText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    rawText = rawText.replace(/(?:<strong>)?On stage:(?:<\/strong>)?/gi, '<strong>On stage:</strong>');
    rawText = rawText.replace(/(?:<strong>)?Absent\/Missing:(?:<\/strong>)?/gi, '<strong>Absent/Missing:</strong>');

    // Ensure Absent/Missing starts on a new line break if attached to On stage line
    rawText = rawText.replace(/([^\n])\s*<strong>Absent\/Missing:<\/strong>/gi, '$1\n\n<strong>Absent/Missing:</strong>');

    // Normalize all escaped or literal line breaks (\r\n, \n, \\n) into SPLIT_MARKER
    let normalized = rawText
      .replace(/\\n/g, '\n')
      .replace(/\r\n/g, '\n')
      .replace(/\n+/g, '===PARAGRAPH===');

    const paragraphs = normalized
      .split('===PARAGRAPH===')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    // Build HTML paragraphs with explicit inline bottom margin spacing
    auditSummary.innerHTML = paragraphs
      .map(p => `<p style="margin-bottom: 1.2rem; line-height: 1.6;">${p}</p>`)
      .join('');

    resultCard.classList.remove('hidden');
  }

  // Auto-run search if ?band=Name URL query parameter exists
  const urlParams = new URLSearchParams(window.location.search);
  const bandParam = urlParams.get('band');
  if (bandParam) {
    bandInput.value = bandParam;
    handleSearch();
  }
});
