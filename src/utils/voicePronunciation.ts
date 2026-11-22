/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared ROOMWISE Voice Pronunciation & Classroom Query Normalizer.
 *
 * Visual room labels in ROOMWISE preserve traditional Indian school Roman
 * numerals (e.g. "Class X-B", "Class IX-A", "Class XII-A", "Class VI-A").
 * For speech synthesis / voice output, however, Roman numerals such as "X-B"
 * are frequently mispronounced ("Exbee", "Eye-Ex"). This module translates
 * Roman class grades into natural spoken cardinal numbers ("Class 10-B",
 * "Class 9-A", "Class 12-A") while leaving visual UI text untouched, and
 * normalizes both spoken ("ten b", "10 b", "room ten bee") and Roman ("X-B",
 * "ex b") user queries so classroom resolution works deterministically.
 */

const ROMAN_TO_NUMBER: Record<string, string> = {
  XII: '12',
  XI: '11',
  X: '10',
  IX: '9',
  VIII: '8',
  VII: '7',
  VI: '6',
  V: '5',
  IV: '4',
  III: '3',
  II: '2',
  I: '1',
};

const WORD_NUMBER_TO_DIGIT: Record<string, string> = {
  twelfth: '12',
  twelve: '12',
  eleventh: '11',
  eleven: '11',
  tenth: '10',
  ten: '10',
  ninth: '9',
  nine: '9',
  eighth: '8',
  eight: '8',
  seventh: '7',
  seven: '7',
  sixth: '6',
  six: '6',
  fifth: '5',
  five: '5',
  fourth: '4',
  four: '4',
  third: '3',
  three: '3',
  second: '2',
  two: '2',
  first: '1',
  one: '1',
};

const SPOKEN_SECTION_ALIASES: Record<string, string> = {
  ay: 'a',
  bee: 'b',
  sea: 'c',
  see: 'c',
  dee: 'd',
  ee: 'e',
};

/**
 * Converts Roman-numeral class labels in text into natural spoken numbers for TTS.
 *
 * Examples:
 * - "Class X-B" -> "Class 10-B"
 * - "Class IX-A (G3-201)" -> "Class 9-A (G3-201)"
 * - "Room XII-A" -> "Room 12-A"
 * - "X-B" -> "10-B"
 * - "Standard VI-B" -> "Standard 6-B"
 *
 * Preserves non-class acronyms (LED, AC, PIR, PVGIS, OB, NB, MPH, PP, BEE, ECBC, kWh).
 */
export function formatRoomNameForSpeech(text: string): string {
  if (!text) return text;

  let out = text;

  // 1. Explicit class/room/grade/standard prefix + Roman numeral + optional section (-A, A, -B, etc.)
  //    e.g., "Class X-B" -> "Class 10-B", "Class XII" -> "Class 12", "Room IX-A" -> "Room 9-A"
  out = out.replace(
    /\b(Class|Room|Grade|Std\.?|Standard)\s+(XII|XI|IX|VIII|VII|VI|IV|III|II|X|V|I)(?:(\s*[-–]\s*|\s+)([A-F])\b)?/gi,
    (_match, prefix: string, roman: string, sep: string | undefined, section: string | undefined) => {
      const digit = ROMAN_TO_NUMBER[roman.toUpperCase()];
      if (!digit) return _match;
      if (section) {
        const cleanSep = sep && sep.includes('-') ? '-' : sep && sep.includes('–') ? '-' : '-';
        return `${prefix} ${digit}${cleanSep}${section.toUpperCase()}`;
      }
      return `${prefix} ${digit}`;
    }
  );

  // 2. Standalone hyphenated Roman grade + section code (e.g., "X-B", "IX-A", "XII-C", "VI-A")
  //    Uses strict uppercase check for Roman numeral so lowercase words like "i-beam" or "x-ray" aren't altered.
  out = out.replace(
    /(?<![A-Za-z0-9])(XII|XI|IX|VIII|VII|VI|IV|III|II|X|V)\s*[-–]\s*([A-F])(?![A-Za-z0-9])/g,
    (_match, roman: string, section: string) => {
      const digit = ROMAN_TO_NUMBER[roman];
      if (!digit) return _match;
      return `${digit}-${section}`;
    }
  );

  return out;
}

