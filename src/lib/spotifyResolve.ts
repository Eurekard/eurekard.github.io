const SPOTIFY_REGEX = /open\.spotify\.com\/(track|playlist|album|episode)\/([a-zA-Z0-9]+)/;

type SpotifyTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type SpotifyTrack = {
  id: string;
  name: string;
  artists?: Array<{ name: string }>;
  album?: { images?: Array<{ url: string; height?: number; width?: number }> };
  preview_url: string | null;
  external_urls?: { spotify?: string };
};

type SpotifyPlaylistTracksResponse = {
  items: Array<{ track: SpotifyTrack | null }>;
};

type SpotifyAlbumTracksResponse = {
  items: SpotifyTrack[];
};

type SpotifyEpisode = {
  id: string;
  name: string;
  images?: Array<{ url: string }>;
  show?: { name?: string };
  audio_preview_url?: string | null;
  external_urls?: { spotify?: string };
};

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getClientCredentialsToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) return cachedToken.token;

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET');
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify token error: ${res.status} ${text}`);
  }
  const json = (await res.json()) as SpotifyTokenResponse;
  cachedToken = {
    token: json.access_token,
    expiresAt: now + (json.expires_in || 3600) * 1000,
  };
  return cachedToken.token;
}

async function spotifyFetch(path: string) {
  const token = await getClientCredentialsToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify API error: ${res.status} ${text}`);
  }
  return res.json() as Promise<any>;
}

function bestImage(images?: Array<{ url: string }>) {
  return images?.[0]?.url;
}

export async function resolveSpotifyFromUrl(rawUrl: string) {
  const match = rawUrl.match(SPOTIFY_REGEX);
  if (!match?.[1] || !match?.[2]) {
    const err: any = new Error('Invalid spotify url');
    err.statusCode = 400;
    throw err;
  }

  const kind = match[1] as 'track' | 'playlist' | 'album' | 'episode';
  const id = match[2];

  if (kind === 'track') {
    const track = (await spotifyFetch(`/tracks/${id}`)) as SpotifyTrack;
    return {
      kind,
      id,
      title: track.name,
      artist: track.artists?.map((a) => a.name).filter(Boolean).join(', ') || '',
      image: bestImage(track.album?.images),
      previewUrl: track.preview_url,
      pageUrl: track.external_urls?.spotify || `https://open.spotify.com/track/${id}`,
    };
  }

  if (kind === 'episode') {
    const ep = (await spotifyFetch(`/episodes/${id}`)) as SpotifyEpisode;
    return {
      kind,
      id,
      title: ep.name,
      artist: ep.show?.name || '',
      image: bestImage(ep.images),
      previewUrl: ep.audio_preview_url || null,
      pageUrl: ep.external_urls?.spotify || `https://open.spotify.com/episode/${id}`,
    };
  }

  if (kind === 'album') {
    const album = await spotifyFetch(`/albums/${id}`);
    const tracksResp = (await spotifyFetch(`/albums/${id}/tracks?limit=50`)) as SpotifyAlbumTracksResponse;
    const tracks: SpotifyTrack[] = [];
    for (const item of tracksResp.items || []) {
      const full = (await spotifyFetch(`/tracks/${item.id}`)) as SpotifyTrack;
      tracks.push(full);
    }
    return {
      kind,
      id,
      title: album.name,
      artist: album.artists?.map((a: any) => a.name).filter(Boolean).join(', ') || '',
      image: bestImage(album.images),
      pageUrl: album.external_urls?.spotify || `https://open.spotify.com/album/${id}`,
      tracks: tracks.map((t) => ({
        id: t.id,
        title: t.name,
        artist: t.artists?.map((a) => a.name).filter(Boolean).join(', ') || '',
        image: bestImage(t.album?.images),
        previewUrl: t.preview_url,
        pageUrl: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
      })),
    };
  }

  const playlist = await spotifyFetch(`/playlists/${id}`);
  const tracksResp = (await spotifyFetch(`/playlists/${id}/tracks?limit=50`)) as SpotifyPlaylistTracksResponse;
  const tracks: SpotifyTrack[] = [];
  for (const row of tracksResp.items || []) {
    const t = row.track;
    if (!t?.id) continue;
    const full = (await spotifyFetch(`/tracks/${t.id}`)) as SpotifyTrack;
    tracks.push(full);
  }

  return {
    kind,
    id,
    title: playlist.name,
    artist: playlist.owner?.display_name || '',
    image: bestImage(playlist.images),
    pageUrl: playlist.external_urls?.spotify || `https://open.spotify.com/playlist/${id}`,
    tracks: tracks.map((t) => ({
      id: t.id,
      title: t.name,
      artist: t.artists?.map((a) => a.name).filter(Boolean).join(', ') || '',
      image: bestImage(t.album?.images),
      previewUrl: t.preview_url,
      pageUrl: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
    })),
  };
}
