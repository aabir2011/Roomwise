/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
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
  side?: 'top' | 'bottom';
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  side = 'bottom',
  className = '',
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: side === 'top' ? 3 : -3, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: side === 'top' ? 3 : -3, scale: 0.97 }}
            transition={{ duration: 0.14, ease: ROOMWISE_EASE }}
            role="tooltip"
            className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-50 px-2.5 py-1.5 rounded-lg bg-neutral-900 text-white text-[11px] font-medium whitespace-nowrap shadow-lg border border-white/10 ${
              side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
            }`}
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
