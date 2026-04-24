import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
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
    return <YouTubeBarPlayer videoId={parsed.videoId} borderColor={borderColor} className={className} style={style} />;
  }

  return (
    <div style={style} className={cn('w-full rounded-[2rem] border p-4 text-center text-sm opacity-70', className)}>
      請貼上 <strong>YouTube</strong> 或 <strong>YouTube Music</strong> 連結（不支援 Spotify）
    </div>
  );
}

type OEmbed = { title?: string; author_name?: string };

async function fetchYouTubeOEmbed(videoId: string): Promise<OEmbed | null> {
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const u = new URL('https://www.youtube.com/oembed');
    u.searchParams.set('url', watchUrl);
    u.searchParams.set('format', 'json');
    const res = await fetch(u.toString());
    if (!res.ok) return null;
    return (await res.json()) as OEmbed;
  } catch {
    return null;
  }
}

function YouTubeBarPlayer({
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
    void (async () => {
      const meta = await fetchYouTubeOEmbed(videoId);
      if (cancelled || !meta) return;
      if (meta.title) setTitle(meta.title);
      if (meta.author_name) setAuthor(meta.author_name);
    })();
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    void (async () => {
      const YT = await loadYouTubeIframeApi();
      if (cancelled || !hostRef.current) return;
      playerRef.current?.destroy?.();
      playerRef.current = new YT.Player(hostRef.current, {
        videoId,
        width: '200',
        height: '200',
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
              if (t?.author) setAuthor((prev) => prev || t.author || '');
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
      {/* IFrame API 仍需要 iframe 節點，但可移出畫面 */}
      <div ref={hostRef} className="pointer-events-none fixed left-[-240px] top-0 h-[200px] w-[200px] opacity-0" aria-hidden />

      <div className="p-3 space-y-2">
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border bg-black/5" style={{ borderColor }}>
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-sm font-black leading-tight line-clamp-2">{title}</div>
            <div className="text-xs opacity-70 line-clamp-1 mt-0.5">{author || 'YouTube'}</div>
          </div>

          <button
            type="button"
            onClick={toggle}
            disabled={!ready}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-chocolate/15 bg-white text-chocolate shadow-sm disabled:opacity-40"
            aria-label={playing ? '暫停' : '播放'}
          >
            {playing ? <Pause size={18} /> : <Play size={18} className="translate-x-px" />}
          </button>
        </div>

        <div
          className="h-1.5 rounded-full bg-chocolate/10 overflow-hidden cursor-pointer"
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

        <div className="flex items-center justify-between px-0.5 text-[10px] font-mono tabular-nums text-chocolate/55">
          <span>{formatTime(current)}</span>
          <span>{formatTime(duration)}</span>
        </div>
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
