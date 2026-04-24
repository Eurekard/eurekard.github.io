import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { CardData, CardElement, GlobalDesignStyles } from '../../types';
import { Plus, GripVertical, Trash2, Layout, Type, Image as ImageIcon, Link as LinkIcon, Play, Hash, Music, Timer, Heart, Settings2, Palette, Save, Eye, UploadCloud, Loader2, ChevronDown, List, Tag, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, Reorder, AnimatePresence, useDragControls } from 'motion/react';
import { db } from '../../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { cn } from '../../lib/utils';
import { compressImageForWeb } from '../../lib/imageCompression';
import { uploadImageToR2 } from '../../lib/r2Upload';
import { useAuth } from '../../context/AuthContext';
import { buildEmbedHtmlFromUrl } from '../../lib/embed';
import MusicPlayer from '../../components/MusicPlayer';
import { MoodCounter, VisitorCounter } from '../../components/ElementCounters';
import { DEFAULT_PALETTE, normalizeLinkTarget, resolveGlobalStyles, toElementStyle, toGlobalPageStyle } from '../../lib/cardStyle';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import EmojiPicker from 'emoji-picker-react';

marked.use({
  gfm: true,
  breaks: true,
});

const ELEMENT_TYPES = [
  { type: 'text', label: '文字', icon: Type },
  { type: 'button', label: '按鈕', icon: LinkIcon },
  { type: 'image', label: '圖片', icon: ImageIcon },
  { type: 'gallery', label: '圖庫', icon: Layout },
  { type: 'section', label: '區段', icon: Hash },
  { type: 'dropdown', label: '下拉選單', icon: List },
  { type: 'tags', label: '標籤', icon: Tag },
  { type: 'anon_box', label: '匿名箱', icon: Heart },
  { type: 'embed', label: '影音嵌入', icon: Play },
  { type: 'music', label: '音樂歌單', icon: Music },
  { type: 'countdown', label: '倒計時', icon: Timer },
  { type: 'visitor', label: '訪客計數器', icon: Eye },
  { type: 'mood', label: '心情按鈕', icon: Heart },
];

