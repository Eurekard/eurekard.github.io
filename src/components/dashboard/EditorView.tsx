import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CardData, CardElement, ElementVisualStyle, GlobalDesignStyles, AnonResponse } from '../../types';
import { Plus, GripVertical, Trash2, Layout, Type, Image as ImageIcon, Link as LinkIcon, Play, Hash, Music, Timer, Heart, Settings, Settings2, Palette, Save, Eye, UploadCloud, Loader2, ChevronDown, List, Tag, ChevronLeft, ChevronRight, Columns, Copy } from 'lucide-react';
import { motion, Reorder, AnimatePresence, useDragControls } from 'motion/react';
import { db } from '../../lib/firebase';
import { doc, setDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { cn } from '../../lib/utils';
import { compressImageForWeb } from '../../lib/imageCompression';
import { deleteR2Image, uploadImageToR2 } from '../../lib/r2Upload';
import { useAuth } from '../../context/AuthContext';
import { buildEmbedHtmlFromUrl } from '../../lib/embed';
import MusicPlayer from '../../components/MusicPlayer';
import { MoodCounter, VisitorCounter } from '../../components/ElementCounters';
import { DEFAULT_PALETTE, normalizeLinkTarget, resolveElementStyle, resolveGlobalStyles, toElementStyle, toGlobalPageStyle } from '../../lib/cardStyle';
import { useToast } from '../../context/ToastContext';
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
  { type: 'layout', label: '佈局', icon: Columns },
];

