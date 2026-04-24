import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { cn } from '../lib/utils';
import { parseMusicUrl } from '../lib/music';

type YTPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  destroy: () => void;
};

type YTNamespace = {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve) => {
    const prior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prior?.();
      resolve(window.YT as YTNamespace);
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
}

type Props = {
  url: string;
  borderColor?: string;
  className?: string;
  style?: React.CSSProperties;
};

export default function MusicPlayer({ url, borderColor, className, style }: Props) {
  const parsed = useMemo(() => parseMusicUrl(url), [url]);

  if (parsed.provider === 'youtube') {
    return <YouTubeCustomPlayer videoId={parsed.videoId} borderColor={borderColor} className={className} style={style} />;
  }
  if (parsed.provider === 'spotify') {
    return <SpotifyCustomPlayer kind={parsed.kind} id={parsed.id} borderColor={borderColor} className={className} style={style} />;
  }

  return (
    <div style={style} className={cn('w-full rounded-[2rem] border p-6 text-center text-sm opacity-70', className)}>
      請貼上 YouTube / YouTube Music 或 Spotify（曲目、歌單、專輯、單集）連結
    </div>
  );
}

function YouTubeCustomPlayer({
  videoId,
  borderColor,
  className,
  style,
}: {
  videoId: string;
  borderColor?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [title, setTitle] = useState('YouTube');
  const [author, setAuthor] = useState('');
  const [thumb, setThumb] = useState(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
  const dragRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    void (async () => {
      const YT = await loadYouTubeIframeApi();
      if (cancelled || !hostRef.current) return;
      playerRef.current?.destroy?.();
      playerRef.current = new YT.Player(hostRef.current, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          controls: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (e: { target: YTPlayer }) => {
            setReady(true);
            try {
              const d = e.target.getDuration();
              if (d && Number.isFinite(d)) setDuration(d);
            } catch {
              /* ignore */
            }
            try {
              const t = (e.target as unknown as { getVideoData?: () => { title?: string; author?: string } }).getVideoData?.();
              if (t?.title) setTitle(t.title);
              if (t?.author) setAuthor(t.author);
            } catch {
              /* ignore */
            }
          },
          onStateChange: (e: { data: number }) => {
            const ps = YT.PlayerState;
            setPlaying(e.data === ps.PLAYING);
            if (e.data === ps.ENDED) {
              setPlaying(false);
              setCurrent(0);
            }
          },
        },
      }) as unknown as YTPlayer;
    })();

    const tick = () => {
      const p = playerRef.current;
      if (!p) return;
      try {
        setCurrent(p.getCurrentTime() || 0);
        const d = p.getDuration();
        if (d && Number.isFinite(d)) {
          setDuration((prev) => (Math.abs(prev - d) > 0.25 ? d : prev));
        }
      } catch {
        /* ignore */
      }
    };
    timer = window.setInterval(tick, 250);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      try {
        playerRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
      setReady(false);
      setPlaying(false);
      setCurrent(0);
      setDuration(0);
    };
  }, [videoId]);

  const toggle = () => {
    const p = playerRef.current;
    if (!p) return;
    try {
      const YT = window.YT;
      const state = p.getPlayerState?.();
      if (YT && state === YT.PlayerState.PLAYING) p.pauseVideo();
      else p.playVideo();
    } catch {
      /* ignore */
    }
  };

  const seekRatio = (ratio: number) => {
    const p = playerRef.current;
    if (!p || !duration) return;
    const next = Math.min(duration, Math.max(0, ratio * duration));
    p.seekTo(next, true);
    setCurrent(next);
  };

  const onBarPointer = (clientX: number, rect: DOMRect) => {
    const ratio = (clientX - rect.left) / rect.width;
    seekRatio(Math.min(1, Math.max(0, ratio)));
  };

  return (
    <div style={{ ...style, borderColor }} className={cn('w-full rounded-[2rem] border overflow-hidden bg-white/40', className)}>
      <div className="relative aspect-square w-full bg-black/5">
        <div ref={hostRef} className="absolute inset-0 opacity-0 pointer-events-none" aria-hidden />
        <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
          <div className="text-sm font-black leading-tight line-clamp-2">{title}</div>
          {author ? <div className="text-xs opacity-80 mt-1 line-clamp-1">{author}</div> : null}
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div
          className="h-2 rounded-full bg-chocolate/10 overflow-hidden cursor-pointer"
          onPointerDown={(e) => {
            dragRef.current = true;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            onBarPointer(e.clientX, rect);
          }}
          onPointerMove={(e) => {
            if (!dragRef.current) return;
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            onBarPointer(e.clientX, rect);
          }}
          onPointerUp={() => {
            dragRef.current = false;
          }}
          onPointerCancel={() => {
            dragRef.current = false;
          }}
        >
          <div className="h-full bg-chocolate/70" style={{ width: `${duration ? Math.min(100, (current / duration) * 100) : 0}%` }} />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] font-mono tabular-nums text-chocolate/60">
            {formatTime(current)} / {formatTime(duration)}
          </div>
          <button
            type="button"
            onClick={toggle}
            disabled={!ready}
            className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-chocolate/15 bg-white text-chocolate shadow-sm disabled:opacity-40"
            aria-label={playing ? '暫停' : '播放'}
          >
            {playing ? <Pause size={20} /> : <Play size={20} className="translate-x-px" />}
          </button>
        </div>
      </div>
    </div>
  );
}

