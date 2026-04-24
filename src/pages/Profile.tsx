import React, { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { db } from '../lib/firebase';
import { doc, getDoc, collection, addDoc, query, onSnapshot, where } from 'firebase/firestore';
import { CardData, AnonResponse } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, Send, ExternalLink, MessageSquare, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { buildEmbedHtmlFromUrl } from '../lib/embed';
import MusicPlayer from '../components/MusicPlayer';
import { MoodCounter, VisitorCounter } from '../components/ElementCounters';
import { isHashLink, normalizeLinkTarget, resolveGlobalStyles, toElementStyle, toGlobalPageStyle } from '../lib/cardStyle';
import { detectDevice, detectSource, getAnalyticsDay } from '../lib/analytics';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.use({
  gfm: true,
  breaks: true,
});

export default function Profile() {
  const { username } = useParams();
  const [data, setData] = useState<CardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [anonMessage, setAnonMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [publicReplies, setPublicReplies] = useState<AnonResponse[]>([]);
  const [activeSectionHash, setActiveSectionHash] = useState('');

  useEffect(() => {
    // Set dynamic favicon
    if (data) {
      const avatarUrl = data.profile?.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.uid}`;
      let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.getElementsByTagName('head')[0].appendChild(link);
      }
      link.href = avatarUrl;
      
      // Set document title
      document.title = `${data.profile?.displayName || username} | Eurekard`;
    }
  }, [data, username]);

  useEffect(() => {
    async function fetchData() {
      if (!username) return;
      try {
        // Step 1: Lookup UID from username
        const usernameRef = doc(db, 'usernames', username);
        const usernameSnap = await getDoc(usernameRef);
        
        if (!usernameSnap.exists()) {
          setError(true);
          setLoading(false);
          return;
        }

        const uid = usernameSnap.data().uid;
        
        // Step 2: Fetch Card Data
        const cardRef = doc(db, 'cards', uid);
        const cardSnap = await getDoc(cardRef);
        
        if (cardSnap.exists()) {
          setData(cardSnap.data() as CardData);
          // Set Favicon link dynamically (optional simplification here)
          document.title = `${username} | Eurekard`;
        }
      } catch (err) {
        setError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [username]);

  useEffect(() => {
    if (!data?.uid) {
      setPublicReplies([]);
      return;
    }

    const q = query(
      collection(db, 'cards', data.uid, 'responses'),
      where('status', '==', 'replied')
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const rows = snapshot.docs.map((row) => ({ id: row.id, ...row.data() } as AnonResponse));
      rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      setPublicReplies(rows);
    });

    return () => unsub();
  }, [data?.uid]);

  useEffect(() => {
    if (!data?.uid) return;

    const day = getAnalyticsDay();
    const dedupeKey = `eurekard:view:${data.uid}:${day}`;
    if (window.localStorage.getItem(dedupeKey)) return;

    window.localStorage.setItem(dedupeKey, '1');
    void addDoc(collection(db, 'analytics', data.uid, 'events'), {
      type: 'view',
      day,
      device: detectDevice(),
      source: detectSource(document.referrer),
      createdAt: new Date().toISOString(),
    });
  }, [data?.uid]);

  useEffect(() => {
    const syncHash = () => {
      setActiveSectionHash((window.location.hash || '').replace(/^#/, ''));
    };
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  const handleTrackClick = async (targetId?: string) => {
    if (!data?.uid) return;

    await addDoc(collection(db, 'analytics', data.uid, 'events'), {
      type: 'click',
      day: getAnalyticsDay(),
      device: detectDevice(),
      source: detectSource(document.referrer),
      targetId: targetId || 'button',
      createdAt: new Date().toISOString(),
    });
  };

  const handleSendAnon = async (cardId: string) => {
    if (!anonMessage.trim()) return;
    try {
      await addDoc(collection(db, 'cards', cardId, 'responses'), {
        message: anonMessage,
        createdAt: new Date().toISOString(),
        status: 'unread'
      });
      setSent(true);
      setAnonMessage('');
      setTimeout(() => setSent(false), 3000);
    } catch (err) {
      alert('發送失敗，請稍後再試');
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-cream">
        <div className="w-16 h-16 border-4 border-cat-blue border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-cream p-8 text-center space-y-6">
        <div className="text-8xl">💡</div>
        <h1 className="text-4xl font-bold text-chocolate">哎呀！找不到這個名片</h1>
        <p className="text-chocolate/60">這個連結可能已經失效，或是用戶修改了專屬網址。</p>
        <Link to="/" className="px-8 py-4 bg-chocolate text-white rounded-2xl font-bold">
          返回 Eurekard 首頁
        </Link>
      </div>
    );
  }

  const elements = data.published_content.elements || [];
  const globalStyles = resolveGlobalStyles(data.published_content.styles);
  const pageStyle = toGlobalPageStyle(globalStyles);
  const segmented = splitElementsBySection(elements);
  const fallbackSection = segmented.sections[0]?.hash || 'home';
  const resolvedActiveHash = activeSectionHash || fallbackSection;
  const activeSection = segmented.sections.find((section) => section.hash === resolvedActiveHash) || segmented.sections[0];
  const headerElements = segmented.headerElements;
  const sectionElements = activeSection?.elements || [];
  const footerElements = segmented.footerElements;
  const hasAnyVisibleContent = headerElements.length > 0 || sectionElements.length > 0 || footerElements.length > 0;

  return (
    <div style={pageStyle} className="min-h-screen bg-cream flex flex-col items-center py-20 px-6 relative overflow-x-hidden">
      {/* Decorative Blobs */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-cat-blue/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-chocolate/5 rounded-full blur-[120px]" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[480px] relative z-10"
      >
        {/* Profile Header */}
        <div className="text-center mb-12">
          <motion.div 
            whileHover={{ scale: 1.05 }}
            className="w-32 h-32 rounded-[3rem] mx-auto mb-6 p-1.5 relative overflow-hidden"
          >
            <img 
              src={data.profile?.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.uid}`} 
              alt={data.profile?.displayName || username}
              className="w-full h-full rounded-[2.8rem] object-cover"
            />
          </motion.div>
          <div className="space-y-1">
            <h1 style={{ color: globalStyles.textColor, fontFamily: 'inherit' }} className="text-3xl font-black tracking-tight group flex items-center justify-center gap-1">
              {data.profile?.displayName || username}
            </h1>
          </div>
        </div>

        {/* Dynamic Content */}
        <div className="space-y-6">
          {!hasAnyVisibleContent && (
            <div className="text-center py-20 text-chocolate/20 font-bold uppercase tracking-widest bg-white/20 rounded-[3rem] border border-dashed border-chocolate/5">
              這裡目前還沒有任何內容...
            </div>
          )}

          {headerElements.map((el) => (
            <RenderElement
              key={el.id}
              el={el}
              cardId={data.uid}
              onSendAnon={() => handleSendAnon(data.uid)}
              anonMessage={anonMessage}
              setAnonMessage={setAnonMessage}
              sent={sent}
              isReplyEnabled={data.interactions?.responsesEnabled !== false}
              publicReplies={publicReplies}
              onTrackClick={handleTrackClick}
              globalStyles={globalStyles}
              onHashNavigate={(hash) => setActiveSectionHash(hash.replace(/^#/, ''))}
            />
          ))}

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`section-${resolvedActiveHash}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: 'easeInOut' }}
              className="space-y-6"
            >
              {sectionElements.map((el) => (
                <RenderElement
                  key={el.id}
                  el={el}
                  cardId={data.uid}
                  onSendAnon={() => handleSendAnon(data.uid)}
                  anonMessage={anonMessage}
                  setAnonMessage={setAnonMessage}
                  sent={sent}
                  isReplyEnabled={data.interactions?.responsesEnabled !== false}
                  publicReplies={publicReplies}
                  onTrackClick={handleTrackClick}
                  globalStyles={globalStyles}
                  onHashNavigate={(hash) => setActiveSectionHash(hash.replace(/^#/, ''))}
                />
              ))}
            </motion.div>
          </AnimatePresence>

          {footerElements.map((el) => (
            <RenderElement
              key={el.id}
              el={el}
              cardId={data.uid}
              onSendAnon={() => handleSendAnon(data.uid)}
              anonMessage={anonMessage}
              setAnonMessage={setAnonMessage}
              sent={sent}
              isReplyEnabled={data.interactions?.responsesEnabled !== false}
              publicReplies={publicReplies}
              onTrackClick={handleTrackClick}
              globalStyles={globalStyles}
              onHashNavigate={(hash) => setActiveSectionHash(hash.replace(/^#/, ''))}
            />
          ))}
        </div>

        {/* Footer */}
        <footer className="mt-20 text-center space-y-6">
          <Link to="/" className="inline-flex items-center gap-2 px-6 py-3 bg-white/50 backdrop-blur-md rounded-full border border-white/50 text-xs font-black text-chocolate uppercase tracking-widest hover:bg-white transition-all">
            <LightbulbLogo />
            使用 Eurekard 製作
          </Link>
          <p className="text-[10px] text-chocolate/30 font-bold uppercase tracking-[0.2em]">
            © {new Date().getFullYear()} • EUREKARD INC.
          </p>
        </footer>
      </motion.div>
    </div>
  );
}

function RenderElement({ el, cardId, onSendAnon, anonMessage, setAnonMessage, sent, isReplyEnabled, publicReplies, onTrackClick, globalStyles, onHashNavigate }: any) {
  const { type, content } = el;
  const visualStyle = toElementStyle(el.style);
  const baseComponentStyle = {
    backgroundColor: globalStyles?.componentBackgroundColor,
    borderColor: globalStyles?.componentBorderColor,
    color: globalStyles?.textColor,
  };

  if (type === 'text') {
    const alignClass = content.align === 'left' ? 'text-left' : content.align === 'right' ? 'text-right' : 'text-center';
    const html = DOMPurify.sanitize(marked.parse(String(content.text || '')) as string);
    return (
      <div
        style={{ color: globalStyles?.textColor }}
        className={cn(
          "font-bold leading-tight mx-auto px-4",
          alignClass,
          content.size === '6xl' ? 'text-4xl md:text-5xl font-black mb-4' : 'text-lg opacity-80'
        )}
      >
        <div
          className="markdown-body max-w-none prose-strong:font-black"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }

  if (type === 'button') {
    const rawUrl = content.url || '';
    const url = normalizeLinkTarget(rawUrl);
    const hashLink = isHashLink(url);
    const buttonStyle = {
      ...baseComponentStyle,
      ...visualStyle,
      backgroundColor: visualStyle.backgroundColor || globalStyles?.componentBackgroundColor,
      color: globalStyles?.textColor,
    };
    return (
      <motion.a 
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        href={url}
        onClick={(event) => {
          void onTrackClick(el.id);
          if (hashLink) {
            event.preventDefault();
            const nextHash = url.replace(/^#/, '');
            if (url === '#') {
              window.history.pushState(null, '', `${window.location.pathname}#`);
            } else {
              window.location.hash = nextHash;
            }
            onHashNavigate(`#${nextHash}`);
          }
        }}
        target={hashLink ? undefined : '_blank'}
        rel={hashLink ? undefined : 'noopener noreferrer'}
        style={buttonStyle}
        className="w-full p-5 border rounded-[2rem] font-bold flex items-center justify-between group"
      >
        <div className="flex items-center gap-4">
          <div style={{ color: globalStyles?.textColor }} className="w-10 h-10 rounded-2xl flex items-center justify-center transition-colors">
            <ExternalLink size={18} />
          </div>
          <span className="text-lg">{content.label}</span>
        </div>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity translate-x-4 group-hover:translate-x-0">
          <Send size={18} />
        </div>
      </motion.a>
    );
  }

  if (type === 'anon_box') {
    return (
      <div
        style={{
          ...baseComponentStyle,
          borderColor: globalStyles?.componentBorderColor,
        }}
        className="w-full p-8 rounded-[3rem] border space-y-4 relative overflow-hidden group"
      >
        <div className="absolute -top-10 -right-10 opacity-10 rotate-12 transition-transform duration-1000 group-hover:scale-150">
          <MessageSquare size={120} />
        </div>
        
        <div className="flex items-center gap-3 mb-2 relative z-10">
          <div className="w-8 h-8 bg-white/30 rounded-xl flex items-center justify-center">
            <Heart size={16} />
          </div>
          <h3 className="font-bold text-xl">{content.title || '給我留言'}</h3>
        </div>

        <div className="relative z-10 space-y-4">
          <textarea 
            placeholder={content.placeholder || "在此輸入想說的話..."}
            value={anonMessage}
            onChange={(e) => setAnonMessage(e.target.value)}
            rows={3}
            className="w-full bg-white/30 border border-white/50 rounded-[2rem] p-5 outline-none focus:ring-4 ring-white/20 placeholder:text-current/40 text-current resize-none"
          />
          <button 
            onClick={onSendAnon}
            disabled={sent || !anonMessage.trim()}
            style={{ backgroundColor: globalStyles?.componentBorderColor, color: globalStyles?.componentBackgroundColor }}
            className={cn(
              "w-full py-4 rounded-[1.5rem] font-black uppercase tracking-widest transition-all scale-100 active:scale-95 flex items-center justify-center gap-2",
              sent ? "bg-green-500 text-white" : "hover:opacity-90"
            )}
          >
            {sent ? <><CheckCircle2 /> 已傳送</> : <><Send size={18} /> 送出悄悄話</>}
          </button>

          {isReplyEnabled && (
            <div className="pt-4 space-y-3 border-t border-white/15">
              <div className="text-xs font-bold tracking-widest uppercase text-white/80">公開回覆</div>
              {publicReplies.length === 0 ? (
                <div className="text-sm text-white/55">目前還沒有公開回覆</div>
              ) : (
                publicReplies.slice(0, 8).map((row: AnonResponse) => (
                  <div key={row.id} className="rounded-2xl bg-white/10 border border-white/20 p-4 space-y-2">
                    <div className="text-[11px] text-white/60">{row.message}</div>
                    <div className="text-sm text-white font-medium">{row.reply}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (type === 'image') {
    return <img src={content.url} style={{ borderColor: globalStyles?.componentBorderColor, ...visualStyle }} className="w-full h-auto rounded-[3rem] border" alt="card image" />;
  }

  if (type === 'gallery') {
    return (
      <GalleryBlock
        content={content}
        baseComponentStyle={baseComponentStyle}
        visualStyle={visualStyle}
        borderColor={globalStyles?.componentBorderColor}
        textColor={globalStyles?.textColor}
        componentBgColor={globalStyles?.componentBackgroundColor}
        onTrackClick={() => void onTrackClick(el.id)}
        onHashNavigate={onHashNavigate}
      />
    );
  }

  if (type === 'section') {
    return null;
  }

  if (type === 'dropdown') {
    const items = Array.isArray(content.items) ? content.items : [];
    return (
      <div style={{ ...baseComponentStyle, ...visualStyle }} className="w-full p-5 rounded-[2rem] border">
        <AnimatedDropdown
          label={content.label || '下拉選單'}
          items={items}
          textColor={globalStyles?.textColor}
          itemBackgroundColor={globalStyles?.componentBackgroundColor}
          onTrackClick={() => void onTrackClick(el.id)}
          onHashNavigate={onHashNavigate}
        />
      </div>
    );
  }

  if (type === 'tags') {
    const items = Array.isArray(content.items) ? content.items : [];
    return (
      <div className="flex flex-wrap gap-2">
        {items.map((item: { icon?: string; text?: string }, index: number) => (
          <span
            key={`tag-public-${index}`}
            style={{ ...baseComponentStyle, ...visualStyle }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium"
          >
            {item.icon ? <span>{item.icon}</span> : null}
            <span>{item.text || `標籤 ${index + 1}`}</span>
          </span>
        ))}
      </div>
    );
  }

  if (type === 'embed') {
    const embedHtml = content.html || buildEmbedHtmlFromUrl(content.url || '');
    if (!embedHtml) return null;
    return (
      <div
        style={{ borderColor: globalStyles?.componentBorderColor }}
        className="w-full rounded-[2rem] overflow-hidden border bg-cream flex flex-col items-center justify-center embed-container"
        dangerouslySetInnerHTML={{ __html: embedHtml }}
      />
    );
  }

  if (type === 'music') {
    const rawUrl = String(content.url || '').trim();
    if (!rawUrl) {
      return (
        <div style={{ ...baseComponentStyle, ...visualStyle }} className="w-full rounded-[2rem] border p-6 text-center">
          <div className="text-sm opacity-70">尚未設定音樂連結</div>
        </div>
      );
    }
    return (
      <MusicPlayer
        url={rawUrl}
        borderColor={globalStyles?.componentBorderColor}
        textColor={globalStyles?.textColor}
        style={{ ...baseComponentStyle, ...visualStyle }}
      />
    );
  }

  if (type === 'countdown') {
    return <CountdownDisplay title={content.title} targetAt={content.targetAt} style={{ ...baseComponentStyle, ...visualStyle }} />;
  }

  if (type === 'visitor') {
    return <VisitorCounter mode="live" cardId={cardId} elementId={el.id} content={content} style={{ ...baseComponentStyle, ...visualStyle }} />;
  }

  if (type === 'mood') {
    return <MoodCounter mode="live" cardId={cardId} elementId={el.id} content={content} style={{ ...baseComponentStyle, ...visualStyle }} />;
  }

  return null;
}

function GalleryBlock({
  content,
  baseComponentStyle,
  visualStyle,
  borderColor,
  textColor,
  componentBgColor,
  onTrackClick,
  onHashNavigate,
}: {
  content: any;
  baseComponentStyle: React.CSSProperties;
  visualStyle: React.CSSProperties;
  borderColor?: string;
  textColor?: string;
  componentBgColor?: string;
  onTrackClick: () => void;
  onHashNavigate: (hash: string) => void;
}) {
  const images = Array.isArray(content.images) ? content.images : [];
  const [index, setIndex] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [slideW, setSlideW] = useState(0);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setSlideW(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (images.length === 0) {
    return <div style={{ ...baseComponentStyle, ...visualStyle }} className="w-full rounded-[2rem] border p-6 text-sm opacity-60">圖庫尚未新增圖片</div>;
  }

  if (content.layout === 'slideshow') {
    const n = images.length;
    const slidePct = 100 / n;
    const current = images[index % n];
    const rawLink = String(current.link || '').trim();
    const url = rawLink ? normalizeLinkTarget(rawLink) : '';
    const hashLink = isHashLink(url);

    const trackTransform =
      slideW > 0
        ? `translate3d(-${index * slideW}px,0,0)`
        : `translateX(-${(index * 100) / n}%)`;
    const trackWidth = slideW > 0 ? n * slideW : undefined;

    const media = (
      <div ref={viewportRef} className="relative aspect-square w-full overflow-hidden bg-black/5">
        <div
          className="flex h-full transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{
            width: trackWidth != null ? trackWidth : `${n * 100}%`,
            transform: trackTransform,
          }}
        >
          {images.map((img: any, i: number) => (
            <div
              key={`g-slide-${i}-${img.url || i}`}
              className="h-full shrink-0"
              style={slideW > 0 ? { width: slideW, flexShrink: 0 } : { width: `${slidePct}%` }}
            >
              <img
                src={img.url}
                alt={img.caption || `gallery ${i + 1}`}
                className={cn('h-full w-full', content.fill ? 'object-cover' : 'object-contain')}
              />
            </div>
          ))}
        </div>
      </div>
    );

    return (
      <div style={{ ...baseComponentStyle, ...visualStyle, borderColor }} className="w-full rounded-[2rem] border overflow-hidden">
        {url ? (
          <motion.a
            href={url}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={(event) => {
              void onTrackClick();
              if (!hashLink) return;
              event.preventDefault();
              const nextHash = url.replace(/^#/, '');
              if (url === '#') {
                window.history.pushState(null, '', `${window.location.pathname}#`);
              } else {
                window.location.hash = nextHash;
              }
              onHashNavigate(`#${nextHash}`);
            }}
            target={hashLink ? undefined : '_blank'}
            rel={hashLink ? undefined : 'noopener noreferrer'}
            className="block"
          >
            {media}
          </motion.a>
        ) : (
          <button type="button" className="block w-full text-left" onClick={() => onTrackClick()}>
            {media}
          </button>
        )}

        <div className="p-4 flex items-center gap-3">
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl cursor-pointer transition-transform hover:scale-110"
            style={{ borderColor, color: textColor, backgroundColor: 'transparent' }}
            aria-label="上一張"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIndex((prev) => (prev - 1 + images.length) % images.length);
            }}
          >
            <ChevronLeft size={18} />
          </button>

          <div className="min-w-0 flex-1 text-center text-sm font-bold truncate" style={{ color: textColor }}>
            {current.caption || `圖片 ${index + 1}`}
          </div>

          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl cursor-pointer transition-transform hover:scale-110"
            style={{ borderColor, color: textColor, backgroundColor: 'transparent' }}
            aria-label="下一張"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIndex((prev) => (prev + 1) % images.length);
            }}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 w-full">
      {images.map((img: any, idx: number) => {
        const rawLink = String(img.link || '').trim();
        const url = rawLink ? normalizeLinkTarget(rawLink) : '';
        const hashLink = isHashLink(url);
        const inner = (
          <div className="relative aspect-square w-full overflow-hidden rounded-2xl border bg-black/5 group" style={{ borderColor }}>
            <img
              src={img.url}
              alt={img.caption || `圖庫 ${idx + 1}`}
              className={cn('h-full w-full', content.fill ? 'object-cover' : 'object-contain')}
            />
            {img.caption ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <div
                  className="gallery-grid-caption w-full px-3 py-2 text-xs font-bold line-clamp-3"
                  style={{
                    backgroundColor: componentBgColor,
                    color: textColor,
                    borderColor,
                  }}
                >
                  {img.caption}
                </div>
              </div>
            ) : null}
          </div>
        );

        if (!url) {
          return (
            <button key={`g-grid-${idx}`} type="button" className="block w-full" onClick={() => onTrackClick()}>
              {inner}
            </button>
          );
        }

        return (
          <motion.a
            key={`g-grid-${idx}`}
            href={url}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={(event) => {
              void onTrackClick();
              if (!hashLink) return;
              event.preventDefault();
              const nextHash = url.replace(/^#/, '');
              if (url === '#') {
                window.history.pushState(null, '', `${window.location.pathname}#`);
              } else {
                window.location.hash = nextHash;
              }
              onHashNavigate(`#${nextHash}`);
            }}
            target={hashLink ? undefined : '_blank'}
            rel={hashLink ? undefined : 'noopener noreferrer'}
            className="block"
          >
            {inner}
          </motion.a>
        );
      })}
    </div>
  );
}

function CountdownDisplay({ title, targetAt, style }: { title?: string; targetAt?: string; style?: React.CSSProperties }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const target = targetAt ? new Date(targetAt).getTime() : 0;
  const diff = Math.max(0, target - now);
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const mins = Math.floor((diff / (1000 * 60)) % 60);
  const secs = Math.floor((diff / 1000) % 60);

  return (
    <div style={style} className="w-full rounded-[2rem] border p-5 text-center font-bold">
      <div className="text-sm opacity-70">{title || '活動倒數'}</div>
      <div className="mt-2 text-xl tabular-nums">{days}天 {hours}時 {mins}分 {secs}秒</div>
    </div>
  );
}

function splitElementsBySection(elements: any[]) {
  const headerElements: any[] = [];
  const footerElements: any[] = [];
  const sections: Array<{ hash: string; elements: any[] }> = [];

  let preSection: any[] = [];
  let currentMode: 'pre' | 'normal' | 'footer' = 'pre';
  let currentSectionHash = 'home';
  let headerMarkerSeen = false;

  const ensureSection = (hash: string) => {
    const normalized = (hash || 'home').replace(/^#/, '').trim() || 'home';
    let section = sections.find((row) => row.hash === normalized);
    if (!section) {
      section = { hash: normalized, elements: [] };
      sections.push(section);
    }
    return section;
  };

  for (const el of elements) {
    if (el?.type === 'section') {
      const kind = el?.content?.kind || 'normal';
      if (kind === 'header') {
        headerMarkerSeen = true;
        headerElements.push(...preSection);
        preSection = [];
        currentMode = 'normal';
        continue;
      }

      if (kind === 'footer') {
        if (!headerMarkerSeen && preSection.length > 0) {
          headerElements.push(...preSection);
          preSection = [];
        }
        currentMode = 'footer';
        continue;
      }

      currentMode = 'normal';
      currentSectionHash = String(el?.content?.name || 'home').replace(/^#/, '') || 'home';
      ensureSection(currentSectionHash);
      continue;
    }

    if (currentMode === 'footer') {
      footerElements.push(el);
      continue;
    }

    if (currentMode === 'normal') {
      ensureSection(currentSectionHash).elements.push(el);
      continue;
    }

    preSection.push(el);
  }

  if (sections.length === 0) {
    sections.push({ hash: 'home', elements: [...preSection] });
  } else if (preSection.length > 0) {
    headerElements.push(...preSection);
  }

  return { headerElements, footerElements, sections };
}

function AnimatedDropdown({
  label,
  items,
  textColor,
  itemBackgroundColor,
  onTrackClick,
  onHashNavigate,
}: {
  label: string;
  items: Array<{ label?: string; url?: string }>;
  textColor?: string;
  itemBackgroundColor?: string;
  onTrackClick: () => void;
  onHashNavigate: (hash: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full cursor-pointer list-none flex items-center justify-between gap-3"
      >
        <span style={{ color: textColor }} className="font-bold">{label}</span>
        <span className={cn('opacity-60 transition-transform', open ? 'rotate-180' : 'rotate-0')}>▼</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-2">
              {items.length === 0 ? (
                <div className="text-sm opacity-60">尚未新增選項</div>
              ) : (
                items.map((item, index) => {
                  const resolvedUrl = normalizeLinkTarget(item.url || '');
                  const hashLink = isHashLink(resolvedUrl);
                  return (
                    <a
                      key={`dropdown-public-${index}`}
                      href={resolvedUrl}
                      onClick={(event) => {
                        onTrackClick();
                        if (hashLink) {
                          event.preventDefault();
                          const nextHash = resolvedUrl.replace(/^#/, '');
                          if (resolvedUrl === '#') {
                            window.history.pushState(null, '', `${window.location.pathname}#`);
                          } else {
                            window.location.hash = nextHash;
                          }
                          onHashNavigate(`#${nextHash}`);
                        }
                      }}
                      target={hashLink ? undefined : '_blank'}
                      rel={hashLink ? undefined : 'noopener noreferrer'}
                      style={{
                        backgroundColor: itemBackgroundColor,
                        color: textColor,
                      }}
                      className="block px-4 py-3 rounded-xl text-sm hover:opacity-50"
                    >
                      {item.label || `項目 ${index + 1}`}
                    </a>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LightbulbLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.9 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>
    </svg>
  );
}

function CheckCircle2(props: any) {
  return (
    <svg 
      {...props}
      width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
      <path d="m9 12 2 2 4-4"/>
    </svg>
  );
}
