/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { SPRING_SNAPPY } from '../../utils/motion';

/**
 * Lightweight zero-rerender fine-pointer optical spotlight tracker matching MagicBento & SpotlightCard.
 */
function updateButtonSpotlight(
  e: React.PointerEvent<HTMLButtonElement>,
  prefersReducedMotion: boolean
) {
  if (prefersReducedMotion || e.pointerType !== 'mouse') return;
  if (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    !window.matchMedia('(hover: hover) and (pointer: fine)').matches
  ) {
    return;
  }
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--rw-bx', `${(e.clientX - rect.left).toFixed(1)}px`);
  e.currentTarget.style.setProperty('--rw-by', `${(e.clientY - rect.top).toFixed(1)}px`);
}

export type ActionButtonVariant =
  | 'forest'
  | 'primary'
  | 'secondary'
  | 'soft'
  | 'amber'
  | 'danger'
  | 'danger-solid'
  | 'dark-ghost';

export type ActionButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ActionButtonProps
  extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children: React.ReactNode;
  variant?: ActionButtonVariant;
  size?: ActionButtonSize;
  icon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  nudgeTrailing?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
}

const ACTION_VARIANT_CLASSES: Record<ActionButtonVariant, string> = {
  forest: 'rw-btn-forest text-white',
  primary: 'rw-btn-primary text-white',
  secondary: 'rw-btn-secondary text-[#111916]',
  soft: 'rw-btn-soft text-[#08543c]',
  amber: 'rw-btn-amber text-[#78350f]',
  danger: 'rw-btn-danger text-[#9f1239]',
  'danger-solid': 'rw-btn-danger-solid text-white',
  'dark-ghost': 'rw-btn-dark-ghost text-[#f3f7f5]',
};

const ACTION_SPOTLIGHT_COLORS: Record<ActionButtonVariant, string> = {
  forest: 'rgba(110, 231, 183, 0.26)',
  primary: 'rgba(52, 211, 153, 0.22)',
  secondary: 'rgba(11, 110, 79, 0.1)',
  soft: 'rgba(11, 110, 79, 0.13)',
  amber: 'rgba(217, 119, 6, 0.14)',
  danger: 'rgba(225, 29, 72, 0.11)',
  'danger-solid': 'rgba(255, 228, 230, 0.22)',
  'dark-ghost': 'rgba(52, 211, 153, 0.18)',
};

const ACTION_SIZE_CLASSES: Record<ActionButtonSize, string> = {
  xs: 'px-2.5 py-1 text-[11px] rounded-[7px] gap-1.5 min-h-[28px]',
  sm: 'px-3 py-1.5 text-xs rounded-[9px] gap-1.5 min-h-[32px]',
  md: 'px-4 py-2 text-xs rounded-[10px] gap-2 min-h-[36px]',
  lg: 'px-5 py-2.5 text-xs rounded-[11px] gap-2 min-h-[42px]',
};

/**
 * Matte architectural React action control with pointer-reactive radial illumination,
 * smooth spring press response, and directional chevron glide—matching ROOMWISE's Bento geometry.
 */
