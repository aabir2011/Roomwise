/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ROOMWISE_EASE } from '../../utils/motion';

export interface AnimatedListProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  as?: 'div' | 'tbody';
  className?: string;
  itemClassName?: string;
  emptyFallback?: React.ReactNode;
}

/**
 * React Bits-inspired AnimatedList using AnimatePresence(initial={false}).
 * Existing items remain completely steady across data polls or updates;
 * only genuinely new items added at runtime animate in cleanly.
 */
export function AnimatedList<T>({
  items,
  getKey,
  renderItem,
  as = 'div',
  className = '',
  itemClassName = '',
  emptyFallback = null,
}: AnimatedListProps<T>) {
  const prefersReducedMotion = useReducedMotion();

  if (items.length === 0 && emptyFallback) {
    return <>{emptyFallback}</>;
  }

  if (as === 'tbody') {
    return (
      <tbody className={className}>
        <AnimatePresence initial={false}>
          {items.map((item, idx) => (
            <React.Fragment key={getKey(item)}>{renderItem(item, idx)}</React.Fragment>
          ))}
        </AnimatePresence>
      </tbody>
    );
  }

  return (
    <div className={className}>
      <AnimatePresence initial={false}>
        {items.map((item, idx) => {
          const key = getKey(item);
          if (prefersReducedMotion) {
            return (
              <div key={key} className={itemClassName}>
                {renderItem(item, idx)}
              </div>
            );
          }
          return (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: ROOMWISE_EASE }}
              className={itemClassName}
            >
              {renderItem(item, idx)}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export interface AnimatedTableRowProps
  extends React.ComponentPropsWithoutRef<typeof motion.tr> {
  children: React.ReactNode;
}

export const AnimatedTableRow: React.FC<AnimatedTableRowProps> = ({
  children,
  className = '',
  ...rest
}) => {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return (
      <tr className={className} {...(rest as React.HTMLAttributes<HTMLTableRowElement>)}>
        {children}
      </tr>
    );
  }

  return (
    <motion.tr
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: ROOMWISE_EASE }}
      className={className}
      {...rest}
    >
      {children}
    </motion.tr>
  );
};
