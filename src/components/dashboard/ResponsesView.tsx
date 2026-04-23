import React, { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { collection, query, onSnapshot, orderBy, updateDoc, doc, deleteDoc, setDoc } from 'firebase/firestore';
import { AnonResponse, CardData } from '../../types';
import { MessageSquareOff, Archive, Trash2, Send, CheckCircle2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { cn } from '../../lib/utils';

type ResponseFilter = 'all' | 'responded' | 'unresponded' | 'archived';

export default function ResponsesView({ cardId, cardData }: { cardId: string; cardData: CardData | null }) {
  const [responses, setResponses] = useState<AnonResponse[]>([]);
  const [filter, setFilter] = useState<ResponseFilter>('all');
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [replyText, setReplyText] = useState<{ [id: string]: string }>({});
  const [loading, setLoading] = useState(true);
  const [hasAnonBox, setHasAnonBox] = useState(false);

  useEffect(() => {
    if (!cardData) return;
    const elements = cardData?.draft_content?.elements || cardData?.published_content?.elements || [];
    setHasAnonBox(elements.some((el) => el.type === 'anon_box'));
    setIsOpen(cardData?.interactions?.responsesEnabled !== false);
  }, [cardData]);

  useEffect(() => {
    if (!cardId) return;

    const q = query(
      collection(db, 'cards', cardId, 'responses'),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as AnonResponse[];
      setResponses(data);
      setLoading(false);
    }, (error) => {
      if (error.name !== 'AbortError') {
        console.error("抓取回應失敗:", error);
      }
    });

    return () => {
      unsub(); 
    };
  }, [cardId]);

  const filteredResponses = responses.filter(r => {
    if (filter === 'responded') return r.status === 'replied';
    if (filter === 'unresponded') return r.status === 'unread';
    if (filter === 'archived') return r.status === 'archived';
    return r.status !== 'deleted';
  });

  const unreadCount = responses.filter((r) => r.status === 'unread').length;
  const repliedCount = responses.filter((r) => r.status === 'replied').length;
  const archivedCount = responses.filter((r) => r.status === 'archived').length;

  const handleStatus = async (id: string, status: string) => {
    await updateDoc(doc(db, 'cards', cardId, 'responses', id), { status });
  };

  const handleToggleOpen = async () => {
    const next = !isOpen;
    setIsOpen(next);
    await setDoc(doc(db, 'cards', cardId), {
      interactions: {
        responsesEnabled: next,
      },
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  };

  const handleDelete = async (id: string) => {
    if (confirm('確定要刪除這條回應嗎？')) {
      await deleteDoc(doc(db, 'cards', cardId, 'responses', id));
    }
  };

  const handleReply = async (id: string) => {
    const text = replyText[id];
    if (!text) return;
    await updateDoc(doc(db, 'cards', cardId, 'responses', id), { 
      reply: text,
      status: 'replied' 
    });
    setReplyText({ ...replyText, [id]: '' });
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-[2rem] border border-chocolate/5 soft-shadow">
        <div>
          <h2 className="text-2xl font-display font-bold text-chocolate flex items-center gap-3">
            匿名箱收件匣
            <span className="text-sm font-bold bg-cat-blue/10 text-cat-blue px-3 py-1 rounded-full">
              {unreadCount} 未回覆
            </span>
          </h2>
          <p className="text-chocolate/60 text-sm">管理投稿、回覆內容、封存與刪除</p>
        </div>
        
        <button 
          onClick={handleToggleOpen}
          className={cn(
            "px-6 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all",
            isOpen ? "bg-green-50 text-green-600 hover:bg-green-100" : "bg-red-50 text-red-500 hover:bg-red-100"
          )}
        >
          {isOpen ? <CheckCircle2 size={18} /> : <MessageSquareOff size={18} />}
          {isOpen ? '收件中' : '已關閉'}
        </button>
      </div>

      {!hasAnonBox && (
        <div className="py-10 text-center space-y-3 bg-white rounded-[2rem] border border-dashed border-chocolate/10">
          <MessageSquareOff className="mx-auto text-chocolate/30" size={28} />
          <p className="text-chocolate/60 font-bold">尚未新增此元素</p>
          <p className="text-xs text-chocolate/40">請先在編輯器新增「匿名箱」，才會開始收件。</p>
        </div>
      )}

      <div className="flex gap-2">
        {['all', 'responded', 'unresponded', 'archived'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f as any)}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-bold transition-all",
              filter === f ? "bg-chocolate text-white" : "bg-white text-chocolate/50 hover:bg-white/80"
            )}
          >
            {f === 'all' ? '全部' : f === 'responded' ? `已回覆 ${repliedCount}` : f === 'unresponded' ? `未回覆 ${unreadCount}` : `已封存 ${archivedCount}`}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {filteredResponses.length === 0 ? (
          <div className="py-20 text-center space-y-4 bg-white/40 rounded-[3rem] border border-dashed border-chocolate/10">
            <div className="w-16 h-16 bg-cream rounded-full flex items-center justify-center mx-auto text-chocolate/20">
              <MessageSquareOff size={32} />
            </div>
            <p className="text-chocolate/40 font-bold">目前沒有回應...</p>
          </div>
        ) : (
          filteredResponses.map((res) => (
            <div key={res.id} className="bg-white p-8 rounded-[2.5rem] border border-chocolate/5 soft-shadow space-y-6">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-cream rounded-2xl flex items-center justify-center text-cat-blue">
                    <UserIcon />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-chocolate/40 uppercase tracking-widest">
                      來自匿名的訪客
                    </div>
                    <div className="text-xs text-chocolate/30 font-medium">
                      {formatDistanceToNow(new Date(res.createdAt), { addSuffix: true, locale: zhTW })}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleStatus(res.id, res.status === 'archived' ? 'unread' : 'archived')}
                    className="p-2 hover:bg-cream rounded-xl text-chocolate/40 transition-colors"
                  >
                    <Archive size={20} className={res.status === 'archived' ? 'text-cat-blue' : ''} />
                  </button>
                  <button 
                    onClick={() => handleDelete(res.id)}
                    className="p-2 hover:bg-red-50 hover:text-red-500 rounded-xl text-chocolate/40 transition-colors"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>

              <div className="text-lg text-chocolate leading-relaxed font-medium">
                「{res.message}」
              </div>

              {res.reply ? (
                <div className="bg-cream/30 p-6 rounded-2xl border-l-4 border-cat-blue space-y-2">
                  <div className="text-xs font-bold text-cat-blue uppercase tracking-widest flex items-center gap-2">
                    你的回覆 <CheckCircle2 size={12} />
                  </div>
                  <div className="text-chocolate/80">{res.reply}</div>
                </div>
              ) : isOpen ? (
                <div className="flex gap-2">
                  <input 
                    placeholder="回覆這條訊息..."
                    value={replyText[res.id] || ''}
                    onChange={(e) => setReplyText({ ...replyText, [res.id]: e.target.value })}
                    className="flex-1 bg-cream/50 border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 ring-cat-blue/20 outline-none transition-all"
                  />
                  <button 
                    onClick={() => handleReply(res.id)}
                    className="p-3 bg-chocolate text-white rounded-2xl hover:bg-chocolate/90 transition-all flex items-center justify-center"
                  >
                    <Send size={18} />
                  </button>
                </div>
              ) : (
                <div className="text-xs text-chocolate/40 bg-cream/40 rounded-xl p-4">已關閉回應，開啟後即可回覆投稿。</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function UserIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  );
}
