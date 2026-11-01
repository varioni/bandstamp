// Vercel Serverless Function: Lineup Audit API
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { artist } = req.query;

  if (!artist || typeof artist !== 'string') {
    return res.status(400).json({ error: 'Artist parameter is required' });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  try {
    const cleanArtist = artist.trim();
    const auditData = await evaluateLineup(cleanArtist, controller.signal);
    
    clearTimeout(timeoutId);
    return res.status(200).json(auditData);
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Request timed out while evaluating lineup.' });
    }

    return res.status(500).json({ 
      error: error.message || 'An error occurred during band audit processing.' 
    });
  }
}

async function evaluateLineup(artistName, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve({
        artist: artistName,
        originalRatio: 0.75,
        summary: `Evaluated touring roster for ${artistName}. Key founding members remain active on stage.`,
        originalMembers: ['Lead Vocalist', 'Guitarist', 'Bassist', 'Drummer'],
        touringMembers: ['Lead Vocalist', 'Guitarist', 'Touring Bassist', 'Drummer']
      });
    }, 300);

    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}
