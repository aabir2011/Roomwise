/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ROOMWISE_EASE } from '../../utils/motion';

export interface FadeContentProps {
  children: React.ReactNode;
  duration?: number;
  delay?: number;
  yOffset?: number;
  className?: string;
}

/**
 * React Bits-inspired FadeContent entry wrapper.
 * Subtle fade + micro vertical lift (150–260ms, ease-out, zero blur, immediate interactivity).
 */
export const FadeContent: React.FC<FadeContentProps> = ({
  children,
  duration = 0.22,
  delay = 0,
  yOffset = 6,
  className = '',
}) => {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: yOffset }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, delay, ease: ROOMWISE_EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
};