export const ActionButton = React.forwardRef<HTMLButtonElement, ActionButtonProps>(
  (
    {
      children,
      variant = 'secondary',
      size = 'md',
      icon,
      trailingIcon,
      nudgeTrailing = true,
      loading = false,
      fullWidth = false,
      disabled,
      type = 'button',
      className = '',
      onPointerEnter,
      onPointerMove,
      ...rest
    },
    ref
  ) => {
    const prefersReducedMotion = useReducedMotion() === true;
    const isDisabled = Boolean(disabled || loading);

    return (
      <motion.button
        ref={ref}
        type={type}
        disabled={isDisabled}
        whileTap={isDisabled ? undefined : { scale: 0.98 }}
        onPointerEnter={(e) => {
          if (!isDisabled) updateButtonSpotlight(e, prefersReducedMotion);
          onPointerEnter?.(e);
        }}
        onPointerMove={(e) => {
          if (!isDisabled) updateButtonSpotlight(e, prefersReducedMotion);
          onPointerMove?.(e);
        }}
        className={`group relative isolate inline-flex items-center justify-center font-semibold tracking-[-0.005em] whitespace-nowrap select-none transition-[background-color,border-color,box-shadow,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6e4f] focus-visible:ring-offset-1 ${
          ACTION_VARIANT_CLASSES[variant]
        } ${ACTION_SIZE_CLASSES[size]} ${fullWidth ? 'w-full' : 'shrink-0'} ${
          isDisabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer'
        } ${className}`.trim()}
        {...rest}
      >
        {/* Fine-pointer optical spotlight layer (clipped cleanly inside button radius) */}
        {!prefersReducedMotion && !isDisabled && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
          >
            <span
              className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              style={{
                background: `radial-gradient(110px circle at var(--rw-bx, 50%) var(--rw-by, 50%), ${ACTION_SPOTLIGHT_COLORS[variant]}, transparent 74%)`,
              }}
            />
          </span>
        )}

        {loading ? (
          <Loader2 className="relative z-10 w-3.5 h-3.5 animate-spin shrink-0 opacity-90" aria-hidden="true" />
        ) : (
          icon && <span className="relative z-10 inline-flex items-center shrink-0">{icon}</span>
        )}
        <span className="relative z-10 inline-flex items-center gap-1.5">{children}</span>
        {trailingIcon && (
          <span
            className={`relative z-10 inline-flex items-center shrink-0 transition-transform duration-150 ${
              nudgeTrailing && !isDisabled ? 'group-hover:translate-x-0.5' : ''
            }`}
          >
            {trailingIcon}
          </span>
        )}
      </motion.button>
    );
  }
);
ActionButton.displayName = 'ActionButton';

export type IconButtonVariant =
  | 'secondary'
  | 'ghost'
  | 'forest'
  | 'obsidian'
  | 'soft'
  | 'danger'
  | 'dark-ghost';

export interface IconButtonProps
  extends Omit<HTMLMotionProps<'button'>, 'children'> {
  label: string;
  children: React.ReactNode;
  variant?: IconButtonVariant;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const ICON_VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  secondary: 'rw-btn-secondary text-[#46544e] hover:text-[#111916]',
  ghost:
    'bg-transparent border border-transparent text-[#46544e] hover:text-[#08543c] hover:bg-[#0b6e4f]/[0.06] hover:border-[#0b6e4f]/20',
  forest: 'rw-btn-forest text-white',
  obsidian: 'rw-btn-primary text-white',
  soft: 'rw-btn-soft text-[#08543c]',
  danger: 'rw-btn-danger text-[#9f1239]',
  'dark-ghost': 'rw-btn-dark-ghost text-[#dde8e3] hover:text-white',
};

const ICON_SPOTLIGHT_COLORS: Record<IconButtonVariant, string> = {
  secondary: 'rgba(11, 110, 79, 0.11)',
  ghost: 'rgba(11, 110, 79, 0.12)',
  forest: 'rgba(110, 231, 183, 0.25)',
  obsidian: 'rgba(52, 211, 153, 0.22)',
  soft: 'rgba(11, 110, 79, 0.14)',
  danger: 'rgba(225, 29, 72, 0.12)',
  'dark-ghost': 'rgba(52, 211, 153, 0.2)',
};

const ICON_SIZE_CLASSES: Record<'xs' | 'sm' | 'md' | 'lg', string> = {
  xs: 'w-7 h-7 rounded-[7px]',
  sm: 'w-8 h-8 rounded-[9px]',
  md: 'w-9 h-9 rounded-[10px]',
  lg: 'w-10 h-10 rounded-[11px]',
};