type SpotifyResolveTrack = {
  id: string;
  title: string;
  artist: string;
  image?: string;
  previewUrl: string | null;
  pageUrl: string;
};

type SpotifyResolveResponse =
  | (SpotifyResolveTrack & { kind: 'track' | 'episode' })
  | {
      kind: 'playlist' | 'album';
      id: string;
      title: string;
      artist: string;
      image?: string;
      pageUrl: string;
      tracks: SpotifyResolveTrack[];
    };

function SpotifyCustomPlayer({
  kind,
  id,
  borderColor,
  className,
  style,
}: {
  kind: 'track' | 'playlist' | 'album' | 'episode';
  id: string;
  borderColor?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const fallbackPageUrl = `https://open.spotify.com/${kind}/${id}`;
  const [openUrl, setOpenUrl] = useState(fallbackPageUrl);
  const [metaTitle, setMetaTitle] = useState('Spotify');
  const [metaAuthor, setMetaAuthor] = useState('');
  const [thumb, setThumb] = useState<string | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [tracks, setTracks] = useState<SpotifyResolveTrack[]>([]);
  const [trackIndex, setTrackIndex] = useState(0);
  const [resolveHint, setResolveHint] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const dragRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setResolveHint(null);
      setTracks([]);
      setTrackIndex(0);
      setPreviewUrl(null);
      setOpenUrl(fallbackPageUrl);

      try {
        const endpoint = `/api/spotify-resolve?url=${encodeURIComponent(fallbackPageUrl)}`;
        const res = await fetch(endpoint);
        const json = (await res.json().catch(() => null)) as any;
        if (cancelled) return;

        if (!res.ok) {
          const msg = typeof json?.error === 'string' ? json.error : `HTTP ${res.status}`;
          setResolveHint(res.status === 501 ? `Spotify 歌單/專輯解析需要後端設定：${msg}` : `Spotify 資料讀取失敗：${msg}`);
          return;
        }

        const payload = json as SpotifyResolveResponse;
        if (!payload?.kind) return;

        setOpenUrl(payload.pageUrl || fallbackPageUrl);
        setMetaTitle(payload.title || 'Spotify');
        setMetaAuthor(payload.artist || '');
        setThumb(payload.image);

        if (payload.kind === 'playlist' || payload.kind === 'album') {
          const list = Array.isArray(payload.tracks) ? payload.tracks : [];
          setTracks(list);
          setTrackIndex(0);
          const first = list[0];
          setPreviewUrl(first?.previewUrl || null);
          if (first?.image) setThumb(first.image);
          if (first?.title) setMetaTitle(first.title);
          if (first?.artist) setMetaAuthor(first.artist);
          if (first?.pageUrl) setOpenUrl(first.pageUrl);
          return;
        }

        // track / episode
        setTracks([]);
        setTrackIndex(0);
        setPreviewUrl((payload as any).previewUrl || null);
      } catch (e) {
        if (!cancelled) setResolveHint('Spotify 資料讀取失敗（網路或設定問題）。');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, id, fallbackPageUrl]);

  useEffect(() => {
    if (tracks.length === 0) return;
    const t = tracks[Math.max(0, Math.min(tracks.length - 1, trackIndex))];
    if (!t) return;
    setPreviewUrl(t.previewUrl);
    if (t.image) setThumb(t.image);
    setMetaTitle(t.title);
    setMetaAuthor(t.artist);
    if (t.pageUrl) setOpenUrl(t.pageUrl);
  }, [trackIndex, tracks]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCurrent(a.currentTime || 0);
    const onMeta = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
    };
  }, [previewUrl]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    if (previewUrl) {
      a.src = previewUrl;
      void a.load();
    } else {
      a.removeAttribute('src');
      void a.load();
    }
  }, [previewUrl]);

  const toggle = async () => {
    const a = audioRef.current;
    if (!a || !previewUrl) return;
    if (a.paused) {
      try {
        await a.play();
      } catch {
        /* ignore */
      }
    } else {
      a.pause();
    }
  };

  const seekRatio = (ratio: number) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    a.currentTime = Math.min(duration, Math.max(0, ratio * duration));
    setCurrent(a.currentTime);
  };

  const canPrevNext = (kind === 'playlist' || kind === 'album') && tracks.length > 1;

  return (
    <div style={{ ...style, borderColor }} className={cn('w-full rounded-[2rem] border overflow-hidden bg-white/40', className)}>
      <audio ref={audioRef} className="hidden" />

      <div className="relative aspect-square w-full bg-black/5">
        {thumb ? <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
          <div className="text-sm font-black leading-tight line-clamp-2">{metaTitle}</div>
          {metaAuthor ? <div className="text-xs opacity-80 mt-1 line-clamp-1">{metaAuthor}</div> : null}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {resolveHint ? <div className="text-xs text-chocolate/60">{resolveHint}</div> : null}
        {!previewUrl ? (
          <div className="text-xs text-chocolate/60">
            這首歌可能沒有提供 30 秒試聽（Spotify 不一定提供 preview）。你可以改用 YouTube / YouTube Music，或點下方在 Spotify 開啟完整版。
          </div>
        ) : null}

        <div
          className="h-2 rounded-full bg-chocolate/10 overflow-hidden cursor-pointer"
          onPointerDown={(e) => {
            if (!previewUrl) return;
            dragRef.current = true;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            seekRatio(Math.min(1, Math.max(0, ratio)));
          }}
          onPointerMove={(e) => {
            if (!dragRef.current || !previewUrl) return;
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            seekRatio(Math.min(1, Math.max(0, ratio)));
          }}
          onPointerUp={() => {
            dragRef.current = false;
          }}
          onPointerCancel={() => {
            dragRef.current = false;
          }}
        >
          <div className="h-full bg-chocolate/70" style={{ width: `${duration ? Math.min(100, (current / duration) * 100) : 0}%` }} />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {canPrevNext ? (
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-chocolate/10 bg-white text-chocolate"
                onClick={() => setTrackIndex((i) => (i - 1 + tracks.length) % tracks.length)}
                aria-label="上一首"
              >
                <ChevronLeft size={18} />
              </button>
            ) : null}
            {canPrevNext ? (
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-chocolate/10 bg-white text-chocolate"
                onClick={() => setTrackIndex((i) => (i + 1) % tracks.length)}
                aria-label="下一首"
              >
                <ChevronRight size={18} />
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <div className="text-[11px] font-mono tabular-nums text-chocolate/60">
              {formatTime(current)} / {formatTime(duration)}
            </div>
            <button
              type="button"
              onClick={toggle}
              disabled={!previewUrl}
              className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-chocolate/15 bg-white text-chocolate shadow-sm disabled:opacity-40"
              aria-label={playing ? '暫停' : '播放'}
            >
              {playing ? <Pause size={20} /> : <Play size={20} className="translate-x-px" />}
            </button>
          </div>
        </div>

        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs font-bold text-chocolate/70 hover:text-chocolate underline-offset-4 hover:underline"
        >
          在 Spotify 開啟
        </a>
      </div>
    </div>
  );
}

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