/**
 * Formats a classroom's spoken identity cleanly for Gemini Live tool responses,
 * e.g. "Class 10-B (code G 3 301)" while keeping UI codes untouched.
 */
export function buildSpokenRoomIdentity(room: {
  name: string;
  roomCode: string;
}): string {
  const spokenName = formatRoomNameForSpeech(room.name);
  return spokenName;
}

/**
 * Normalizes a user's spoken or typed classroom query so all variants resolve
 * to the same canonical token form:
 * - "Class X-B", "class xb", "class ex b", "class ten b", "room 10b", "10-B", "ten bee" -> "class 10 b" / "10 b"
 * - "Class IX-A", "nine a", "9a", "9-a" -> "9 a"
 * - "Class XII-A", "12th a", "twelve a" -> "12 a"
 * - "G3-301", "g 3 301", "g3 301" -> "g3 301"
 */
export function normalizeClassroomQuery(raw: string): string {
  if (!raw) return '';

  let s = raw
    .toLowerCase()
    .replace(/['’"]/g, ' ')
    .replace(/[-–_/.,:;()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Handle common speech-to-text misrecognitions of Roman "X-B" / "X-A"
  s = s
    .replace(/\bex\s*bee\b/g, '10 b')
    .replace(/\bex\s+([a-f])\b/g, '10 $1')
    .replace(/\bexb\b/g, '10 b')
    .replace(/\bexa\b/g, '10 a')
    .replace(/\bxb\b/g, '10 b')
    .replace(/\bxa\b/g, '10 a')
    .replace(/\bxc\b/g, '10 c')
    .replace(/\bix([a-f])\b/g, '9 $1')
    .replace(/\bxi([a-f])\b/g, '11 $1')
    .replace(/\bxii([a-f])\b/g, '12 $1')
    .replace(/\bvi([a-f])\b/g, '6 $1')
    .replace(/\bvii([a-f])\b/g, '7 $1')
    .replace(/\bviii([a-f])\b/g, '8 $1');

  // Split compact numeric grade+section like "10b", "9a", "12a", "10th b", "12th a"
  s = s.replace(/\b(1[0-2]|[1-9])(?:st|nd|rd|th)?\s*([a-f])\b/g, '$1 $2');
  s = s.replace(/\b(1[0-2]|[1-9])(?:st|nd|rd|th)\b/g, '$1');

  // Convert spoken English grade words ("ten", "ninth", "twelve")
  const tokens = s.split(' ').filter(Boolean);
  const mapped: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const prev = i > 0 ? mapped[mapped.length - 1] : '';
    const next = i + 1 < tokens.length ? tokens[i + 1] : '';

    // Normalize "g 3 301" -> "g3 301"
    if (tok === 'g' && next === '3') {
      mapped.push('g3');
      i += 1;
      continue;
    }

    // Word numbers -> digits
    if (WORD_NUMBER_TO_DIGIT[tok]) {
      mapped.push(WORD_NUMBER_TO_DIGIT[tok]);
      continue;
    }

    // Spoken section letter homophones only right after a grade digit (e.g. "10 bee" -> "10 b")
    if (SPOKEN_SECTION_ALIASES[tok] && /^(1[0-2]|[1-9])$/.test(prev)) {
      mapped.push(SPOKEN_SECTION_ALIASES[tok]);
      continue;
    }

    // Standalone Roman numerals (longest first already handled by exact key match)
    const upper = tok.toUpperCase();
    if (
      upper === 'XII' ||
      upper === 'XI' ||
      upper === 'IX' ||
      upper === 'VIII' ||
      upper === 'VII' ||
      upper === 'VI' ||
      upper === 'IV' ||
      upper === 'III' ||
      upper === 'II' ||
      upper === 'X'
    ) {
      mapped.push(ROMAN_TO_NUMBER[upper]);
      continue;
    }

    // "v" or "i" only convert when preceded by class/room/grade/std or followed by a single section letter
    if ((upper === 'V' || upper === 'I') && (prev === 'class' || prev === 'room' || prev === 'grade' || prev === 'standard' || /^[a-f]$/.test(next))) {
      mapped.push(ROMAN_TO_NUMBER[upper]);
      continue;
    }

    mapped.push(tok);
  }

  return mapped.join(' ').replace(/\s+/g, ' ').trim();
}
