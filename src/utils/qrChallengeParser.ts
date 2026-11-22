/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ParsedQRChallengeParams {
  challengeId: string;
  nonce: string;
}

/**
 * Extracts validated ROOMWISE challenge parameters (`c` & `n`) from a scanned QR
 * URL or payload string. Returns null for unrelated QR codes.
 */
export function extractChallengeParams(rawText: string): ParsedQRChallengeParams | null {
  if (!rawText || typeof rawText !== 'string') return null;
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://roomwise.local';
    const parsed = new URL(trimmed, base);
    const challengeId = parsed.searchParams.get('c') || parsed.searchParams.get('challenge');
    const nonce = parsed.searchParams.get('n') || parsed.searchParams.get('nonce');
    if (challengeId && nonce && challengeId.trim().length >= 8 && nonce.trim().length >= 8) {
      return {
        challengeId: challengeId.trim(),
        nonce: nonce.trim(),
      };
    }
  } catch {
    // Try regex fallback below
  }

  const cMatch = trimmed.match(/[?&](?:c|challenge)=([^&#]+)/);
  const nMatch = trimmed.match(/[?&](?:n|nonce)=([^&#]+)/);
  if (cMatch && nMatch) {
    try {
      const challengeId = decodeURIComponent(cMatch[1]).trim();
      const nonce = decodeURIComponent(nMatch[1]).trim();
      if (challengeId.length >= 8 && nonce.length >= 8) {
        return { challengeId, nonce };
      }
    } catch {
      return null;
    }
  }

  return null;
}
