/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';

export interface CountUpProps {
  to: number;
  from?: number;
  duration?: number;
  delay?: number;
  decimals?: number;
  separator?: string;
  locale?: string;
  prefix?: string;
  suffix?: string;
  metricKey?: string;
  className?: string;
}

function formatNumberValue(
  value: number,
  decimals: number,
  locale?: string,
  separator?: string
): string {
  if (!Number.isFinite(value)) return '0';
  if (locale) {
    return value.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  const fixed = value.toFixed(decimals);
  if (!separator) return fixed;
  const parts = fixed.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  return parts.join('.');
}

/**
 * React Bits-inspired CountUp animation tailored for ROOMWISE quantitative KPIs.
 * - Uses ease-out cubic (~750–900ms) on view entry.
 * - Preserves the entry sweep even if asynchronous telemetry hydration arrives mid-animation.
 * - Smoothly eases subsequent live telemetry updates without resetting to zero.
 * - Reserves final bounding width inside an inline-grid spacer to prevent CLS.
 */
export const CountUp: React.FC<CountUpProps> = ({
  to,
  from = 0,
  duration = 0.8,
  delay = 0,
  decimals = 0,
  separator,
  locale,
  prefix = '',
  suffix = '',
  className = '',
}) => {
  const prefersReducedMotion = useReducedMotion() === true;
  const safeTarget = Number.isFinite(to) ? to : 0;

  const [displayValue, setDisplayValue] = useState<number>(() =>
    prefersReducedMotion ? safeTarget : from
  );
  const currentRef = useRef<number>(prefersReducedMotion ? safeTarget : from);
  const entryCompletedRef = useRef<boolean>(prefersReducedMotion);
  const entryEndTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const delayTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (delayTimerRef.current !== null) {
      window.clearTimeout(delayTimerRef.current);
      delayTimerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (prefersReducedMotion || !Number.isFinite(safeTarget)) {
      currentRef.current = safeTarget;
      setDisplayValue(safeTarget);
      entryCompletedRef.current = true;
      return;
    }

    const startVal = currentRef.current;

    if (entryCompletedRef.current && Math.abs(safeTarget - startVal) < 1e-6) {
      return;
    }

    const nowMs = performance.now();
    const isEntryActive = !entryCompletedRef.current;

    let durationMs: number;
    if (isEntryActive) {
      if (entryEndTimeRef.current === null) {
        const entryDurationMs = Math.max(240, Math.round(duration * 1000));
        entryEndTimeRef.current = nowMs + Math.max(0, Math.round(delay * 1000)) + entryDurationMs;
        durationMs = entryDurationMs;
      } else {
        durationMs = Math.max(280, Math.round(entryEndTimeRef.current - nowMs));
      }
    } else {
      durationMs = Math.max(180, Math.round(Math.min(0.32, duration) * 1000));
    }

    const runAnimation = () => {
      const startTime = performance.now();
      const tick = (now: number) => {
        const elapsed = Math.max(0, now - startTime);
        const progress = Math.min(1, elapsed / durationMs);
        const eased = 1 - Math.pow(1 - progress, 3);
        const interpolated = startVal + (safeTarget - startVal) * eased;

        currentRef.current = interpolated;
        setDisplayValue(interpolated);

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          currentRef.current = safeTarget;
          setDisplayValue(safeTarget);
          entryCompletedRef.current = true;
          rafRef.current = null;
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    const delayMs =
      isEntryActive && delay > 0 && Math.abs(startVal - from) < 1e-6
        ? Math.round(delay * 1000)
        : 0;

    if (delayMs > 0) {
      delayTimerRef.current = window.setTimeout(() => {
        delayTimerRef.current = null;
        runAnimation();
      }, delayMs);
    } else {
      runAnimation();
    }

    return () => {
      if (delayTimerRef.current !== null) {
        window.clearTimeout(delayTimerRef.current);
        delayTimerRef.current = null;
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [safeTarget, from, duration, delay, prefersReducedMotion]);

  const formattedTarget = useMemo(
    () => `${prefix}${formatNumberValue(safeTarget, decimals, locale, separator)}${suffix}`,
    [safeTarget, decimals, locale, separator, prefix, suffix]
  );

  const formattedCurrent = `${prefix}${formatNumberValue(
    displayValue,
    decimals,
    locale,
    separator
  )}${suffix}`;

  return (
    <span className={`inline-grid align-baseline tabular-nums ${className}`}>
      <span
        className="invisible col-start-1 row-start-1 select-none pointer-events-none"
        aria-hidden="true"
      >
        {formattedTarget}
      </span>
      <span className="col-start-1 row-start-1">{formattedCurrent}</span>
    </span>
  );
};
