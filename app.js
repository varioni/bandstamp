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

  const shareBtn = document.getElementById('share-btn');
  const challengeToggleBtn = document.getElementById('challenge-toggle-btn');
  const challengeBox = document.getElementById('challenge-box');
  const challengeInput = document.getElementById('challenge-input');
  const submitChallengeBtn = document.getElementById('submit-challenge-btn');

  let currentBandName = '';
  const fallbackUrl = 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=800&q=80';

  // Color-coded tier score map
  const tierColorMap = {
    gold: '#ffd700',
    green: '#4caf50',
    yellow: '#ffeb3b',
    orange: '#ff9800',
    red: '#ff5252',
    black: '#ffffff'
  };

  function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Load rotating audit ticker banner
  async function loadTicker() {
    const track = document.getElementById('ticker-track');
    if (!track) return;

    try {
      const res = await fetch('/api/index-list');
      const data = await res.json();
      const bands = data.bands || [];

      if (bands.length > 0) {
        const randomizedBands = shuffleArray(bands);

        const itemsHtml = randomizedBands.map(b => {
          const badgeType = b.badge_type || 'gold';
          const scoreColor = tierColorMap[badgeType] || '#ffd700';
          const slug = b.band_name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          
          return `
            <a href="/${slug}" class="ticker-item">
              ★ <strong>${b.band_name}</strong>: <span class="ticker-score" style="color: ${scoreColor};">${b.calculated_score}% PURITY</span>
            </a>
          `;
        }).join('');

        track.innerHTML = itemsHtml + itemsHtml;
      } else {
        track.innerHTML = `<a href="index-list.html" class="ticker-item">★ BANDSTAMP LIVE INDEX: Audit a band to rank them on the leaderboard!</a>`;
      }
    } catch (e) {
      console.warn("Ticker fetch error:", e.message);
    }
  }

  loadTicker();

  // Robust Wikipedia/Wikimedia lead image fetcher
  async function fetchBandPhoto(bandName) {
    try {
      const wikiSummaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(bandName)}`;
      const wikiRes = await fetch(wikiSummaryUrl);
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        const mainImgUrl = wikiData?.thumbnail?.source || wikiData?.originalimage?.source;
        if (mainImgUrl && isValidImageUrl(mainImgUrl)) {
          return mainImgUrl;
        }
      }

      const query = encodeURIComponent(`${bandName} band concert live`);
      const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${query}&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url&format=json&origin=*`;

      const commonsRes = await fetch(commonsUrl);
      if (!commonsRes.ok) return fallbackUrl;

      const commonsData = await commonsRes.json();
      if (!commonsData.query || !commonsData.query.pages) return fallbackUrl;

      const pages = Object.values(commonsData.query.pages);
      for (const page of pages) {
        const imgUrl = page?.imageinfo?.[0]?.url;
        if (imgUrl && isValidImageUrl(imgUrl)) {
          return imgUrl;
        }
      }

      return fallbackUrl;
    } catch (e) {
      console.warn('Band photo fetch error:', e.message);
      return fallbackUrl;
    }
  }

  function isValidImageUrl(url) {
    const lower = url.toLowerCase();
    if (lower.endsWith('.svg') || lower.endsWith('.tif') || lower.endsWith('.tiff') || lower.endsWith('.ogg')) {
      return false;
    }
    return lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.png') || lower.includes('.webp');
  }

  // Share functionality handler
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      if (!currentBandName) return;

      const slug = currentBandName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const shareUrl = `${window.location.origin}/${slug}`;
      const shareTitle = `${currentBandName} - BandStamp Lineup Audit`;
      const shareText = `Check out the live lineup purity audit for ${currentBandName} on BandStamp!`;

      if (navigator.share) {
        try {
          await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
          return;
        } catch (err) {
          // Fallback if user dismissed share sheet
        }
      }

      try {
        await navigator.clipboard.writeText(shareUrl);
        const originalText = shareBtn.textContent;
        shareBtn.textContent = '✓ Clean Link Copied to Clipboard!';
        setTimeout(() => {
          shareBtn.textContent = originalText;
        }, 2500);
      } catch (e) {
        alert(`Share this audit: ${shareUrl}`);
      }
    });
  }

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
      await renderAuditResult(data);
      loadTicker();
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
      await renderAuditResult(data);
      loadTicker();
    } catch (err) {
      alert(`Audit Error: ${err.message}`);
    } finally {
      loading.classList.add('hidden');
    }
  }

  async function renderAuditResult(data) {
    bandHeading.textContent = data.band_name || currentBandName;
    tierBadge.textContent = data.tier_label || 'Audit Result';
    tierBadge.className = `tier-badge-text ${data.badge_type || 'gold'}`;

    bandPhoto.onerror = () => {
      bandPhoto.src = fallbackUrl;
    };

    const photoUrl = await fetchBandPhoto(data.band_name || currentBandName);
    bandPhoto.src = photoUrl;

    if (!data.currently_touring) {
      stampOverlay.textContent = 'NOT TOURING';
      stampOverlay.className = 'stamp black';
    } else if (data.calculated_score < 0) {
      stampOverlay.textContent = 'REVIEW';
      stampOverlay.className = 'stamp red';
    } else {
      stampOverlay.textContent = `${data.calculated_score}% PURITY`;
      stampOverlay.className = `stamp ${data.badge_type || 'gold'}`;
    }

    let rawText = data.summary || '';
    rawText = rawText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    rawText = rawText.replace(/(?:<strong>)?On stage:(?:<\/strong>)?/gi, '<strong>On stage:</strong>');
    rawText = rawText.replace(/(?:<strong>)?Absent\/Missing:(?:<\/strong>)?/gi, '<strong>Absent/Missing:</strong>');

    rawText = rawText.replace(/([^\n])\s*<strong>Absent\/Missing:<\/strong>/gi, '$1\n\n<strong>Absent/Missing:</strong>');

    let normalized = rawText
      .replace(/\\n/g, '\n')
      .replace(/\r\n/g, '\n')
      .replace(/\n+/g, '===PARAGRAPH===');

    const paragraphs = normalized
      .split('===PARAGRAPH===')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    auditSummary.innerHTML = paragraphs
      .map(p => `<p style="margin-bottom: 1.2rem; line-height: 1.6;">${p}</p>`)
      .join('');

    resultCard.classList.remove('hidden');
  }

  // Auto-run search on page load for query params or clean path slugs
  const urlParams = new URLSearchParams(window.location.search);
  const bandParam = urlParams.get('band');

  if (bandParam) {
    const formattedName = decodeURIComponent(bandParam).replace(/-/g, ' ');
    bandInput.value = formattedName;
    handleSearch();
  } else {
    const pathSlug = window.location.pathname.substring(1).trim();
    if (pathSlug && !pathSlug.includes('.html') && !pathSlug.includes('.')) {
      const formattedName = decodeURIComponent(pathSlug).replace(/-/g, ' ');
      bandInput.value = formattedName;
      handleSearch();
    }
  }
});
