import React, { createContext, useCallback, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_CONFIG = {
  success: { Icon: CheckCircle, bg: 'bg-emerald-500', text: 'text-white' },
  error:   { Icon: AlertCircle, bg: 'bg-red-500',     text: 'text-white' },
  warning: { Icon: AlertTriangle, bg: 'bg-amber-400', text: 'text-chocolate' },
  info:    { Icon: Info,          bg: 'bg-cat-blue',  text: 'text-white' },
} as const;

const DURATION_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, DURATION_MS);
  }, []);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {createPortal(
        <div
          aria-live="polite"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[99999] flex flex-col gap-2 pointer-events-none items-center"
          style={{ maxWidth: 380, width: 'max-content' }}
        >
          <AnimatePresence initial={false}>
            {toasts.map((toast) => {
              const { Icon, bg, text } = TOAST_CONFIG[toast.type];
              return (
                <motion.div
                  key={toast.id}
                  initial={{ opacity: 0, y: -16, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9, y: -8 }}
                  transition={{ type: 'spring', damping: 22, stiffness: 300 }}
                  className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-2xl shadow-xl ${bg} ${text}`}
                  style={{ willChange: 'transform, opacity' }}
                >
                  <Icon size={18} className="shrink-0 mt-0.5" />
                  <span className="text-sm font-semibold flex-1 leading-snug">{toast.message}</span>
                  <button
                    onClick={() => dismiss(toast.id)}
                    className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
                  >
                    <X size={15} />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
