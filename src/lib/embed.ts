const YOUTUBE_REGEX = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/;
const SPOTIFY_REGEX = /open\.spotify\.com\/(track|playlist|album|episode)\/([a-zA-Z0-9]+)/;
const YOUTUBE_MUSIC_REGEX = /music\.youtube\.com\/(?:watch\?v=)([a-zA-Z0-9_-]{6,})/;

export function buildEmbedHtmlFromUrl(rawUrl: string): string {
  const input = rawUrl.trim();
  if (!input) return '';

  const youtubeMatch = input.match(YOUTUBE_REGEX);
  if (youtubeMatch?.[1]) {
    const id = youtubeMatch[1];
    return `<iframe width="100%" height="360" src="https://www.youtube.com/embed/${id}" title="YouTube video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
  }

  const ytmMatch = input.match(YOUTUBE_MUSIC_REGEX);
  if (ytmMatch?.[1]) {
    const id = ytmMatch[1];
    return `<iframe width="100%" height="180" src="https://www.youtube.com/embed/${id}" title="YouTube Music" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  }

  const spotifyMatch = input.match(SPOTIFY_REGEX);
  if (spotifyMatch?.[1] && spotifyMatch?.[2]) {
    const kind = spotifyMatch[1];
    const id = spotifyMatch[2];
    return `<iframe style="border-radius:12px" src="https://open.spotify.com/embed/${kind}/${id}" width="100%" height="352" frameborder="0" allowfullscreen="" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
  }

  if (input.startsWith('<iframe')) {
    return input;
  }

  return '';
}

export function supportsEmbedUrl(rawUrl: string): boolean {
  return buildEmbedHtmlFromUrl(rawUrl).length > 0;
}
