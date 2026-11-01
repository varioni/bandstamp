// BandStamp Front-End Controller - Fixed Non-Freezing Implementation
document.addEventListener('DOMContentLoaded', () => {
  const searchForm = document.getElementById('search-form');
  const artistInput = document.getElementById('artist-input');
  const resultsContainer = document.getElementById('results-container');
  const loadingSpinner = document.getElementById('loading-spinner');
  const searchBtn = document.getElementById('search-btn');

  let isProcessing = false;
  let activeAbortController = null;

  if (!searchForm || !artistInput) return;

  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const query = artistInput.value.trim();
    if (!query || isProcessing) return;

    await runAudit(query);
  });

  async function runAudit(artistName) {
    // Abort any inflight API call to avoid stacked async loops
    if (activeAbortController) {
      activeAbortController.abort();
    }
    activeAbortController = new AbortController();

    isProcessing = true;
    setLoadingState(true);
    clearResults();

    try {
      const response = await fetch(`/api/audit?artist=${encodeURIComponent(artistName)}`, {
        signal: activeAbortController.signal,
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP error ${response.status}`);
      }

      const data = await response.json();
      renderResults(data);
    } catch (error) {
      if (error.name === 'AbortError') return;
      renderError(error.message || 'Unable to retrieve lineup audit data.');
    } finally {
      isProcessing = false;
      setLoadingState(false);
      activeAbortController = null;
    }
  }

  function setLoadingState(isLoading) {
    if (loadingSpinner) {
      loadingSpinner.style.display = isLoading ? 'block' : 'none';
    }
    if (searchBtn) {
      searchBtn.disabled = isLoading;
      searchBtn.style.opacity = isLoading ? '0.6' : '1';
    }
  }

  function clearResults() {
    if (resultsContainer) {
      resultsContainer.innerHTML = '';
    }
  }

  function renderResults(data) {
    if (!resultsContainer) return;

    const ratio = Number(data.originalRatio || 0);
    let stampClass = 'stamp-amber';
    let stampText = 'PARTIAL LINEUP';

    if (ratio >= 0.75) {
      stampClass = 'stamp-green';
      stampText = 'AUTHENTIC LINEUP';
    } else if (ratio < 0.5) {
      stampClass = 'stamp-red';
      stampText = 'TRIBUTE / RECONSTITUTED';
    }

    const percentage = Math.round(ratio * 100);
    const originalList = (data.originalMembers || [])
      .map(m => `<li>${escapeHtml(m)}</li>`)
      .join('') || '<li>No data available</li>';

    const touringList = (data.touringMembers || [])
      .map(m => `<li>${escapeHtml(m)}</li>`)
      .join('') || '<li>No data available</li>';

    resultsContainer.innerHTML = `
      <div class="result-card">
        <h2>${escapeHtml(data.artist || 'Artist')}</h2>
        <div class="stamp-container ${stampClass}">
          ${stampText} — ${percentage}% ORIGINAL
        </div>
        <p>${escapeHtml(data.summary || 'Lineup evaluation completed.')}</p>
        <div class="lineup-grid">
          <div class="lineup-column">
            <h3>Original / Classic Members</h3>
            <ul class="lineup-list">${originalList}</ul>
          </div>
          <div class="lineup-column">
            <h3>Current Touring Roster</h3>
            <ul class="lineup-list">${touringList}</ul>
          </div>
        </div>
      </div>
    `;
  }

  function renderError(message) {
    if (!resultsContainer) return;
    resultsContainer.innerHTML = `
      <div class="result-card" style="border-color: #991b1b;">
        <p style="color: #991b1b;"><strong>Error:</strong> ${escapeHtml(message)}</p>
      </div>
    `;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
