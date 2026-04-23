import React, { useState, useEffect } from 'react';
import { CardData, CardElement } from '../../types';
import { Plus, GripVertical, Trash2, Layout, Type, Image as ImageIcon, Link as LinkIcon, Play, Hash, Music, Timer, Heart, Settings2, Palette, Save, Eye, Sparkles, UploadCloud, Loader2 } from 'lucide-react';
import { motion, Reorder, AnimatePresence } from 'motion/react';
import { db } from '../../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { cn } from '../../lib/utils';
import { compressImageForWeb } from '../../lib/imageCompression';
import { uploadImageToR2 } from '../../lib/r2Upload';

const ELEMENT_TYPES = [
  { type: 'text', label: '文字', icon: Type },
  { type: 'button', label: '按鈕', icon: LinkIcon },
  { type: 'image', label: '圖片', icon: ImageIcon },
  { type: 'gallery', label: '圖庫', icon: Layout },
  { type: 'section', label: '區段', icon: Hash },
  { type: 'anon_box', label: '匿名箱', icon: Heart },
  { type: 'embed', label: '影音嵌入', icon: Play },
  { type: 'countdown', label: '倒計時', icon: Timer },
];

export default function EditorView({ cardData, ownerUid }: { cardData: CardData; ownerUid: string | null }) {
  const [elements, setElements] = useState<CardElement[]>(cardData?.draft_content?.elements || []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isAddDrawerOpen, setIsAddDrawerOpen] = useState(false);
  const [profileData, setProfileData] = useState({
    displayName: cardData?.profile?.displayName || user?.displayName || cardData?.username || '',
    avatarUrl: cardData?.profile?.avatarUrl || user?.photoURL || ''
  });

  useEffect(() => {
    if (cardData?.draft_content?.elements) {
      setElements(cardData.draft_content.elements);
    }
  }, [cardData]);

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
    setElements(elements.map(el => el.id === id ? { ...el, ...updates } : el));
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
          elements
        },
        published_content: {
          ...(cardData.published_content || {}),
          elements
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

  return (
    <div className="relative min-h-[calc(100vh-73px)] w-full overflow-x-hidden bg-cream flex justify-center">
      
      {/* Decorative Blobs (Same as Profile) */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden select-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-cat-blue/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-chocolate/5 rounded-full blur-[120px]" />
      </div>

      {/* 1:1 Canvas (Matches Profile.tsx EXACTLY) */}
      <div 
        className="w-full max-w-[480px] min-h-full py-20 px-6 relative z-10"
        onClick={() => setSelectedId(null)} // Click outside to deselect
      >
        <div 
          className="text-center mb-12 cursor-pointer transition-transform hover:scale-105 active:scale-95" 
          onClick={(e) => { e.stopPropagation(); setSelectedId('profile'); }}
        >
          <motion.div 
            className={cn("w-32 h-32 bg-white rounded-[3rem] mx-auto mb-6 p-1.5 shadow-2xl relative overflow-hidden transition-all", isProfileSelected ? "ring-4 ring-cat-blue" : "")}
          >
            <img 
              src={profileData.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${cardData.uid}`} 
              alt={profileData.displayName}
              className="w-full h-full rounded-[2.8rem] bg-cat-blue/10 object-cover"
            />
          </motion.div>
          <div className="space-y-1">
            <h1 className="text-3xl font-display font-black text-chocolate tracking-tight group flex items-center justify-center gap-1">
              {profileData.displayName}
              <Sparkles className="text-cat-blue" size={20} />
            </h1>
          </div>
        </div>

        <Reorder.Group 
          axis="y" 
          values={elements} 
          onReorder={setElements} 
          className="space-y-6 pb-32" // extra padding for bottom FABs
        >
          {elements.length === 0 && (
            <div className="text-center py-20 text-chocolate/20 font-bold uppercase tracking-widest bg-white/20 rounded-[3rem] border border-dashed border-chocolate/5">
              這裡目前還沒有任何內容...
            </div>
          )}

          {elements.map((el) => (
            <Reorder.Item 
              key={el.id} 
              value={el} 
              onDragStart={() => setSelectedId(el.id)}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedId(el.id);
              }}
              className={cn(
                "relative transition-all cursor-pointer",
                selectedId === el.id ? "ring-4 ring-cat-blue/50 rounded-[2.2rem] scale-[1.02]" : "hover:scale-[1.01]"
              )}
            >
              <div className="absolute -left-12 top-1/2 -translate-y-1/2 p-2 text-chocolate/20 hover:text-chocolate/50 transition-colors cursor-move opacity-0 group-hover:opacity-100 xl:opacity-100 flex flex-col items-center gap-2">
                 <GripVertical size={20} />
              </div>
              
              {selectedId === el.id && (
                <div className="absolute -right-4 -top-4 z-20">
                  <button 
                    onClick={(e) => { e.stopPropagation(); setElements(elements.filter(item => item.id !== el.id)); setSelectedId(null); }}
                    className="p-3 bg-red-500 text-white hover:bg-red-600 rounded-full shadow-lg transition-transform hover:scale-110 active:scale-95"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
              
              {/* Disable interactions inside preview so we don't accidentally navigate or type while dragging */}
              <div className="pointer-events-none">
                <ElementPreview el={el} />
              </div>
            </Reorder.Item>
          ))}
        </Reorder.Group>
      </div>

      {/* Floating Action Buttons */}
      <div className="fixed top-24 right-8 z-40 flex flex-col items-end gap-4">
        <button 
          onClick={handleSave}
          disabled={saving}
          className="h-14 px-8 rounded-full flex items-center justify-center gap-2 bg-chocolate text-white font-bold transition-all shadow-xl hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 truncate"
        >
          <Save size={20} />
          {saving ? '保存中...' : '儲存發布'}
        </button>
        <button 
          onClick={() => { setIsAddDrawerOpen(!isAddDrawerOpen); setSelectedId(null); }}
          className={cn(
            "w-14 h-14 rounded-full flex items-center justify-center transition-all bg-cat-blue text-white shadow-xl hover:scale-110 active:scale-95",
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
            className="fixed top-0 left-0 h-[100vh] w-80 bg-white border-r border-chocolate/5 flex flex-col p-6 overflow-y-auto shadow-2xl z-50"
          >
            <div className="mb-8 flex items-center justify-between">
              <h3 className="text-sm font-bold text-chocolate/40 uppercase tracking-widest">全局樣式</h3>
              <button onClick={() => setIsAddDrawerOpen(false)} className="visible md:hidden p-2 text-chocolate/50 hover:bg-cream rounded-full"><Plus size={24} className="rotate-45" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-8">
              <button className="p-3 bg-cream rounded-xl flex flex-col items-center justify-center gap-2 border border-chocolate/5 text-xs font-bold hover:bg-chocolate hover:text-white transition-colors">
                <Palette size={18} /> 主題顏色
              </button>
              <button className="p-3 bg-cream rounded-xl flex flex-col items-center justify-center gap-2 border border-chocolate/5 text-xs font-bold hover:bg-chocolate hover:text-white transition-colors">
                <Type size={18} /> 全局字體
              </button>
            </div>

            <h3 className="text-sm font-bold text-chocolate/40 uppercase tracking-widest mb-4">新增元素</h3>
            <div className="grid grid-cols-2 gap-3 pb-8">
              {ELEMENT_TYPES.map((et) => (
                <button
                  key={et.type}
                  onClick={() => handleAdd(et.type)}
                  className="flex flex-col items-center justify-center gap-2 p-6 bg-white border-2 border-transparent hover:border-cat-blue/20 bg-cream/30 rounded-2xl hover:text-cat-blue transition-all group hover:-translate-y-1"
                >
                  <div className="w-12 h-12 bg-white rounded-xl shadow-sm border border-chocolate/5 flex items-center justify-center group-hover:bg-cat-blue group-hover:text-white transition-colors group-hover:shadow-cat-blue/20">
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
            className="absolute top-0 right-0 h-[100vh] w-80 bg-white border-l border-chocolate/5 p-6 overflow-y-auto shadow-2xl z-50 fixed right-0"
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
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-chocolate shadow-sm">
                      <Sparkles size={18} />
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
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-chocolate shadow-sm">
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
    case 'button': return { label: '點擊按鈕', url: 'https://', icon: 'Link' };
    case 'image': return { url: 'https://images.unsplash.com/photo-1493612276216-ee3925520721?w=800&auto=format&fit=crop', alt: '靈感圖片' };
    case 'anon_box': return { title: '跟我說些悄悄話吧', placeholder: '在此輸入...' };
    default: return {};
  }
}

function ElementPreview({ el }: { el: CardElement }) {
  const { type, content } = el;

  if (type === 'text') {
    return (
      <div className={cn(
        "text-chocolate font-bold text-center leading-tight mx-auto px-4",
        content.size === '6xl' ? 'text-4xl md:text-5xl font-black mb-4' : 'text-lg opacity-80'
      )}>
        {content.text}
      </div>
    );
  }

  if (type === 'button') {
    return (
      <div className="w-full p-5 bg-white border border-chocolate/5 rounded-[2rem] text-chocolate font-bold flex items-center justify-between group soft-shadow pointer-events-none">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-cream rounded-2xl flex items-center justify-center text-cat-blue">
            <LinkIcon size={18} />
          </div>
          <span className="text-lg">{content.label}</span>
        </div>
      </div>
    );
  }

  if (type === 'anon_box') {
    return (
      <div className="w-full bg-chocolate p-8 rounded-[3rem] text-white space-y-4 shadow-2xl relative overflow-hidden pointer-events-none">
        <div className="absolute -top-10 -right-10 opacity-10 rotate-12">
          <Heart size={120} />
        </div>
        <div className="flex items-center gap-3 mb-2 relative z-10">
          <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
            <Heart size={16} fill="white" />
          </div>
          <h3 className="font-display font-bold text-xl">{content.title || '給我留言'}</h3>
        </div>
        <div className="relative z-10 space-y-4">
          <div className="w-full bg-white/10 border border-white/20 rounded-[2rem] p-5 text-white/30 truncate">
            {content.placeholder || "在此輸入想說的話..."}
          </div>
          <div className="w-full py-4 rounded-[1.5rem] font-black uppercase tracking-widest bg-cat-blue text-white flex items-center justify-center gap-2">
            送出悄悄話
          </div>
        </div>
      </div>
    );
  }

  if (type === 'image') {
    return <img src={content.url} className="w-full h-auto rounded-[3rem] shadow-xl border-4 border-white pointer-events-none" alt="preview" />;
  }
  
  if (type === 'embed') {
    if (!content.html) {
      return (
        <div className="w-full rounded-[2rem] overflow-hidden shadow-xl border-4 border-white bg-cream flex flex-col items-center justify-center p-8 text-center pointer-events-none">
           <Play className="text-chocolate/20 mb-4" size={48} />
           <p className="font-bold text-chocolate">嵌入內容區域</p>
           <p className="text-xs text-chocolate/50 font-mono mt-2 truncate w-full">請在屬性面板貼上 iframe 代碼</p>
        </div>
      );
    }
    return (
      <div 
        className="w-full rounded-[2rem] overflow-hidden shadow-xl border-4 border-white bg-cream flex flex-col items-center justify-center pointer-events-none"
        dangerouslySetInnerHTML={{ __html: content.html }}
      />
    );
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
      <div className="relative group overflow-hidden rounded-2xl border-2 border-dashed border-chocolate/10 hover:border-cat-blue/50 transition-colors bg-cream/30">
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

function InspectorControls({ el, onUpdate }: { el: CardElement, onUpdate: (u: any) => void }) {
  const { type, content } = el;
  
  const handleChange = (key: string, value: any) => {
    onUpdate({ content: { ...content, [key]: value } });
  };

  if (type === 'text') {
    return (
      <div className="space-y-4">
        <label className="block text-xs font-bold text-chocolate/40">文字內容</label>
        <textarea 
          value={content.text}
          onChange={(e) => handleChange('text', e.target.value)}
          className="w-full p-4 bg-cream border-none rounded-xl focus:ring-2 ring-cat-blue/20 outline-none text-sm min-h-[100px]"
        />
        <label className="block text-xs font-bold text-chocolate/40">字體大小</label>
        <div className="flex gap-2">
          {['sm', 'md', 'lg', '6xl'].map(s => (
            <button 
              key={s} 
              onClick={() => handleChange('size', s)}
              className={cn("flex-1 py-2 rounded-lg text-xs font-bold", content.size === s ? 'bg-chocolate text-white' : 'bg-cream text-chocolate/40')}
            >
              {s.toUpperCase()}
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
        <label className="block text-xs font-bold text-chocolate/40">連結 URL</label>
        <input 
          value={content.url}
          onChange={(e) => handleChange('url', e.target.value)}
          className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20"
          placeholder="https://"
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
        <label className="block text-xs font-bold text-chocolate/40">嵌入代碼 (iframe HTML)</label>
        <textarea 
          value={content.html || ''}
          onChange={(e) => handleChange('html', e.target.value)}
          rows={5}
          className="w-full p-4 bg-cream border-none rounded-xl font-mono text-xs outline-none focus:ring-2 ring-cat-blue/20"
          placeholder='<iframe src="https://open.spotify.com/embed/..." ...></iframe>'
        />
        <div className="p-4 bg-chocolate/5 rounded-xl border border-chocolate/10">
          <p className="text-xs font-bold text-chocolate mb-2">如何嵌入串流平台？</p>
          <ul className="text-xs text-chocolate/60 space-y-2 list-disc pl-4">
            <li><strong>Spotify:</strong> 在歌曲/播放清單點擊「分享」 {'>'} 「嵌入單曲」，複製代碼並貼在上方。</li>
            <li><strong>YouTube:</strong> 在影片點擊「分享」 {'>'} 「嵌入」，複製代碼並貼在上方。</li>
            <li><strong>其他平台:</strong> 任何支援 iframe 嵌入的服務皆可使用此方法。</li>
          </ul>
        </div>
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

  return <div className="text-xs text-chocolate/30 py-8 italic text-center">此組件暫無屬性面板。</div>;
}
