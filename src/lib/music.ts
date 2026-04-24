const YOUTUBE_VIDEO_REGEX = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/;
const YOUTUBE_MUSIC_REGEX = /music\.youtube\.com\/(?:watch\?v=)([a-zA-Z0-9_-]{6,})/;
const PLAYLIST_IN_URL = /[?&]list=([a-zA-Z0-9_-]+)/;

/**
 * 僅用於音樂元件：支援單部影片、影片+清單、或單一播放清單網址。
 */
export type ParsedMusicUrl =
  | { kind: 'video'; videoId: string; playlistId?: string }
  | { kind: 'playlist'; playlistId: string }
  | { kind: 'unknown' };

export function parseMusicUrl(raw: string): ParsedMusicUrl {
  const input = (raw || '').trim();
  if (!input) return { kind: 'unknown' };

  const listMatch = input.match(PLAYLIST_IN_URL);
  const listId = listMatch?.[1];

  const ytm = input.match(YOUTUBE_MUSIC_REGEX);
  if (ytm?.[1]) {
    return { kind: 'video', videoId: ytm[1], playlistId: listId || undefined };
  }

  if (/\/playlist\?/i.test(input) && listId) {
    return { kind: 'playlist', playlistId: listId };
  }

  const yt = input.match(YOUTUBE_VIDEO_REGEX);
  if (yt?.[1]) {
    if (listId) return { kind: 'video', videoId: yt[1], playlistId: listId };
    return { kind: 'video', videoId: yt[1] };
  }

  if (listId && /youtube\.com\//.test(input)) {
    return { kind: 'playlist', playlistId: listId };
  }

  return { kind: 'unknown' };
}