/**
 * Square matte architectural icon control with fine-pointer radial illumination and subtle icon scale.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      label,
      children,
      variant = 'secondary',
      size = 'sm',
      disabled,
      type = 'button',
      title,
      className = '',
      onPointerEnter,
      onPointerMove,
      ...rest
    },
    ref
  ) => {
    const prefersReducedMotion = useReducedMotion() === true;

    return (
      <motion.button
        ref={ref}
        type={type}
        disabled={disabled}
        aria-label={label}
        title={title ?? label}
        whileTap={disabled ? undefined : { scale: 0.94 }}
        onPointerEnter={(e) => {
          if (!disabled) updateButtonSpotlight(e, prefersReducedMotion);
          onPointerEnter?.(e);
        }}
        onPointerMove={(e) => {
          if (!disabled) updateButtonSpotlight(e, prefersReducedMotion);
          onPointerMove?.(e);
        }}
        className={`group relative isolate inline-flex items-center justify-center shrink-0 transition-[background-color,border-color,box-shadow,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6e4f] focus-visible:ring-offset-1 ${
          ICON_VARIANT_CLASSES[variant]
        } ${ICON_SIZE_CLASSES[size]} ${
          disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'
        } ${className}`.trim()}
        {...rest}
      >
        {!prefersReducedMotion && !disabled && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
          >
            <span
              className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              style={{
                background: `radial-gradient(48px circle at var(--rw-bx, 50%) var(--rw-by, 50%), ${ICON_SPOTLIGHT_COLORS[variant]}, transparent 74%)`,
              }}
            />
          </span>
        )}
        <span className="relative z-10 inline-flex items-center justify-center transition-transform duration-150 group-hover:scale-[1.06]">
          {children}
        </span>
      </motion.button>
    );
  }
);
IconButton.displayName = 'IconButton';

export interface InlineActionLinkProps
  extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children: React.ReactNode;
  icon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  tone?: 'emerald' | 'neutral' | 'amber' | 'rose';
}

const INLINE_TONE_CLASSES: Record<'emerald' | 'neutral' | 'amber' | 'rose', string> = {
  emerald:
    'text-[#0b6e4f] hover:text-[#08543c] hover:bg-[#0b6e4f]/[0.07] hover:border-[#0b6e4f]/22',
  neutral:
    'text-[#46544e] hover:text-[#111916] hover:bg-[#111916]/[0.05] hover:border-[#111916]/14',
  amber:
    'text-amber-800 hover:text-amber-950 hover:bg-amber-500/[0.08] hover:border-amber-500/24',
  rose:
    'text-rose-700 hover:text-rose-900 hover:bg-rose-500/[0.07] hover:border-rose-500/24',
};

/**
 * Quiet architectural inline micro-action with animated origin-left hairline rule and chevron glide.
 */
export const InlineActionLink: React.FC<InlineActionLinkProps> = ({
  children,
  icon,
  trailingIcon,
  tone = 'emerald',
  type = 'button',
  disabled,
  className = '',
  ...rest
}) => (
  <motion.button
    type={type}
    disabled={disabled}
    whileTap={disabled ? undefined : { scale: 0.98 }}
    className={`group inline-flex items-center gap-1.5 px-2.5 py-1 -mx-1 rounded-lg border border-transparent text-[11.5px] font-semibold whitespace-nowrap transition-[background-color,border-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6e4f] focus-visible:ring-offset-1 ${
      INLINE_TONE_CLASSES[tone]
    } ${disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'} ${className}`.trim()}
    {...rest}
  >
    {icon && <span className="inline-flex items-center shrink-0">{icon}</span>}
    <span className="relative">
      <span>{children}</span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 right-0 -bottom-[2px] h-[1.5px] bg-current opacity-55 origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
      />
    </span>
    {trailingIcon && (
      <span className="inline-flex items-center shrink-0 transition-transform duration-150 group-hover:translate-x-0.5">
        {trailingIcon}
      </span>
    )}
  </motion.button>
);

