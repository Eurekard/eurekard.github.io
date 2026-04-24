const YOUTUBE_REGEX = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/;
const YOUTUBE_MUSIC_REGEX = /music\.youtube\.com\/(?:watch\?v=)([a-zA-Z0-9_-]{6,})/;
const SPOTIFY_REGEX = /open\.spotify\.com\/(track|playlist|album|episode)\/([a-zA-Z0-9]+)/;

export type MusicProvider = 'youtube' | 'spotify' | 'unknown';

export type ParsedMusicUrl =
  | { provider: 'youtube'; videoId: string }
  | { provider: 'spotify'; kind: 'track' | 'playlist' | 'album' | 'episode'; id: string }
  | { provider: 'unknown' };

export function parseMusicUrl(raw: string): ParsedMusicUrl {
  const input = (raw || '').trim();
  if (!input) return { provider: 'unknown' };

  const ytm = input.match(YOUTUBE_MUSIC_REGEX);
  if (ytm?.[1]) return { provider: 'youtube', videoId: ytm[1] };

  const yt = input.match(YOUTUBE_REGEX);
  if (yt?.[1]) return { provider: 'youtube', videoId: yt[1] };

  const sp = input.match(SPOTIFY_REGEX);
  if (sp?.[1] && sp?.[2]) {
    const k = sp[1];
    if (k === 'track' || k === 'playlist' || k === 'album' || k === 'episode') {
      return { provider: 'spotify', kind: k, id: sp[2] };
    }
  }

  return { provider: 'unknown' };
}
