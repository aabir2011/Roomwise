/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useReducedMotion } from 'motion/react';

/**
 * Application-wide atmospheric background wash layer.
 * Renders soft, low-opacity cool-white, pale-mint, and restrained-emerald skylight
 * washes that drift slowly using GPU compositor transforms only.
 * Respects `prefers-reduced-motion` by rendering static atmospheric washes.
 */
export const AmbientBackdrop: React.FC = () => {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden print:hidden select-none"
    >
      {/* Upper-left pale mint & botanical emerald skylight wash */}
      <div
        className={`absolute -top-[18%] -left-[12%] w-[68vw] max-w-[980px] h-[58vh] min-h-[380px] rounded-full ${
          prefersReducedMotion ? '' : 'rw-ambient-wash-a'
        }`}
        style={{
          background:
            'radial-gradient(closest-side, rgba(167, 243, 208, 0.28) 0%, rgba(11, 110, 79, 0.065) 48%, transparent 100%)',
        }}
      />

      {/* Upper-right cool-white & restrained sage/teal atmospheric drift */}
      <div
        className={`absolute -top-[10%] -right-[14%] w-[62vw] max-w-[900px] h-[54vh] min-h-[360px] rounded-full ${
          prefersReducedMotion ? '' : 'rw-ambient-wash-b'
        }`}
        style={{
          background:
            'radial-gradient(closest-side, rgba(209, 250, 229, 0.24) 0%, rgba(14, 107, 168, 0.045) 52%, transparent 100%)',
        }}
      />

      {/* Lower-center soft cool limestone & mint base swell for scroll depth */}
      <div
        className={`absolute -bottom-[22%] left-[18%] w-[64vw] max-w-[940px] h-[50vh] min-h-[320px] rounded-full ${
          prefersReducedMotion ? '' : 'rw-ambient-wash-c'
        }`}
        style={{
          background:
            'radial-gradient(closest-side, rgba(220, 252, 231, 0.22) 0%, rgba(16, 185, 129, 0.048) 46%, transparent 100%)',
        }}
      />
    </div>
  );
};