export default function EditorView({ cardData, ownerUid }: { cardData: CardData; ownerUid: string | null }) {
  const { user } = useAuth();
  const [elements, setElements] = useState<CardElement[]>(cardData?.draft_content?.elements || []);
  const [globalStyles, setGlobalStyles] = useState<GlobalDesignStyles>(resolveGlobalStyles(cardData?.draft_content?.styles));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isAddDrawerOpen, setIsAddDrawerOpen] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const dragTimerRef = useRef<number | null>(null);
  const [profileData, setProfileData] = useState({
    displayName: cardData?.profile?.displayName || user?.displayName || cardData?.username || '',
    avatarUrl: cardData?.profile?.avatarUrl || user?.photoURL || ''
  });

  useEffect(() => {
    if (cardData?.draft_content?.elements) {
      setElements(cardData.draft_content.elements);
    }
    setGlobalStyles(resolveGlobalStyles(cardData?.draft_content?.styles));
  }, [cardData]);

  useEffect(() => {
    const updateTouchMode = () => {
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      setIsTouchDevice(coarse || window.innerWidth < 1024);
    };
    updateTouchMode();
    window.addEventListener('resize', updateTouchMode);
    return () => window.removeEventListener('resize', updateTouchMode);
  }, []);

  const handleAdd = (type: string) => {
    const newEl: CardElement = {
      id: `el_${Date.now()}`,
      type: type as any,
      content: getInitialContent(type),
      style: {}
    };
    const newElements = [...elements, newEl];
    setElements(newElements);
    setSelectedId(newEl.id);
  };

  const handleUpdate = (id: string, updates: Partial<CardElement>) => {
    setElements((prev) =>
      prev.map((el) => {
        if (el.id !== id) return el;
        const merged = { ...el, ...updates } as CardElement;
        if (merged.type !== 'section') return merged;

        const nextKind = merged.content?.kind || 'normal';
        if (nextKind !== 'header' && nextKind !== 'footer') return merged;

        const hasDuplicate = prev.some(
          (row) => row.id !== id && row.type === 'section' && (row.content?.kind || 'normal') === nextKind
        );
        if (!hasDuplicate) return merged;

        alert(nextKind === 'header' ? '頁首區段只能有一個，已改回一般區段。' : '頁腳區段只能有一個，已改回一般區段。');
        return {
          ...merged,
          content: {
            ...(merged.content || {}),
            kind: 'normal',
          },
        } as CardElement;
      })
    );
  };

  const handleSave = async () => {
    const targetCardId = ownerUid || cardData.uid;
    setSaving(true);
    if (!ownerUid || targetCardId === 'demo_user' || cardData.uid === 'demo_user') {
      setTimeout(() => {
        alert('測試模式：已模擬儲存發布！(未登入狀態不會寫入資料庫)');
        setSaving(false);
      }, 800);
      return;
    }

    try {
      await setDoc(doc(db, 'cards', targetCardId), {
        uid: targetCardId,
        username: cardData.username || '',
        profile: {
          displayName: profileData.displayName || cardData.username || '',
          avatarUrl: profileData.avatarUrl || ''
        },
        draft_content: {
          ...(cardData.draft_content || {}),
          elements,
          styles: globalStyles,
        },
        published_content: {
          ...(cardData.published_content || {}),
          elements,
          styles: globalStyles,
        },
        updatedAt: new Date().toISOString()
      }, { merge: true });
      alert('已成功保存並發布！');
    } catch (err) {
      console.error('Save failed:', err);
      const e = err as { code?: string; message?: string };
      alert(`保存失敗：${e.code || 'unknown'}${e.message ? `\n${e.message}` : ''}`);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    // If an element is selected, close the Add drawer
    if (selectedId) setIsAddDrawerOpen(false);
  }, [selectedId]);

  const activeElement = elements.find(el => el.id === selectedId);
  const isProfileSelected = selectedId === 'profile';
  const pageStyle = toGlobalPageStyle(globalStyles);
  const previewCardId = ownerUid || cardData.uid;

  return (
    <div className="relative min-h-[calc(100vh-73px)] w-full overflow-x-hidden bg-cream flex justify-center">
      
      {/* Decorative Blobs (Same as Profile) */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden select-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-cat-blue/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-chocolate/5 rounded-full blur-[120px]" />
      </div>

      {/* 1:1 Canvas (Matches Profile.tsx EXACTLY) */}
      <div
        style={pageStyle}
        className="w-full min-h-full py-20 px-6 relative z-10"
        onClick={() => setSelectedId(null)} // Click outside to deselect
      >
        <div className="w-full max-w-[480px] mx-auto">
          <div 
            className="text-center mb-12 cursor-pointer transition-transform hover:scale-105 active:scale-95" 
            onClick={(e) => { e.stopPropagation(); setSelectedId('profile'); }}
          >
            <motion.div className={cn("w-32 h-32 rounded-[4rem] mx-auto mb-6 p-1.5 relative overflow-hidden transition-all", isProfileSelected ? "ring-4 ring-cat-blue" : "")}>
              <img 
                src={profileData.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${cardData.uid}`} 
                alt={profileData.displayName}
                className="w-full h-full rounded-[2.8rem] object-cover"
              />
            </motion.div>
            <div className="space-y-1">
              <h1 style={{ color: globalStyles.textColor, fontFamily: 'inherit' }} className="text-3xl font-black tracking-tight group flex items-center justify-center gap-1">
                {profileData.displayName}
              </h1>
            </div>
          </div>

          <Reorder.Group
            axis="y" 
            values={elements} 
            onReorder={setElements} 
            layoutScroll
            className="space-y-6 pb-32" // extra padding for bottom FABs
          >
            {elements.length === 0 && (
              <div className="text-center py-20 text-chocolate/20 font-bold uppercase tracking-widest bg-white/20 rounded-[2rem] border-3 border-dashed border-chocolate/5">
                這裡目前還沒有任何內容...
              </div>
            )}

            {elements.map((el) => (
              <SortableElementItem
                key={el.id}
                el={el}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                isTouchDevice={isTouchDevice}
                dragTimerRef={dragTimerRef}
              >

                {selectedId === el.id && (
                  <div className="absolute -right-4 -top-4 z-20">
                    <button 
                      onClick={(e) => { e.stopPropagation(); setElements(elements.filter(item => item.id !== el.id)); setSelectedId(null); }}
                      className="p-3 bg-red-500 text-white hover:bg-red-600 rounded-full transition-transform hover:scale-110 active:scale-95"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}

                {/* 多數元件在編輯器預覽停用互動，避免拖曳時誤觸；少數元件需要可操作/可同步資料 */}
                <div
                  className={cn(
                    'pointer-events-none',
                    (el.type === 'music' || el.type === 'gallery') && 'pointer-events-auto'
                  )}
                >
                  <ElementPreview el={el} globalStyles={globalStyles} cardId={previewCardId} editorVisitorMode="display" />
                </div>
              </SortableElementItem>
            ))}
          </Reorder.Group>
        </div>
      </div>

      {/* Floating Action Buttons */}
      <div className="fixed top-24 right-8 z-40 flex flex-col items-end gap-4">
        <button 
          onClick={handleSave}
          disabled={saving}
          className="w-14 h-14 rounded-full flex items-center justify-center gap-2 bg-chocolate text-white font-bold transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 truncate"
        >
          <Save size={24} />
          {saving ? '保存中...' : ''}
        </button>
        <button 
          onClick={() => { setIsAddDrawerOpen(!isAddDrawerOpen); setSelectedId(null); }}
          className={cn(
            "w-14 h-14 rounded-full flex items-center justify-center transition-all bg-cat-blue text-white hover:scale-110 active:scale-95",
            isAddDrawerOpen && "rotate-45"
          )}
        >
          <Plus size={28} />
        </button>
      </div>

      {/* Left Drawer: Add Elements */}
      <AnimatePresence>
        {isAddDrawerOpen && (
          <motion.aside 
            initial={{ x: '-100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '-100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 left-0 h-[100vh] w-80 bg-white border-r border-chocolate/5 flex flex-col p-6 overflow-y-auto z-50"
          >
            <div className="mb-8 flex items-center justify-between">
              <h3 className="text-sm font-bold text-chocolate/40 uppercase tracking-widest">全局網站設計</h3>
              <button onClick={() => setIsAddDrawerOpen(false)} className="visible md:hidden p-2 text-chocolate/50 hover:bg-cream rounded-full"><Plus size={24} className="rotate-45" /></button>
            </div>
            <div className="space-y-4 mb-8">
              <GlobalStyleControls styles={globalStyles} onChange={setGlobalStyles} />
            </div>

            <h3 className="text-sm font-bold text-chocolate/40 uppercase tracking-widest mb-4">新增元素</h3>
            <div className="grid grid-cols-2 gap-3 pb-8">
              {ELEMENT_TYPES.map((et) => (
                <button
                  key={et.type}
                  onClick={() => handleAdd(et.type)}
                  className="flex flex-col items-center justify-center gap-2 p-6 bg-white border-3 border-transparent hover:border-cat-blue/20 bg-cream/30 rounded-2xl hover:text-cat-blue transition-all group hover:-translate-y-1"
                >
                  <div className="w-12 h-12 bg-white rounded-xl border-3 border-chocolate/5 flex items-center justify-center group-hover:bg-cat-blue group-hover:text-white transition-colors">
                    <et.icon size={24} />
                  </div>
                  <span className="text-xs font-bold">{et.label}</span>
                </button>
              ))}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Right Drawer: Properties Inspector */}
      <AnimatePresence>
        {(activeElement || isProfileSelected) && (
          <motion.aside 
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="absolute top-0 right-0 h-[100vh] w-80 bg-white border-l border-chocolate/5 p-6 overflow-y-auto z-50 fixed right-0"
          >
            <div className="flex items-center justify-between mb-8 pb-4 border-b border-chocolate/5">
              <div className="flex items-center gap-2 text-chocolate">
                <Settings2 size={18} />
                <h3 className="text-sm font-bold uppercase tracking-widest">屬性編輯</h3>
              </div>
              <button onClick={() => setSelectedId(null)} className="p-2 bg-cream hover:bg-chocolate hover:text-white transition-colors rounded-full"><Plus className="rotate-45" size={18}/></button>
            </div>

            <div className="space-y-6">
              {isProfileSelected ? (
                <>
                  <div className="p-4 bg-cream rounded-2xl flex items-center gap-3">
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-chocolate">
                      <Eye size={18} />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-chocolate">個人檔案</div>
                      <div className="text-[10px] text-chocolate/40 font-mono">ID: profile</div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <label className="block text-xs font-bold text-chocolate/40">顯示名稱</label>
                    <input 
                      value={profileData.displayName}
                      onChange={(e) => setProfileData(p => ({ ...p, displayName: e.target.value }))}
                      className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20"
                    />
                    <ImageUploadControl 
                      currentUrl={profileData.avatarUrl} 
                      onUploadComplete={(url) => setProfileData(p => ({ ...p, avatarUrl: url }))} 
                    />
                    <textarea 
                      value={profileData.avatarUrl}
                      onChange={(e) => setProfileData(p => ({ ...p, avatarUrl: e.target.value }))}
                      rows={3}
                      className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20 break-all"
                      placeholder="https://"
                    />
                    <p className="text-xs text-chocolate/40 italic">提示：上傳圖片，或貼上網址。留白則會自動使用您的 Google 帳號頭貼或產生預設圖案。</p>
                  </div>
                </>
              ) : activeElement ? (
                <>
                  <div className="p-4 bg-cream rounded-2xl flex items-center gap-3">
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-chocolate">
                      {(() => {
                        const Icon = ELEMENT_TYPES.find(t => t.type === activeElement.type)?.icon;
                        return Icon ? <Icon size={18} /> : null;
                      })()}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-chocolate">{ELEMENT_TYPES.find(t => t.type === activeElement.type)?.label}</div>
                      <div className="text-[10px] text-chocolate/40 font-mono">ID: {activeElement.id}</div>
                    </div>
                  </div>
                  <InspectorControls el={activeElement} onUpdate={(updates) => handleUpdate(activeElement.id, updates)} />
                </>
              ) : null}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}

function getInitialContent(type: string) {
  switch(type) {
    case 'text': return { text: '輸入文字内容...', size: 'md', align: 'center' };
    case 'button': return { label: '點擊按鈕', url: '', icon: 'Link' };
    case 'image': return { url: 'https://images.unsplash.com/photo-1493612276216-ee3925520721?w=800&auto=format&fit=crop', alt: '靈感圖片' };
    case 'section': return { name: 'home', title: '首頁區段', kind: 'normal' };
    case 'dropdown': return {
      label: '快速導覽',
      items: [
        { label: '前往首頁', url: '#home' },
        { label: '聯絡我', url: '#contact' },
      ],
    };
    case 'tags': return {
      items: [
        { text: '設計', icon: '✨' },
        { text: '開發', icon: '💻' },
      ],
    };
    case 'gallery': return {
      layout: 'grid',
      fill: true,
      images: [
        { url: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=800&auto=format&fit=crop', caption: '第一張圖片', link: '' },
      ],
    };
    case 'anon_box': return { title: '跟我說些悄悄話吧', placeholder: '在此輸入...' };
    case 'embed': return { url: '', html: '' };
    case 'music': return { url: '' };
    case 'countdown': return { title: '活動倒數', targetAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString() };
    case 'visitor': return { title: '訪客次數', prefix: '👀' };
    case 'mood': return { title: '個人都說讚', emoji: '❤️' };
    default: return {};
  }
}

function EditorGalleryPreview({
  content,
  baseComponentStyle,
  visualStyle,
  borderColor,
  textColor,
  componentBgColor,
  disableLinks,
}: {
  content: any;
  baseComponentStyle: React.CSSProperties;
  visualStyle: React.CSSProperties;
  borderColor?: string;
  textColor?: string;
  componentBgColor?: string;
  /** 編輯器內不開連結、不導向 */
  disableLinks?: boolean;
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
    return <div style={baseComponentStyle} className="w-full p-6 rounded-[2rem] border-3 text-sm opacity-60">圖庫尚未新增圖片</div>;
  }

  if (content.layout === 'slideshow') {
    const n = images.length;
    const slidePct = 100 / n;
    const current = images[index % n];
    const rawLink = String(current.link || '').trim();
    const url = disableLinks ? '' : rawLink ? normalizeLinkTarget(rawLink) : '';

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
      <div style={{ ...baseComponentStyle, ...visualStyle, borderColor }} className="w-full rounded-[2rem] border-3 overflow-hidden">
        {url ? (
          <a href={url} className="block" onPointerDown={(e) => e.stopPropagation()}>
            {media}
          </a>
        ) : (
          <div className="block" onPointerDown={(e) => e.stopPropagation()}>
            {media}
          </div>
        )}

        <div className="p-4 flex items-center gap-3" onPointerDown={(e) => e.stopPropagation()}>
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
    <div className="grid grid-cols-2 gap-2 w-full" onPointerDown={(e) => e.stopPropagation()}>
      {images.map((img: any, idx: number) => {
        const rawLink = String(img.link || '').trim();
        const url = disableLinks ? '' : rawLink ? normalizeLinkTarget(rawLink) : '';
        const inner = (
          <div className="relative aspect-square w-full overflow-hidden rounded-2xl border-3 bg-black/5 group" style={{ borderColor }}>
            <img src={img.url} alt={img.caption || `圖庫 ${idx + 1}`} className={cn('h-full w-full', content.fill ? 'object-cover' : 'object-contain')} />
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

        if (!url || disableLinks) return <div key={`g-${idx}`}>{inner}</div>;
        return (
          <a key={`g-${idx}`} href={url} className="block">
            {inner}
          </a>
        );
      })}
    </div>
  );
}

function ElementPreview({
  el,
  globalStyles,
  cardId,
  editorVisitorMode = 'live',
}: {
  el: CardElement;
  globalStyles: GlobalDesignStyles;
  cardId: string;
  editorVisitorMode?: 'live' | 'display';
}) {
  const { type, content } = el;
  const visualStyle = toElementStyle(el.style);
  const baseComponentStyle = {
    backgroundColor: globalStyles.componentBackgroundColor,
    borderColor: globalStyles.componentBorderColor,
    color: globalStyles.textColor,
  };

  if (type === 'text') {
    const alignClass = content.align === 'left' ? 'text-left' : content.align === 'right' ? 'text-right' : 'text-center';
    const html = DOMPurify.sanitize(marked.parse(String(content.text || '')) as string);
    return (
      <div
        style={{ color: globalStyles.textColor }}
        className={cn(
          "font-bold leading-tight mx-auto px-4",
          alignClass,
          content.size === '6xl' ? 'text-4xl md:text-5xl font-black mb-4' : 'text-lg opacity-80'
        )}
      >
        <div className="markdown-body max-w-none prose-strong:font-black" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  }

  if (type === 'button') {
    const buttonStyle = {
      ...baseComponentStyle,
      ...visualStyle,
      backgroundColor: visualStyle.backgroundColor || globalStyles.componentBackgroundColor,
      color: globalStyles.textColor,
    };
    return (
      <div style={buttonStyle} className="w-full p-5 border-3 rounded-[2rem] font-bold flex items-center justify-between group pointer-events-none">
        <div className="flex items-center gap-4">
          <div style={{ color: globalStyles.textColor }} className="w-10 h-10 rounded-2xl flex items-center justify-center">
            <LinkIcon size={18} />
          </div>
          <span className="text-lg">{content.label}</span>
        </div>
      </div>
    );
  }

  if (type === 'anon_box') {
    return (
      <div
        style={{
          ...baseComponentStyle,
          borderColor: globalStyles.componentBorderColor,
        }}
        className="w-full p-8 rounded-[2rem] border-3 space-y-4 relative overflow-hidden pointer-events-none"
      >
        <div className="absolute -top-10 -right-10 opacity-10 rotate-12">
          <Heart size={120} />
        </div>
        <div className="flex items-center gap-3 mb-2 relative z-10">
          <div className="w-8 h-8 bg-white/30 rounded-xl flex items-center justify-center">
            <Heart size={16} />
          </div>
          <h3 className="font-bold text-xl">{content.title || '給我留言'}</h3>
        </div>
        <div className="relative z-10 space-y-4">
          <div className="w-full bg-white/30 border-3 border-white/50 rounded-[2rem] p-5 truncate opacity-70">
            {content.placeholder || "在此輸入想說的話..."}
          </div>
          <div
            style={{ backgroundColor: globalStyles.componentBorderColor, color: globalStyles.componentBackgroundColor }}
            className="w-full py-4 rounded-[1.5rem] font-black uppercase tracking-widest flex items-center justify-center gap-2"
          >
            送出悄悄話
          </div>
        </div>
      </div>
    );
  }

  if (type === 'image') {
    return <img src={content.url} style={{ borderColor: globalStyles.componentBorderColor, ...visualStyle }} className="w-full h-auto rounded-[2rem] border-3 pointer-events-none" alt="preview" />;
  }

  if (type === 'gallery') {
    return (
      <EditorGalleryPreview
        content={content}
        baseComponentStyle={baseComponentStyle}
        visualStyle={visualStyle}
        borderColor={globalStyles.componentBorderColor}
        textColor={globalStyles.textColor}
        componentBgColor={globalStyles.componentBackgroundColor}
        disableLinks
      />
    );
  }

  if (type === 'section') {
    const marker = content.kind === 'header' ? '#header' : content.kind === 'footer' ? '#footer' : `#${(content.name || 'section').replace(/^#/, '')}`;
    const markerColor = globalStyles.textColor || globalStyles.componentBorderColor;
    const markerBg = globalStyles.componentBackgroundColor || globalStyles.backgroundColor;
    return (
      <div style={{ backgroundColor: markerBg }} className="relative left-1/2 -translate-x-1/2 w-screen max-w-none py-2">
        <div className="flex items-center gap-3 px-3">
          <div style={{ borderColor: markerColor }} className="h-0 flex-1 border-t border-dashed" />
          <span
            style={{ color: markerColor, backgroundColor: markerBg, ...visualStyle }}
            className="px-2 text-[11px] font-black tracking-widest uppercase leading-none"
          >
            {marker}
          </span>
          <div style={{ borderColor: markerColor }} className="h-0 flex-1 border-t border-dashed" />
        </div>
      </div>
    );
  }

  if (type === 'dropdown') {
    const first = content.items?.[0];
    return (
      <div
        style={{ ...baseComponentStyle, ...visualStyle }}
        className="w-full p-5 rounded-[2rem] border-3 flex items-center justify-between"
      >
        <div>
          <div style={{ color: globalStyles.textColor }} className="text-xs font-bold uppercase tracking-wider opacity-70">{content.label || '下拉選單'}</div>
          <div className="text-sm mt-1 truncate">{first ? `${first.label} -> ${first.url}` : '尚未新增選項'}</div>
        </div>
        <ChevronDown size={18} className="opacity-60" />
      </div>
    );
  }

  if (type === 'tags') {
    const items = content.items || [];
    return (
      <div className="flex flex-wrap gap-2">
        {items.length === 0 ? (
          <div style={baseComponentStyle} className="text-xs px-3 py-2 rounded-xl border-3">尚未新增標籤</div>
        ) : (
          items.map((item: { text?: string; icon?: string }, idx: number) => (
            <div
              key={`tag-${idx}`}
              style={{ ...baseComponentStyle, ...visualStyle }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border-3 font-medium text-sm"
            >
              {item.icon ? <span>{item.icon}</span> : null}
              <span>{item.text || `標籤 ${idx + 1}`}</span>
            </div>
          ))
        )}
      </div>
    );
  }
  
  if (type === 'embed') {
    const embedHtml = content.html || buildEmbedHtmlFromUrl(content.url || '');
    if (!embedHtml) {
      return (
        <div className="w-full rounded-[2rem] overflow-hidden border-3 bg-cream flex flex-col items-center justify-center p-8 text-center pointer-events-none">
           <Play className="text-chocolate/20 mb-4" size={48} />
           <p className="font-bold text-chocolate">嵌入內容區域</p>
           <p className="text-xs text-chocolate/50 font-mono mt-2 truncate w-full">請在屬性面板貼上影音連結或 iframe 代碼</p>
        </div>
      );
    }
    return (
      <div 
        style={{ borderColor: globalStyles.componentBorderColor }}
        className="w-full rounded-[2rem] overflow-hidden border-3 bg-cream flex flex-col items-center justify-center pointer-events-none"
      >
        <StableEmbedHtml embedHtml={embedHtml} />
      </div>
    );
  }

  if (type === 'music') {
    const rawUrl = String(content.url || '').trim();
    if (!rawUrl) {
      return (
        <div style={baseComponentStyle} className="w-full rounded-[2rem] border-3 p-6 text-center">
          <Music className="mx-auto mb-2 opacity-40" />
          <div className="text-sm opacity-70">貼上 YouTube 或 YouTube Music 連結</div>
        </div>
      );
    }
    return (
      <div onPointerDown={(e) => e.stopPropagation()}>
        <MusicPlayer
          url={rawUrl}
          borderColor={globalStyles.componentBorderColor}
          textColor={globalStyles.textColor}
          style={{ ...baseComponentStyle, ...visualStyle }}
        />
      </div>
    );
  }

  if (type === 'countdown') {
    return <CountdownBlock title={content.title} targetAt={content.targetAt} style={baseComponentStyle} />;
  }

  if (type === 'visitor') {
    const merged = {
      ...baseComponentStyle,
      ...visualStyle,
      backgroundColor: visualStyle.backgroundColor || globalStyles.componentBackgroundColor,
    };
    return <VisitorCounter mode={editorVisitorMode} cardId={cardId} elementId={el.id} content={content} style={merged} />;
  }

  if (type === 'mood') {
    const merged = {
      ...baseComponentStyle,
      ...visualStyle,
      backgroundColor: visualStyle.backgroundColor || globalStyles.componentBackgroundColor,
      color: globalStyles.textColor,
    };
    return <MoodCounter mode="live" cardId={cardId} elementId={el.id} content={content} style={merged} />;
  }

  return <div className="p-4 bg-cream rounded-xl text-[10px] text-chocolate/40 font-bold uppercase">{type} ELEMENT</div>;
}

function ImageUploadControl({ currentUrl, onUploadComplete }: { currentUrl?: string, onUploadComplete: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate type
    if (!file.type.startsWith('image/')) {
      alert('請上傳圖片檔案 (JPG, PNG, GIF, WebP)');
      return;
    }

    setUploading(true);
    setProgress(5);
    setStatusText('壓縮圖片中...');

    try {
      const compressed = await compressImageForWeb(file);
      setProgress(40);
      setStatusText(`上傳 ${compressed.extension.toUpperCase()} 中...`);

      const safeBaseName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'image';
      const uploadedUrl = await uploadImageToR2({
        blob: compressed.blob,
        fileName: safeBaseName,
        contentType: compressed.mimeType,
        onProgress: (p) => {
          const mapped = 40 + Math.round(p * 0.6);
          setProgress(Math.min(99, mapped));
        },
      });

      setProgress(100);
      setStatusText('上傳完成');
      onUploadComplete(uploadedUrl);
    } catch (error) {
      console.error(error);
      alert('上傳失敗，請檢查 R2 設定或稍後再試');
    } finally {
      setTimeout(() => {
        setUploading(false);
        setProgress(0);
        setStatusText('');
      }, 250);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs font-bold text-chocolate/40">上傳圖片檔案</label>
      <div className="relative group overflow-hidden rounded-2xl border-3 border-dashed border-chocolate/10 hover:border-cat-blue/50 transition-colors bg-cream/30">
        <input 
          type="file" 
          accept="image/*" 
          onChange={handleFileChange}
          disabled={uploading}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
        />
        <div className="p-6 flex flex-col items-center justify-center text-center gap-2">
          {uploading ? (
            <>
              <Loader2 className="animate-spin text-cat-blue" size={24} />
              <div className="text-xs font-bold text-cat-blue">{statusText || '上傳中...'} {progress}%</div>
            </>
          ) : (
            <>
              <UploadCloud className="text-chocolate/20 group-hover:text-cat-blue transition-colors" size={24} />
              <div className="text-xs font-bold text-chocolate/60">
                點擊或拖曳圖片至此處
              </div>
              <div className="text-[10px] text-chocolate/30">自動壓縮成 AVIF/WebP 後上傳</div>
            </>
          )}
        </div>
        {uploading && (
          <div className="absolute bottom-0 left-0 h-1 bg-cat-blue transition-all" style={{ width: `${progress}%` }} />
        )}
      </div>
      
      <div className="relative flex py-4 items-center">
        <div className="flex-grow border-t border-chocolate/5"></div>
        <span className="flex-shrink-0 mx-4 text-chocolate/20 text-xs font-bold uppercase">或貼上網址</span>
        <div className="flex-grow border-t border-chocolate/5"></div>
      </div>
    </div>
  );
}

function GlobalStyleControls({ styles, onChange }: { styles: GlobalDesignStyles; onChange: (next: GlobalDesignStyles) => void }) {
  const [openPanel, setOpenPanel] = useState<'background' | 'typography' | 'palette'>('background');

  const update = <K extends keyof GlobalDesignStyles>(key: K, value: GlobalDesignStyles[K]) => {
    onChange({ ...styles, [key]: value });
  };

  const palette = (styles.palette && styles.palette.length > 0 ? styles.palette : DEFAULT_PALETTE).slice(0, 10);

  const updatePalette = (index: number, color: string) => {
    const next = [...palette];
    next[index] = color;
    onChange({ ...styles, palette: next });
  };

  const addPalette = () => {
    if (palette.length >= 10) return;
    onChange({ ...styles, palette: [...palette, '#FFFFFF'] });
  };

  const removePalette = (index: number) => {
    if (palette.length <= 1) return;
    onChange({ ...styles, palette: palette.filter((_, i) => i !== index) });
  };

  const togglePanel = (key: 'background' | 'typography' | 'palette') => {
    setOpenPanel((prev) => (prev === key ? prev : key));
  };

  return (
    <div className="rounded-2xl bg-cream/40">
      <AccordionHeader title="背景設定" isOpen={openPanel === 'background'} onClick={() => togglePanel('background')} />
      <AnimatePresence initial={false}>
        {openPanel === 'background' && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="overflow-hidden"
        >
        <div className="space-y-3 px-3 py-3">
          <CompactImageUploadControl onUploadComplete={(url) => update('backgroundImageUrl', url)} />
          <input
            value={styles.backgroundImageUrl || ''}
            onChange={(e) => update('backgroundImageUrl', e.target.value)}
            className="w-full p-3 bg-white rounded-xl text-xs outline-none focus:ring-2 ring-cat-blue/20"
            placeholder="背景圖片網址（可留白）"
          />
          <PaletteSelector
            title="背景色"
            palette={palette}
            selected={styles.backgroundColor || '#F5F5DC'}
            onPick={(color) => update('backgroundColor', color)}
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={styles.backgroundRepeat || 'no-repeat'}
              onChange={(e) => update('backgroundRepeat', e.target.value as any)}
              className="w-full p-3 bg-white rounded-xl text-xs outline-none"
            >
              <option value="no-repeat">不重複</option>
              <option value="repeat">平鋪重複</option>
            </select>
            <select
              value={styles.backgroundSize || 'cover'}
              onChange={(e) => update('backgroundSize', e.target.value as any)}
              className="w-full p-3 bg-white rounded-xl text-xs outline-none"
            >
              <option value="cover">裁切填滿</option>
              <option value="contain">完整顯示</option>
              <option value="stretch">拉伸</option>
              <option value="auto">原尺寸</option>
            </select>
          </div>
        </div>
        </motion.div>
      )}
      </AnimatePresence>

      <AccordionHeader title="字體與主色" isOpen={openPanel === 'typography'} onClick={() => togglePanel('typography')} />
      <AnimatePresence initial={false}>
      {openPanel === 'typography' && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="overflow-hidden"
        >
        <div className="space-y-3 px-3 py-3">
          <select
            value={styles.fontFamily || 'system'}
            onChange={(e) => update('fontFamily', e.target.value as any)}
            className="w-full p-3 bg-white rounded-xl text-xs outline-none"
          >
            <option value="system">系統字體</option>
            <option value="noto-sans-tc">黑體 Noto Sans TC</option>
            <option value="noto-serif-tc">襯線 Noto Serif TC</option>
            <option value="chiron-goround-tc">圓體 Chiron GoRound TC</option>
            <option value="lxgw-wenkai-tc">楷體 LXGW WenKai TC</option>
          </select>
          <PaletteSelector
            title="文字色"
            palette={palette}
            selected={styles.textColor || '#3D2B1F'}
            onPick={(color) => update('textColor', color)}
          />
          <PaletteSelector
            title="元件底色"
            palette={palette}
            selected={styles.componentBackgroundColor || '#FFFFFF'}
            onPick={(color) => update('componentBackgroundColor', color)}
          />
          <PaletteSelector
            title="元件邊框"
            palette={palette}
            selected={styles.componentBorderColor || '#3D2B1F'}
            onPick={(color) => update('componentBorderColor', color)}
          />
        </div>
        </motion.div>
      )}
      </AnimatePresence>

      <AccordionHeader title="主題調色盤" isOpen={openPanel === 'palette'} onClick={() => togglePanel('palette')} />
      <AnimatePresence initial={false}>
      {openPanel === 'palette' && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="overflow-hidden"
        >
        <div className="space-y-3 px-3 py-3">
          <div className="grid grid-cols-4 gap-2">
            {palette.map((color, index) => (
              <div key={`palette-${index}`} className="space-y-1">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => updatePalette(index, e.target.value)}
                  className="h-12 w-full cursor-pointer rounded-lg border-3 border-chocolate/10 bg-transparent"
                />
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => removePalette(index)}
                    className="p-1 rounded-md text-red-500 hover:bg-red-50 disabled:opacity-30"
                    disabled={palette.length <= 1}
                    title="刪除顏色"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={addPalette}
            disabled={palette.length >= 10}
            className="w-full p-3 rounded-xl text-xs font-bold bg-white border-3 border-chocolate/10 hover:bg-chocolate hover:text-white transition-colors disabled:opacity-40"
          >
            新增顏色
          </button>
        </div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

function AccordionHeader({ title, isOpen, onClick }: { title: string; isOpen: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-3 py-3 bg-white border-b border-chocolate/10 text-xs font-black text-chocolate/70"
    >
      <span>{title}</span>
      <ChevronDown size={16} className={cn('transition-transform', isOpen ? 'rotate-180' : 'rotate-0')} />
    </button>
  );
}

function PaletteSelector({
  title,
  palette,
  selected,
  onPick,
}: {
  title: string;
  palette: string[];
  selected: string;
  onPick: (color: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-bold text-chocolate/50">{title}</div>
      <div className="grid grid-cols-6 gap-2">
        {palette.map((color, index) => {
          const isSelected = color.toLowerCase() === selected.toLowerCase();
          return (
            <button
              key={`${title}-${index}`}
              onClick={() => onPick(color)}
              className={cn(
                'h-8 w-8 rounded-md border-3 transition-transform hover:scale-105',
                isSelected ? 'border-chocolate shadow-md' : 'border-white/70'
              )}
              style={{ backgroundColor: color }}
              title={color}
            />
          );
        })}
      </div>
    </div>
  );
}

function CompactImageUploadControl({ onUploadComplete }: { onUploadComplete: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    setUploading(true);
    setProgress(5);

    try {
      const compressed = await compressImageForWeb(file);
      const safeBaseName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'bg';
      const uploadedUrl = await uploadImageToR2({
        blob: compressed.blob,
        fileName: safeBaseName,
        contentType: compressed.mimeType,
        onProgress: (p) => setProgress(Math.min(99, Math.max(5, p))),
      });
      setProgress(100);
      onUploadComplete(uploadedUrl);
    } catch (error) {
      console.error(error);
      alert('背景上傳失敗，請稍後再試');
    } finally {
      setTimeout(() => {
        setUploading(false);
        setProgress(0);
      }, 250);
    }
  };

  return (
    <label className="relative block overflow-hidden rounded-xl border-3 border-dashed border-chocolate/15 bg-white/80 hover:border-cat-blue/60 transition-colors cursor-pointer">
      <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" disabled={uploading} />
      <div className="py-4 px-3 text-center">
        {uploading ? (
          <div className="text-xs font-bold text-cat-blue">上傳中 {progress}%</div>
        ) : (
          <div className="text-xs font-bold text-chocolate/60">上傳背景圖片</div>
        )}
      </div>
      {uploading && <div className="absolute left-0 bottom-0 h-1 bg-cat-blue" style={{ width: `${progress}%` }} />}
    </label>
  );
}

const StableEmbedHtml = React.memo(
  function StableEmbedHtml({ embedHtml }: { embedHtml: string }) {
    return <div className="w-full stable-embed-html" dangerouslySetInnerHTML={{ __html: embedHtml }} />;
  },
  (prev, next) => prev.embedHtml === next.embedHtml
);

function CountdownBlock({ title, targetAt, style }: { title?: string; targetAt?: string; style?: React.CSSProperties }) {
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
    <div style={style} className="w-full rounded-[2rem] border-3 p-5 text-center font-bold">
      <div className="text-sm opacity-70 mb-3">{title || '活動倒數'}</div>
      <div className="flex items-baseline justify-center">
        {[ { v: days, u: '天' }, { v: hours, u: '時' }, { v: mins, u: '分' }, { v: secs, u: '秒' } ].map((t, i) => (
          <React.Fragment key={i}>
            <span className="text-xl tabular-nums">{t.v}</span>
            <span className="text-sm opacity-70 ml-1 mr-3 last:mr-0">{t.u}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function InspectorControls({ el, onUpdate }: { el: CardElement, onUpdate: (u: any) => void }) {
  const { type, content } = el;
  
  const handleChange = (key: string, value: any) => {
    onUpdate({ content: { ...content, [key]: value } });
  };

  if (type === 'text') {
    const sizeOptions = [
      { value: 'sm', label: '小' },
      { value: 'md', label: '中' },
      { value: 'lg', label: '大' },
      { value: '6xl', label: '特大' },
    ];

    return (
      <div className="space-y-4">
        <label className="block text-xs font-bold text-chocolate/40">文字內容</label>
        <textarea 
          value={content.text}
          onChange={(e) => handleChange('text', e.target.value)}
          className="w-full p-4 bg-cream border-none rounded-xl focus:ring-2 ring-cat-blue/20 outline-none text-sm min-h-[100px]"
        />
        <details className="rounded-xl border-3 border-chocolate/10 bg-white/60 p-3">
          <summary className="cursor-pointer text-xs font-bold text-chocolate/60">支援 Markdown 語法</summary>
          <div className="mt-3 text-xs text-chocolate/70 space-y-2">
            <div><span className="font-black">換行</span>：<code>&lt;br&gt;</code></div>
            <div><span className="font-black">粗體</span>：<code>**粗體**</code></div>
            <div><span className="font-black">斜體</span>：<code>*斜體*</code></div>
            <div><span className="font-black">連結</span>：<code>[文字](https://example.com)</code></div>
            <div><span className="font-black">清單</span>：<code>- 項目</code></div>
            <div><span className="font-black">引用</span>：<code>&gt; 引用文字</code></div>
            <div><span className="font-black">程式碼</span>：<code>`code`</code></div>
          </div>
        </details>
        <label className="block text-xs font-bold text-chocolate/40">字體大小</label>
        <div className="flex gap-2">
          {sizeOptions.map((s) => (
            <button 
              key={s.value}
              onClick={() => handleChange('size', s.value)}
              className={cn("flex-1 py-2 rounded-lg text-xs font-bold", content.size === s.value ? 'bg-chocolate text-white' : 'bg-cream text-chocolate/40')}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="block text-xs font-bold text-chocolate/40">對齊方式</label>
        <div className="grid grid-cols-3 gap-2">
          {[
            { value: 'left', label: '靠左' },
            { value: 'center', label: '置中' },
            { value: 'right', label: '靠右' },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => handleChange('align', option.value)}
              className={cn(
                'py-2 rounded-lg text-xs font-bold',
                (content.align || 'center') === option.value ? 'bg-chocolate text-white' : 'bg-cream text-chocolate/40'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'button') {
    return (
      <div className="space-y-4">
        <label className="block text-xs font-bold text-chocolate/40">按鈕文字</label>
        <input 
          value={content.label}
          onChange={(e) => handleChange('label', e.target.value)}
          className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20"
        />
        <label className="block text-xs font-bold text-chocolate/40">連結（可輸入網址或區段錨點）</label>
        <input 
          value={content.url}
          onChange={(e) => handleChange('url', e.target.value)}
          className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20"
          placeholder="例如：www.facebook.com 或 #home"
        />
      </div>
    );
  }

  if (type === 'image') {
    return (
      <div className="space-y-4">
        <ImageUploadControl 
          currentUrl={content.url} 
          onUploadComplete={(url) => handleChange('url', url)} 
        />
        <textarea 
          value={content.url}
          onChange={(e) => handleChange('url', e.target.value)}
          rows={3}
          className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20"
          placeholder="請貼上圖片網址"
        />
        <p className="text-xs text-chocolate/40 italic">提示：您也可以在上方的欄位直接上傳圖片。上傳後會自動填入專屬網址。</p>
      </div>
    );
  }

  if (type === 'embed') {
    return (
      <div className="space-y-4">
        <label className="block text-xs font-bold text-chocolate/40">影音平台連結</label>
        <input
          value={content.url || ''}
          onChange={(e) => {
            const url = e.target.value;
            onUpdate({
              content: {
                ...content,
                url,
                html: buildEmbedHtmlFromUrl(url),
              },
            });
          }}
          className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20"
          placeholder="貼上 YouTube、Spotify 連結"
        />
        <label className="block text-xs font-bold text-chocolate/40">或貼 iframe 代碼</label>
        <textarea 
          value={content.html || ''}
          onChange={(e) => handleChange('html', e.target.value)}
          rows={5}
          className="w-full p-4 bg-cream border-none rounded-xl font-mono text-xs outline-none focus:ring-2 ring-cat-blue/20"
          placeholder='<iframe src="https://open.spotify.com/embed/..." ...></iframe>'
        />
        <div className="p-4 bg-chocolate/5 rounded-xl border-3 border-chocolate/10">
          <p className="text-xs font-bold text-chocolate mb-2">支援方式</p>
          <ul className="text-xs text-chocolate/60 space-y-2 list-disc pl-4">
            <li><strong>YouTube / Spotify:</strong> 直接貼上影音連結，系統會自動轉成播放器。</li>
            <li><strong>其他平台:</strong> 可貼上 iframe 嵌入代碼。</li>
          </ul>
        </div>
      </div>
    );
  }

  if (type === 'music') {
    return (
      <div className="space-y-4">
        <label className="block text-xs font-bold text-chocolate/40">音樂平台連結</label>
        <input
          value={content.url || ''}
          onChange={(e) => {
            const url = e.target.value;
            onUpdate({ content: { ...content, url } });
          }}
          className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20"
          placeholder="貼上 YouTube 或 YouTube Music 連結"
        />
      </div>
    );
  }

  if (type === 'gallery') {
    const images = content.images || [];
    const updateImages = (nextImages: Array<{ url: string; caption?: string; link?: string }>) => handleChange('images', nextImages);
    return (
      <div className="space-y-4">
        <details className="eurek-details rounded-2xl border-3 border-chocolate/10 bg-white/60 overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 text-xs font-black text-chocolate/70">圖庫設定</summary>
          <div className="eurek-details-body px-4 pb-4 space-y-3 border-t border-chocolate/10">
            <label className="block text-xs font-bold text-chocolate/40">圖庫版型</label>
            <select value={content.layout || 'grid'} onChange={(e) => handleChange('layout', e.target.value)} className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none">
              <option value="grid">網格</option>
              <option value="slideshow">幻燈片</option>
            </select>
            <label className="block text-xs font-bold text-chocolate/40">圖片呈現</label>
            <select value={content.fill ? 'fill' : 'contain'} onChange={(e) => handleChange('fill', e.target.value === 'fill')} className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none">
              <option value="fill">填滿裁切</option>
              <option value="contain">完整顯示</option>
            </select>
          </div>
        </details>

        <label className="block text-xs font-bold text-chocolate/40">圖片清單</label>
        <div className="space-y-2">
          {images.map((img: any, index: number) => (
            <details key={`gallery-${index}`} className="eurek-details rounded-2xl border-3 border-chocolate/10 bg-white/70 overflow-hidden">
              <summary className="cursor-pointer list-none px-3 py-2 flex items-center justify-between gap-3">
                <div className="text-xs font-black text-chocolate/70 truncate">圖片 {index + 1}</div>
                <div className="text-[10px] font-bold text-chocolate/35">展開</div>
              </summary>

              <div className="eurek-details-body border-t border-chocolate/10">
                <div className="relative aspect-square w-full bg-black/5">
                  {img.url ? (
                    <img src={img.url} alt={img.caption || `圖片 ${index + 1}`} className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-chocolate/35">尚未設定圖片</div>
                  )}
                </div>

                <div className="p-3 space-y-2">
                  <GalleryImageUpload
                    onUploadComplete={(url) => {
                      const next = [...images];
                      next[index] = { ...next[index], url };
                      updateImages(next);
                    }}
                  />
                  <input value={img.url || ''} onChange={(e) => {
                    const next = [...images];
                    next[index] = { ...next[index], url: e.target.value };
                    updateImages(next);
                  }} className="w-full p-3 bg-cream rounded-xl text-xs outline-none" placeholder="圖片網址" />
                  <input value={img.caption || ''} onChange={(e) => {
                    const next = [...images];
                    next[index] = { ...next[index], caption: e.target.value };
                    updateImages(next);
                  }} className="w-full p-3 bg-cream rounded-xl text-xs outline-none" placeholder="圖片說明（可留白）" />
                  <input value={img.link || ''} onChange={(e) => {
                    const next = [...images];
                    next[index] = { ...next[index], link: e.target.value };
                    updateImages(next);
                  }} onBlur={(e) => {
                    const raw = e.target.value.trim();
                    if (!raw) return;
                    const next = [...images];
                    next[index] = { ...next[index], link: normalizeLinkTarget(raw) };
                    updateImages(next);
                  }} className="w-full p-3 bg-cream rounded-xl text-xs outline-none" placeholder="點擊連結（支援 #區段 / 自動補 https://）" />
                  <button
                    type="button"
                    title="刪除此圖"
                    onClick={() => updateImages(images.filter((_: any, i: number) => i !== index))}
                    className="w-full h-10 inline-flex items-center justify-center gap-2 bg-red-50 text-red-500 rounded-xl text-xs font-black"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </details>
          ))}
          <button onClick={() => updateImages([...images, { url: '', caption: '', link: '' }])} className="w-full p-3 rounded-xl text-xs font-bold bg-white border-3 border-chocolate/10 hover:bg-chocolate hover:text-white transition-colors">
            新增圖片
          </button>
        </div>
      </div>
    );
  }

  if (type === 'countdown') {
    return (
      <div className="space-y-4">
        <label className="block text-xs font-bold text-chocolate/40">倒數標題</label>
        <input value={content.title || ''} onChange={(e) => handleChange('title', e.target.value)} className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20" />
        <label className="block text-xs font-bold text-chocolate/40">目標時間</label>
        <input type="datetime-local" value={toLocalDatetimeInputValue(content.targetAt)} onChange={(e) => handleChange('targetAt', fromLocalDatetimeInputValue(e.target.value))} className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20" />
      </div>
    );
  }

  if (type === 'visitor') {
    return (
      <div className="space-y-4">
        <label className="block text-xs font-bold text-chocolate/40">標題</label>
        <input value={content.title || ''} onChange={(e) => handleChange('title', e.target.value)} className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20" />
        <label className="block text-xs font-bold text-chocolate/40">前綴圖示</label>
        <EmojiPickerControl value={content.prefix || '👀'} onChange={(emoji) => handleChange('prefix', emoji)} />
      </div>
    );
  }

  if (type === 'mood') {
    return (
      <div className="space-y-4">
        <label className="block text-xs font-bold text-chocolate/40">心情圖示</label>
        <EmojiPickerControl value={content.emoji || '❤️'} onChange={(emoji) => handleChange('emoji', emoji)} />
        <label className="block text-xs font-bold text-chocolate/40">按鈕文字</label>
        <input value={content.title || ''} onChange={(e) => handleChange('title', e.target.value)} className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20" />
      </div>
    );
  }

  if (type === 'anon_box') {
    return (
      <div className="space-y-4">
        <label className="block text-xs font-bold text-chocolate/40">標題</label>
        <input 
          value={content.title}
          onChange={(e) => handleChange('title', e.target.value)}
          className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20"
        />
        <label className="block text-xs font-bold text-chocolate/40">輸入框提示文字</label>
        <input 
          value={content.placeholder}
          onChange={(e) => handleChange('placeholder', e.target.value)}
          className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20"
        />
      </div>
    );
  }

  if (type === 'section') {
    return (
      <div className="space-y-4">
        <label className="block text-xs font-bold text-chocolate/40">區段類型</label>
        <select
          value={content.kind || 'normal'}
          onChange={(e) => handleChange('kind', e.target.value)}
          className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none"
        >
          <option value="normal">一般區段</option>
          <option value="header">頁首區段</option>
          <option value="footer">頁腳區段</option>
        </select>
        {(content.kind || 'normal') === 'normal' && (
          <>
            <label className="block text-xs font-bold text-chocolate/40">一般區段錨點（#）</label>
            <div className="flex items-center rounded-xl bg-cream overflow-hidden">
              <span className="px-4 text-sm font-bold text-chocolate/60">#</span>
              <input
                value={(content.name || '').replace(/^#/, '')}
                onChange={(e) => handleChange('name', e.target.value.replace(/^#/, ''))}
                className="w-full p-4 bg-transparent border-none text-sm outline-none focus:ring-2 ring-cat-blue/20"
                placeholder="home / test / about"
              />
            </div>
          </>
        )}
        {(content.kind || 'normal') !== 'normal' && (
          <div className="text-xs text-chocolate/50 bg-cream/60 rounded-xl p-3">
            固定區段不需要名稱或 # 錨點。
          </div>
        )}
      </div>
    );
  }

  if (type === 'dropdown') {
    const items = content.items || [];
    const updateItems = (nextItems: Array<{ label: string; url: string }>) => handleChange('items', nextItems);
    return (
      <div className="space-y-4">
        <label className="block text-xs font-bold text-chocolate/40">選單標題</label>
        <input
          value={content.label || ''}
          onChange={(e) => handleChange('label', e.target.value)}
          className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20"
          placeholder="例如：快速導覽"
        />
        <label className="block text-xs font-bold text-chocolate/40">選項列表</label>
        <Reorder.Group axis="y" values={items} onReorder={updateItems} className="space-y-2">
          {items.map((item: { label: string; url: string }, index: number) => (
            <Reorder.Item key={`dropdown-item-${index}`} value={item} className="flex items-center gap-2">
              <div className="w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-xl bg-white border-3 border-chocolate/10 text-chocolate/40 cursor-move">
                <GripVertical size={16} />
              </div>
              <input
                value={item.label}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...next[index], label: e.target.value };
                  updateItems(next);
                }}
                className="min-w-0 flex-1 p-3 bg-cream rounded-xl text-xs outline-none"
                placeholder="文字"
              />
              <input
                value={item.url}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...next[index], url: e.target.value };
                  updateItems(next);
                }}
                className="min-w-0 flex-1 p-3 bg-cream rounded-xl text-xs outline-none"
                placeholder="連結"
              />
              <button
                onClick={() => updateItems(items.filter((_: any, i: number) => i !== index))}
                className="w-9 h-9 shrink-0 inline-flex items-center justify-center bg-red-50 text-red-500 rounded-xl text-xs font-bold"
                title="刪除選項"
              >
                <Trash2 size={15} />
              </button>
            </Reorder.Item>
          ))}
        </Reorder.Group>
          <button
            onClick={() => updateItems([...items, { label: `項目 ${items.length + 1}`, url: '#' }])}
            className="w-full p-3 rounded-xl text-xs font-bold bg-white border-3 border-chocolate/10 hover:bg-chocolate hover:text-white transition-colors"
          >
            新增選項
          </button>
      </div>
    );
  }

  if (type === 'tags') {
    const items = content.items || [];
    const updateItems = (nextItems: Array<{ text: string; icon?: string }>) => handleChange('items', nextItems);
    return (
      <div className="space-y-4">
        <label className="block text-xs font-bold text-chocolate/40">標籤列表</label>
        <div className="space-y-2">
          {items.map((item: { text: string; icon?: string }, index: number) => (
            <div key={`tag-item-${index}`} className="flex items-center gap-2">
              <EmojiPickerControl 
                value={item.icon || '✨'} 
                onChange={(emoji) => {
                  const next = [...items];
                  next[index] = { ...next[index], icon: emoji };
                  updateItems(next);
                }} 
              />
              <input
                value={item.text}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...next[index], text: e.target.value };
                  updateItems(next);
                }}
                className="min-w-0 flex-1 p-4 bg-cream rounded-xl text-xs outline-none"
                placeholder="標籤文字"
              />
              <button
                onClick={() => updateItems(items.filter((_: any, i: number) => i !== index))}
                className="w-10 h-10 shrink-0 inline-flex items-center justify-center bg-red-50 text-red-500 rounded-xl text-xs font-bold"
                title="刪除標籤"
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
          <button
            onClick={() => updateItems([...items, { text: `標籤 ${items.length + 1}`, icon: '✨' }])}
            className="w-full p-3 rounded-xl text-xs font-bold bg-white border-3 border-chocolate/10 hover:bg-chocolate hover:text-white transition-colors"
          >
            新增標籤
          </button>
        </div>
      </div>
    );
  }

  return <div className="text-xs text-chocolate/30 py-8 italic text-center">此組件暫無屬性面板。</div>;
}

function SortableElementItem({
  el,
  selectedId,
  setSelectedId,
  isTouchDevice,
  dragTimerRef,
  children,
}: {
  el: CardElement;
  selectedId: string | null;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  isTouchDevice: boolean;
  dragTimerRef: React.MutableRefObject<number | null>;
  children: React.ReactNode;
}) {
  const dragControls = useDragControls();

  const clearDragTimer = () => {
    if (dragTimerRef.current) {
      window.clearTimeout(dragTimerRef.current);
      dragTimerRef.current = null;
    }
  };

  const onHandlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    clearDragTimer();
    const nativeEvent = event.nativeEvent;
    if (isTouchDevice) {
      dragTimerRef.current = window.setTimeout(() => {
        dragControls.start(nativeEvent);
      }, 280);
      return;
    }
    dragControls.start(nativeEvent);
  };

  return (
    <Reorder.Item
      key={el.id}
      value={el}
      dragControls={dragControls}
      dragListener={false}
      whileDrag={{ scale: 1, zIndex: 40 }}
      onDragStart={() => setSelectedId(el.id)}
      onClick={(e) => {
        e.stopPropagation();
        setSelectedId(el.id);
      }}
      className={cn(
        'relative cursor-pointer group',
        selectedId === el.id ? 'ring-4 ring-cat-blue/50 rounded-[2.2rem]' : ''
      )}
      style={{ touchAction: isTouchDevice ? 'pan-y' : 'none' }}
    >
      <button
        type="button"
        onPointerDown={onHandlePointerDown}
        onPointerUp={clearDragTimer}
        onPointerCancel={clearDragTimer}
        onPointerLeave={clearDragTimer}
        className="absolute -left-12 top-1/2 -translate-y-1/2 p-2 text-chocolate/20 hover:text-chocolate/50 transition-colors cursor-move opacity-0 group-hover:opacity-100 xl:opacity-100 flex flex-col items-center gap-2"
        title={isTouchDevice ? '長按拖曳排序' : '拖曳排序'}
      >
        <GripVertical size={20} />
      </button>
      {children}
    </Reorder.Item>
  );
}

function toLocalDatetimeInputValue(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}

function fromLocalDatetimeInputValue(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function GalleryImageUpload({ onUploadComplete }: { onUploadComplete: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('請上傳圖片檔案 (JPG, PNG, GIF, WebP)');
      return;
    }
    setUploading(true);
    setProgress(5);
    try {
      const compressed = await compressImageForWeb(file);
      const safeBaseName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'gallery';
      const uploadedUrl = await uploadImageToR2({
        blob: compressed.blob,
        fileName: safeBaseName,
        contentType: compressed.mimeType,
        onProgress: (p) => setProgress(Math.min(99, Math.max(5, p))),
      });
      setProgress(100);
      onUploadComplete(uploadedUrl);
    } catch (error) {
      console.error(error);
      alert('上傳失敗，請稍後再試');
    } finally {
      setTimeout(() => {
        setUploading(false);
        setProgress(0);
      }, 250);
    }
  };

  return (
    <label className="relative block overflow-hidden rounded-xl border-3 border-dashed border-chocolate/15 bg-white/80 hover:border-cat-blue/60 transition-colors cursor-pointer">
      <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" disabled={uploading} />
      <div className="py-3 px-3 text-center">
        {uploading ? (
          <div className="text-xs font-bold text-cat-blue">上傳中 {progress}%</div>
        ) : (
          <div className="text-xs font-bold text-chocolate/60">上傳圖庫圖片</div>
        )}
      </div>
      {uploading && <div className="absolute left-0 bottom-0 h-1 bg-cat-blue" style={{ width: `${progress}%` }} />}
    </label>
  );
}

function EmojiPickerControl({ value, onChange }: { value: string; onChange: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full p-3 bg-cream rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20 flex items-center justify-between cursor-pointer"
      >
        <span className="text-lg">{value}</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-2">
          <div className="fixed inset-0" onClick={() => setOpen(false)} />
          <div className="relative">
            <EmojiPicker
              onEmojiClick={(emojiData: any) => {
                onChange(emojiData.emoji);
                setOpen(false);
              }}
              width={280}
              height={350}
              emojiStyle={"native" as any}
              previewConfig={{ showPreview: false }}
              searchDisabled={false}
              skinTonesDisabled
              lazyLoadEmojis
            />
          </div>
        </div>
      )}
    </div>
  );
}
