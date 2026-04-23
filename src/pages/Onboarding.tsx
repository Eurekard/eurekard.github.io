import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Lightbulb, Check, AlertCircle, Sparkles, Wand2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../lib/firebase';
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { cn } from '../lib/utils';

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState('classic');

  const themes = [
    { id: 'classic', name: '晨光初現', colors: ['#F5F5DC', '#89CFF0'], desc: '柔和的清晨，靈感湧現' },
    { id: 'bicolor', name: '極簡現代', colors: ['#FFFFFF', '#3D2B1F'], desc: '俐落的對比，專注於內容' },
    { id: 'seal', name: '深夜沉思', colors: ['#FDF5E6', '#2F4F4F'], desc: '深邃的氛圍，適合深度思考' },
  ];

  const handleCheckUsername = async () => {
    if (!username || username.length < 3) {
      setError('用戶名至少需要 3 個字元');
      return;
    }
    if (!/^[a-z0-9_]+$/.test(username)) {
      setError('只能使用小寫字母、數字與下底線');
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      const docRef = doc(db, 'usernames', username);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setError('此用戶名已被佔用');
      } else {
        setStep(2);
      }
    } catch (err) {
      setError('系統錯誤，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const batch = writeBatch(db);
      
      const userRef = doc(db, 'users', user.uid);
      const usernameRef = doc(db, 'usernames', username);
      const cardRef = doc(db, 'cards', user.uid);

      const profileData = {
        uid: user.uid,
        username,
        email: user.email,
        avatarUrl: user.photoURL,
        theme,
        createdAt: new Date().toISOString(),
        settings: {
          emailNotifications: true,
          darkMode: false
        }
      };

      const cardData = {
        uid: user.uid,
        username,
        profile: {
          displayName: user.displayName || username,
          avatarUrl: user.photoURL || ''
        },
        published_content: { elements: [], styles: { theme } },
        draft_content: { 
          elements: [
            { id: 'id_1', type: 'text', content: { text: `你好，我是 ${user.displayName || username}`, size: '6xl' }, style: {} }
          ], 
          styles: { theme } 
        },
        updatedAt: new Date().toISOString()
      };

      batch.set(userRef, profileData);
      batch.set(usernameRef, { uid: user.uid });
      batch.set(cardRef, cardData);

      await batch.commit();
      navigate('/dashboard');
    } catch (err) {
      setError('完成註冊時發生錯誤');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white/60 backdrop-blur-xl border border-white p-8 rounded-[3rem] soft-shadow relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
          <Lightbulb size={120} />
        </div>

        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="space-y-2">
                <h2 className="text-3xl font-display font-bold text-chocolate">選擇你的專屬網址</h2>
                <p className="text-chocolate/60">這是訪客訪問你名片的唯一路徑</p>
              </div>

              <div className="space-y-4">
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-chocolate/40 font-medium">
                    eurekard.com/
                  </div>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase())}
                    placeholder="yourname"
                    className="w-full pl-[110px] pr-4 py-4 bg-white/50 border-2 border-white rounded-2xl focus:border-cat-blue outline-none transition-colors font-medium text-chocolate"
                  />
                </div>
                {error && (
                  <div className="flex items-center gap-2 text-red-500 text-sm font-medium px-2">
                    <AlertCircle size={16} />
                    {error}
                  </div>
                )}
              </div>

              <button
                disabled={loading || !username}
                onClick={handleCheckUsername}
                className="w-full py-4 bg-cat-blue text-white rounded-[1.5rem] font-bold soft-shadow hover:bg-cat-blue/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                {loading ? '檢查中...' : '下一步'}
                <Check size={20} />
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="space-y-2">
                <h2 className="text-3xl font-display font-bold text-chocolate">挑選專屬風格</h2>
                <p className="text-chocolate/60">別擔心，進來後隨時可以調整</p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {themes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={cn(
                      "p-4 border-2 rounded-2xl text-left transition-all flex items-center gap-4 group",
                      theme === t.id ? "border-cat-blue bg-white" : "border-white bg-white/20 hover:border-cat-blue/30"
                    )}
                  >
                    <div className="flex -space-x-2">
                      {t.colors.map((c, i) => (
                        <div key={i} className="w-8 h-8 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                    <div>
                      <div className="font-bold text-chocolate">{t.name}</div>
                      <div className="text-xs text-chocolate/50">{t.desc}</div>
                    </div>
                    {theme === t.id && <Sparkles className="ml-auto text-cat-blue" size={20} />}
                  </button>
                ))}
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 py-4 bg-white/50 text-chocolate rounded-2xl font-bold hover:bg-white transition-all"
                >
                  上一步
                </button>
                <button
                  disabled={loading}
                  onClick={handleComplete}
                  className="flex-[2] py-4 bg-chocolate text-white rounded-2xl font-bold soft-shadow hover:bg-chocolate/90 transition-all flex items-center justify-center gap-2"
                >
                  <Wand2 size={20} />
                  完成
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
