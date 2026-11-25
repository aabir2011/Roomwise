/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Check } from 'lucide-react';
import { ROOMWISE_EASE } from '../../utils/motion';

export interface StepperStep {
  id: string;
  label: string;
  description?: string;
}

export interface StepperProps {
  steps: readonly StepperStep[];
  currentStep: number;
  onStepClick?: (index: number) => void;
  tone?: 'light' | 'dark';
  compact?: boolean;
  allowStepBack?: boolean;
  allowJumpAny?: boolean;
  ariaLabel?: string;
  className?: string;
}

/**
 * React Bits-inspired Stepper component.
 * Distinguishes completed, current, and upcoming steps with smooth progress transitions
 * and optional backward/interactive step navigation synced strictly to workflow state.
 */
export const Stepper: React.FC<StepperProps> = ({
  steps,
  currentStep,
  onStepClick,
  tone = 'light',
  compact = false,
  allowStepBack = true,
  allowJumpAny = false,
  ariaLabel = 'Workflow progress',
  className = '',
}) => {
  const prefersReducedMotion = useReducedMotion();
  const isDark = tone === 'dark';

  return (
    <nav aria-label={ariaLabel} className={`w-full ${className}`}>
      <ol className={`flex items-center ${compact ? 'gap-1.5' : 'gap-2 sm:gap-3'}`}>
        {steps.map((step, idx) => {
          const isCompleted = idx < currentStep;
          const isCurrent = idx === currentStep;
          const isClickable =
            Boolean(onStepClick) &&
            (allowJumpAny ? idx !== currentStep : allowStepBack && isCompleted);

          return (
            <React.Fragment key={step.id}>
              <li className="flex items-center min-w-0 shrink-0">
                <button
                  type="button"
                  disabled={!isClickable}
                  onClick={() => isClickable && onStepClick?.(idx)}
                  aria-current={isCurrent ? 'step' : undefined}
                  title={step.description ? `${step.label}: ${step.description}` : step.label}
                  className={`group inline-flex items-center gap-2 rounded-lg text-left transition-colors ${
                    compact ? 'px-1 py-0.5' : 'px-1.5 py-1'
                  } ${
                    isClickable
                      ? isDark
                        ? 'cursor-pointer hover:bg-white/8'
                        : 'cursor-pointer hover:bg-neutral-100/80'
                      : 'cursor-default'
                  }`}
                >
                  <span
                    className={`relative flex items-center justify-center rounded-full font-mono font-bold transition-colors shrink-0 ${
                      compact ? 'w-5 h-5 text-[10px]' : 'w-6 h-6 text-[11px]'
                    } ${
                      isCompleted
                        ? isDark
                          ? 'bg-emerald-500/25 border border-emerald-400/70 text-emerald-200'
                          : 'bg-emerald-600 border border-emerald-600 text-white'
                        : isCurrent
                        ? isDark
                          ? 'bg-emerald-500 text-white border border-emerald-300 shadow-[0_0_0_2px_rgba(16,185,129,0.22)]'
                          : 'bg-[#0b2e22] text-white border border-[#0b2e22] shadow-[0_0_0_2px_rgba(16,185,129,0.16)]'
                        : isDark
                        ? 'bg-white/12 border border-white/22 text-[#cad8d2]'
                        : 'bg-neutral-100 border border-neutral-300/80 text-neutral-500'
                    }`}
                  >
                    {isCompleted ? <Check className="w-3 h-3 stroke-[2.5]" /> : idx + 1}
                  </span>

                  {!compact && (
                    <span className="min-w-0">
                      <span
                        className={`block text-[11px] leading-tight whitespace-nowrap ${
                          isCurrent
                            ? isDark
                              ? 'font-semibold text-white'
                              : 'font-semibold text-[#111815]'
                            : isCompleted
                            ? isDark
                              ? 'font-medium text-emerald-200'
                              : 'font-medium text-emerald-800'
                            : isDark
                            ? 'font-normal text-[#cad8d2]'
                            : 'font-normal text-neutral-500'
                        }`}
                      >
                        {step.label}
                      </span>
                    </span>
                  )}
                </button>
              </li>

              {idx < steps.length - 1 && (
                <li
                  aria-hidden="true"
                  className={`flex-1 h-[2px] rounded-full overflow-hidden min-w-[10px] ${
                    isDark ? 'bg-white/12' : 'bg-neutral-200'
                  }`}
                >
                  <motion.div
                    initial={false}
                    animate={{ width: idx < currentStep ? '100%' : '0%' }}
                    transition={
                      prefersReducedMotion
                        ? { duration: 0 }
                        : { duration: 0.24, ease: ROOMWISE_EASE }
                    }
                    className={`h-full rounded-full ${
                      isDark ? 'bg-emerald-400' : 'bg-emerald-600'
                    }`}
                  />
                </li>
              )}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
};
