import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { db } from '../lib/firebase';
import { doc, getDoc, collection, addDoc, query, onSnapshot, where } from 'firebase/firestore';
import { CardData, AnonResponse } from '../types';
import { motion } from 'motion/react';
import { Heart, Send, Sparkles, ExternalLink, MessageSquare } from 'lucide-react';
import { cn } from '../lib/utils';
import { buildEmbedHtmlFromUrl } from '../lib/embed';
import { toElementStyle } from '../lib/cardStyle';
import { detectDevice, detectSource, getAnalyticsDay } from '../lib/analytics';

export default function Profile() {
  const { username } = useParams();
  const [data, setData] = useState<CardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [anonMessage, setAnonMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [publicReplies, setPublicReplies] = useState<AnonResponse[]>([]);

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
        <h1 className="text-4xl font-display font-bold text-chocolate">哎呀！找不到這個名片</h1>
        <p className="text-chocolate/60">這個連結可能已經失效，或是用戶修改了專屬網址。</p>
        <Link to="/" className="px-8 py-4 bg-chocolate text-white rounded-2xl font-bold soft-shadow">
          返回 Eurekard 首頁
        </Link>
      </div>
    );
  }

  const elements = data.published_content.elements || [];

  return (
    <div className="min-h-screen bg-cream flex flex-col items-center py-20 px-6 relative overflow-x-hidden">
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
            className="w-32 h-32 bg-white rounded-[3rem] mx-auto mb-6 p-1.5 shadow-2xl relative overflow-hidden"
          >
            <img 
              src={data.profile?.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.uid}`} 
              alt={data.profile?.displayName || username}
              className="w-full h-full rounded-[2.8rem] bg-cat-blue/10 object-cover"
            />
          </motion.div>
          <div className="space-y-1">
            <h1 className="text-3xl font-display font-black text-chocolate tracking-tight group flex items-center justify-center gap-1">
              {data.profile?.displayName || username}
              <Sparkles className="text-cat-blue" size={20} />
            </h1>
          </div>
        </div>

        {/* Dynamic Content */}
        <div className="space-y-6">
          {elements.length === 0 && (
            <div className="text-center py-20 text-chocolate/20 font-bold uppercase tracking-widest bg-white/20 rounded-[3rem] border border-dashed border-chocolate/5">
              這裡目前還沒有任何內容...
            </div>
          )}
          
          {elements.map((el) => (
            <RenderElement
              key={el.id}
              el={el}
              onSendAnon={() => handleSendAnon(data.uid)}
              anonMessage={anonMessage}
              setAnonMessage={setAnonMessage}
              sent={sent}
              isReplyEnabled={data.interactions?.responsesEnabled !== false}
              publicReplies={publicReplies}
              onTrackClick={handleTrackClick}
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

function RenderElement({ el, onSendAnon, anonMessage, setAnonMessage, sent, isReplyEnabled, publicReplies, onTrackClick }: any) {
  const { type, content } = el;
  const visualStyle = toElementStyle(el.style);

  if (type === 'text') {
    const alignClass = content.align === 'left' ? 'text-left' : content.align === 'right' ? 'text-right' : 'text-center';
    return (
      <div className={cn(
        "text-chocolate font-bold leading-tight mx-auto px-4",
        alignClass,
        content.size === '6xl' ? 'text-4xl md:text-5xl font-black mb-4' : 'text-lg opacity-80'
      )}>
        {content.text}
      </div>
    );
  }

  if (type === 'button') {
    return (
      <motion.a 
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        href={content.url}
        onClick={() => {
          void onTrackClick(el.id);
        }}
        target="_blank"
        rel="noopener noreferrer"
        style={visualStyle}
        className="w-full p-5 bg-white border border-chocolate/5 rounded-[2rem] text-chocolate font-bold flex items-center justify-between group soft-shadow"
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-cream rounded-2xl flex items-center justify-center text-cat-blue group-hover:bg-cat-blue group-hover:text-white transition-colors">
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
      <div className="w-full bg-chocolate p-8 rounded-[3rem] text-white space-y-4 shadow-2xl relative overflow-hidden group">
        <div className="absolute -top-10 -right-10 opacity-10 rotate-12 transition-transform duration-1000 group-hover:scale-150">
          <MessageSquare size={120} />
        </div>
        
        <div className="flex items-center gap-3 mb-2 relative z-10">
          <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
            <Heart size={16} fill="white" />
          </div>
          <h3 className="font-display font-bold text-xl">{content.title || '給我留言'}</h3>
        </div>

        <div className="relative z-10 space-y-4">
          <textarea 
            placeholder={content.placeholder || "在此輸入想說的話..."}
            value={anonMessage}
            onChange={(e) => setAnonMessage(e.target.value)}
            rows={3}
            className="w-full bg-white/10 border border-white/20 rounded-[2rem] p-5 outline-none focus:ring-4 ring-white/5 placeholder:text-white/30 text-white resize-none"
          />
          <button 
            onClick={onSendAnon}
            disabled={sent || !anonMessage.trim()}
            className={cn(
              "w-full py-4 rounded-[1.5rem] font-black uppercase tracking-widest transition-all scale-100 active:scale-95 flex items-center justify-center gap-2",
              sent ? "bg-green-500 text-white" : "bg-cat-blue text-white hover:bg-white hover:text-chocolate"
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
    return <img src={content.url} style={visualStyle} className="w-full h-auto rounded-[3rem] shadow-xl border-4 border-white" alt="card image" />;
  }

  if (type === 'embed') {
    const embedHtml = content.html || buildEmbedHtmlFromUrl(content.url || '');
    if (!embedHtml) return null;
    return (
      <div 
        className="w-full rounded-[2rem] overflow-hidden shadow-xl border-4 border-white bg-cream flex flex-col items-center justify-center embed-container"
        dangerouslySetInnerHTML={{ __html: embedHtml }}
      />
    );
  }

  return null;
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