export interface FilterChipButtonProps
  extends Omit<HTMLMotionProps<'button'>, 'children'> {
  active?: boolean;
  layoutId?: string;
  children: React.ReactNode;
  tone?: 'obsidian' | 'forest';
}

/**
 * Architectural filter chip with flat matte porcelain resting state, fine-pointer spotlight,
 * and shared layoutId spring indicator.
 */
export const FilterChipButton: React.FC<FilterChipButtonProps> = ({
  active = false,
  layoutId,
  children,
  tone = 'obsidian',
  type = 'button',
  className = '',
  onPointerEnter,
  onPointerMove,
  ...rest
}) => {
  const prefersReducedMotion = useReducedMotion() === true;

  return (
    <motion.button
      type={type}
      aria-pressed={active}
      whileTap={{ scale: 0.975 }}
      onPointerEnter={(e) => {
        updateButtonSpotlight(e, prefersReducedMotion);
        onPointerEnter?.(e);
      }}
      onPointerMove={(e) => {
        updateButtonSpotlight(e, prefersReducedMotion);
        onPointerMove?.(e);
      }}
      className={`group relative isolate inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[11.5px] font-semibold whitespace-nowrap shrink-0 transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6e4f] focus-visible:ring-offset-1 cursor-pointer ${
        active
          ? 'text-white'
          : 'bg-white border border-[#111916]/12 text-[#46544e] hover:text-[#111916] hover:border-[#0b6e4f]/40 hover:bg-[#f7fbf9] shadow-[0_1px_2px_rgba(11,23,19,0.03)]'
      } ${className}`.trim()}
      {...rest}
    >
      {active && (
        <motion.span
          layoutId={layoutId}
          transition={SPRING_SNAPPY}
          className={`absolute inset-0 rounded-[9px] border ${
            tone === 'forest'
              ? 'bg-[#0b6e4f] border-[#08543c]/50 shadow-[0_4px_12px_-4px_rgba(11,110,79,0.38)]'
              : 'bg-[#0b1713] border-[#0b1713] shadow-[0_4px_12px_-4px_rgba(11,23,19,0.32)]'
          }`}
          aria-hidden="true"
        />
      )}
      {!prefersReducedMotion && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
        >
          <span
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            style={{
              background: `radial-gradient(84px circle at var(--rw-bx, 50%) var(--rw-by, 50%), ${
                active ? 'rgba(52, 211, 153, 0.22)' : 'rgba(11, 110, 79, 0.09)'
              }, transparent 75%)`,
            }}
          />
        </span>
      )}
      <span className="relative z-10 inline-flex items-center gap-1.5">{children}</span>
    </motion.button>
  );
};

interface PageHeaderProps {
  kicker: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Architectural page header — crisp display title, quiet unboxed metadata kicker,
 * restrained 1-line descriptor, and aligned action slot separated by a precision 1px rule.
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
      className={`flex flex-col lg:flex-row lg:items-center justify-between gap-4 lg:gap-6 pb-4 sm:pb-5 border-b border-[#111916]/10 ${className}`}
    >
      <div className="min-w-0 space-y-1">
        <div className="text-[11px] font-medium text-[#0b6e4f] flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {kicker}
        </div>
        <h1 className="font-display text-xl sm:text-2xl lg:text-[27px] font-bold text-[#111916] tracking-[-0.025em] leading-[1.15]">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[12.5px] sm:text-[13px] text-[#46544e] max-w-2xl leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>

      {action && (
        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto shrink-0">
          {action}
        </div>
      )}
    </header>
  );
};

