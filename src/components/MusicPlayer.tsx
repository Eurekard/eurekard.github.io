import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { cn } from '../lib/utils';
import { parseMusicUrl } from '../lib/music';

type YTPlayerX = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  destroy: () => void;
  getVideoData?: () => { title?: string; author?: string; video_id?: string };
  getPlaylist?: () => string[] | void;
  getPlaylistIndex?: () => number;
  nextVideo?: () => void;
  previousVideo?: () => void;
  playVideoAt?: (index: number) => void;
  loadVideoById?: (videoId: { videoId: string } | string) => void;
};

type YTNamespace = {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayerX;
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
  /** 全局主文字色（字、播放鍵圖示、進度、時間） */
  textColor?: string;
  className?: string;
  style?: React.CSSProperties;
};

export default function MusicPlayer({ url, borderColor, textColor, className, style }: Props) {
  const parsed = useMemo(() => parseMusicUrl(url), [url]);
  if (parsed.kind === 'video') {
    return (
      <YouTubeBarPlayer
        videoId={parsed.videoId}
        playlistId={parsed.playlistId}
        borderColor={borderColor}
        textColor={textColor}
        className={className}
        style={style}
      />
    );
  }
  if (parsed.kind === 'playlist') {
    return (
      <YouTubeBarPlayer
        videoId={undefined}
        playlistId={parsed.playlistId}
        borderColor={borderColor}
        textColor={textColor}
        className={className}
        style={style}
      />
    );
  }

  return (
    <div style={style} className={cn('w-full rounded-[2rem] border p-4 text-center text-sm opacity-70', className)}>
      請貼上有效的 <strong>YouTube</strong> 或 <strong>YouTube Music</strong> 影片／播放清單連結
    </div>
  );
}

type OEmbed = { title?: string; author_name?: string };