export default function EditorView({ cardData, ownerUid }: { cardData: CardData; ownerUid: string | null }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [elements, setElements] = useState<CardElement[]>(cardData?.draft_content?.elements || []);
  const [globalStyles, setGlobalStyles] = useState<GlobalDesignStyles>(resolveGlobalStyles(cardData?.draft_content?.styles));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpenId, setInspectorOpenId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isAddDrawerOpen, setIsAddDrawerOpen] = useState(false);
  const [showDropZones, setShowDropZones] = useState(false);
  // Framer Motion drag → layout drop tracking
  const draggingIdRef = useRef<string | null>(null);
  const dragOverLayoutIdRef = useRef<string | null>(null);
  const dragOverColIdxRef = useRef<number | null>(null);
  const [dragOverLayoutId, setDragOverLayoutId] = useState<string | null>(null);
  const [dragOverColIdx, setDragOverColIdx] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const dragTimerRef = useRef<number | null>(null);
  const [profileData, setProfileData] = useState({
    displayName: cardData?.profile?.displayName || user?.displayName || cardData?.username || '',
    avatarUrl: cardData?.profile?.avatarUrl || user?.photoURL || ''
  });

  useEffect(() => {
    if (cardData?.draft_content?.elements) {
      // Unflatten layout children if they were stored as objects in Firestore
      const raw = cardData.draft_content.elements;
      const unflattened = raw.map(el => {
        if (el.type === 'layout' && el.content?.children && !Array.isArray(el.content.children)) {
          const obj = el.content.children;
          const keys = Object.keys(obj).sort((a, b) => Number(a) - Number(b));
          const arr = keys.map(k => obj[k].items || []);
          return { ...el, content: { ...el.content, children: arr } };
        }
        return el;
      });
      setElements(unflattened);
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

  const UNIQUE_TYPES = ['visitor', 'anon_box'] as const;

  const handleAdd = (type: string) => {
    // 唯一性限制
    if ((UNIQUE_TYPES as readonly string[]).includes(type)) {
      const exists = elements.some(el => el.type === type);
      if (exists) {
        const label = type === 'visitor' ? '訪客計數器' : '匿名箱';
        showToast(`${label}只能有一個！`, 'warning');
        return;
      }
    }
    const newEl: CardElement = {
      id: `el_${Date.now()}`,
      type: type as any,
      content: getInitialContent(type),
      style: {}
    };
    const newElements = [...elements, newEl];
    setElements(newElements);
    setSelectedId(newEl.id);
    setInspectorOpenId(newEl.id); // Auto-open inspector for newly added elements
    setIsAddDrawerOpen(false);
  };

  // ── Layout Utilities ──────────────────────────────────────────────────────
  
  // Unified getter for layout children (handles array/object formats)
  const getLayoutChildren = useCallback((el: CardElement): CardElement[][] => {
    const raw = el.content?.children;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      const keys = Object.keys(raw).sort((a, b) => Number(a) - Number(b));
      return keys.map(k => (raw as any)[k].items || []);
    }
    const cols = el.content?.columns ?? 2;
    return Array.from({ length: cols }, () => []);
  }, []);

  // Find which layout (and column) an element belongs to
  const findElementParent = useCallback((targetId: string, currentElements: CardElement[]) => {
    for (const el of currentElements) {
      if (el.type === 'layout') {
        const childrenCols = getLayoutChildren(el);
        for (let colIdx = 0; colIdx < childrenCols.length; colIdx++) {
          if (childrenCols[colIdx].some(c => c.id === targetId)) {
            return { parentId: el.id, colIdx };
          }
        }
      }
    }
    return null;
  }, [getLayoutChildren]);

  // ── Framer Motion drag → layout drop ──────────────────────────────────────
  const handleFmDragMove = useCallback((draggingElId: string, clientX: number, clientY: number) => {
    if (!draggingIdRef.current) {
      draggingIdRef.current = draggingElId;
      setDraggingId(draggingElId);
      setShowDropZones(true);
    }
    // Find layout elements in DOM via data-layout-id attribute
    const layoutElements = document.querySelectorAll<HTMLElement>('[data-layout-id]');
    let found = false;
    for (const domEl of Array.from(layoutElements)) {
      const layoutId = domEl.getAttribute('data-layout-id')!;
      const rect = domEl.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        // Determine which column based on X
        const layoutEl = elements.find(e => e.id === layoutId);
        if (!layoutEl || layoutEl.id === draggingElId) { found = false; break; }
        
        const parentInfo = findElementParent(draggingElId, elements);
        const cols: number = layoutEl.content?.columns ?? 2;
        const widths: number[] = layoutEl.content?.columnWidths ?? Array.from({ length: cols }, () => Math.round(100 / cols));
        const relX = clientX - rect.left;
        const totalW = rect.width;
        let accum = 0;
        let colIdx = cols - 1;
        for (let i = 0; i < cols; i++) {
          accum += (widths[i] ?? Math.round(100 / cols)) / 100 * totalW;
          if (relX < accum) { colIdx = i; break; }
        }

        // Avoid triggering layout drop if it's already in THIS column
        if (parentInfo?.parentId === layoutId && parentInfo.colIdx === colIdx) {
          found = false;
          break;
        }

        dragOverLayoutIdRef.current = layoutId;
        dragOverColIdxRef.current = colIdx;
        setDragOverLayoutId(layoutId);
        setDragOverColIdx(colIdx);
        found = true;
        break;
      }
    }
    if (!found) {
      dragOverLayoutIdRef.current = null;
      dragOverColIdxRef.current = null;
      setDragOverLayoutId(null);
      setDragOverColIdx(null);
    }
  }, [elements]);

  const handleFmDragEnd = useCallback((draggingElId: string, dropPoint?: { x: number, y: number }) => {
    const targetLayoutId = dragOverLayoutIdRef.current;
    const targetColIdx = dragOverColIdxRef.current;
    
    // Reset state
    draggingIdRef.current = null;
    dragOverLayoutIdRef.current = null;
    dragOverColIdxRef.current = null;
    setShowDropZones(false);
    setDragOverLayoutId(null);
    setDragOverColIdx(null);
    setDraggingId(null);

    setElements(prev => {
      const parentInfo = findElementParent(draggingElId, prev);
      const isInLayout = !!parentInfo;
      const parentLayoutId = parentInfo?.parentId;
      const parentColIdx = parentInfo?.colIdx;

      // CASE 1: Move IN from main elements list
      if (!isInLayout && targetLayoutId !== null && targetColIdx !== null) {
        const movedEl = prev.find(e => e.id === draggingElId);
        if (!movedEl || movedEl.type === 'layout') return prev;

        const originalIdx = prev.findIndex(e => e.id === draggingElId);
        const targetLayoutIdx = prev.findIndex(e => e.id === targetLayoutId);
        const removedPrev = prev.filter(e => e.id !== draggingElId);

        return removedPrev.map(el => {
          if (el.id !== targetLayoutId) return el;
          const childrenCols = getLayoutChildren(el);
          while (childrenCols.length <= targetColIdx) childrenCols.push([]);
          
          const insertAtStart = originalIdx !== -1 && targetLayoutIdx !== -1 && originalIdx < targetLayoutIdx;
          if (insertAtStart) {
            childrenCols[targetColIdx] = [movedEl, ...childrenCols[targetColIdx]];
          } else {
            childrenCols[targetColIdx] = [...childrenCols[targetColIdx], movedEl];
          }
          return { ...el, content: { ...el.content, children: childrenCols } };
        });
      }

      // CASE 2: Move OUT back to main elements list
      if (isInLayout && targetLayoutId === null) {
        let childEl: CardElement | undefined;
        // Step 1: Remove from layout
        const removedFromLayout = prev.map(el => {
          if (el.id !== parentLayoutId) return el;
          const childrenCols = getLayoutChildren(el);
          childEl = childrenCols[parentColIdx!].find(c => c.id === draggingElId);
          return {
            ...el,
            content: {
              ...el.content,
              children: childrenCols.map(col => col.filter(c => c.id !== draggingElId))
            }
          };
        });

        if (!childEl) return prev;

        // Step 2: Insert into main list based on drop coordinates
        const parentIdx = removedFromLayout.findIndex(el => el.id === parentLayoutId);
        let insertIdx = parentIdx + 1;
        if (dropPoint) {
          const parentDom = document.querySelector(`[data-layout-id="${parentLayoutId}"]`);
          if (parentDom) {
            const rect = parentDom.getBoundingClientRect();
            if (dropPoint.y < rect.top + rect.height / 2) insertIdx = parentIdx;
          }
        }

        const newElements = [...removedFromLayout];
        newElements.splice(insertIdx, 0, childEl);
        return newElements;
      }

      // CASE 3: CROSS-COLUMN or CROSS-LAYOUT move
      if (isInLayout && targetLayoutId !== null && (targetLayoutId !== parentLayoutId || targetColIdx !== parentColIdx)) {
        let movedEl: CardElement | undefined;
        
        // Step 1: Remove from old parent
        const removedFromOld = prev.map(el => {
          if (el.id !== parentLayoutId) return el;
          const childrenCols = getLayoutChildren(el);
          movedEl = childrenCols[parentColIdx!].find(c => c.id === draggingElId);
          return {
            ...el,
            content: {
              ...el.content,
              children: childrenCols.map(col => col.filter(c => c.id !== draggingElId))
            }
          };
        });

        if (!movedEl) return prev;

        // Step 2: Insert into new parent
        return removedFromOld.map(el => {
          if (el.id !== targetLayoutId) return el;
          const childrenCols = getLayoutChildren(el);
          while (childrenCols.length <= targetColIdx!) childrenCols.push([]);
          childrenCols[targetColIdx!] = [...childrenCols[targetColIdx!], movedEl!];
          return { ...el, content: { ...el.content, children: childrenCols } };
        });
      }

      return prev;
    });
    
    setSelectedId(null);
    setInspectorOpenId(null);
  }, [findElementParent, getLayoutChildren]);

  // Combined logic into handleFmDragEnd for consistency
  const handleMoveOutOfLayout = useCallback(() => {}, []);

  // Conditional reorder: block if dragging over a layout element
  const handleReorder = useCallback((newOrder: CardElement[]) => {
    if (dragOverLayoutIdRef.current) return; // suppress reorder, will drop into layout
    setElements(newOrder);
  }, []);

  const handleDropToColumn = useCallback((layoutId: string, colIdx: number, e: React.DragEvent) => {
    e.preventDefault();
    setShowDropZones(false);
    const elementType = e.dataTransfer.getData('eurekard/element-type');
    const elementId = e.dataTransfer.getData('eurekard/element-id');

    if (elementType && elementType !== 'layout') {
      const newEl: CardElement = {
        id: `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: elementType as CardElement['type'],
        content: getInitialContent(elementType),
        style: {},
      };
      setElements(prev => prev.map(el => {
        if (el.id !== layoutId) return el;
        const children: CardElement[][] = Array.isArray(el.content?.children)
          ? el.content.children.map((c: CardElement[]) => [...c])
          : Array.from({ length: el.content?.columns ?? 2 }, () => []);
        while (children.length <= colIdx) children.push([]);
        children[colIdx] = [...children[colIdx], newEl];
        return { ...el, content: { ...el.content, children } };
      }));
      setIsAddDrawerOpen(false);
    } else if (elementId) {
      // Move existing element from main list into layout column
      setElements(prev => {
        const movedEl = prev.find(el => el.id === elementId);
        if (!movedEl || movedEl.type === 'layout') return prev;
        const withoutMoved = prev.filter(el => el.id !== elementId);
        return withoutMoved.map(el => {
          if (el.id !== layoutId) return el;
          const children: CardElement[][] = Array.isArray(el.content?.children)
            ? el.content.children.map((c: CardElement[]) => [...c])
            : Array.from({ length: el.content?.columns ?? 2 }, () => []);
          while (children.length <= colIdx) children.push([]);
          children[colIdx] = [...children[colIdx], movedEl];
          return { ...el, content: { ...el.content, children } };
        });
      });
      setSelectedId(null);
      setInspectorOpenId(null);
    }
  }, []);

  const handleUpdate = (id: string, updates: Partial<CardElement>) => {
    setElements((prev) => {
      const walk = (items: CardElement[]): CardElement[] => {
        return items.map((el) => {
          if (el.id === id) {
            const merged = { ...el, ...updates } as CardElement;
            if (merged.type !== 'section') return merged;

            const nextKind = merged.content?.kind || 'normal';
            if (nextKind !== 'header' && nextKind !== 'footer') return merged;

            const hasDuplicate = prev.some(
              (row) => row.id !== id && row.type === 'section' && (row.content?.kind || 'normal') === nextKind
            );
            if (!hasDuplicate) return merged;

            showToast(nextKind === 'header' ? '頁首區段只能有一個，已改回一般區段。' : '頁腳區段只能有一個，已改回一般區段。', 'warning');
            return {
              ...merged,
              content: {
                ...(merged.content || {}),
                kind: 'normal',
              },
            } as CardElement;
          }

          if (el.type === 'layout' && el.content?.children) {
            const raw = el.content.children;
            const isArray = Array.isArray(raw);
            const cols = isArray ? raw : Object.values(raw).map((v: any) => v.items || []);
            const newCols = cols.map((col: CardElement[]) => walk(col));
            return {
              ...el,
              content: {
                ...el.content,
                children: isArray ? newCols : Object.fromEntries(newCols.map((c, i) => [i, { items: c }]))
              }
            };
          }
          return el;
        });
      };
      return walk(prev);
    });
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
      // Recursive function to strip nested arrays for Firestore compatibility
      const deepSanitize = (obj: any): any => {
        if (!obj || typeof obj !== 'object') return obj ?? null;
        
        // Handle arrays - but NOT nested arrays
        if (Array.isArray(obj)) {
          // Check if this is a nested array (array containing arrays)
          const hasNestedArray = obj.some(item => Array.isArray(item));
          if (hasNestedArray) {
            // This is a layout children array, convert to object format
            const childrenObj: Record<string, { items: any[] }> = {};
            obj.forEach((col: any[], idx: number) => {
              childrenObj[idx.toString()] = { items: deepSanitize(col) };
            });
            return childrenObj;
          } else {
            // Regular array, sanitize each item
            return obj.map(item => deepSanitize(item));
          }
        }

        const clean: any = {};
        for (const [key, val] of Object.entries(obj)) {
          clean[key] = deepSanitize(val);
        }
        return clean;
      };

      const cleanElements = deepSanitize(elements);
      const cleanStyles = JSON.parse(JSON.stringify(globalStyles));

      await setDoc(doc(db, 'cards', targetCardId), {
        uid: targetCardId,
        username: cardData.username || '',
        profile: {
          displayName: profileData.displayName || cardData.username || '',
          avatarUrl: profileData.avatarUrl || ''
        },
        draft_content: {
          ...(cardData.draft_content || {}),
          elements: cleanElements,
          styles: cleanStyles,
        },
        published_content: {
          ...(cardData.published_content || {}),
          elements: cleanElements,
          styles: cleanStyles,
        },
        updatedAt: new Date().toISOString()
      }, { merge: true });
      showToast('已成功保存並發布！', 'success');
    } catch (err) {
      console.error('Save failed:', err);
      const e = err as { code?: string; message?: string };
      showToast(`保存失敗：${e.code || 'unknown'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (selectedId) {
      setIsAddDrawerOpen(false);
      // 如果設定面板已經是開啟狀態，切換選中元件時自動更新面板內容
      setInspectorOpenId(prev => prev !== null ? selectedId : prev);
    }
  }, [selectedId]);

  // Helper to find element recursively (for layout children)
  const findElementRecursive = (items: CardElement[], id: string): CardElement | undefined => {
    for (const item of items) {
      if (item.id === id) return item;
      if (item.type === 'layout' && Array.isArray(item.content?.children)) {
        for (const col of item.content.children) {
          const found = findElementRecursive(col, id);
          if (found) return found;
        }
      }
    }
    return undefined;
  };

  const activeElement = inspectorOpenId ? findElementRecursive(elements, inspectorOpenId) : undefined;
  const isProfileSelected = inspectorOpenId === 'profile';
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
        onClick={() => { setSelectedId(null); setInspectorOpenId(null); }}
      >
        <div className={cn(
          'w-full mx-auto max-w-[480px]',
          globalStyles.layoutWidth === 'wide' && 'sm:max-w-[1200px]'
        )}>
          <div
            className="text-center mb-12 cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setSelectedId('profile'); setInspectorOpenId('profile'); }}
          >
            <motion.div
              className="w-32 h-32 mx-auto mb-6 relative overflow-hidden transition-all"
              style={(() => {
                const avatarComputed = resolveElementStyle(globalStyles?.avatarStyle, globalStyles);
                return {
                  willChange: 'transform',
                  backgroundColor: avatarComputed.backgroundColor,
                  borderColor: isProfileSelected ? '#5B9CF6' : avatarComputed.borderColor,
                  borderWidth: avatarComputed.borderWidth ?? 3,
                  borderStyle: (avatarComputed.borderStyle as string) ?? 'solid',
                  borderRadius: avatarComputed.borderRadius ?? '2rem',
                  padding: '6px',
                };
              })()}
            >
              <img
                src={profileData.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${cardData.uid}`}
                alt={profileData.displayName}
                className="w-full h-full object-cover"
                style={(() => {
                  const avatarComputed = resolveElementStyle(globalStyles?.avatarStyle, globalStyles);
                  const r = avatarComputed.borderRadius;
                  const num = typeof r === 'string' ? parseFloat(r) : (r ?? 32);
                  return { borderRadius: `calc(${num}px - 6px)` };
                })()}
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
            onReorder={handleReorder}
            layoutScroll
            className="space-y-6 pb-32" // extra padding for bottom FABs
          >
            {elements.length === 0 && (
              <div className="text-center py-20 text-chocolate/20 font-bold uppercase tracking-widest bg-white/20 rounded-[2rem] border border-dashed border-chocolate/5">
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
                onDragMove={(cx, cy) => handleFmDragMove(el.id, cx, cy)}
                onDragEnded={(point) => handleFmDragEnd(el.id, point)}
                isDraggingOverLayout={el.id === draggingId && !!dragOverLayoutId}
              >

                {selectedId === el.id && (
                  <div className="absolute -right-4 -top-4 z-20">
                    <ElementActionsMenu
                      el={el}
                      onEdit={() => setInspectorOpenId(el.id)}
                      onDuplicate={() => {
                        // 唯一性限制
                        const uniqueTypes = ['visitor', 'anon_box'];
                        if (uniqueTypes.includes(el.type)) {
                          const label = el.type === 'visitor' ? '訪客計數器' : '匿名箱';
                          showToast(`${label}只能有一個，無法複製！`, 'warning');
                          return;
                        }
                        // section header/footer 限制：這兩種只能各有一個，複製必然會產生第二個，直接阻止
                        if (el.type === 'section') {
                          const kind = el.content?.kind;
                          if (kind === 'header' || kind === 'footer') {
                            showToast(`${kind === 'header' ? '頁首' : '頁腳'}區段只能有一個，無法複製！`, 'warning');
                            return;
                          }
                        }
                        const newElement = {
                          ...el,
                          id: `el_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
                        };
                        const index = elements.findIndex(item => item.id === el.id);
                        const next = [...elements];
                        next.splice(index + 1, 0, newElement);
                        setElements(next);
                        setSelectedId(newElement.id);
                      }}
                      onDelete={() => {
                        setElements(elements.filter(item => item.id !== el.id));
                        setSelectedId(null);
                      }}
                    />
                  </div>
                )}

                {/* 元件預覽 — layout 元件使用可互動的拖放區塊；其他元件停用互動避免誤觸 */}
                {el.type === 'layout' ? (
                  <LayoutEditorBlock
                    el={el}
                    globalStyles={globalStyles}
                    cardId={previewCardId}
                    showDropZones={showDropZones}
                    activeDropColIdx={dragOverLayoutId === el.id ? dragOverColIdx : null}
                    draggingElement={showDropZones && dragOverLayoutId === el.id ? elements.find(e => e.id === draggingId) ?? null : null}
                    draggingId={draggingId}
                    dragOverLayoutId={dragOverLayoutId}
                    selectedId={selectedId}
                    setSelectedId={setSelectedId}
                    setInspectorOpenId={setInspectorOpenId}
                    onDragMove={handleFmDragMove}
                    onDragEnded={handleFmDragEnd}
                    onDuplicateChild={(child, colIdx) => {
                      const newEl = { ...child, id: `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
                      handleUpdate(el.id, {
                        content: {
                          ...el.content,
                          children: (el.content.children as CardElement[][]).map((col, i) => i === colIdx ? [...col, newEl] : col)
                        }
                      });
                    }}
                    onMoveOutChild={(child) => {
                      // Put child back to main list
                      handleUpdate(el.id, {
                        content: {
                          ...el.content,
                          children: (el.content.children as CardElement[][]).map(
                            (col: CardElement[], i: number) => col.filter(c => c.id !== child.id)
                          )
                        }
                      });
                      setElements(prev => [...prev, child]);
                    }}
                    onDeleteChild={(childId) => {
                      handleUpdate(el.id, {
                        content: {
                          ...el.content,
                          children: (el.content.children as CardElement[][]).map(
                            (col: CardElement[]) => col.filter((c: CardElement) => c.id !== childId)
                          )
                        }
                      });
                    }}
                    handleUpdate={handleUpdate}
                    isTouchDevice={isTouchDevice}
                    dragTimerRef={dragTimerRef}
                  />
                ) : (
                  <div
                    className={cn(
                      'pointer-events-none',
                      (el.type === 'music' || el.type === 'gallery') && 'pointer-events-auto'
                    )}
                  >
                    <ElementPreview el={el} globalStyles={globalStyles} cardId={previewCardId} editorVisitorMode="display" />
                  </div>
                )}
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
      {isAddDrawerOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsAddDrawerOpen(false)}
        />
      )}
      <AnimatePresence>
        {isAddDrawerOpen && (
          <motion.aside
            initial={{ x: '-100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '-100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 left-0 h-[100vh] w-80 bg-white border-r border-chocolate/5 flex flex-col p-6 overflow-y-auto z-50"
            style={{ willChange: 'transform, opacity' }}
          >
            <div className="mb-8 flex items-center justify-between">
              <h3 className="text-sm font-bold text-chocolate/40 uppercase tracking-widest">全局網站設計</h3>
              <button onClick={() => setIsAddDrawerOpen(false)} className="visible md:hidden p-2 text-chocolate/50 hover:bg-cream rounded-full"><Plus size={24} className="rotate-45" /></button>
            </div>
            <div className="space-y-4 mb-8">
              <GlobalStyleControls styles={globalStyles} onChange={setGlobalStyles} />
            </div>

            <h3 className="text-sm font-bold text-chocolate/40 uppercase tracking-widest mb-4">新增元件</h3>
            <div className="grid grid-cols-2 gap-3 pb-8">
              {ELEMENT_TYPES.map((et) => (
                <button
                  key={et.type}
                  onClick={() => handleAdd(et.type)}
                  className="flex flex-col items-center justify-center gap-2 p-6 bg-white border border-transparent hover:border-cat-blue/20 bg-cream/30 rounded-2xl hover:text-cat-blue transition-all group hover:-translate-y-1"
                >
                  <div className="w-12 h-12 bg-white rounded-xl border border-chocolate/5 flex items-center justify-center group-hover:bg-cat-blue group-hover:text-white transition-colors">
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
            style={{ willChange: 'transform, opacity' }}
          >
            <div className="flex items-center justify-between mb-8 pb-4 border-b border-chocolate/5">
              <div className="flex items-center gap-2 text-chocolate">
                <Settings2 size={18} />
                <h3 className="text-sm font-bold uppercase tracking-widest">屬性設定</h3>
              </div>
              <button onClick={() => { setSelectedId(null); setInspectorOpenId(null); }} className="p-2 bg-cream hover:bg-chocolate hover:text-white transition-colors rounded-full"><Plus className="rotate-45" size={18} /></button>
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
                    <div className="mt-2">
                      <ElementStyleControls
                        style={globalStyles?.avatarStyle || {}}
                        palette={globalStyles?.palette || DEFAULT_PALETTE}
                        globalStyles={globalStyles}
                        onUpdate={(patch) => setGlobalStyles((s) => ({ ...s, avatarStyle: { ...(s?.avatarStyle || {}), ...patch } }))}
                      />
                    </div>
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
                  <InspectorControls el={activeElement} onUpdate={(updates) => handleUpdate(activeElement.id, updates)} cardData={cardData} globalStyles={globalStyles} />
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
  switch (type) {
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
    case 'layout': return {
      columns: 2,
      columnWidths: [50, 50],
      children: [[], []], // children[i] = CardElement[] for column i
    };
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
  disableLinks?: boolean;
}) {
  const images = Array.isArray(content.images) ? content.images : [];
  const [index, setIndex] = useState(0);

  if (images.length === 0) {
    return <div style={baseComponentStyle} className="w-full p-6 text-sm opacity-60">圖庫尚未新增圖片</div>;
  }

  if (content.layout === 'slideshow') {
    const n = images.length;
    const slidePct = 100 / n;
    const current = images[index % n];
    const rawLink = String(current.link || '').trim();
    const url = disableLinks ? '' : rawLink ? normalizeLinkTarget(rawLink) : '';

    const xPos = `-${(index * 100) / n}%`;
    const trackWidth = `${n * 100}%`;

    const media = (
      <div className="relative aspect-square w-full overflow-hidden">
        <motion.div
          className="flex h-full"
          animate={{ x: xPos }}
          transition={{ type: 'tween', duration: 0.35, ease: 'easeInOut' }}
          style={{
            width: trackWidth,
            willChange: 'transform',
          }}
        >
          {images.map((img: any, i: number) => (
            <div
              key={`g-slide-${i}-${img.url || i}`}
              className="h-full shrink-0"
              style={{ width: `${slidePct}%` }}
            >
              {img.url
                ? <img src={img.url} alt={img.caption || `gallery ${i + 1}`} className={cn('h-full w-full', content.fill ? 'object-cover' : 'object-contain')} />
                : <div className="h-full w-full flex flex-col items-center justify-center gap-1 opacity-30"><ImageIcon size={24} /><span className="text-[10px] font-bold">尚未新增</span></div>
              }
            </div>
          ))}
        </motion.div>
      </div>
    );

    return (
      <div style={{ ...baseComponentStyle, ...visualStyle }} className="w-full overflow-hidden">
        {url ? (
          <a href={url} className="block" onPointerDown={(e) => e.stopPropagation()}>
            {media}
          </a>
        ) : (
          <div className="block" onPointerDown={(e) => e.stopPropagation()}>
            {media}
          </div>
        )}

        <div className="p-2 flex items-center gap-3" onPointerDown={(e) => e.stopPropagation()}>
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
          <div
            className="relative aspect-square w-full overflow-hidden group"
            style={{
              borderColor,
              borderWidth: (baseComponentStyle as any)?.borderWidth ?? 3,
              borderStyle: (baseComponentStyle as any)?.borderStyle ?? 'solid',
              borderRadius: (baseComponentStyle as any)?.borderRadius ?? '1rem',
            }}
          >
            {img.url
              ? <img src={img.url} alt={img.caption || `圖庫 ${idx + 1}`} className={cn('h-full w-full', content.fill ? 'object-cover' : 'object-contain')} />
              : <div className="h-full w-full flex flex-col items-center justify-center gap-1 opacity-30"><ImageIcon size={24} /><span className="text-[10px] font-bold">尚未新增</span></div>
            }
            {img.caption ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden opacity-100 lg:opacity-0 transition-opacity duration-200 lg:group-hover:opacity-100">
                <div
                  className="gallery-grid-caption w-full px-3 py-2 text-xs font-bold line-clamp-3 text-left"
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

function AnonBoxEditorPreview({
  el,
  cardId,
  computedStyle,
}: {
  el: CardElement;
  cardId: string;
  computedStyle: React.CSSProperties;
}) {
  const { content } = el;
  const [publicReplies, setPublicReplies] = useState<AnonResponse[]>([]);

  useEffect(() => {
    if (!cardId) return;
    const q = query(
      collection(db, 'cards', cardId, 'responses'),
      where('status', '==', 'replied')
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const rows = snapshot.docs.map((row) => ({ id: row.id, ...row.data() } as AnonResponse));
      rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      setPublicReplies(rows);
    });
    return () => unsub();
  }, [cardId]);

  return (
    <div
      style={computedStyle}
      className="w-full p-8 rounded-[2rem] border space-y-4 relative overflow-hidden pointer-events-none"
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
        <div
          style={{ borderColor: computedStyle.borderColor, color: computedStyle.color }}
          className="w-full bg-white/30 border rounded-2xl p-5 truncate opacity-70"
        >
          {content.placeholder || '在此輸入想說的話...'}
        </div>
        <div
          style={{ backgroundColor: computedStyle.borderColor, color: computedStyle.color }}
          className="w-full py-4 rounded-[1.5rem] font-black uppercase tracking-widest flex items-center justify-center gap-2"
        >
          送出悄悄話
        </div>
        {publicReplies.length > 0 && (
          <div
            className="pt-4 space-y-3 border-t"
            style={{ borderColor: computedStyle.borderColor }}
          >
            <div
              className="text-xs font-bold tracking-widest uppercase"
              style={{ color: computedStyle.color }}
            >
              公開回覆
            </div>
            {publicReplies.slice(0, 5).map((row) => (
              <div
                key={row.id}
                className="rounded-2xl bg-white/10 border p-4 space-y-2"
                style={{ borderColor: computedStyle.borderColor }}
              >
                <div
                  className="text-[11px]"
                  style={{ color: computedStyle.color }}
                >
                  {row.message}
                </div>
                <div
                  className="text-sm font-medium"
                  style={{ color: computedStyle.color }}
                >
                  {row.reply}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
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
  // resolveElementStyle 會根據 useGlobalStyle 旗標，自動選擇全局或自訂樣式
  // 並且正確套用 borderWidth, borderStyle, borderRadius, backgroundOpacity 等所有屬性
  const computedStyle = resolveElementStyle(el.style, globalStyles);

  if (type === 'text') {
    const alignClass = content.align === 'left' ? 'text-left' : content.align === 'right' ? 'text-right' : 'text-center';
    const html = DOMPurify.sanitize(marked.parse(String(content.text || '')) as string);
    return (
      <div
        style={computedStyle}
        className={cn(
          "font-bold leading-tight mx-auto p-5 border rounded-[2rem] w-full",
          alignClass,
          ({ sm: 'text-sm', md: 'text-base', lg: 'text-lg', '6xl': 'text-4xl md:text-5xl font-black' } as Record<string, string>)[content.size as string] ?? 'text-base'
        )}
      >
        <div className="markdown-body max-w-none prose-strong:font-black" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  }

  if (type === 'button') {
    return (
      <div style={computedStyle} className="w-full p-5 border rounded-[2rem] font-bold flex items-center justify-between group pointer-events-none">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-2xl transition-colors">
            {content.emoji || '🔗'}
          </div>
          <span className="text-lg">{content.label}</span>
        </div>
      </div>
    );
  }


  if (type === 'anon_box') {
    return <AnonBoxEditorPreview el={el} cardId={cardId} computedStyle={computedStyle} />;
  }

  if (type === 'image') {
    return (
      <div className="relative w-full overflow-hidden rounded-[2rem] border group pointer-events-none" style={computedStyle}>
        {content.url
          ? <img src={content.url} alt="preview" className="w-full h-auto object-cover" />
          : <div className="w-full aspect-video flex flex-col items-center justify-center gap-2 opacity-30"><ImageIcon size={32} /><span className="text-xs font-bold">尚未新增圖片</span></div>
        }
        {content.caption ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden opacity-100 lg:opacity-0 transition-opacity duration-200 lg:group-hover:opacity-100">
            <div
              className="image-caption w-full px-4 py-3 text-sm font-bold line-clamp-3"
              style={{
                backgroundColor: computedStyle.backgroundColor,
                color: computedStyle.color,
              }}
            >
              {content.caption}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (type === 'gallery') {
    return (
      <EditorGalleryPreview
        key={`gallery-${el.id}-${globalStyles.layoutWidth ?? 'narrow'}`}
        content={content}
        baseComponentStyle={computedStyle}
        visualStyle={{}}
        borderColor={computedStyle.borderColor as string}
        textColor={computedStyle.color as string}
        componentBgColor={computedStyle.backgroundColor as string}
        disableLinks
      />
    );
  }

  if (type === 'section') {
    const marker = content.kind === 'header' ? '#header' : content.kind === 'footer' ? '#footer' : `#${(content.name || 'section').replace(/^#/, '')}`;
    const markerColor = globalStyles.textColor || globalStyles.componentBorderColor;
    const markerBg = computedStyle.backgroundColor;
    return (
      <div style={{ backgroundColor: markerBg }} className="w-full py-1">
        <div className="flex items-center gap-3 px-3">
          <div style={{ borderColor: markerColor }} className="h-0 flex-1 border-t border-dashed" />
          <span
            style={{ color: markerColor }}
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
        style={computedStyle}
        className="w-full p-5 rounded-[2rem] border flex items-center justify-between"
      >
        <div>
          <div style={{ color: computedStyle.color }} className="text-xs font-bold uppercase tracking-wider opacity-70">{content.label || '下拉選單'}</div>
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
          <div style={computedStyle} className="text-xs px-3 py-2 rounded-xl border">尚未新增標籤</div>
        ) : (
          items.map((item: { text?: string; icon?: string }, idx: number) => (
            <div
              key={`tag-${idx}`}
              style={computedStyle}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border font-medium text-sm"
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
        <div
          style={{
            backgroundColor: computedStyle.backgroundColor,
            borderColor: computedStyle.borderColor,
            borderWidth: computedStyle.borderWidth ?? 3,
            borderStyle: computedStyle.borderStyle ?? 'solid',
            borderRadius: computedStyle.borderRadius ?? '2rem',
          }}
          className="w-full overflow-hidden flex flex-col items-center justify-center p-8 text-center pointer-events-none"
        >
          <Play className="text-chocolate/20 mb-4" size={48} />
          <p className="font-bold text-chocolate">嵌入內容區域</p>
          <p className="text-xs text-chocolate/50 font-mono mt-2 truncate w-full">請在屬性面板貼上影音連結或 iframe 代碼</p>
        </div>
      );
    }
    return (
      <div
        style={{
          backgroundColor: computedStyle.backgroundColor,
          borderColor: computedStyle.borderColor,
          borderWidth: computedStyle.borderWidth ?? 3,
          borderStyle: computedStyle.borderStyle ?? 'solid',
          borderRadius: computedStyle.borderRadius ?? '2rem',
        }}
        className="w-full overflow-hidden flex flex-col items-center justify-center pointer-events-none"
      >
        <StableEmbedHtml embedHtml={embedHtml} />
      </div>
    );
  }

  if (type === 'music') {
    const rawUrl = String(content.url || '').trim();
    if (!rawUrl) {
      return (
        <div style={computedStyle} className="w-full rounded-[2rem] border p-6 text-center">
          <Music className="mx-auto mb-2 opacity-40" />
          <div className="text-sm opacity-70">貼上 YouTube 或 YouTube Music 連結</div>
        </div>
      );
    }
    return (
      <div onPointerDown={(e) => e.stopPropagation()}>
        <MusicPlayer
          url={rawUrl}
          borderColor={computedStyle.borderColor as string}
          textColor={computedStyle.color as string}
          style={computedStyle}
        />
      </div>
    );
  }

  if (type === 'countdown') {
    return <CountdownBlock title={content.title} targetAt={content.targetAt} style={computedStyle} />;
  }

  if (type === 'visitor') {
    return <VisitorCounter mode={editorVisitorMode} cardId={cardId} elementId={el.id} content={content} style={computedStyle} />;
  }

  if (type === 'mood') {
    return <MoodCounter mode="live" cardId={cardId} elementId={el.id} content={content} style={computedStyle} />;
  }

  if (type === 'layout') {
    const cols: number = content.columns ?? 2;
    const widths: number[] = content.columnWidths ?? Array(cols).fill(Math.round(100 / cols));
    const childrenCols: CardElement[][] = content.children ?? Array(cols).fill([]);
    return (
      <div className="w-full flex flex-col sm:flex-row gap-4">
        {Array.from({ length: cols }).map((_, colIdx) => {
          const colChildren: CardElement[] = childrenCols[colIdx] || [];
          const pct = widths[colIdx] ?? Math.round(100 / cols);
          return (
            <div
              key={`layout-col-${colIdx}`}
              style={{ flexBasis: `${pct}%`, flexShrink: 0, flexGrow: 0, minWidth: 0 }}
              className="hidden sm:flex flex-col gap-4 first:flex"
            >
              {colChildren.length === 0 ? (
                <div className="flex-1 border border-dashed border-chocolate/20 rounded-[1.5rem] p-4 text-center text-xs text-chocolate/30 font-bold min-h-[80px] flex items-center justify-center">
                  欄 {colIdx + 1} (空)
                </div>
              ) : (
                colChildren.map((child) => (
                  <ElementPreview key={child.id} el={child} globalStyles={globalStyles} cardId={cardId} editorVisitorMode={editorVisitorMode} />
                ))
              )}
            </div>
          );
        })}
        {/* Mobile: show all children vertically */}
        <div className="flex sm:hidden flex-col gap-4 w-full">
          {childrenCols.flat().map((child) => (
            <ElementPreview key={child.id} el={child} globalStyles={globalStyles} cardId={cardId} editorVisitorMode={editorVisitorMode} />
          ))}
          {childrenCols.flat().length === 0 && (
            <div className="border border-dashed border-chocolate/20 rounded-[1.5rem] p-4 text-center text-xs text-chocolate/30 font-bold min-h-[80px] flex items-center justify-center">
              佈局容器 (空)
            </div>
          )}
        </div>
      </div>
    );
  }

  return <div className="p-4 bg-cream rounded-xl text-[10px] text-chocolate/40 font-bold uppercase">{type} ELEMENT</div>;
}

// ─── 佈局元件編輯器區塊（FM 拖曳 Drop Zone）────────────────────────────────
function LayoutEditorBlock({
  el,
  globalStyles,
  cardId,
  showDropZones,
  activeDropColIdx,
  draggingElement,
  draggingId,
  dragOverLayoutId,
  selectedId,
  setSelectedId,
  setInspectorOpenId,
  onDragMove,
  onDragEnded,
  onDuplicateChild,
  onMoveOutChild,
  onDeleteChild,
  handleUpdate,
  isTouchDevice,
  dragTimerRef,
}: {
  el: CardElement;
  globalStyles: GlobalDesignStyles;
  cardId?: string;
  showDropZones: boolean;
  activeDropColIdx: number | null;
  draggingElement: CardElement | null;
  draggingId: string | null;
  dragOverLayoutId: string | null;
  selectedId: string | null;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setInspectorOpenId: React.Dispatch<React.SetStateAction<string | null>>;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnded: (id: string, point: { x: number, y: number }) => void;
  onDuplicateChild: (child: CardElement, colIdx: number) => void;
  onMoveOutChild: (child: CardElement) => void;
  onDeleteChild: (childId: string) => void;
  handleUpdate: (id: string, updates: Partial<CardElement>) => void;
  isTouchDevice: boolean;
  dragTimerRef: React.MutableRefObject<number | null>;
}) {
  const cols: number = el.content.columns ?? 2;
  const widths: number[] = el.content.columnWidths ?? Array.from({ length: cols }, () => Math.round(100 / cols));

  // Defensive hydration: handle both array of arrays and flattened object
  let childrenCols: CardElement[][] = [];
  const rawChildren = el.content.children;
  if (Array.isArray(rawChildren)) {
    childrenCols = rawChildren;
  } else if (rawChildren && typeof rawChildren === 'object') {
    const keys = Object.keys(rawChildren).sort((a, b) => Number(a) - Number(b));
    childrenCols = keys.map(k => (rawChildren as any)[k].items || []);
  }
  while (childrenCols.length < cols) childrenCols.push([]);

  return (
    <div className="w-full" data-layout-id={el.id}>
      {/* Column proportion bar */}
      <div className="flex gap-0.5 mb-2 rounded-full overflow-hidden h-1.5">
        {Array.from({ length: cols }).map((_, i) => (
          <div
            key={`bar-${i}`}
            style={{ flexBasis: `${widths[i] ?? Math.round(100 / cols)}%` }}
            className={cn('transition-all', i % 2 === 0 ? 'bg-cat-blue/40' : 'bg-chocolate/20')}
          />
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 w-full">
        {Array.from({ length: cols }).map((_, colIdx) => {
          const colChildren = childrenCols[colIdx] || [];
          const isActive = activeDropColIdx === colIdx;
          const pct = widths[colIdx] ?? Math.round(100 / cols);

          return (
            <div
              key={`layout-drop-col-${colIdx}`}
              style={{ 
                flexBasis: `${pct}%`, 
                flexShrink: 0, 
                flexGrow: 0, 
                minWidth: 0,
                // 使用 auto 高度，避免內容被裁切
                height: 'auto'
              }}
              className={cn(
                'flex flex-col gap-2 rounded-[1.5rem] relative',
                // 當正在拖曳時，強制給予一個固定的最小高度，避免高度晃動導致滑鼠移出
                showDropZones ? 'border-2 border-dashed p-2' : 'p-px min-h-[80px]',
                isActive
                  ? 'border-cat-blue bg-cat-blue/8'
                  : showDropZones ? 'border-chocolate/25' : '',
                // 完全移除所有 transition，避免動畫干擾
                'transition-none'
              )}
            >
              {/* Column label */}
              <div className={cn(
                'text-center text-[10px] font-black tracking-wider uppercase transition-none',
                isActive ? 'text-cat-blue' : 'text-chocolate/30'
              )}>
                {isActive ? `▼ 放入欄 ${colIdx + 1}` : `欄 ${colIdx + 1}`}
              </div>

              {/* Children — exact same as main canvas */}
              <Reorder.Group
                axis="y"
                values={colChildren}
                onReorder={(newOrder) => {
                  const newChildrenCols = [...(el.content.children as CardElement[][])];
                  newChildrenCols[colIdx] = newOrder;
                  handleUpdate(el.id, { content: { ...el.content, children: newChildrenCols } });
                }}
                className={cn(
                  'flex flex-col gap-2 w-full',
                  // 拖曳時鎖定高度，避免內容變化影響容器
                  showDropZones ? 'flex-1' : 'min-h-full'
                )}
              >
                {colChildren.map((child) => (
                  <SortableElementItem
                    key={child.id}
                    el={child}
                    selectedId={selectedId}
                    setSelectedId={setSelectedId}
                    isTouchDevice={isTouchDevice}
                    dragTimerRef={dragTimerRef}
                    onDragMove={(cx, cy) => onDragMove(child.id, cx, cy)}
                    onDragEnded={(point) => onDragEnded(child.id, point)}
                    isDraggingOverLayout={child.id === draggingId && !!dragOverLayoutId}
                    isChild
                  >
                    {selectedId === child.id && (
                      <div className="absolute -right-4 -top-4 z-20">
                        <ElementActionsMenu
                          el={child}
                          onEdit={() => setInspectorOpenId(child.id)}
                          onDuplicate={() => onDuplicateChild(child, colIdx)}
                          onDelete={() => onDeleteChild(child.id)}
                        />
                      </div>
                    )}
                    <div className="pointer-events-none">
                      <ElementPreview el={child} globalStyles={globalStyles} cardId={cardId ?? ''} editorVisitorMode="display" />
                    </div>
                  </SortableElementItem>
                ))}
              </Reorder.Group>

              {/* Ghost preview: show dragging element scaled to column width */}
              {isActive && draggingElement && (
                <div className="absolute inset-0 pointer-events-none opacity-60 ring-2 ring-cat-blue/40 z-10"
                  style={{ borderRadius: draggingElement.style?.radius ?? globalStyles.componentBorderRadius ?? 32, overflow: 'hidden' }}
                >
                  <ElementPreview el={draggingElement} globalStyles={globalStyles} cardId={cardId ?? ''} editorVisitorMode="display" />
                </div>
              )}

              {/* Drop zone hint - 固定高度，避免動態變化 */}
              <div className={cn(
                'rounded-[1.2rem] text-center text-[11px] font-bold flex items-center justify-center h-[52px] flex-shrink-0 transition-none',
                isActive
                  ? 'bg-cat-blue/15 text-cat-blue border-2 border-cat-blue/50'
                  : showDropZones
                    ? 'border border-dashed border-chocolate/20 text-chocolate/30'
                    : colChildren.length === 0
                      ? 'border border-dashed border-chocolate/10 text-chocolate/20'
                      : 'opacity-0 pointer-events-none'
              )}>
                {isActive
                  ? (draggingElement ? '放開以放入此欄 ✓' : '放開滑鼠以放入此欄 ✓')
                  : showDropZones ? '拖曳至此欄' : '此欄為空'}
              </div>
            </div>
          );
        })}
      </div>

      {showDropZones && (
        <div className="mt-2 text-center text-[10px] text-cat-blue/60 font-bold animate-pulse">
          拖曳至上方欄位，放開滑鼠即可放入
        </div>
      )}
    </div>
  );
}

// ─── 佈局子元件操作選單 ────────────────────────────────────────────────────
function LayoutChildMenu({ child, onMoveOut, onDuplicate, onDelete }: {
  child: CardElement;
  onMoveOut: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { showToast } = useToast();
  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className="p-2 bg-white border border-chocolate/10 text-chocolate hover:bg-cat-blue hover:border-cat-blue hover:text-white rounded-full transition-all hover:scale-110 active:scale-95 shadow-sm"
        title="元件操作"
      >
        <Plus size={14} className={cn('transition-transform', open && 'rotate-45')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -4 }}
            className="absolute right-0 top-9 z-30 w-36 bg-white rounded-2xl border border-chocolate/10 shadow-lg overflow-hidden py-1"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => { e.stopPropagation(); onMoveOut(); setOpen(false); }}
              className="w-full px-3 py-2.5 text-xs font-bold text-cat-blue hover:bg-cat-blue/10 flex items-center gap-2 transition-colors text-left"
            >
              ↑ 移出佈局
            </button>
            <div className="h-px bg-chocolate/5 mx-2" />
            <button
              onClick={(e) => { e.stopPropagation(); onDuplicate(); setOpen(false); }}
              className="w-full px-3 py-2.5 text-xs font-bold text-chocolate/80 hover:bg-chocolate/5 flex items-center gap-2 transition-colors text-left"
            >
              <Copy size={12} /> 複製元件
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(child.id);
                showToast('已複製元件 ID', 'success');
                setOpen(false);
              }}
              className="w-full px-3 py-2.5 text-xs font-bold text-chocolate/80 hover:bg-chocolate/5 flex items-center gap-2 transition-colors text-left"
            >
              <Hash size={12} /> 複製 ID
            </button>
            <div className="h-px bg-chocolate/5 mx-2" />
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); setOpen(false); }}
              className="w-full px-3 py-2.5 text-xs font-bold text-red-500 hover:bg-red-50 flex items-center gap-2 transition-colors text-left"
            >
              <Trash2 size={12} /> 刪除元件
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── 佈局子元件拖曳容器 ────────────────────────────────────────────────────
function DraggableLayoutChild({
  child, globalStyles, cardId, draggingId, dragOverLayoutId,
  setSelectedId, onDragMove, onDragEnded, onMoveOut, onDuplicate, onDelete
}: any) {
  const dragControls = useDragControls();
  const dragTimerRef = useRef<number | null>(null);

  const clearDragTimer = () => {
    if (dragTimerRef.current) {
      window.clearTimeout(dragTimerRef.current);
      dragTimerRef.current = null;
    }
  };

  const onHandlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    clearDragTimer();
    dragControls.start(event.nativeEvent);
  };

  const isDraggingOverLayout = child.id === draggingId && dragOverLayoutId;

  return (
    <motion.div
      drag
      dragControls={dragControls}
      dragListener={false}
      dragSnapToOrigin
      whileDrag={{ scale: 1.05, zIndex: 50 }}
      onDrag={(e, info) => onDragMove(info.point.x, info.point.y)}
      onDragEnd={(e, info) => onDragEnded({ x: info.point.x, y: info.point.y })}
      onClick={(e) => { e.stopPropagation(); setSelectedId(child.id); }}
      className="relative group/child rounded-[2rem] cursor-pointer"
      style={{ opacity: isDraggingOverLayout ? 0 : 1 }}
    >
      {/* Grip handle — left side on hover */}
      <div className="absolute -left-8 top-1/2 -translate-y-1/2 opacity-0 group-hover/child:opacity-100 transition-opacity z-10">
        <button onPointerDown={onHandlePointerDown} className="p-1 bg-white rounded-xl border border-chocolate/10 text-chocolate/20 cursor-move shadow-sm">
          <GripVertical size={16} />
        </button>
      </div>

      {/* Element preview */}
      <div className="pointer-events-none">
        <ElementPreview el={child} globalStyles={globalStyles} cardId={cardId} editorVisitorMode="display" />
      </div>

      {/* Action menu — top-right */}
      <div className="absolute -right-2 -top-2 z-20 opacity-0 group-hover/child:opacity-100 transition-opacity">
        <LayoutChildMenu
          child={child}
          onMoveOut={onMoveOut}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      </div>
    </motion.div>
  );
}



function ImageUploadControl({ currentUrl, onUploadComplete }: { currentUrl?: string, onUploadComplete: (url: string) => void }) {
  const { showToast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  const processFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast('請上傳圖片檔案 (JPG, PNG, GIF, WebP)', 'warning');
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
      if (currentUrl) void deleteR2Image(currentUrl);
      onUploadComplete(uploadedUrl);
    } catch (error) {
      console.error(error);
      showToast('上傳失敗，請稍後再試', 'error');
    } finally {
      setTimeout(() => {
        setUploading(false);
        setProgress(0);
        setStatusText('');
      }, 250);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await processFile(file);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await processFile(file);
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs font-bold text-chocolate/40">上傳圖片檔案</label>
      <div
        className={cn(
          'relative group overflow-hidden rounded-2xl border border-dashed transition-colors',
          isDragOver
            ? 'border-cat-blue bg-cat-blue/5'
            : 'border-chocolate/10 hover:border-cat-blue/50 bg-cream/30'
        )}
        onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
        onDrop={handleDrop}
      >
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
              <UploadCloud className={cn('transition-colors', isDragOver ? 'text-cat-blue' : 'text-chocolate/20 group-hover:text-cat-blue')} size={24} />
              <div className={cn('text-xs font-bold transition-colors', isDragOver ? 'text-cat-blue' : 'text-chocolate/60')}>
                {isDragOver ? '放開以上傳' : '點擊或拖曳圖片至此處'}
              </div>
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
  const [openPanel, setOpenPanel] = useState<'background' | 'typography' | 'palette' | 'layout' | null>(null);

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

  const togglePanel = (key: 'background' | 'typography' | 'palette' | 'layout') => {
    setOpenPanel((prev) => (prev === key ? null : key));
  };

  return (
    <div className="space-y-2">
      {/* 背景設定 */}
      <div className="rounded-2xl border border-chocolate/10 bg-white/70 overflow-hidden">
        <button type="button" className="w-full px-4 py-3 flex items-center justify-between bg-transparent" onClick={() => togglePanel('background')}>
          <div className="flex items-center gap-2">
            <ImageIcon size={16} className="text-chocolate/50" />
            <span className="text-xs font-black text-chocolate/70">背景設定</span>
          </div>
          <ChevronDown size={14} className={cn('transition-transform text-chocolate/50', openPanel === 'background' && 'rotate-180')} />
        </button>
        <AnimatePresence initial={false}>
          {openPanel === 'background' && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }} className="overflow-hidden border-t border-chocolate/10" style={{ willChange: 'height, opacity' }}>
              <div className="space-y-3 px-3 py-3">
                <CompactImageUploadControl
                  currentUrl={styles.backgroundImageUrl}
                  onUploadComplete={(url) => update('backgroundImageUrl', url)}
                />
                <input
                  value={styles.backgroundImageUrl || ''}
                  onChange={(e) => update('backgroundImageUrl', e.target.value)}
                  className="w-full p-3 bg-white rounded-xl text-xs outline-none focus:ring-2 ring-cat-blue/20"
                  placeholder="背景圖片網址（可留白）"
                />
                <PaletteSelector title="背景色" palette={palette} selected={styles.backgroundColor || '#F5F5DC'} onPick={(color) => update('backgroundColor', color)} />
                <div className="grid grid-cols-2 gap-2">
                  <select value={styles.backgroundRepeat || 'no-repeat'} onChange={(e) => update('backgroundRepeat', e.target.value as any)} className="w-full p-3 bg-white rounded-xl text-xs outline-none">
                    <option value="no-repeat">不重複</option>
                    <option value="repeat">平鋪重複</option>
                  </select>
                  <select value={styles.backgroundSize || 'cover'} onChange={(e) => update('backgroundSize', e.target.value as any)} className="w-full p-3 bg-white rounded-xl text-xs outline-none">
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
      </div>

      {/* 字型與主色 */}
      <div className="rounded-2xl border border-chocolate/10 bg-white/70 overflow-hidden">
        <button type="button" className="w-full px-4 py-3 flex items-center justify-between bg-transparent" onClick={() => togglePanel('typography')}>
          <div className="flex items-center gap-2">
            <Type size={16} className="text-chocolate/50" />
            <span className="text-xs font-black text-chocolate/70">字型與主色</span>
          </div>
          <ChevronDown size={14} className={cn('transition-transform text-chocolate/50', openPanel === 'typography' && 'rotate-180')} />
        </button>
        <AnimatePresence initial={false}>
          {openPanel === 'typography' && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }} className="overflow-hidden border-t border-chocolate/10" style={{ willChange: 'height, opacity' }}>
              <div className="space-y-3 px-3 py-3">
                <select value={styles.fontFamily || 'system'} onChange={(e) => update('fontFamily', e.target.value as any)} className="w-full p-3 bg-white rounded-xl text-xs outline-none">
                  <option value="system">系統字體</option>
                  <option value="noto-sans-tc">黑體 Noto Sans TC</option>
                  <option value="noto-serif-tc">襯線 Noto Serif TC</option>
                  <option value="chiron-goround-tc">圓體 Chiron GoRound TC</option>
                  <option value="lxgw-wenkai-tc">楷體 LXGW WenKai TC</option>
                </select>
                <PaletteSelector title="文字色" palette={palette} selected={styles.textColor || '#3D2B1F'} onPick={(color) => update('textColor', color)} />
                <PaletteSelector title="元件底色" palette={palette} selected={styles.componentBackgroundColor || '#FFFFFF'} onPick={(color) => update('componentBackgroundColor', color)} />
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-bold text-chocolate/40">
                    <span>元件底色透明度</span>
                    <span>{Math.round((styles.componentBackgroundOpacity ?? 1) * 100)}%</span>
                  </div>
                  <input type="range" min={0} max={1} step={0.05} value={styles.componentBackgroundOpacity ?? 1} onChange={(e) => update('componentBackgroundOpacity', parseFloat(e.target.value))} className="w-full h-2 rounded-full accent-cat-blue cursor-pointer" />
                </div>
                <PaletteSelector title="元件邊框色" palette={palette} selected={styles.componentBorderColor || '#3D2B1F'} onPick={(color) => update('componentBorderColor', color)} />
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <div className="text-[11px] font-bold text-chocolate/50">邊框粗細</div>
                    <select value={styles.componentBorderWidth ?? 3} onChange={(e) => update('componentBorderWidth', Number(e.target.value))} className="w-full p-2 bg-white rounded-xl text-xs outline-none">
                      <option value={0}>無邊框</option>
                      <option value={1}>細 (1px)</option>
                      <option value={2}>中 (2px)</option>
                      <option value={3}>粗 (3px)</option>
                      <option value={4}>特粗 (4px)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] font-bold text-chocolate/50">邊框樣式</div>
                    <select value={styles.componentBorderStyle ?? 'solid'} onChange={(e) => update('componentBorderStyle', e.target.value as any)} className="w-full p-2 bg-white rounded-xl text-xs outline-none">
                      <option value="solid">實線</option>
                      <option value="dashed">虛線</option>
                      <option value="dotted">點線</option>
                      <option value="double">雙線</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-bold text-chocolate/50">
                    <span>圓角</span>
                    <span>{styles.componentBorderRadius ?? 32}px</span>
                  </div>
                  <input type="range" min={0} max={64} step={4} value={styles.componentBorderRadius ?? 32} onChange={(e) => update('componentBorderRadius', Number(e.target.value))} className="w-full h-2 rounded-full accent-cat-blue cursor-pointer" />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 主題調色盤 */}
      <div className="rounded-2xl border border-chocolate/10 bg-white/70 overflow-hidden">
        <button type="button" className="w-full px-4 py-3 flex items-center justify-between bg-transparent" onClick={() => togglePanel('palette')}>
          <div className="flex items-center gap-2">
            <Palette size={16} className="text-chocolate/50" />
            <span className="text-xs font-black text-chocolate/70">主題色彩庫</span>
          </div>
          <ChevronDown size={14} className={cn('transition-transform text-chocolate/50', openPanel === 'palette' && 'rotate-180')} />
        </button>
        <AnimatePresence initial={false}>
          {openPanel === 'palette' && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }} className="overflow-hidden border-t border-chocolate/10" style={{ willChange: 'height, opacity' }}>
              <div className="space-y-3 px-3 py-3">
                <div className="grid grid-cols-4 gap-2">
                  {palette.map((color, index) => (
                    <div key={`palette-${index}`} className="space-y-1">
                      <input type="color" value={color} onChange={(e) => updatePalette(index, e.target.value)} className="h-12 w-full cursor-pointer rounded-lg border border-chocolate/10 bg-transparent" />
                      <div className="flex items-center gap-1">
                        <button onClick={() => removePalette(index)} className="p-1 rounded-md text-red-500 hover:bg-red-50 disabled:opacity-30" disabled={palette.length <= 1} title="刪除顏色">
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={addPalette} disabled={palette.length >= 10} className="w-full p-3 rounded-xl text-xs font-bold bg-white border border-chocolate/10 hover:bg-chocolate hover:text-white transition-colors disabled:opacity-40">
                  新增顏色
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 佈局寬度 */}
      <div className="rounded-2xl border border-chocolate/10 bg-white/70 overflow-hidden">
        <button type="button" className="w-full px-4 py-3 flex items-center justify-between bg-transparent" onClick={() => togglePanel('layout')}>
          <div className="flex items-center gap-2">
            <Columns size={16} className="text-chocolate/50" />
            <span className="text-xs font-black text-chocolate/70">佈局寬度</span>
          </div>
          <ChevronDown size={14} className={cn('transition-transform text-chocolate/50', openPanel === 'layout' && 'rotate-180')} />
        </button>
        <AnimatePresence initial={false}>
          {openPanel === 'layout' && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }} className="overflow-hidden border-t border-chocolate/10" style={{ willChange: 'height, opacity' }}>
              <div className="space-y-3 px-3 py-3">
                <div className="text-[11px] font-bold text-chocolate/50">網站寬度</div>
                <div className="grid grid-cols-2 gap-2">
                  {(['narrow', 'wide'] as const).map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => update('layoutWidth', w)}
                      className={cn(
                        'flex flex-col items-center gap-2 py-3 px-2 rounded-xl border text-xs font-bold transition-all',
                        (styles.layoutWidth ?? 'narrow') === w
                          ? 'border-cat-blue bg-cat-blue/10 text-cat-blue'
                          : 'border-chocolate/10 bg-white text-chocolate/60 hover:border-cat-blue/30'
                      )}
                    >
                      <div className={cn(
                        'h-6 border-2 rounded transition-all',
                        (styles.layoutWidth ?? 'narrow') === w ? 'border-cat-blue' : 'border-chocolate/20',
                        w === 'narrow' ? 'w-8' : 'w-14'
                      )} />
                      {w === 'narrow' ? '窄' : '全寬'}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-chocolate/40 leading-relaxed">
                  {(styles.layoutWidth ?? 'narrow') === 'wide'
                    ? '全寬模式：可配合佈局元件設計多欄版面，手機版仍為窄寬。'
                    : '窄模式：適合名片式版面，所有元件集中在窄版面寬度內。'}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
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
                'h-8 w-8 rounded-md border transition-transform hover:scale-105',
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

function CompactImageUploadControl({ currentUrl, onUploadComplete }: { currentUrl?: string; onUploadComplete: (url: string) => void }) {
  const { showToast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const processFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
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
      if (currentUrl) void deleteR2Image(currentUrl);
      onUploadComplete(uploadedUrl);
    } catch (error) {
      console.error(error);
      showToast('背景上傳失敗，請稍後再試', 'error');
    } finally {
      setTimeout(() => { setUploading(false); setProgress(0); }, 250);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await processFile(file);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await processFile(file);
  };

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-dashed transition-colors cursor-pointer',
        isDragOver ? 'border-cat-blue bg-cat-blue/5' : 'border-chocolate/15 bg-white/80 hover:border-cat-blue/60'
      )}
      onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
      onDrop={handleDrop}
      onClick={() => document.getElementById('compact-upload-input')?.click()}
    >
      <input id="compact-upload-input" type="file" accept="image/*" onChange={handleFileChange} className="hidden" disabled={uploading} />
      <div className="py-4 px-3 text-center">
        {uploading ? (
          <div className="text-xs font-bold text-cat-blue">上傳中 {progress}%</div>
        ) : (
          <div className={cn('text-xs font-bold transition-colors', isDragOver ? 'text-cat-blue' : 'text-chocolate/60')}>
            {isDragOver ? '放開以上傳' : '點擊或拖曳背景圖片'}
          </div>
        )}
      </div>
      {uploading && <div className="absolute left-0 bottom-0 h-1 bg-cat-blue" style={{ width: `${progress}%` }} />}
    </div>
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
    <div style={style} className="w-full rounded-[2rem] border p-5 text-center font-bold">
      <div className="text-sm opacity-70 mb-3">{title || '活動倒數'}</div>
      <div className="flex items-baseline justify-center">
        {[{ v: days, u: '天' }, { v: hours, u: '時' }, { v: mins, u: '分' }, { v: secs, u: '秒' }].map((t, i) => (
          <React.Fragment key={i}>
            <span className="text-xl tabular-nums">{t.v}</span>
            <span className="text-sm opacity-70 ml-1 mr-3 last:mr-0">{t.u}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function InspectorControls({ el, onUpdate, cardData, globalStyles }: { el: CardElement, onUpdate: (u: any) => void, cardData?: CardData, globalStyles?: GlobalDesignStyles }) {
  const { type, content } = el;
  const palette = (globalStyles?.palette && globalStyles.palette.length > 0 ? globalStyles.palette : DEFAULT_PALETTE).slice(0, 10);

  const updateStyle = (patch: Partial<ElementVisualStyle>) => {
    onUpdate({ style: { ...(el.style || {}), ...patch } });
  };

  const handleChange = (keyOrUpdates: string | object, value?: any) => {
    if (typeof keyOrUpdates === 'string') {
      onUpdate({ content: { ...content, [keyOrUpdates]: value } });
    } else {
      onUpdate({ content: { ...content, ...keyOrUpdates } });
    }
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
        <details className="rounded-xl border border-chocolate/10 bg-white/60 p-3">
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
        <ElementStyleControls style={el.style || {}} palette={palette} globalStyles={globalStyles} onUpdate={updateStyle} />
      </div>
    );
  }

  if (type === 'button') {
    return (
      <div className="space-y-4">
        <label className="block text-xs font-bold text-chocolate/40">按鈕圖示</label>
        <EmojiPickerControl value={content.emoji || '🔗'} onChange={(emoji) => handleChange('emoji', emoji)} />
        <label className="block text-xs font-bold text-chocolate/40">按鈕文字</label>
        <input
          value={content.label}
          onChange={(e) => handleChange('label', e.target.value)}
          className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20"
        />
        <label className="block text-xs font-bold text-chocolate/40">連結</label>
        <input
          value={content.url}
          onChange={(e) => handleChange('url', e.target.value)}
          className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20"
          placeholder="輸入區段錨點或網址"
        />
        <ElementStyleControls style={el.style || {}} palette={palette} globalStyles={globalStyles} onUpdate={updateStyle} />
      </div>
    );
  }

  if (type === 'image') {
    return (
      <div className="space-y-4">
        <label className="block text-xs font-bold text-chocolate/40">圖片設定</label>
        <ImageUploadControl
          currentUrl={content.url}
          onUploadComplete={(url) => handleChange('url', url)}
        />
        <label className="block text-xs font-bold text-chocolate/40">圖片網址</label>
        <input
          value={content.url || ''}
          onChange={(e) => handleChange('url', e.target.value)}
          className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20"
        />
        <label className="block text-xs font-bold text-chocolate/40">圖片說明（可留白）</label>
        <input
          value={content.caption || ''}
          onChange={(e) => handleChange('caption', e.target.value)}
          className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20"
        />
        <label className="block text-xs font-bold text-chocolate/40">圖片連結</label>
        <input
          value={content.link || ''}
          onChange={(e) => handleChange('link', e.target.value)}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            if (raw) handleChange('link', normalizeLinkTarget(raw));
          }}
          className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20"
          placeholder="輸入區段錨點或網址"
        />
        <ElementStyleControls style={el.style || {}} palette={palette} globalStyles={globalStyles} onUpdate={updateStyle} />
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
        <div className="p-4 bg-chocolate/5 rounded-xl border border-chocolate/10">
          <p className="text-xs font-bold text-chocolate mb-2">支援方式</p>
          <ul className="text-xs text-chocolate/60 space-y-2 list-disc pl-4">
            <li><strong>YouTube / Spotify:</strong> 直接貼上影音連結，系統會自動轉成播放器。</li>
            <li><strong>其他平台:</strong> 可貼上 iframe 嵌入代碼。</li>
          </ul>
        </div>
        <ElementStyleControls style={el.style || {}} palette={palette} globalStyles={globalStyles} onUpdate={updateStyle} />
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
        <ElementStyleControls style={el.style || {}} palette={palette} globalStyles={globalStyles} onUpdate={updateStyle} />
      </div>
    );
  }

  if (type === 'gallery') {
    return <GalleryInspector content={content} handleChange={handleChange} style={el.style || {}} palette={palette} globalStyles={globalStyles} onUpdateStyle={updateStyle} />;
  }

  if (type === 'countdown') {
    return (
      <div className="space-y-4">
        <label className="block text-xs font-bold text-chocolate/40">倒數標題</label>
        <input value={content.title || ''} onChange={(e) => handleChange('title', e.target.value)} className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20" />
        <label className="block text-xs font-bold text-chocolate/40">目標時間</label>
        <input type="datetime-local" value={toLocalDatetimeInputValue(content.targetAt)} onChange={(e) => handleChange('targetAt', fromLocalDatetimeInputValue(e.target.value))} className="w-full p-4 bg-cream border-none rounded-xl text-sm outline-none focus:ring-2 ring-cat-blue/20" />
        <ElementStyleControls style={el.style || {}} palette={palette} globalStyles={globalStyles} onUpdate={updateStyle} />
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
        <ElementStyleControls style={el.style || {}} palette={palette} globalStyles={globalStyles} onUpdate={updateStyle} />
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
        <ElementStyleControls style={el.style || {}} palette={palette} globalStyles={globalStyles} onUpdate={updateStyle} />
      </div>
    );
  }

  if (type === 'anon_box') {
    const isReplyEnabled = cardData?.interactions?.responsesEnabled !== false;
    return (
      <div className="space-y-4">
        <div className="p-4 bg-cream rounded-xl flex justify-between items-center text-sm">
          <span className="font-bold text-chocolate/60">留言板狀態</span>
          <span className={cn("font-black px-3 py-1 rounded-full", isReplyEnabled ? "text-cat-blue bg-cat-blue/10" : "text-chocolate/40 bg-chocolate/10")}>
            {isReplyEnabled ? '收件中' : '已關閉'}
          </span>
        </div>
        <p className="text-[10px] text-chocolate/40 italic">（如需更改狀態，請前往「回應管理」面板進行設定）</p>
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
        <ElementStyleControls style={el.style || {}} palette={palette} globalStyles={globalStyles} onUpdate={updateStyle} />
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
    return <DropdownInspector content={content} handleChange={handleChange} style={el.style || {}} palette={palette} globalStyles={globalStyles} onUpdateStyle={updateStyle} />;
  }

  if (type === 'tags') {
    return <TagsInspector content={content} handleChange={handleChange} style={el.style || {}} palette={palette} globalStyles={globalStyles} onUpdateStyle={updateStyle} />;
  }

  if (type === 'layout') {
    return <LayoutInspector content={content} handleChange={handleChange} />;
  }

  return <div className="text-xs text-chocolate/30 py-8 italic text-center">此組件暫無屬性面板。</div>;
}

// ─── 佈局元件設定面板 ─────────────────────────────────────────────────────
function LayoutInspector({ content, handleChange }: { content: any; handleChange: (key: string | object, value?: any) => void }) {
  const cols: number = content.columns ?? 2;
  const widths: number[] = content.columnWidths ?? Array.from({ length: cols }, () => Math.round(100 / cols));
  const children: any[][] = content.children ?? Array.from({ length: cols }, () => []);

  const setColumns = (newCols: number) => {
    const newWidths = Array.from({ length: newCols }, (_, i) => {
      if (i < widths.length) return widths[i];
      return Math.round(100 / newCols);
    });
    const sum = newWidths.reduce((a, b) => a + b, 0);
    const normalized = newWidths.map((w) => Math.round((w / sum) * 100));
    const drift = 100 - normalized.reduce((a, b) => a + b, 0);
    normalized[normalized.length - 1] += drift;
    const newChildren = Array.from({ length: newCols }, (_, i) => children[i] || []);
    handleChange({
      columns: newCols,
      columnWidths: normalized,
      children: newChildren
    });
  };

  const updateWidth = (colIdx: number, newPct: number) => {
    const clamped = Math.max(10, Math.min(100 - (cols - 1) * 10, newPct));
    const diff = widths[colIdx] - clamped;
    const others = widths.map((w, i) => i === colIdx ? clamped : w);
    const otherIndices = Array.from({ length: cols }, (_, i) => i).filter((i) => i !== colIdx);
    const otherSum = otherIndices.reduce((s, i) => s + others[i], 0);
    let remaining = diff;
    const adjusted = [...others];
    for (let k = 0; k < otherIndices.length; k++) {
      const i = otherIndices[k];
      const share = k === otherIndices.length - 1
        ? remaining
        : Math.round((others[i] / otherSum) * diff);
      adjusted[i] = Math.max(10, others[i] + share);
      remaining -= share;
    }
    const total = adjusted.reduce((a, b) => a + b, 0);
    adjusted[colIdx] += 100 - total;
    handleChange('columnWidths', adjusted);
  };

  const removeChild = (colIdx: number, childId: string) => {
    const newChildren = children.map((col, i) =>
      i === colIdx ? col.filter((c: any) => c.id !== childId) : col
    );
    handleChange('children', newChildren);
  };

  return (
    <div className="space-y-5">
      {/* 欄數 */}
      <div className="space-y-2">
        <label className="block text-xs font-bold text-chocolate/40">欄數（2–5）</label>
        <div className="flex gap-2">
          {[2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setColumns(n)}
              className={cn(
                'flex-1 py-2 rounded-lg text-xs font-bold transition-all',
                cols === n ? 'bg-chocolate text-white' : 'bg-cream text-chocolate/40 hover:bg-chocolate/10'
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* 欄寬 */}
      <div className="space-y-2">
        <label className="block text-xs font-bold text-chocolate/40">各欄寬度（%）</label>
        <div className="space-y-2">
          {Array.from({ length: cols }).map((_, i) => (
            <div key={`col-w-${i}`} className="flex items-center p-2 gap-2">
              <span className="text-[11px] font-bold text-chocolate/50 w-8 shrink-0">欄{i + 1}</span>
              <input
                type="range"
                min={10}
                max={100 - (cols - 1) * 10}
                step={1}
                value={widths[i] ?? Math.round(100 / cols)}
                onChange={(e) => updateWidth(i, Number(e.target.value))}
                className="flex-1 h-2 rounded-full accent-cat-blue cursor-pointer"
              />
              <span className="text-[11px] font-bold text-chocolate/60 w-8 text-right">{widths[i] ?? Math.round(100 / cols)}%</span>
            </div>
          ))}
        </div>
        <div className="flex rounded-xl overflow-hidden h-3 gap-px">
          {Array.from({ length: cols }).map((_, i) => (
            <div
              key={`bar-${i}`}
              style={{ flexBasis: `${widths[i] ?? Math.round(100 / cols)}%` }}
              className={cn('transition-all', i % 2 === 0 ? 'bg-cat-blue/60' : 'bg-chocolate/30')}
            />
          ))}
        </div>
      </div>

      <div className="p-3 bg-cream/60 rounded-xl text-[10px] text-chocolate/50 leading-relaxed">
        💡 電腦版顯示多欄佈局，手機版自動切換為縱向排列。
      </div>
    </div>
  );
}


// ─── 通用元件樣式設定控制器 ────────────────────────────────────────────
function ElementStyleControls({
  style,
  palette,
  globalStyles,
  onUpdate,
}: {
  style: ElementVisualStyle;
  palette: string[];
  globalStyles?: GlobalDesignStyles;
  onUpdate: (patch: Partial<ElementVisualStyle>) => void;
}) {
  const useGlobal = style.useGlobalStyle !== false;

  // 切換為自訂樣式時，自動帶入全局色彩作為初始値
  const handleToggleGlobal = () => {
    if (useGlobal) {
      onUpdate({
        useGlobalStyle: false,
        backgroundColor: style.backgroundColor || globalStyles?.componentBackgroundColor || '#FFFFFF',
        backgroundOpacity: style.backgroundOpacity ?? (globalStyles?.componentBackgroundOpacity ?? 1),
        borderColor: style.borderColor || globalStyles?.componentBorderColor || '#3D2B1F',
        borderWidth: style.borderWidth ?? (globalStyles?.componentBorderWidth ?? 3),
        borderStyle: style.borderStyle || (globalStyles?.componentBorderStyle as any) || 'solid',
        radius: style.radius ?? (globalStyles?.componentBorderRadius ?? 32),
      });
    } else {
      onUpdate({ useGlobalStyle: true });
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-chocolate/10 bg-white/70 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-chocolate/10">
        <div className="flex items-center gap-2">
          <Palette size={15} className="text-chocolate/50" />
          <span className="text-xs font-black text-chocolate/70">元件樣式</span>
        </div>
        <button
          type="button"
          onClick={handleToggleGlobal}
          className={cn(
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
            useGlobal ? 'bg-cat-blue' : 'bg-chocolate/20'
          )}
          title={useGlobal ? '目前使用全局樣式，點擊切換為自訂' : '目前使用自訂樣式，點擊切換為全局'}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
              useGlobal ? 'translate-x-6' : 'translate-x-1'
            )}
          />
        </button>
      </div>

      <div className="px-4 py-2 text-[10px] text-chocolate/40 font-bold">
        {useGlobal ? '✓ 跟隨全局設定（底色、邊框皆套用全局主題）' : '✎ 自訂樣式（以下設定僅套用於此元件）'}
      </div>

      <AnimatePresence initial={false}>
        {!useGlobal && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4 border-t border-chocolate/10">
              {/* 底色 */}
              <div className="space-y-2 pt-3">
                <div className="text-[11px] font-bold text-chocolate/50">底色</div>
                <div className="grid grid-cols-6 gap-2">
                  {palette.map((color, i) => (
                    <button
                      key={`bg-${i}`}
                      type="button"
                      onClick={() => onUpdate({ backgroundColor: color })}
                      className={cn(
                        'h-8 w-8 rounded-md border transition-transform hover:scale-105',
                        (style.backgroundColor || '').toLowerCase() === color.toLowerCase()
                          ? 'border-chocolate shadow-md' : 'border-white/70'
                      )}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-bold text-chocolate/40">
                    <span>透明度</span>
                    <span>{Math.round((style.backgroundOpacity ?? 1) * 100)}%</span>
                  </div>
                  <input
                    type="range" min={0} max={1} step={0.05}
                    value={style.backgroundOpacity ?? 1}
                    onChange={(e) => onUpdate({ backgroundOpacity: parseFloat(e.target.value) })}
                    className="w-full h-2 rounded-full accent-cat-blue cursor-pointer"
                  />
                </div>
              </div>

              {/* 邊框顏色 */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-chocolate/50">邊框顏色</div>
                <div className="grid grid-cols-6 gap-2">
                  {palette.map((color, i) => (
                    <button
                      key={`bd-${i}`}
                      type="button"
                      onClick={() => onUpdate({ borderColor: color })}
                      className={cn(
                        'h-8 w-8 rounded-md border transition-transform hover:scale-105',
                        (style.borderColor || '').toLowerCase() === color.toLowerCase()
                          ? 'border-chocolate shadow-md' : 'border-white/70'
                      )}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>

              {/* 邊框粗細 & 樣式 */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="text-[11px] font-bold text-chocolate/50">邊框粗細</div>
                  <select
                    value={style.borderWidth ?? 3}
                    onChange={(e) => onUpdate({ borderWidth: Number(e.target.value) })}
                    className="w-full p-2 bg-cream rounded-xl text-xs outline-none"
                  >
                    <option value={0}>無邊框</option>
                    <option value={1}>細 (1px)</option>
                    <option value={2}>中 (2px)</option>
                    <option value={3}>粗 (3px)</option>
                    <option value={4}>特粗 (4px)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-bold text-chocolate/50">邊框樣式</div>
                  <select
                    value={style.borderStyle ?? 'solid'}
                    onChange={(e) => onUpdate({ borderStyle: e.target.value as any })}
                    className="w-full p-2 bg-cream rounded-xl text-xs outline-none"
                  >
                    <option value="solid">實線</option>
                    <option value="dashed">虛線</option>
                    <option value="dotted">點線</option>
                    <option value="double">雙線</option>
                  </select>
                </div>
              </div>

              {/* 圓角 */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-bold text-chocolate/50">
                  <span>圓角</span>
                  <span>{style.radius ?? 32}px</span>
                </div>
                <input
                  type="range" min={0} max={64} step={4}
                  value={style.radius ?? 32}
                  onChange={(e) => onUpdate({ radius: Number(e.target.value) })}
                  className="w-full h-2 rounded-full accent-cat-blue cursor-pointer"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Draggable wrapper components ──────────────────────────────────────────────
// These must be separate components so that useDragControls() is called at the
// top level of a React function, not inside a .map() callback.

function DraggableDropdownItem({ item, index, items, updateItems, getKey }: {
  item: { label: string; url: string };
  index: number;
  items: { label: string; url: string }[];
  updateItems: (next: { label: string; url: string }[]) => void;
  getKey: (item: { label: string; url: string }) => string;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={item} dragListener={false} dragControls={controls} className="flex items-center gap-2" as="div">
      <div onPointerDown={(e) => controls.start(e)} className="w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-xl bg-white border border-chocolate/10 text-chocolate/40 cursor-move touch-none">
        <GripVertical size={16} />
      </div>
      <input
        value={item.label}
        onChange={(e) => updateItems(items.map((it, i) => i === index ? { ...it, label: e.target.value } : it))}
        className="min-w-0 flex-1 p-3 bg-cream rounded-xl text-xs outline-none"
        placeholder="文字"
      />
      <input
        value={item.url}
        onChange={(e) => updateItems(items.map((it, i) => i === index ? { ...it, url: e.target.value } : it))}
        className="min-w-0 flex-1 p-3 bg-cream rounded-xl text-xs outline-none"
        placeholder="連結"
      />
      <button onClick={() => updateItems(items.filter((_, i) => i !== index))} className="w-9 h-9 shrink-0 inline-flex items-center justify-center bg-red-50 text-red-500 rounded-xl text-xs font-bold">
        <Trash2 size={15} />
      </button>
    </Reorder.Item>
  );
}

function DraggableTagItem({ item, index, items, updateItems, getKey }: {
  item: { text: string; icon?: string };
  index: number;
  items: { text: string; icon?: string }[];
  updateItems: (next: { text: string; icon?: string }[]) => void;
  getKey: (item: { text: string; icon?: string }) => string;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={item} dragListener={false} dragControls={controls} className="flex items-center gap-2" as="div">
      <div onPointerDown={(e) => controls.start(e)} className="w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-xl bg-white border border-chocolate/10 text-chocolate/40 cursor-move touch-none">
        <GripVertical size={16} />
      </div>
      <EmojiPickerControl value={item.icon || '✨'} onChange={(emoji) => updateItems(items.map((it, i) => i === index ? { ...it, icon: emoji } : it))} />
      <input
        value={item.text}
        onChange={(e) => updateItems(items.map((it, i) => i === index ? { ...it, text: e.target.value } : it))}
        className="min-w-0 flex-1 p-3 bg-cream rounded-xl text-xs outline-none"
        placeholder="標籤文字"
      />
      <button onClick={() => updateItems(items.filter((_, i) => i !== index))} className="w-10 h-10 shrink-0 inline-flex items-center justify-center bg-red-50 text-red-500 rounded-xl text-xs font-bold">
        <Trash2 size={17} />
      </button>
    </Reorder.Item>
  );
}

type DropdownItem = { label: string; url: string };
function DropdownInspector({ content, handleChange, style, palette, globalStyles, onUpdateStyle }: { content: any; handleChange: (key: string, value: any) => void; style: ElementVisualStyle; palette: string[]; globalStyles?: GlobalDesignStyles; onUpdateStyle: (patch: Partial<ElementVisualStyle>) => void }) {
  const items: DropdownItem[] = content.items || [];
  const counterRef = useRef(0);
  const getKey = (item: any): string => {
    if (!item._key) item._key = `dd_${++counterRef.current}`;
    return item._key;
  };
  const updateItems = (next: DropdownItem[]) => handleChange('items', next);
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
        {items.map((item, index) => (
          <DraggableDropdownItem key={getKey(item)} item={item} index={index} items={items} updateItems={updateItems} getKey={getKey} />
        ))}
      </Reorder.Group>
      <button
        onClick={() => updateItems([...items, { label: `項目 ${items.length + 1}`, url: '#' }])}
        className="w-full p-3 rounded-xl text-xs font-bold bg-white border border-chocolate/10 hover:bg-chocolate hover:text-white transition-colors"
      >
        新增選項
      </button>
      <ElementStyleControls style={style} palette={palette} globalStyles={globalStyles} onUpdate={onUpdateStyle} />
    </div>
  );
}

type TagItem = { text: string; icon?: string };
function TagsInspector({ content, handleChange, style, palette, globalStyles, onUpdateStyle }: { content: any; handleChange: (key: string, value: any) => void; style: ElementVisualStyle; palette: string[]; globalStyles?: GlobalDesignStyles; onUpdateStyle: (patch: Partial<ElementVisualStyle>) => void }) {
  const items: TagItem[] = content.items || [];
  const counterRef = useRef(0);
  const getKey = (item: any): string => {
    if (!item._key) item._key = `tag_${++counterRef.current}`;
    return item._key;
  };
  const updateItems = (next: TagItem[]) => handleChange('items', next);
  return (
    <div className="space-y-4">
      <label className="block text-xs font-bold text-chocolate/40">標籤列表</label>
      <Reorder.Group axis="y" values={items} onReorder={updateItems} className="space-y-2">
        {items.map((item, index) => (
          <DraggableTagItem key={getKey(item)} item={item} index={index} items={items} updateItems={updateItems} getKey={getKey} />
        ))}
      </Reorder.Group>
      <button
        onClick={() => updateItems([...items, { text: `標籤 ${items.length + 1}`, icon: '✨' }])}
        className="w-full p-3 rounded-xl text-xs font-bold bg-white border border-chocolate/10 hover:bg-chocolate hover:text-white transition-colors"
      >
        新增標籤
      </button>
      <ElementStyleControls style={style} palette={palette} globalStyles={globalStyles} onUpdate={onUpdateStyle} />
    </div>
  );
}

function SortableElementItem({
  el,
  selectedId,
  setSelectedId,
  isTouchDevice,
  dragTimerRef,
  children,
  onDragMove,
  onDragEnded,
  isDraggingOverLayout,
  isChild,
}: {
  el: CardElement;
  selectedId: string | null;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  isTouchDevice: boolean;
  dragTimerRef: React.MutableRefObject<number | null>;
  children: React.ReactNode;
  onDragMove?: (clientX: number, clientY: number) => void;
  onDragEnded?: (point: { x: number, y: number }) => void;
  isDraggingOverLayout?: boolean;
  isChild?: boolean;
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
    dragControls.start(nativeEvent);
  };

  const onDragPointerDown = (_event: React.PointerEvent<HTMLElement>) => {
    // On mobile, drag only starts from the grip handle (touch-action: none).
  };

  const handleDrag = (event: MouseEvent | TouchEvent | PointerEvent) => {
    const clientY = 'touches' in event ? event.touches[0].clientY : (event as MouseEvent).clientY;
    const clientX = 'touches' in event ? event.touches[0].clientX : (event as MouseEvent).clientX;
    const threshold = 100;
    if (clientY < threshold) {
      window.scrollBy({ top: -15, behavior: 'auto' });
    } else if (clientY > window.innerHeight - threshold) {
      window.scrollBy({ top: 15, behavior: 'auto' });
    }
    onDragMove?.(clientX, clientY);
  };

  const handleDragEnd = (e: any, info: any) => {
    onDragEnded?.({ x: info.point.x, y: info.point.y });
  };

  return (
    <Reorder.Item
      key={el.id}
      value={el}
      dragControls={dragControls}
      dragListener={false}
      whileDrag={{ zIndex: 40, opacity: isDraggingOverLayout ? 0 : 1, overflow: 'visible' }}
      onDragStart={() => { /* inspector stays unchanged during drag */ }}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      onClick={(e) => {
        e.stopPropagation();
        // 如果是佈局元件，主體不給點選（避免跟內部的子元件衝突），必須點把手
        if (el.type !== 'layout') {
          setSelectedId(el.id);
        }
      }}
      onPointerDown={onDragPointerDown}
      onPointerUp={clearDragTimer}
      onPointerCancel={clearDragTimer}
      onPointerLeave={clearDragTimer}
      className={cn(
        'relative cursor-pointer group rounded-[2.2rem]',
      )}
      style={{ touchAction: 'pan-y', userSelect: 'none', WebkitUserSelect: 'none', willChange: 'transform', opacity: isDraggingOverLayout ? 0 : 1, overflow: 'visible' } as React.CSSProperties}
    >
      {/* Desktop grip — shown on hover to the left of the card */}
      <button
        type="button"
        onPointerDown={(e) => {
          onHandlePointerDown(e);
          setSelectedId(el.id); // 點擊把手時強制選中
        }}
        onPointerUp={clearDragTimer}
        onPointerCancel={clearDragTimer}
        onPointerLeave={clearDragTimer}
        className={cn(
          "absolute p-1 bg-white rounded-xl border shadow-lg cursor-move opacity-0 group-hover:opacity-100 xl:opacity-100 xl:flex hidden flex-col items-center gap-2 z-15",
          el.type === 'layout' ? "-top-2 -translate-y-0" : "top-1/2 -translate-y-1/2",
          isChild ? "-left-2" : "-left-12",
          selectedId === el.id ? 'border-cat-blue bg-cat-blue text-white' : 'border-chocolate/10 text-chocolate/20 hover:text-chocolate/50'
        )}
        style={{ touchAction: 'none' }}
        title="拖曳排序"
      >
        <GripVertical size={20} />
      </button>

      {/* Mobile grip — always visible, inside the card on the right */}
      {isTouchDevice && (
        <button
          type="button"
          onPointerDown={(e) => {
            onHandlePointerDown(e);
            setSelectedId(el.id); // 點擊把手時強制選中
          }}
          onPointerUp={clearDragTimer}
          onPointerCancel={clearDragTimer}
          onPointerLeave={clearDragTimer}
          className={cn(
            "absolute p-1 bg-white rounded-xl border shadow-lg cursor-move z-15",
            el.type === 'layout' ? "-top-2 -translate-y-0" : "top-1/2 -translate-y-1/2",
            isChild ? "-left-2" : "-left-2",
            selectedId === el.id ? 'border-cat-blue bg-cat-blue text-white' : 'border-chocolate/10 text-chocolate/30'
          )}
          style={{ touchAction: 'none' }}
          title="長按拖曳排序"
        >
          <GripVertical size={16} />
        </button>
      )}

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

function GalleryImageUpload({ currentUrl, onUploadComplete }: { currentUrl?: string; onUploadComplete: (url: string) => void }) {
  const { showToast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const processFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast('請上傳圖片檔案 (JPG, PNG, GIF, WebP)', 'warning');
      return;
    }
    setUploading(true);
    setProgress(5);
    try {
      const compressed = await compressImageForWeb(file);
      const safeBaseName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'image';
      const uploadedUrl = await uploadImageToR2({
        blob: compressed.blob,
        fileName: safeBaseName,
        contentType: compressed.mimeType,
        onProgress: (p) => setProgress(Math.min(99, Math.max(5, p))),
      });
      setProgress(100);
      if (currentUrl) void deleteR2Image(currentUrl);
      onUploadComplete(uploadedUrl);
    } catch (error) {
      console.error(error);
      showToast('上傳失敗，請稍後再試', 'error');
    } finally {
      setTimeout(() => { setUploading(false); setProgress(0); }, 250);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await processFile(file);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await processFile(file);
  };

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-dashed transition-colors cursor-pointer',
        isDragOver ? 'border-cat-blue bg-cat-blue/5' : 'border-chocolate/15 bg-white/80 hover:border-cat-blue/60'
      )}
      onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
      onDrop={handleDrop}
      onClick={() => document.getElementById('gallery-upload-input')?.click()}
    >
      <input id="gallery-upload-input" type="file" accept="image/*" onChange={handleFileChange} className="hidden" disabled={uploading} />
      <div className="py-3 px-3 text-center">
        {uploading ? (
          <div className="text-xs font-bold text-cat-blue">上傳中 {progress}%</div>
        ) : (
          <div className={cn('text-xs font-bold transition-colors', isDragOver ? 'text-cat-blue' : 'text-chocolate/60')}>
            {isDragOver ? '放開以上傳' : '點擊或拖曳圖庫圖片'}
          </div>
        )}
      </div>
      {uploading && <div className="absolute left-0 bottom-0 h-1 bg-cat-blue" style={{ width: `${progress}%` }} />}
    </div>
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

function DraggableGalleryItem({
  img, index, imgKey, isOpen, images, updateImages, setExpandedKey
}: {
  img: any; index: number; imgKey: string; isOpen: boolean;
  images: any[]; updateImages: (next: any[]) => void;
  setExpandedKey: (key: string | null) => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={img} dragListener={false} dragControls={controls} className="rounded-2xl border border-chocolate/10 bg-white/70 overflow-hidden" as="div">
      <div className="flex items-center">
        <div onPointerDown={(e) => controls.start(e)} className="w-10 h-10 shrink-0 inline-flex items-center justify-center text-chocolate/40 cursor-move touch-none border-r border-chocolate/10">
          <GripVertical size={16} />
        </div>
        <button type="button" onClick={() => setExpandedKey(isOpen ? null : imgKey)} className="w-full px-3 py-3 flex items-center justify-between gap-3 bg-transparent text-left">
          <div className="text-xs font-black text-chocolate/70 truncate">{img.caption || `圖片 ${index + 1}`}</div>
          <ChevronDown size={14} className={cn('transition-transform text-chocolate/50 shrink-0', isOpen && 'rotate-180')} />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="border-t border-chocolate/10">
              <div className="relative aspect-square w-full">
                {img.url ? (
                  <img src={img.url} alt={img.caption || `圖片 ${index + 1}`} className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-chocolate/35">尚未設定圖片</div>
                )}
              </div>
              <div className="p-3 space-y-2">
                <GalleryImageUpload currentUrl={img.url} onUploadComplete={(url) => updateImages(images.map((it, i) => i === index ? { ...it, url } : it))} />
                <label className="block text-xs font-bold text-chocolate/40">圖片網址</label>
                <input value={img.url || ''} onChange={(e) => updateImages(images.map((it, i) => i === index ? { ...it, url: e.target.value } : it))} className="w-full p-3 bg-cream rounded-xl text-xs outline-none" />
                <label className="block text-xs font-bold text-chocolate/40">圖片說明（可留白）</label>
                <input value={img.caption || ''} onChange={(e) => updateImages(images.map((it, i) => i === index ? { ...it, caption: e.target.value } : it))} className="w-full p-3 bg-cream rounded-xl text-xs outline-none" />
                <label className="block text-xs font-bold text-chocolate/40">圖片連結</label>
                <input value={img.link || ''} onChange={(e) => updateImages(images.map((it, i) => i === index ? { ...it, link: e.target.value } : it))} onBlur={(e) => { const raw = e.target.value.trim(); if (!raw) return; updateImages(images.map((it, i) => i === index ? { ...it, link: normalizeLinkTarget(raw) } : it)); }} className="w-full p-3 bg-cream rounded-xl text-xs outline-none" placeholder="輸入區段錨點或網址" />
                <button type="button" title="刪除此圖" onClick={() => { updateImages(images.filter((_: any, i: number) => i !== index)); setExpandedKey(null); }} className="w-full h-10 inline-flex items-center justify-center gap-2 bg-red-50 text-red-500 rounded-xl text-xs font-black">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  );
}

function GalleryInspector({ content, handleChange, style, palette, globalStyles, onUpdateStyle }: { content: any; handleChange: (key: string, value: any) => void; style: ElementVisualStyle; palette: string[]; globalStyles?: GlobalDesignStyles; onUpdateStyle: (patch: Partial<ElementVisualStyle>) => void }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const images: any[] = Array.isArray(content.images) ? content.images : [];
  const counterRef = useRef(0);
  const getKey = (img: any): string => {
    if (!img._key) img._key = `gi_${++counterRef.current}`;
    return img._key;
  };
  const updateImages = (next: any[]) => handleChange('images', next);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-chocolate/10 bg-white/70 overflow-hidden">
        <button
          type="button"
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="w-full px-4 py-3 flex items-center justify-between bg-transparent"
        >
          <div className="flex items-center gap-2">
            <Palette size={16} className="text-chocolate/50" />
            <span className="text-xs font-black text-chocolate/70">圖庫顯示設定</span>
          </div>
          <ChevronDown size={14} className={cn('transition-transform text-chocolate/50', settingsOpen && 'rotate-180')} />
        </button>
        <AnimatePresence initial={false}>
          {settingsOpen && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden" style={{ willChange: 'height' }}>
              <div className="px-4 pb-4 space-y-3 border-t border-chocolate/10">
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <label className="block text-xs font-bold text-chocolate/40">圖片清單</label>
      <Reorder.Group axis="y" values={images} onReorder={updateImages} className="space-y-2">
        {images.map((img, index) => {
          const imgKey = getKey(img);
          const isOpen = expandedKey === imgKey;
          return (
            <DraggableGalleryItem
              key={imgKey}
              img={img}
              index={index}
              imgKey={imgKey}
              isOpen={isOpen}
              images={images}
              updateImages={updateImages}
              setExpandedKey={setExpandedKey}
            />
          );
        })}
      </Reorder.Group>
      <button onClick={() => updateImages([...images, { url: '', caption: '', link: '' }])} className="w-full p-3 rounded-xl text-xs font-bold bg-white border border-chocolate/10 hover:bg-chocolate hover:text-white transition-colors">
        新增圖片
      </button>
      <ElementStyleControls style={style} palette={palette} globalStyles={globalStyles} onUpdate={onUpdateStyle} />
    </div>
  );
}


function ElementActionsMenu({ el, onEdit, onDuplicate, onDelete }: { el: CardElement; onEdit: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
    setOpen((v) => !v);
  };

  // Close menu on scroll (portal menu is fixed-position, doesn't follow scroll)
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', close, { capture: true });
  }, [open]);

  const handleCopyId = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(el.id);
      showToast('已複製元件 ID', 'success');
    } catch {
      showToast('ID: ' + el.id, 'info');
    }
    setOpen(false);
  };

  const menu = open && menuPos ? createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -8 }}
          style={{
            position: 'fixed',
            top: menuPos.top,
            right: menuPos.right,
            zIndex: 9999,
            willChange: 'transform, opacity',
          }}
          className="w-44 bg-white rounded-2xl border border-chocolate/10 shadow-lg overflow-hidden py-2"
        >
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); setOpen(false); }}
            className="w-full px-4 py-3 text-sm font-bold text-chocolate hover:bg-cream flex items-center gap-3 transition-colors text-left"
          >
            <Settings size={16} /> 屬性設定
          </button>
          <div className="h-px bg-chocolate/5 my-1" />
          <button
            onClick={(e) => { e.stopPropagation(); onDuplicate(); setOpen(false); }}
            className="w-full px-4 py-3 text-sm font-bold text-chocolate hover:bg-cream flex items-center gap-3 transition-colors text-left"
          >
            <Plus size={16} /> 複製元件
          </button>
          <button
            onClick={handleCopyId}
            className="w-full px-4 py-3 text-sm font-bold text-chocolate hover:bg-cream flex items-center gap-3 transition-colors text-left"
          >
            <Hash size={16} /> 複製 ID
          </button>
          <div className="h-px bg-chocolate/5 my-1" />
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); setOpen(false); }}
            className="w-full px-4 py-3 text-sm font-bold text-red-500 hover:bg-red-50 flex items-center gap-3 transition-colors text-left"
          >
            <Trash2 size={16} /> 刪除元件
          </button>
        </motion.div>
      </AnimatePresence>
    </>,
    document.body
  ) : null;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="p-3 bg-white border border-chocolate/10 text-chocolate hover:bg-cat-blue hover:border-cat-blue hover:text-white rounded-full transition-all hover:scale-110 active:scale-95 shadow-sm"
        title="元件操作"
      >
        <Plus size={16} className={cn("transition-transform", open && "rotate-45")} />
      </button>
      {menu}
    </div>
  );
}
