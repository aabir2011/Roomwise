/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { SPRING_SNAPPY } from '../../utils/motion';

interface PageHeaderProps {
  kicker: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
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
        <div className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-emerald-800 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {kicker}
        </div>
        <h1 className="text-xl sm:text-2xl font-bold text-[#111815] tracking-tight leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs text-[#4a5851] max-w-2xl leading-relaxed">
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
  subtitle?: React.ReactNode;
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
          <h2 className="text-sm sm:text-[15px] font-bold text-[#111815] tracking-tight">
            {title}
          </h2>
          {meta && (
            <span className="text-[11px] font-mono text-[#64726b] tabular-nums">
              {meta}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-[#4a5851] mt-0.5 leading-relaxed">
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
  ariaLabel?: string;
  className?: string;
}

/**
 * Unified floating segmented control with shared layoutId spring indicator.
 * Guarantees single-line button geometry and accessible tablist semantics across viewports.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  size = 'md',
  tone = 'dark',
  ariaLabel,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex items-center p-1 rounded-xl bg-[#f3f5f4] border border-neutral-200/80 max-w-full overflow-x-auto ${className}`}
    >
      {options.map((opt) => {
        const active = value === opt.id;
        const Icon = opt.icon;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={`relative rounded-lg font-medium whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors cursor-pointer ${
              size === 'sm' ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-1.5 text-xs'
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
            {Icon && (
              <Icon
                className={`relative z-10 w-3.5 h-3.5 shrink-0 ${
                  active && tone === 'light' ? 'text-emerald-700' : ''
                }`}
              />
            )}
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
 * Clean un-nested architectural metric cell — uses whitespace and crisp hairline borders.
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

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'neutral' | 'emerald';
  className?: string;
}

/**
 * Calm, centered empty state shared across filtered tables, directories, and audit views.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  tone = 'neutral',
  className = '',
}) => {
  return (
    <div className={`p-10 sm:p-12 rounded-2xl rw-surface text-center space-y-3 ${className}`}>
      <div
        className={`w-11 h-11 rounded-2xl border flex items-center justify-center mx-auto ${
          tone === 'emerald'
            ? 'bg-emerald-50 border-emerald-200/80 text-emerald-700'
            : 'bg-[#f3f5f4] border-neutral-200/90 text-[#4a5851]'
        }`}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-bold text-[#111815]">{title}</h3>
        <p className="text-xs text-[#4a5851] max-w-md mx-auto leading-relaxed">
          {description}
        </p>
      </div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="px-4 py-2 rounded-xl rw-btn-primary text-xs font-semibold"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};

interface LoadingStateProps {
  message?: string;
  className?: string;
}

/**
 * Unified calm loading surface with restrained spinner indicator.
 */
export const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Loading telemetry workspace...',
  className = '',
}) => (
  <div
    className={`py-16 flex flex-col items-center justify-center gap-2.5 text-xs text-[#4a5851] ${className}`}
  >
    <Loader2 className="w-5 h-5 animate-spin text-emerald-700" />
    <span>{message}</span>
  </div>
);

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/**
 * Unified calm error notification surface with optional retry control.
 */
export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  message,
  onRetry,
  retryLabel = 'Retry',
  className = '',
}) => (
  <div
    role="alert"
    className={`p-4 rounded-2xl border border-rose-200/90 bg-rose-50/75 text-xs text-rose-950 flex flex-wrap items-center justify-between gap-3 ${className}`}
  >
    <div className="flex items-center gap-2.5 min-w-0">
      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
      <span className="leading-relaxed">{message}</span>
    </div>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold transition-colors shrink-0"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        <span>{retryLabel}</span>
      </button>
    )}
  </div>
);
