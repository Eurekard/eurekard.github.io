const YOUTUBE_REGEX = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/;
const YOUTUBE_MUSIC_REGEX = /music\.youtube\.com\/(?:watch\?v=)([a-zA-Z0-9_-]{6,})/;

export type ParsedMusicUrl = { provider: 'youtube'; videoId: string } | { provider: 'unknown' };

export function parseMusicUrl(raw: string): ParsedMusicUrl {
  const input = (raw || '').trim();
  if (!input) return { provider: 'unknown' };

  const ytm = input.match(YOUTUBE_MUSIC_REGEX);
  if (ytm?.[1]) return { provider: 'youtube', videoId: ytm[1] };

  const yt = input.match(YOUTUBE_REGEX);
  if (yt?.[1]) return { provider: 'youtube', videoId: yt[1] };

  return { provider: 'unknown' };
}
