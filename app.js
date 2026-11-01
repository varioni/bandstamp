// BandStamp - Main Application Controller
document.addEventListener('DOMContentLoaded', () => {
  const searchForm = document.getElementById('search-form');
  const artistInput = document.getElementById('artist-input');
  const resultsContainer = document.getElementById('results-container');
  const loadingSpinner = document.getElementById('loading-spinner');

  let currentAbortController = null;
  let isProcessing = false;

  if (!searchForm || !artistInput) return;

  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = artistInput.value.trim();
    if (!query || isProcessing) return;

    await performAudit(query);
  });

  async function performAudit(artistName) {
    // Abort previous inflight request to prevent stacked async loops
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();

    isProcessing = true;
    toggleLoading(true);
    clearResults();

    try {
      const response = await fetch(`/api/audit?artist=${encodeURIComponent(artistName)}`, {
        signal: currentAbortController.signal,
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error (${response.status})`);
      }

      const data = await response.json();
      renderAuditResult(data);
    } catch (error) {
      if (error.name === 'AbortError') return;
      renderError(error.message || 'An error occurred while analyzing the band lineup.');
    } finally {
      isProcessing = false;
      toggleLoading(false);
      currentAbortController = null;
    }
  }

  function toggleLoading(isLoading) {
    if (loadingSpinner) {
      loadingSpinner.style.display = isLoading ? 'block' : 'none';
    }
  }

  function clearResults() {
    if (resultsContainer) {
      resultsContainer.innerHTML = '';
    }
  }

  function renderAuditResult(data) {
    if (!resultsContainer) return;

    const ratio = Number(data.originalRatio || 0);
    const stampClass = ratio >= 0.75 ? 'stamp-gold' : ratio >= 0.5 ? 'stamp-silver' : 'stamp-warning';
    const stampLabel = ratio >= 0.75 ? 'AUTHENTIC LINEUP' : ratio >= 0.5 ? 'PARTIAL ORIGINAL' : 'TRIBUTE / RECONSTITUTED';

    resultsContainer.innerHTML = `
      <div class="card">
        <h2>${escapeHtml(data.artist || 'Unknown Artist')}</h2>
        <div class="stamp-badge ${stampClass}">
          <span>${stampLabel}</span>
          <strong>${Math.round(ratio * 100)}% Original Members</strong>
        </div>
        <p class="summary">${escapeHtml(data.summary || 'Lineup evaluation complete.')}</p>
        <div class="lineup-grid">
          <div class="column">
            <h3>Classic / Original Era</h3>
            <ul>
              ${(data.originalMembers || []).map(member => `<li>${escapeHtml(member)}</li>`).join('') || '<li>Data unavailable</li>'}
            </ul>
          </div>
          <div class="column">
            <h3>Current Touring Roster</h3>
            <ul>
              ${(data.touringMembers || []).map(member => `<li>${escapeHtml(member)}</li>`).join('') || '<li>Data unavailable</li>'}
            </ul>
          </div>
        </div>
      </div>
    `;
  }

  function renderError(message) {
    if (!resultsContainer) return;
    resultsContainer.innerHTML = `
      <div class="card error-card">
        <p><strong>Error:</strong> ${escapeHtml(message)}</p>
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
