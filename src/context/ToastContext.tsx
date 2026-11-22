/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  ReactNode,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, AlertTriangle, Info, AlertCircle, X } from 'lucide-react';
import { ROOMWISE_EASE } from '../utils/motion';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  persistent?: boolean;
}

interface ToastContextValue {
  pushToast: (toast: Omit<ToastItem, 'id'>) => string;
  dismissToast: (id: string) => void;
  success: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const MAX_VISIBLE_TOASTS = 3;

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Record<string, number>>({});

  const dismissToast = useCallback((id: string) => {
    if (timersRef.current[id]) {
      window.clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (input: Omit<ToastItem, 'id'>): string => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const isPersistent = input.persistent ?? input.tone === 'error';

      setToasts((prev) => {
        const next = [...prev, { ...input, id, persistent: isPersistent }];
        if (next.length > MAX_VISIBLE_TOASTS) {
          const evicted = next.slice(0, next.length - MAX_VISIBLE_TOASTS);
          evicted.forEach((e) => {
            if (timersRef.current[e.id]) {
              window.clearTimeout(timersRef.current[e.id]);
              delete timersRef.current[e.id];
            }
          });
          return next.slice(next.length - MAX_VISIBLE_TOASTS);
        }
        return next;
      });

      if (!isPersistent) {
        const duration = input.tone === 'warning' ? 4800 : 3600;
        timersRef.current[id] = window.setTimeout(() => {
          dismissToast(id);
        }, duration);
      }

      return id;
    },
    [dismissToast]
  );

  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach((t) => window.clearTimeout(t));
      timersRef.current = {};
    };
  }, []);

  const success = useCallback(
    (title: string, description?: string) => pushToast({ tone: 'success', title, description }),
    [pushToast]
  );
  const info = useCallback(
    (title: string, description?: string) => pushToast({ tone: 'info', title, description }),
    [pushToast]
  );
  const warning = useCallback(
    (title: string, description?: string) => pushToast({ tone: 'warning', title, description }),
    [pushToast]
  );
  const error = useCallback(
    (title: string, description?: string) =>
      pushToast({ tone: 'error', title, description, persistent: true }),
    [pushToast]
  );

  return (
    <ToastContext.Provider value={{ pushToast, dismissToast, success, info, warning, error }}>
      {children}

      {/* Global Toast Viewport */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-4 right-4 left-4 sm:left-auto z-[90] flex flex-col gap-2 sm:w-[360px] pointer-events-none print:hidden"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {toasts.map((t) => {
            const Icon =
              t.tone === 'success'
                ? CheckCircle2
                : t.tone === 'warning'
                ? AlertTriangle
                : t.tone === 'error'
                ? AlertCircle
                : Info;

            const iconToneClass =
              t.tone === 'success'
                ? 'text-emerald-600 bg-emerald-50 border-emerald-200/80'
                : t.tone === 'warning'
                ? 'text-amber-600 bg-amber-50 border-amber-200/80'
                : t.tone === 'error'
                ? 'text-rose-600 bg-rose-50 border-rose-200/80'
                : 'text-neutral-700 bg-neutral-100 border-neutral-200';

            const borderClass =
              t.tone === 'error'
                ? 'border-rose-200'
                : t.tone === 'warning'
                ? 'border-amber-200/90'
                : 'border-neutral-200/90';

            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.2, ease: ROOMWISE_EASE }}
                role={t.tone === 'error' ? 'alert' : 'status'}
                className={`pointer-events-auto bg-white/95 backdrop-blur-md border ${borderClass} rounded-xl shadow-[0_12px_32px_-8px_rgba(15,23,42,0.14)] p-3 flex items-start gap-3`}
              >
                <div
                  className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${iconToneClass}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-neutral-900 leading-snug">
                    {t.title}
                  </div>
                  {t.description && (
                    <div className="text-[11px] text-neutral-500 mt-0.5 leading-relaxed">
                      {t.description}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => dismissToast(t.id)}
                  className="p-1 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors cursor-pointer shrink-0"
                  aria-label="Dismiss notification"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
};
