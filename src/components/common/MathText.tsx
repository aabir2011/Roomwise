/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export interface MathTextProps {
  /** Pure LaTeX math expression rendered via bundled KaTeX */
  tex: string;
  /** Render as centered display equation block instead of inline math */
  display?: boolean;
  /** Accessible screen-reader description of the mathematical expression */
  ariaLabel?: string;
  /** Optional wrapper classes */
  className?: string;
  /** Tighter vertical spacing for compact formula rows & cards */
  compact?: boolean;
}

/**
 * Shared ROOMWISE mathematical typesetting primitive powered by locally bundled KaTeX.
 * Renders crisp HTML + MathML output with zero runtime CDN requests.
 */
export const MathText: React.FC<MathTextProps> = ({
  tex,
  display = false,
  ariaLabel,
  className = '',
  compact = false,
}) => {
  const html = useMemo(
    () =>
      katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        strict: 'ignore',
        output: 'htmlAndMathml',
      }),
    [tex, display]
  );

  if (display) {
    return (
      <div
        role={ariaLabel ? 'img' : undefined}
        aria-label={ariaLabel}
        className={`rw-math-display overflow-x-auto ${compact ? 'py-1 px-1' : 'py-2.5 px-2'} ${className}`}
      >
        <div
          className="min-w-max mx-auto text-center leading-none"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }

  return (
    <span
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      className={`rw-math-inline inline-block align-baseline ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
