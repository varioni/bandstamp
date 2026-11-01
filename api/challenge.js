// Vercel Serverless Function: Lineup Challenge Endpoint
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { artist, proposedLineup } = req.body || {};

    if (!artist || !proposedLineup) {
      return res.status(400).json({ error: 'Artist and proposed lineup details are required.' });
    }

    return res.status(200).json({
      success: true,
      message: `Challenge submitted for ${artist}. Verification pending.`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error processing challenge.' });
  }
}
