/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Transition, Variants } from 'motion/react';

export const ROOMWISE_EASE = [0.16, 1, 0.3, 1] as const;

export const TRANSITION_FAST: Transition = {
  duration: 0.15,
  ease: ROOMWISE_EASE,
};

export const TRANSITION_BASE: Transition = {
  duration: 0.22,
  ease: ROOMWISE_EASE,
};

export const TRANSITION_SMOOTH: Transition = {
  duration: 0.32,
  ease: ROOMWISE_EASE,
};

export const SPRING_SNAPPY: Transition = {
  type: 'spring',
  stiffness: 460,
  damping: 34,
  mass: 0.8,
};

export const SPRING_GENTLE: Transition = {
  type: 'spring',
  stiffness: 320,
  damping: 30,
  mass: 0.9,
};

export const SPRING_SWITCH: Transition = {
  type: 'spring',
  stiffness: 540,
  damping: 34,
};

export const SPRING_DRAWER: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 38,
  mass: 0.9,
};

export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.16, ease: ROOMWISE_EASE } },
  exit: { opacity: 0, transition: { duration: 0.14, ease: 'easeIn' } },
};

export const modalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.975, y: 6 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.2, ease: ROOMWISE_EASE },
  },
  exit: {
    opacity: 0,
    scale: 0.98,
    y: 4,
    transition: { duration: 0.14, ease: 'easeIn' },
  },
};

export const drawerRightVariants: Variants = {
  hidden: { x: '100%', opacity: 0.85 },
  visible: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.24, ease: ROOMWISE_EASE },
  },
  exit: {
    x: '100%',
    opacity: 0.85,
    transition: { duration: 0.18, ease: 'easeIn' },
  },
};

export const popoverVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: -4 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.15, ease: ROOMWISE_EASE },
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    y: -4,
    transition: { duration: 0.11, ease: 'easeIn' },
  },
};

export const tabContentVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.16, ease: ROOMWISE_EASE },
  },
  exit: {
    opacity: 0,
    y: -2,
    transition: { duration: 0.1, ease: 'easeIn' },
  },
};

export const pageTransitionVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.16, ease: ROOMWISE_EASE },
  },
  exit: {
    opacity: 0,
    y: -2,
    transition: { duration: 0.1, ease: 'easeIn' },
  },
};

export const staggerContainerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.03,
      delayChildren: 0.015,
    },
  },
};

export const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: ROOMWISE_EASE },
  },
};
