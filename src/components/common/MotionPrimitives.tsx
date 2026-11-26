/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ROOMWISE_EASE, SPRING_SWITCH } from '../../utils/motion';

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  durationMs?: number;
}

/**
 * Smoothly interpolates genuine numeric state updates with tabular figures.
 * Renders the initial value immediately on mount (zero artificial count-up delay)
 * and only animates subsequent real changes.
 */
export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  className = '',
  durationMs = 320,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [displayValue, setDisplayValue] = useState<number>(value);
  const currentRef = useRef<number>(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion || !Number.isFinite(value)) {
      currentRef.current = value;
      setDisplayValue(value);
      return;
    }

    const from = currentRef.current;
    const to = value;
    if (Math.abs(to - from) < 1e-6) {
      return;
    }

    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const interpolated = from + (to - from) * eased;

      currentRef.current = interpolated;
      setDisplayValue(interpolated);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        currentRef.current = to;
        setDisplayValue(to);
        rafRef.current = null;
      }
    };

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [value, durationMs, prefersReducedMotion]);

  const formatted = Number.isFinite(displayValue)
    ? displayValue.toFixed(decimals)
    : '0';

  return (
    <span className={`tabular-nums ${className}`}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
};

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
  size?: 'sm' | 'md';
  accent?: 'emerald' | 'amber' | 'indigo';
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  size = 'md',
  accent = 'emerald',
}) => {
  const trackSize = size === 'sm' ? 'w-9 h-5' : 'w-11 h-6';
  const thumbSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4.5 h-4.5';
  const translateX = size === 'sm' ? (checked ? 16 : 2) : checked ? 22 : 2;

  const activeBg =
    accent === 'amber'
      ? 'bg-amber-600'
      : accent === 'indigo'
      ? 'bg-indigo-600'
      : 'bg-emerald-600';

  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.94 }}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex items-center shrink-0 rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1 ${trackSize} ${
        checked ? activeBg : 'bg-neutral-300/90'
      } ${disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <motion.span
        animate={{ x: translateX }}
        transition={SPRING_SWITCH}
        className={`inline-block rounded-full bg-white shadow-xs ${thumbSize}`}
      />
    </motion.button>
  );
};

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'right';
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  side = 'bottom',
  className = '',
}) => {
  const prefersReducedMotion = useReducedMotion();
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; transform: string }>({
    top: 0,
    left: 0,
    transform: 'translate(-50%, 0)',
  });

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || typeof window === 'undefined') return;

    const updatePosition = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const gap = 8;
      const vw = window.innerWidth;
      const tipWidth = tooltipRef.current?.offsetWidth ?? 0;

      if (side === 'right') {
        setCoords({
          top: rect.top + rect.height / 2,
          left: Math.min(vw - 12, rect.right + gap),
          transform: 'translate(0, -50%)',
        });
        return;
      }

      const rawCenter = rect.left + rect.width / 2;
      const half = tipWidth > 0 ? tipWidth / 2 : 80;
      const clampedCenter = Math.max(half + 10, Math.min(vw - half - 10, rawCenter));

      if (side === 'top') {
        setCoords({
          top: Math.max(10, rect.top - gap),
          left: clampedCenter,
          transform: 'translate(-50%, -100%)',
        });
      } else {
        setCoords({
          top: rect.bottom + gap,
          left: clampedCenter,
          transform: 'translate(-50%, 0)',
        });
      }
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, side, content]);

  const motionOffset =
    prefersReducedMotion
      ? {}
      : side === 'right'
      ? { x: -4 }
      : side === 'top'
      ? { y: 3 }
      : { y: -3 };

  const tooltipNode =
    typeof document !== 'undefined'
      ? createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={tooltipRef}
                initial={{ opacity: 0, scale: 0.97, ...motionOffset }}
                animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, ...motionOffset }}
                transition={{ duration: 0.14, ease: ROOMWISE_EASE }}
                role="tooltip"
                style={{
                  position: 'fixed',
                  top: coords.top,
                  left: coords.left,
                  transform: coords.transform,
                }}
                className="pointer-events-none z-[90] px-2.5 py-1.5 rounded-lg bg-[#0b1713] text-[#f4f6f4] text-[11px] font-medium whitespace-nowrap shadow-xl border border-white/15"
              >
                {content}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )
      : null;

  return (
    <div
      ref={triggerRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {tooltipNode}
    </div>
  );
};
