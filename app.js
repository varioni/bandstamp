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

  async function fetchWikiImage(queryName) {
    try {
      // 1. Try direct search query
      let res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(queryName)}`);
      let data = res.ok ? await res.json() : null;
      let imgSrc = data?.thumbnail?.source || data?.originalimage?.source;

      // 2. Fallback to queryName + " (band)" if first try has no image or hits disambiguation
      if (!imgSrc && !queryName.toLowerCase().includes('(band)')) {
        const fallbackRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(queryName + ' (band)')}`);
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          imgSrc = fallbackData?.thumbnail?.source || fallbackData?.originalimage?.source;
        }
      }

      return imgSrc || null;
    } catch (e) {
      return null;
    }
  }

  async function performAudit() {
    const query = bandInput.value.trim();
    if (!query) return;

    // Reset UI state
    loadingDiv.classList.remove('hidden');
    resultCard.classList.add('hidden');
    stampOverlay.className = 'stamp';
    if (imageWrapper) imageWrapper.style.display = 'block';

    try {
      // 1. Audit Request to Backend Endpoint
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

      // 2. Fetch Photo via Wikipedia REST API with Smart Fallback
      const imgSrc = await fetchWikiImage(data.band_name || query);

      if (imgSrc) {
        bandPhoto.src = imgSrc;
        bandPhoto.onerror = () => { if (imageWrapper) imageWrapper.style.display = 'none'; };
      } else {
        if (imageWrapper) imageWrapper.style.display = 'none';
      }

      // 3. Populate Card UI
      bandNameHeading.textContent = data.band_name;
      scoreValue.textContent = `${data.calculated_score}%`;
      tierBadge.textContent = data.tier_label;
      tierBadge.className = 'badge';
      auditSummary.textContent = data.summary;

      // Stamp Overlay
      stampOverlay.textContent = `${data.calculated_score}% PURITY`;
      stampOverlay.classList.add(data.badge_type);

      // Reveal Result Card
      loadingDiv.classList.add('hidden');
      resultCard.classList.remove('hidden');

    } catch (err) {
      loadingDiv.classList.add('hidden');
      alert(`Audit Error: ${err.message}`);
    }
  }

  stampBtn.addEventListener('click', performAudit);
  bandInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performAudit();
  });
});