interface SectionHeadingProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Clean architectural section divider with Bricolage display hierarchy and inline monospace meta.
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
      className={`flex flex-col sm:flex-row sm:items-end justify-between gap-2 pb-3 border-b border-[#111916]/10 ${className}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h2 className="font-display text-[15px] sm:text-base font-bold text-[#111916] tracking-[-0.015em]">
            {title}
          </h2>
          {meta && (
            <span className="text-[11px] font-mono text-[#62706a] tabular-nums">
              {meta}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-[#46544e] mt-0.5 leading-relaxed">
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
 * Precision architectural segmented tab strip with shared layoutId spring indicator.
 * Flat matte architectural planes, crisp hairline enclosure, zero bevel.
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
      className={`inline-flex items-center p-1 rounded-[10px] bg-[#eaece8] border border-[#111916]/10 max-w-full overflow-x-auto no-scrollbar ${className}`}
    >
      {options.map((opt) => {
        const active = value === opt.id;
        const Icon = opt.icon;
        return (
          <motion.button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            whileTap={{ scale: 0.985 }}
            onClick={() => onChange(opt.id)}
            className={`relative rounded-[7px] font-medium whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6e4f] ${
              size === 'sm' ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-1.5 text-xs'
            } ${
              active
                ? tone === 'dark'
                  ? 'text-white font-semibold'
                  : 'text-[#111916] font-semibold'
                : 'text-[#46544e] hover:text-[#111916] hover:bg-white/50'
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={SPRING_SNAPPY}
                className={`absolute inset-0 rounded-[7px] ${
                  tone === 'dark'
                    ? 'bg-[#0b1713] border border-[#0b1713] shadow-[0_2px_8px_-2px_rgba(11,23,19,0.28)]'
                    : 'bg-white border border-[#111916]/10 shadow-[0_1px_3px_rgba(11,23,19,0.08)]'
                }`}
                aria-hidden="true"
              />
            )}
            {Icon && (
              <Icon
                className={`relative z-10 w-3.5 h-3.5 shrink-0 ${
                  active
                    ? tone === 'dark'
                      ? 'text-emerald-400'
                      : 'text-[#0b6e4f]'
                    : 'text-[#62706a]'
                }`}
              />
            )}
            <span className="relative z-10">{opt.label}</span>
            {opt.suffix !== undefined && (
              <span
                className={`relative z-10 text-[10px] font-mono tabular-nums ${
                  active
                    ? tone === 'dark'
                      ? 'text-emerald-300'
                      : 'text-[#0b6e4f]'
                    : 'text-[#62706a]'
                }`}
              >
                {opt.suffix}
              </span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

interface TelemetryReadoutProps {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: string;
  detail?: React.ReactNode;
  footnote?: React.ReactNode;
  tone?: 'default' | 'emerald' | 'forest';
  className?: string;
}

/**
 * Clean single-elevation architectural metric cell — crisp hairlines and tabular alignment.
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
      className={`px-4 py-4 sm:px-5 sm:py-4.5 ${
        tone === 'emerald'
          ? 'rw-surface-sage rounded-xl'
          : isForest
          ? 'rw-obsidian-panel text-white rounded-xl'
          : 'rw-surface rounded-xl'
      } ${className}`}
    >
      <div
        className={`text-[11px] font-medium ${
          isForest ? 'text-[#9bb3a8]' : 'text-[#46544e]'
        }`}
      >
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className={`text-2xl sm:text-[26px] font-semibold font-mono tracking-tight tabular-nums ${
            isForest ? 'text-white' : 'text-[#111916]'
          }`}
        >
          {value}
        </span>
        {unit && (
          <span
            className={`text-xs font-mono font-medium ${
              isForest ? 'text-emerald-300/80' : 'text-[#62706a]'
            }`}
          >
            {unit}
          </span>
        )}
      </div>
      {detail && (
        <div
          className={`mt-1.5 text-xs font-medium tabular-nums truncate ${
            isForest ? 'text-emerald-200' : 'text-[#0b6e4f]'
          }`}
        >
          {detail}
        </div>
      )}
      {footnote && (
        <div
          className={`mt-0.5 text-[11px] font-mono tabular-nums truncate ${
            isForest ? 'text-[#8ea69b]' : 'text-[#62706a]'
          }`}
        >
          {footnote}
        </div>
      )}
    </div>
  );
};

interface LedgerItem {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: string;
  detail?: React.ReactNode;
  highlight?: boolean;
}

interface LedgerStripProps {
  items: LedgerItem[];
  columns?: 2 | 3 | 4;
  className?: string;
}

/**
 * Unified single-elevation horizontal telemetry strip divided by crisp 1px hairlines.
 * Eliminates repetitive floating KPI cards while maximizing architectural legibility.
 */
export const LedgerStrip: React.FC<LedgerStripProps> = ({
  items,
  columns = 4,
  className = '',
}) => {
  const gridCols =
    columns === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : columns === 3
      ? 'grid-cols-1 sm:grid-cols-3'
      : 'grid-cols-2 lg:grid-cols-4';

  return (
    <div
      className={`rw-surface rounded-xl overflow-hidden grid ${gridCols} gap-px bg-[#111916]/10 ${className}`}
    >
      {items.map((item, idx) => (
        <div
          key={idx}
          className={`relative px-3.5 py-3 sm:px-5 sm:py-4 min-w-0 ${
            item.highlight
              ? 'bg-gradient-to-br from-[#f4faf7] to-[#e9f4ee]'
              : 'bg-white'
          }`}
        >
          {item.highlight && (
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-[2px] gradient-rim-emerald"
            />
          )}
          <div className="text-[10.5px] sm:text-[11px] font-medium text-[#46544e] leading-snug truncate">
            {item.label}
          </div>
          <div className="mt-1 sm:mt-1.5 flex items-baseline gap-1 sm:gap-1.5">
            <span
              className={`text-lg sm:text-2xl font-semibold font-mono tracking-tight tabular-nums ${
                item.highlight ? 'text-[#08543c]' : 'text-[#111916]'
              }`}
            >
              {item.value}
            </span>
            {item.unit && (
              <span className="text-[10.5px] sm:text-[11px] font-mono text-[#62706a]">{item.unit}</span>
            )}
          </div>
          {item.detail && (
            <div className="mt-1 text-[10.5px] sm:text-[11px] text-[#62706a] leading-snug tabular-nums line-clamp-2">
              {item.detail}
            </div>
          )}
        </div>
      ))}
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
    <div className={`p-10 sm:p-12 rounded-xl rw-surface text-center space-y-3 ${className}`}>
      <div
        className={`w-10 h-10 rounded-lg border flex items-center justify-center mx-auto ${
          tone === 'emerald'
            ? 'bg-[#eef6f2] border-[#0b6e4f]/25 text-[#0b6e4f]'
            : 'bg-[#ecefe9] border-[#111916]/10 text-[#46544e]'
        }`}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="space-y-1">
        <h3 className="font-display text-sm font-bold text-[#111916]">{title}</h3>
        <p className="text-xs text-[#46544e] max-w-md mx-auto leading-relaxed">
          {description}
        </p>
      </div>
      {actionLabel && onAction && (
        <ActionButton variant="primary" size="md" onClick={onAction}>
          {actionLabel}
        </ActionButton>
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
    className={`py-16 flex flex-col items-center justify-center gap-2.5 text-xs text-[#46544e] ${className}`}
  >
    <Loader2 className="w-5 h-5 animate-spin text-[#0b6e4f]" />
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
    className={`p-4 rounded-xl border border-rose-300/80 bg-rose-50/80 text-xs text-rose-950 flex flex-wrap items-center justify-between gap-3 ${className}`}
  >
    <div className="flex items-center gap-2.5 min-w-0">
      <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0" />
      <span className="leading-relaxed">{message}</span>
    </div>
    {onRetry && (
      <ActionButton
        variant="danger-solid"
        size="sm"
        onClick={onRetry}
        icon={<RefreshCw className="w-3.5 h-3.5" />}
      >
        {retryLabel}
      </ActionButton>
    )}
  </div>
);