async function fetchYouTubeOEmbedByVideoId(videoId: string): Promise<OEmbed | null> {
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
  playlistId,
  borderColor,
  textColor,
  className,
  style,
}: {
  videoId?: string;
  playlistId?: string;
  borderColor?: string;
  textColor?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const isPlaylist = !!playlistId;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerX | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [title, setTitle] = useState('YouTube');
  const [author, setAuthor] = useState('');
  const [thumb, setThumb] = useState(() => (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : ''));
  const dragRef = useRef(false);

  const uiColor = textColor || (style as any)?.color;

  const syncMeta = async (vid?: string) => {
    if (!vid) return;
    setThumb(`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`);
    const meta = await fetchYouTubeOEmbedByVideoId(vid);
    if (meta?.title) setTitle(meta.title);
    if (meta?.author_name) setAuthor(meta.author_name);
  };

  useEffect(() => {
    if (videoId) void syncMeta(videoId);
  }, [videoId]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    void (async () => {
      const YT = await loadYouTubeIframeApi();
      if (cancelled || !hostRef.current) return;
      playerRef.current?.destroy?.();

      const playerVars: Record<string, string | number> = {
        controls: 0,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
        origin: window.location.origin,
      };

      if (playlistId) {
        playerVars.listType = 'playlist';
        playerVars.list = playlistId;
      }

      const p = new YT.Player(hostRef.current, {
        videoId: videoId || undefined,
        width: 200,
        height: 200,
        playerVars,
        events: {
          onReady: (e: { target: YTPlayerX }) => {
            setReady(true);
            try {
              if (videoId && playlistId) e.target.loadVideoById?.(videoId);
            } catch {
              /* ignore */
            }
            try {
              const d = e.target.getDuration();
              if (d && Number.isFinite(d)) setDuration(d);
            } catch {
              /* ignore */
            }
            let vd = (e.target as YTPlayerX).getVideoData?.();
            if (vd?.title) setTitle(vd.title);
            if (vd?.author) setAuthor((prev) => prev || vd.author || '');
            if (vd?.video_id) {
              setThumb(`https://i.ytimg.com/vi/${vd.video_id}/hqdefault.jpg`);
              void syncMeta(vd.video_id);
            }
          },
          onStateChange: (e: { data: number; target: YTPlayerX }) => {
            const ps = YT.PlayerState;
            setPlaying(e.data === ps.PLAYING);
            if (e.data === ps.PLAYING) {
              const vd = (e.target as YTPlayerX).getVideoData?.();
              if (vd?.title) setTitle(vd.title);
              if (vd?.author) setAuthor((prev) => (vd.author ? prev || vd.author : prev));
              if (vd?.video_id) {
                setThumb(`https://i.ytimg.com/vi/${vd.video_id}/hqdefault.jpg`);
                void syncMeta(vd.video_id);
              }
            }
            if (e.data === ps.ENDED) {
              setPlaying(false);
              setCurrent(0);
              const p2 = e.target;
              try {
                const pl = p2.getPlaylist?.();
                if (playlistId) {
                  if (Array.isArray(pl) && pl.length > 0) {
                    const idx = p2.getPlaylistIndex?.() ?? 0;
                    if (idx < pl.length - 1) {
                      p2.nextVideo?.();
                    } else {
                      p2.playVideoAt?.(0);
                    }
                  } else {
                    p2.seekTo(0, true);
                    p2.playVideo();
                  }
                } else {
                  p2.seekTo(0, true);
                  p2.playVideo();
                }
              } catch (err) {
                console.error("YouTube 播放器執行錯誤:", err);
              }
            }
          },
        },
      }) as unknown as YTPlayerX;

      playerRef.current = p;
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
  }, [videoId, playlistId, isPlaylist]);

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
    <div
      style={{ ...style, borderColor, ...(uiColor ? { color: uiColor, ['--eurek-music' as any]: uiColor } : {}) }}
      className={cn('w-full rounded-[2rem] border overflow-hidden bg-white/40', !uiColor && 'text-chocolate', className)}
    >
      <div ref={hostRef} className="pointer-events-none fixed left-[-240px] top-0 h-[200px] w-[200px] opacity-0" aria-hidden />

      <div className="p-3 space-y-2" style={uiColor ? { color: uiColor } : undefined}>
        <div className="flex items-center gap-3">
          <div
            className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border bg-black/5"
            style={borderColor ? { borderColor } : undefined}
          >
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-sm font-black leading-tight line-clamp-2">{title}</div>
            <div className="text-xs opacity-80 line-clamp-1 mt-0.5">{author || 'YouTube'}</div>
          </div>

          <div className="flex items-center gap-0.5 shrink-0" style={uiColor ? { color: uiColor } : undefined}>
            {isPlaylist ? (
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-current/25 bg-white/0 disabled:opacity-40"
                style={uiColor ? { color: uiColor, borderColor: `${uiColor}33` } : undefined}
                aria-label="上一首"
                onClick={() => {
                  try {
                    playerRef.current?.previousVideo?.();
                  } catch {
                    /* ignore */
                  }
                }}
              >
                <ChevronLeft size={18} className="opacity-80" style={uiColor ? { color: uiColor } : undefined} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={toggle}
              disabled={!ready}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-current/25 bg-white/0 disabled:opacity-40"
              style={uiColor ? { color: uiColor, borderColor: `${uiColor}33` } : undefined}
              aria-label={playing ? '暫停' : '播放'}
            >
              {playing ? <Pause size={18} style={uiColor ? { color: uiColor } : undefined} /> : <Play size={18} className="translate-x-px" style={uiColor ? { color: uiColor } : undefined} />}
            </button>
            {isPlaylist ? (
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-current/25 bg-white/0 disabled:opacity-40"
                style={uiColor ? { color: uiColor, borderColor: `${uiColor}33` } : undefined}
                aria-label="下一首"
                onClick={() => {
                  try {
                    playerRef.current?.nextVideo?.();
                  } catch {
                    /* ignore */
                  }
                }}
              >
                <ChevronRight size={18} className="opacity-80" style={uiColor ? { color: uiColor } : undefined} />
              </button>
            ) : null}
          </div>
        </div>

        <div
          className="h-1.5 rounded-full overflow-hidden cursor-pointer"
          style={uiColor ? { backgroundColor: `${uiColor}2a` } : { backgroundColor: 'rgba(61,43,31,0.1)' }}
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
          <div
            className="h-full"
            style={{
              width: `${duration ? Math.min(100, (current / duration) * 100) : 0}%`,
              backgroundColor: uiColor || 'var(--color-chocolate, #3D2B1F)',
            }}
          />
        </div>

        <div
          className="flex items-center justify-between px-0.5 text-[10px] font-mono tabular-nums"
          style={uiColor ? { color: uiColor, opacity: 0.8 } : { color: 'rgba(61,43,31,0.55)' }}
        >
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
