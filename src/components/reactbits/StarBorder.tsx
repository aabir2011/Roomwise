/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useReducedMotion } from 'motion/react';

export interface StarBorderProps {
  children: React.ReactNode;
  active?: boolean;
  className?: string;
  innerClassName?: string;
}

/**
 * React Bits-inspired StarBorder applied strictly to the Overview "Adaptive Automation Active" indicator.
 * Renders a crisp, slow-moving single emerald border glint when active; cleanly falls back
 * to a static emerald hairline when inactive or under prefers-reduced-motion.
 */
export const StarBorder: React.FC<StarBorderProps> = ({
  children,
  active = true,
  className = '',
  innerClassName = '',
}) => {
  const prefersReducedMotion = useReducedMotion();
  const showOrbit = active && !prefersReducedMotion;

  return (
    <span
      className={`relative inline-flex items-center p-[1px] rounded-lg overflow-hidden align-middle ${
        active ? 'bg-emerald-600/20' : 'bg-amber-600/25'
      } ${className}`}
    >
      {showOrbit && (
        <span
          aria-hidden="true"
          className="rw-star-border-orbit pointer-events-none absolute left-1/2 top-1/2 w-[260px] h-[260px]"
          style={{
            background:
              'conic-gradient(from 0deg, transparent 0deg, transparent 275deg, rgba(16, 185, 129, 0.72) 320deg, rgba(52, 211, 153, 0.9) 340deg, transparent 360deg)',
          }}
        />
      )}
      <span
        className={`relative z-10 inline-flex items-center gap-1.5 rounded-[7px] px-2 py-0.5 ${
          active ? 'bg-emerald-50/95 text-emerald-900' : 'bg-amber-50/95 text-amber-900'
        } ${innerClassName}`}
      >
        {children}
      </span>
    </span>
  );
};
