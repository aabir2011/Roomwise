/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

type SpotlightBaseProps = {
  children: React.ReactNode;
  spotlightColor?: string;
  spotlightRadius?: number;
  innerClassName?: string;
};

export type SpotlightCardProps =
  | (SpotlightBaseProps & { as?: 'button' } & React.ComponentPropsWithoutRef<typeof motion.button>)
  | (SpotlightBaseProps & { as: 'div' } & React.ComponentPropsWithoutRef<typeof motion.div>);

/**
 * React Bits-inspired SpotlightCard for Digital Twin and Classrooms room cards.
 * - Activates only on desktop fine-pointer devices (`pointerType === 'mouse'` & `(hover: hover) and (pointer: fine)`).
 * - Disabled on touch screens and when prefers-reduced-motion is enabled.
 * - Zero React state updates during pointer movement (updates CSS custom properties directly on the DOM node).
 */
export const SpotlightCard: React.FC<SpotlightCardProps> = (props) => {
  const {
    as = 'button',
    children,
    className = '',
    innerClassName = 'block w-full',
    spotlightColor = 'rgba(16, 185, 129, 0.13)',
    spotlightRadius = 210,
    onPointerMove,
    onPointerEnter,
    onPointerLeave,
    ...rest
  } = props;

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const divRef = useRef<HTMLDivElement | null>(null);
  const prefersReducedMotion = useReducedMotion() === true;
  const [isSpotlightVisible, setIsSpotlightVisible] = useState(false);

  const canUseFineSpotlight = (e: React.PointerEvent<HTMLElement>) => {
    if (prefersReducedMotion) return false;
    if (e.pointerType !== 'mouse') return false;
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    }
    return true;
  };

  const updatePointerCoords = (e: React.PointerEvent<HTMLElement>) => {
    const el = as === 'div' ? divRef.current : buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--rw-spot-x', `${(e.clientX - rect.left).toFixed(1)}px`);
    el.style.setProperty('--rw-spot-y', `${(e.clientY - rect.top).toFixed(1)}px`);
  };

  const spotlightOverlay = !prefersReducedMotion && (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 transition-opacity duration-200"
      style={{
        opacity: isSpotlightVisible ? 1 : 0,
        background: `radial-gradient(${spotlightRadius}px circle at var(--rw-spot-x, 50%) var(--rw-spot-y, 50%), ${spotlightColor}, transparent 75%)`,
      }}
    />
  );

  if (as === 'div') {
    const divProps = rest as React.ComponentPropsWithoutRef<typeof motion.div>;
    return (
      <motion.div
        ref={divRef}
        onPointerEnter={(e) => {
          if (canUseFineSpotlight(e)) {
            updatePointerCoords(e);
            setIsSpotlightVisible(true);
          }
          (onPointerEnter as React.PointerEventHandler<HTMLDivElement> | undefined)?.(e);
        }}
        onPointerMove={(e) => {
          if (canUseFineSpotlight(e)) {
            updatePointerCoords(e);
            if (!isSpotlightVisible) setIsSpotlightVisible(true);
          }
          (onPointerMove as React.PointerEventHandler<HTMLDivElement> | undefined)?.(e);
        }}
        onPointerLeave={(e) => {
          setIsSpotlightVisible(false);
          (onPointerLeave as React.PointerEventHandler<HTMLDivElement> | undefined)?.(e);
        }}
        className={`relative overflow-hidden ${className}`}
        {...divProps}
      >
        {spotlightOverlay}
        <span className={`relative z-10 ${innerClassName}`}>{children}</span>
      </motion.div>
    );
  }

  const buttonProps = rest as React.ComponentPropsWithoutRef<typeof motion.button>;
  return (
    <motion.button
      ref={buttonRef}
      type="button"
      onPointerEnter={(e) => {
        if (canUseFineSpotlight(e)) {
          updatePointerCoords(e);
          setIsSpotlightVisible(true);
        }
        (onPointerEnter as React.PointerEventHandler<HTMLButtonElement> | undefined)?.(e);
      }}
      onPointerMove={(e) => {
        if (canUseFineSpotlight(e)) {
          updatePointerCoords(e);
          if (!isSpotlightVisible) setIsSpotlightVisible(true);
        }
        (onPointerMove as React.PointerEventHandler<HTMLButtonElement> | undefined)?.(e);
      }}
      onPointerLeave={(e) => {
        setIsSpotlightVisible(false);
        (onPointerLeave as React.PointerEventHandler<HTMLButtonElement> | undefined)?.(e);
      }}
      className={`relative overflow-hidden ${className}`}
      {...buttonProps}
    >
      {spotlightOverlay}
      <span className={`relative z-10 ${innerClassName}`}>{children}</span>
    </motion.button>
  );
};
