// Lightweight input sanitization & IP rate limiting helper

/**
 * Validates whether a band name input is legitimate or likely random keyboard noise.
 */
function isValidBandName(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();

  // Length boundaries
  if (trimmed.length < 2 || trimmed.length > 50) return false;

  // Reject strings with no vowels (e.g. "sdfghjk", "qwrtyp") unless it's a known short acronym like "UB40" or "R.E.M."
  const hasVowels = /[aeiouyAEIOUY0-9]/.test(trimmed);
  if (!hasVowels && trimmed.length > 3) return false;

  // Reject 4 or more identical consecutive characters (e.g. "aaaaa", "zzzzzzz")
  if (/(.)\1{3,}/.test(trimmed)) return false;

  // Allow standard letters, numbers, spaces, and typical band punctuation (& . ' - / + ! ?)
  const validCharRegex = /^[a-zA-Z0-9\s&.\'\/\+\!\?\-\#]+$/;
  return validCharRegex.test(trimmed);
}

/**
 * IP Rate Limiter using Upstash Redis REST API
 * @param {string} ip - Client IP address
 * @param {string} action - 'audit' or 'challenge'
 * @param {number} limit - Maximum allowed requests in window
 * @param {number} windowSeconds - Expiration window in seconds (default 1 hour)
 */
async function checkRateLimit(ip, action, limit = 10, windowSeconds = 3600) {
  let KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN;

  if (!KV_URL || !KV_TOKEN) return { allowed: true }; // Pass through if Redis is unconfigured

  if (!KV_URL.startsWith('http')) KV_URL = `https://${KV_URL}`;
  if (KV_URL.endsWith('/')) KV_URL = KV_URL.slice(0, -1);

  const cleanIp = ip.split(',')[0].trim().replace(/[^a-zA-Z0-9.:_]/g, '');
  const rateKey = `ratelimit:${action}:${cleanIp}`;

  try {
    // Pipeline INCR and EXPIRE in a single multi-command POST to Upstash
    const pipeRes = await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([
        ['INCR', rateKey],
        ['EXPIRE', rateKey, windowSeconds]
      ])
    });

    if (pipeRes.ok) {
      const data = await pipeRes.json();
      const currentCount = data[0]?.result || 0;
      if (currentCount > limit) {
        return { allowed: false, count: currentCount, limit };
      }
    }
  } catch (err) {
    console.warn("Rate limit check error:", err.message);
  }

  return { allowed: true };
}

module.exports = { isValidBandName, checkRateLimit };
  
