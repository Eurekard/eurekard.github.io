import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { CardData } from '../types';
import { BarChart3, MessageSquareText, PenLine, Settings, Share2, LogOut, ExternalLink, QrCode, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { Link } from 'react-router-dom';
import AnalyticsView from '../components/dashboard/AnalyticsView';
import ResponsesView from '../components/dashboard/ResponsesView';
import EditorView from '../components/dashboard/EditorView';

export default function Dashboard() {
  const { user, profile, logOut } = useAuth();
  const [activeTab, setActiveTab] = useState<'analytics' | 'responses' | 'editor'>('analytics');
  const [cardData, setCardData] = useState<CardData | null>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) {
      setCardData({
        uid: 'demo_user',
        username: 'demo',
        profile: {
          displayName: '訪客測試模式',
        },
        published_content: {
          elements: [],
          styles: {},
        },
        draft_content: {
          elements: [],
          styles: {},
        },
        interactions: {
          responsesEnabled: true,
        },
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    const unsubCard = onSnapshot(doc(db, 'cards', user.uid), (currDoc) => {
      if (currDoc.exists()) {
        const d = currDoc.data() as CardData;
        
        if (!d.profile?.avatarUrl && user.photoURL) {
          d.profile = { 
            ...(d.profile || {}), 
            displayName: d.profile?.displayName || user.displayName || d.username,
            avatarUrl: user.photoURL 
          };
        }
        setCardData(d);
      } else {
        setCardData({
          uid: user.uid,
          username: profile?.username || user.displayName || 'new-user',
          profile: {
            displayName: user.displayName || profile?.username || '新用戶',
            avatarUrl: user.photoURL || '',
          },
          published_content: {
            elements: [],
            styles: {},
          },
          draft_content: {
            elements: [],
            styles: {},
          },
          interactions: {
            responsesEnabled: true,
          },
          updatedAt: new Date().toISOString(),
        });
      }
    }, (error) => {
      if (error.code !== 'cancelled') {
        console.error("Firebase 監聽報鎖:", error);
      }
    });

    return () => unsubCard();
  }, [user, profile]);

  const handleCopyLink = () => {
    if (!profile) return;
    const url = `${window.location.origin}/${profile.username}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tabs = [
    { id: 'analytics', label: '統計', icon: BarChart3 },
    { id: 'responses', label: '回應', icon: MessageSquareText },
    { id: 'editor', label: '編輯', icon: PenLine },
  ];

  return (
    <div className="min-h-screen bg-cream flex flex-col">
      {/* Top Fixed Nav */}
      <header className="sticky top-0 z-50 bg-white/70 backdrop-blur-xl border-b border-chocolate/5 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2 text-chocolate">
            <LightbulbLogo />
            <span className="font-display font-bold text-xl lg:block hidden">尤里卡</span>
          </Link>

          {/* Three-Way Switcher */}
          <nav className="flex bg-chocolate/5 p-1 rounded-2xl">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-xl transition-all font-bold text-sm",
                    isActive ? "bg-white text-chocolate shadow-sm" : "text-chocolate/40 hover:text-chocolate/60"
                  )}
                >
                  <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsShareOpen(!isShareOpen)}
            className="p-2 whitespace-nowrap bg-white border border-chocolate/10 rounded-xl text-chocolate/70 hover:bg-chocolate hover:text-white transition-all flex items-center gap-2 font-bold text-sm px-4"
          >
            <Share2 size={18} />
          </button>
          
          <div className="w-10 h-10 rounded-full border-2 border-white bg-cat-blue/20 overflow-hidden cursor-pointer">
            <img src={user?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.uid || 'demo'}`} alt="avatar" />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative">
        {!cardData ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-chocolate"></div>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {activeTab === 'analytics' && (
              <motion.div key="analytics" className="flex-1 relative" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <AnalyticsView cardId={cardData.uid} username={profile?.username} displayName={cardData.profile?.displayName} />
              </motion.div>
            )}
            {activeTab === 'responses' && (
              <motion.div key="responses" className="flex-1 relative" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <ResponsesView cardId={cardData.uid} cardData={cardData} />
              </motion.div>
            )}
            {activeTab === 'editor' && (
              <motion.div key="editor" className="flex-1 relative" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <EditorView cardData={cardData} ownerUid={user?.uid || null} />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </main>

      {/* Share Modal */}
      <AnimatePresence>
        {isShareOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsShareOpen(false)}
              className="fixed inset-0 bg-chocolate/10 backdrop-blur-sm z-[60]" 
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white p-8 rounded-[3rem] shadow-2xl z-[70] border border-white"
            >
              <h2 className="text-2xl font-display font-bold text-chocolate mb-2">分享你的名片</h2>
              <p className="text-chocolate/60 mb-6 text-sm">全世界都在期待你的下一個靈感</p>
              
              <div className="bg-cream/50 p-4 rounded-[2rem] border border-chocolate/5 flex items-center justify-between gap-4 mb-8">
                <div className="truncate font-medium text-chocolate/70">
                  {window.location.origin}/{profile?.username}
                </div>
                <button onClick={handleCopyLink} className="p-3 bg-white rounded-2xl hover:bg-chocolate hover:text-white transition-all shadow-sm">
                  {copied ? <Check size={20} className="text-green-500" /> : <Copy size={20} />}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <Link to={`/${profile?.username}`} target="_blank" className="p-4 bg-cat-blue/10 border border-cat-blue/20 rounded-2xl flex flex-col items-center gap-2 hover:bg-cat-blue/20 transition-all group">
                  <ExternalLink className="text-cat-blue group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-bold text-cat-blue">預覽頁面</span>
                </Link>
                <button className="p-4 bg-chocolate/5 border border-chocolate/10 rounded-2xl flex flex-col items-center gap-2 hover:bg-chocolate/10 transition-all group">
                  <QrCode className="text-chocolate group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-bold text-chocolate">下載 QR Code</span>
                </button>
              </div>

              <button 
                onClick={logOut}
                className="w-full py-4 border border-red-100 text-red-500 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-red-50 transition-all"
              >
                <LogOut size={18} />
                登出帳號
              </button>
            </motion.div>
          </>
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