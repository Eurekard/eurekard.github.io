import React, { useEffect, useState } from 'react';
import { doc, increment, onSnapshot, setDoc } from 'firebase/firestore';
import { motion } from 'motion/react';
import { Heart } from 'lucide-react';
import { db } from '../lib/firebase';

export function VisitorCounter({
  cardId,
  elementId,
  content,
  style,
  mode = 'live',
}: {
  cardId: string;
  elementId: string;
  content: any;
  style?: React.CSSProperties;
  mode?: 'live' | 'display';
}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!cardId || !elementId) return;
    if (cardId === 'demo_user') {
      setCount(0);
      return;
    }
    const ref = doc(db, 'cards', cardId, 'element_stats', elementId);
    const key = `eurekard:visitor:${cardId}:${elementId}`;
    if (mode === 'live' && !window.localStorage.getItem(key)) {
      void (async () => {
        try {
          await setDoc(ref, { visitorCount: increment(1), updatedAt: new Date().toISOString() }, { merge: true });
          window.localStorage.setItem(key, '1');
        } catch (e) {
          console.error(e);
        }
      })();
    }
    const unsub = onSnapshot(ref, (snap) => {
      if (mode === 'live' && !snap.exists() && window.localStorage.getItem(key)) {
        window.localStorage.removeItem(key);
      }
      setCount((snap.data() as any)?.visitorCount || 0);
    });
    return () => unsub();
  }, [cardId, elementId, mode]);

  return (
    <div style={style} className="w-full rounded-[2rem] border p-5 text-center font-bold">
      <div className="text-sm opacity-70">{content?.title || '訪客次數'}</div>
      <div className="text-2xl mt-1">
        {content?.prefix || '👀'} {count}
      </div>
    </div>
  );
}

export function MoodCounter({
  cardId,
  elementId,
  content,
  style,
  mode = 'live',
}: {
  cardId: string;
  elementId: string;
  content: any;
  style?: React.CSSProperties;
  mode?: 'live' | 'display';
}) {
  const [count, setCount] = useState(0);
  const localKey = `eurekard:mood:${cardId}:${elementId}`;
  const [hasVoted, setHasVoted] = useState<boolean>(() => !!window.localStorage.getItem(localKey));

  useEffect(() => {
    if (!cardId || !elementId) return;
    if (cardId === 'demo_user') {
      setCount(0);
      return;
    }
    const ref = doc(db, 'cards', cardId, 'element_stats', `${elementId}_mood`);
    const unsub = onSnapshot(ref, (snap) => {
      setCount((snap.data() as any)?.moodCount || 0);
    });
    return () => unsub();
  }, [cardId, elementId]);

  const handleVote = async () => {
    if (mode !== 'live') return;
    if (hasVoted) return;
    if (cardId === 'demo_user') return;
    window.localStorage.setItem(localKey, '1');
    setHasVoted(true);
    try {
      await setDoc(
        doc(db, 'cards', cardId, 'element_stats', `${elementId}_mood`),
        { moodCount: increment(1), updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch (e) {
      console.error(e);
      window.localStorage.removeItem(localKey);
      setHasVoted(false);
      alert('按讚失敗。請稍後再試。');
    }
  };

  const buttonStyle = {
    ...style,
    backgroundColor: (style as any)?.backgroundColor,
    color: (style as any)?.color,
    borderColor: (style as any)?.borderColor,
  };

  const inner = (
    <>
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center transition-colors">
          <span className="text-xl leading-none">{content?.emoji || '❤️'}</span>
        </div>
        <div className="min-w-0 text-left">
          <div className="text-lg truncate">{count} {content?.title || '個人都說讚'}</div>
        </div>
      </div>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity translate-x-4 group-hover:translate-x-0">
        <Heart size={18} />
      </div>
    </>
  );

  if (mode !== 'live') {
    return (
      <div style={buttonStyle} className="w-full cursor-default rounded-[2rem] border p-5 text-center font-bold flex items-center justify-between group">
        {inner}
      </div>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={handleVote}
      disabled={hasVoted}
      style={buttonStyle}
      whileHover={{ scale: !hasVoted ? 1.02 : 1 }}
      whileTap={{ scale: !hasVoted ? 0.98 : 1 }}
      className="w-full rounded-[2rem] border p-5 text-center font-bold disabled:opacity-50 flex items-center justify-between group"
    >
      {inner}
    </motion.button>
  );
}
