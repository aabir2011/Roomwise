/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { SPRING_SNAPPY } from '../../utils/motion';

interface PageHeaderProps {
  kicker: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Editorial page header — quiet metadata kicker, crisp display title,
 * restrained 1-line descriptor, and aligned action slot without visual noise.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  kicker,
  title,
  subtitle,
  action,
  className = '',
}) => {
  return (
    <header
      className={`flex flex-col lg:flex-row lg:items-end justify-between gap-3.5 pb-4 sm:pb-5 border-b border-neutral-200/75 ${className}`}
    >
      <div className="min-w-0 space-y-1">
        <div className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-emerald-800">
          {kicker}
        </div>
        <h1 className="text-lg sm:text-2xl font-bold text-neutral-900 tracking-tight leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs text-neutral-500 max-w-2xl leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>

      {action && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {action}
        </div>
      )}
    </header>
  );
};

interface SectionHeadingProps {
  title: string;
  subtitle?: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Clean architectural section divider with consistent ROOMWISE typography and optional inline meta.
 */
export const SectionHeading: React.FC<SectionHeadingProps> = ({
  title,
  subtitle,
  meta,
  action,
  className = '',
}) => {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-end justify-between gap-2 pb-3 border-b border-neutral-200/70 ${className}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h2 className="text-sm sm:text-[15px] font-bold text-neutral-900 tracking-tight">
            {title}
          </h2>
          {meta && (
            <span className="text-[11px] font-mono text-neutral-500 tabular-nums">
              {meta}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  suffix?: string | number;
}

interface SegmentedControlProps<T extends string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  layoutId: string;
  size?: 'sm' | 'md';
  tone?: 'dark' | 'light';
  className?: string;
}

/**
 * Unified floating segmented control with shared layoutId spring indicator.
 * Guarantees single-line button geometry across viewports.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  size = 'md',
  tone = 'dark',
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div
      className={`inline-flex items-center p-1 rounded-xl bg-[#f3f5f4] border border-neutral-200/80 max-w-full overflow-x-auto ${className}`}
    >
      {options.map((opt) => {
        const active = value === opt.id;
        const Icon = opt.icon;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`relative rounded-lg font-medium whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors cursor-pointer ${
              size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
            } ${
              active
                ? tone === 'dark'
                  ? 'text-white font-semibold'
                  : 'text-[#111815] font-semibold'
                : 'text-[#4a5851] hover:text-[#111815]'
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={SPRING_SNAPPY}
                className={`absolute inset-0 rounded-lg ${
                  tone === 'dark'
                    ? 'bg-[#0b2e22] shadow-xs'
                    : 'bg-white border border-neutral-200/80 shadow-2xs'
                }`}
                aria-hidden="true"
              />
            )}
            {Icon && <Icon className="relative z-10 w-3.5 h-3.5 shrink-0" />}
            <span className="relative z-10">{opt.label}</span>
            {opt.suffix !== undefined && (
              <span
                className={`relative z-10 text-[10px] font-mono tabular-nums ${
                  active
                    ? tone === 'dark'
                      ? 'text-emerald-200'
                      : 'text-emerald-700'
                    : 'text-[#64726b]'
                }`}
              >
                {opt.suffix}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface TelemetryReadoutProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  detail?: React.ReactNode;
  footnote?: React.ReactNode;
  tone?: 'default' | 'emerald' | 'forest';
  className?: string;
}

/**
 * Clean un-nested architectural metric cell — uses whitespace and subtle
 * top hairline rules instead of repetitive boxed containers.
 */
export const TelemetryReadout: React.FC<TelemetryReadoutProps> = ({
  label,
  value,
  unit,
  detail,
  footnote,
  tone = 'default',
  className = '',
}) => {
  const isForest = tone === 'forest';
  return (
    <div
      className={`px-4 py-4 sm:px-5 sm:py-5 ${
        tone === 'emerald'
          ? 'bg-emerald-50/45 border border-emerald-200/70 rounded-2xl'
          : isForest
          ? 'rw-forest-hero text-white rounded-2xl'
          : 'rw-surface rounded-2xl'
      } ${className}`}
    >
      <div
        className={`text-[11px] font-medium ${
          isForest ? 'text-emerald-200/80' : 'text-[#4a5851]'
        }`}
      >
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span
          className={`text-2xl sm:text-[28px] font-semibold font-mono tracking-tight tabular-nums ${
            isForest ? 'text-white' : 'text-[#111815]'
          }`}
        >
          {value}
        </span>
        {unit && (
          <span
            className={`text-xs font-medium ${
              isForest ? 'text-emerald-200/80' : 'text-[#64726b]'
            }`}
          >
            {unit}
          </span>
        )}
      </div>
      {detail && (
        <div
          className={`mt-1.5 text-xs font-medium tabular-nums truncate ${
            isForest ? 'text-emerald-100' : 'text-emerald-800'
          }`}
        >
          {detail}
        </div>
      )}
      {footnote && (
        <div
          className={`mt-0.5 text-[11px] font-mono tabular-nums truncate ${
            isForest ? 'text-emerald-200/65' : 'text-[#64726b]'
          }`}
        >
          {footnote}
        </div>
      )}
    </div>
  );
};
