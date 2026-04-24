import { resolveSpotifyFromUrl } from '../src/lib/spotifyResolve';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.end();
  }

  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.json({ error: 'Method not allowed' });
  }

  const rawUrl = String(req.query.url || '').trim();

  try {
    const payload = await resolveSpotifyFromUrl(rawUrl);
    return res.status(200).json(payload);
  } catch (e: any) {
    const message = typeof e?.message === 'string' ? e.message : 'unknown error';
    const missingCreds = message.includes('Missing SPOTIFY_CLIENT_ID');
    const badRequest = Number(e?.statusCode) === 400 || message.includes('Invalid spotify url');
    res.statusCode = badRequest ? 400 : missingCreds ? 501 : 500;
    return res.json({ error: message });
  }
}
