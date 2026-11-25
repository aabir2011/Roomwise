/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { canonicalizeWrittenText } from './voiceTerminology.ts';

const LETTER_START_RE = /^\p{L}/u;
const SENTENCE_END_NEEDS_SPACE_RE = /(?:[\p{L}\p{M}]{2,}|[0-9)\]"'”’])[.!?।॥۔؟]$/u;
const CLAUSE_PUNCT_NEEDS_SPACE_RE = /[,;:،؛]$/;

/**
 * Merges a streaming transcription chunk into an in-progress transcript string
 * while preserving legitimate leading/trailing spaces, avoiding mid-word splits,
 * recovering missing spaces after punctuation boundaries, and deduplicating
 * cumulative snapshots if an upstream ASR sends full-turn text instead of deltas.
 */
export function mergeTranscriptChunk(existing: string, incoming: string): string {
  if (!incoming) return existing;

  // Brand-new bubble: strip only leading whitespace; do not start a whitespace-only bubble.
  if (!existing) {
    return incoming.trimStart();
  }

  // Handle pure-whitespace delta chunks (e.g. " " sent between two words) without dropping them.
  if (/^[ \t]+$/.test(incoming)) {
    return /\s$/.test(existing) ? existing : `${existing} `;
  }

  // Guard against cumulative-snapshot transcripts (where incoming already contains existing as a prefix).
  const existingTrimmedStart = existing.trimStart();
  const incomingTrimmedStart = incoming.trimStart();
  if (
    existingTrimmedStart.length >= 6 &&
    incomingTrimmedStart.length >= existingTrimmedStart.length &&
    incomingTrimmedStart.startsWith(existingTrimmedStart)
  ) {
    return incomingTrimmedStart;
  }

  // Prevent doubled horizontal spaces across chunk boundaries ("Hello " + " world").
  if (/[ \t]$/.test(existing) && /^[ \t]/.test(incoming)) {
    return `${existing}${incoming.replace(/^[ \t]+/, '')}`;
  }

  // Preserve exact boundary when either side already carries whitespace.
  if (/\s$/.test(existing) || /^\s/.test(incoming)) {
    return `${existing}${incoming}`;
  }

  // Defensive punctuation boundary repair:
  // If upstream omitted a space after terminal/clause punctuation followed by a letter
  // (e.g. "privileges." + "Please", "Sorry," + "but", "नमस्ते।" + "मैं"), insert a single space.
  // Never splits decimals ("7." + "40"), thousand separators ("1," + "209"),
  // times ("07:" + "30"), contractions ("I" + "'m"), or subword tokens ("modify" + "ing").
  if (
    LETTER_START_RE.test(incoming) &&
    (SENTENCE_END_NEEDS_SPACE_RE.test(existing) || CLAUSE_PUNCT_NEEDS_SPACE_RE.test(existing))
  ) {
    return `${existing} ${incoming}`;
  }

  return `${existing}${incoming}`;
}

/**
 * Normalizes a completed transcript turn without stripping valid inter-word spaces,
 * and applies context-sensitive ROOMWISE proper-noun & technical-notation canonicalization
 * (e.g. "Davos Model School" -> "D A V Model School", "three-D" -> "3D", "G plus three" -> "G+3").
 */
export function finalizeTranscriptText(text: string): string {
  if (!text) return '';
  const spaced = text.replace(/[ \t]{2,}/g, ' ').trim();
  return canonicalizeWrittenText(spaced);
}
