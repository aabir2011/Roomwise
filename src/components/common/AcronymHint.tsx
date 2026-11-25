/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { HelpCircle } from 'lucide-react';
import { ACRONYM_GLOSSARY } from '../../utils/canonicalEnergy';

interface AcronymHintProps {
  term: string;
  label?: string;
  showIcon?: boolean;
  className?: string;
}

/**
 * Restrained contextual abbreviation hint — preserves clean visual hierarchy while
 * providing instant native tooltip + screen-reader expansion for technical acronyms.
 */
export const AcronymHint: React.FC<AcronymHintProps> = ({
  term,
  label,
  showIcon = false,
  className = '',
}) => {
  const entry = ACRONYM_GLOSSARY[term];
  const fullText = entry?.full ?? term;
  const display = label ?? entry?.short ?? term;

  return (
    <abbr
      title={fullText}
      aria-label={`${display}: ${fullText}`}
      className={`no-underline border-b border-dotted border-current/45 cursor-help inline-flex items-center gap-0.5 ${className}`}
    >
      <span>{display}</span>
      {showIcon && <HelpCircle className="w-3 h-3 opacity-60 shrink-0" aria-hidden="true" />}
    </abbr>
  );
};
