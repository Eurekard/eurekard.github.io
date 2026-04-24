import React from 'react';
import { motion } from 'motion/react';
import { Lightbulb, ArrowRight, Star, Heart, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function Home() {
  const { user, signIn, profile } = useAuth();
  const navigate = useNavigate();

  const handleStart = async () => {
    if (!user) {
      try {
        await signIn();
      } catch (error) {
        console.error(error);
        alert('登入失敗，請稍後再試');
        return;
      }
    }

    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen bg-cream flex flex-col overflow-hidden">
      {/* Navigation */}
      <nav className="p-6 flex justify-between items-center relative z-10">
        <div className="flex items-center gap-2 text-chocolate">
          <Lightbulb className="w-8 h-8 text-cat-blue" strokeWidth={2.5} />
          <span className="font-display font-bold text-2xl tracking-tight">尤里卡</span>
        </div>
        <button 
          onClick={handleStart}
          className="px-6 py-2 bg-white text-chocolate font-medium rounded-full soft-shadow hover:scale-105 transition-transform"
        >
          {user ? '進入儀表板' : '使用 Google 登入'}
        </button>
      </nav>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 text-center relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="max-w-3xl"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-cat-blue/20 text-cat-blue rounded-full text-sm font-semibold mb-6 ring-1 ring-cat-blue/30">
            <Sparkles size={14} />
            捕捉每一次靈光一閃的瞬間
          </div>
          
          <h1 className="text-6xl md:text-8xl font-display font-bold text-chocolate leading-[0.9] mb-8">
            展現你的 <br />
            <span className="text-cat-blue italic">尤里卡時刻</span>
          </h1>
          
          <p className="text-xl text-chocolate/70 mb-12 max-w-xl mx-auto leading-relaxed">
            尤里卡為你打造最具質感的個人入口頁。乾淨的畫布與流暢的體驗，讓每一個深刻的點子都能找到最好的展示舞台。
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button 
              onClick={handleStart}
              className="px-10 py-5 bg-chocolate text-white text-lg font-bold rounded-3xl hover:bg-chocolate/90 transition-all flex items-center justify-center gap-3 soft-shadow group"
            >
              {user ? '立即開始製作' : '使用 Google 登入'}
              <ArrowRight className="group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </motion.div>

        {/* Feature Cards Loop */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl w-full">
          {[
            { icon: <Heart className="text-pink-400" />, title: "優雅質地", desc: "舒適的視覺風格，為你的內容提供絕佳背景" },
            { icon: <Star className="text-yellow-400" />, title: "全能編輯", desc: "自由拖拽文字、圖片、匿名箱等多種組件" },
            { icon: <Sparkles className="text-cat-blue" />, title: "動態回應", desc: "內建匿名留言系統，與你的訪客深度互動" }
          ].map((f, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5 + i * 0.1 }}
              className="p-8 bg-white/40 backdrop-blur-md rounded-[2.5rem] border border-white/40 text-left flex flex-col gap-4"
            >
              <div className="p-3 bg-white rounded-2xl w-fit shadow-sm">
                {f.icon}
              </div>
              <h3 className="text-xl font-bold font-display">{f.title}</h3>
              <p className="text-chocolate/60 leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="p-8 text-center text-sm font-medium text-chocolate/40 tracking-wider">
        © 2026 Eurekard • MADE WITH INSPIRATION
      </footer>
    </div>
  );
}
