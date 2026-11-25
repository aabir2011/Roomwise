/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatRoomNameForSpeech } from './voicePronunciation.ts';

/**
 * Canonical ROOMWISE Terminology, Proper-Noun, Number/Unit & Spoken-vs-Written Layer.
 *
 * Strictly separates five distinct representations:
 *  1. Raw STT / user utterance
 *  2. Normalised canonical input text (for semantic NLU & entity extraction)
 *  3. Structured entities (institution, building, classroom, period, metrics)
 *  4. Final written text (for UI transcripts, cards, reports — preserves 3D, G+3, X-B, D A V Model School, 540 W, 10,080 kWh, ₹70,560, 1.29 years)
 *  5. Spoken TTS text (for natural pronunciation — "D-A-V Model School", "Class 10-B", "G plus 3 Block", etc.)
 */

export const CANONICAL_INSTITUTION_NAME = 'D A V Model School';
export const CANONICAL_CAMPUS_FULL_NAME = 'D A V Model School, IIT Kharagpur';

export const CANONICAL_BUILDINGS = [
  'G+3 Block',
  'New Building',
  'Old Building',
  'Pre-Primary Block',
  'Multipurpose Hall',
] as const;

export type CanonicalBuildingName = (typeof CANONICAL_BUILDINGS)[number];

const BUILDING_ALIASES: Array<{ canonical: CanonicalBuildingName; patterns: RegExp[] }> = [
  {
    canonical: 'G+3 Block',
    patterns: [
      /\bg\s*(?:\+|plus)\s*(?:3|three)\s*(?:block|building)?\b/i,
      /\bg3\s*(?:block|building)\b/i,
    ],
  },
  {
    canonical: 'New Building',
    patterns: [
      /\bnew\s+building\b/i,
      /(?<![a-z0-9])n\.?\s*b\.?(?:\s+block|\s+building)?(?![a-z0-9])/i,
    ],
  },
  {
    canonical: 'Old Building',
    patterns: [
      /\bold\s+building\b/i,
      /(?<![a-z0-9])o\.?\s*b\.?(?:\s+block|\s+building)?(?![a-z0-9])/i,
    ],
  },
  {
    canonical: 'Pre-Primary Block',
    patterns: [
      /\bpre[\s-]*primary(?:\s*(?:block|building|wing))?\b/i,
      /(?<![a-z0-9])p\.?\s*p\.?(?:\s+block|\s+building)?(?![a-z0-9])/i,
    ],
  },
  {
    canonical: 'Multipurpose Hall',
    patterns: [
      /\bmulti[\s-]*purpose\s+hall\b/i,
      /(?<![a-z0-9])m\.?\s*p\.?\s*h\.?(?![a-z0-9])/i,
    ],
  },
];

/**
 * Context-sensitive normalization of raw STT output or user text into canonical written form.
 * Fixes common speech-recognition confusions (e.g. "Davos Model School", "Dave Model School",
 * "room wise", "three-D", "G plus three", "R C E M", "P V G I S") ONLY in appropriate contexts
 * so unrelated everyday words are never corrupted.
 */
export function normalizeRawUtterance(raw: string): string {
  if (!raw) return '';
  let text = raw;

  // 1. Institution name: context-sensitive repair ONLY when coupled with "Model School" or "school"
  //    Fixes: "Davos Model School", "Dave Model School", "Davy Model School", "Dev Model School",
  //    "D.A.V. Model School", "D. A. V. Model School", "DAV Model School", "D-A-V Model School"
  text = text.replace(
    /\b(?:davos|dave|davy|david|dev|d\.?\s*a\.?\s*v\.?|d-a-v|dav)\s+model\s+school\b/gi,
    CANONICAL_INSTITUTION_NAME
  );
  // Also repair "Davos school" / "Dave school" / "D.A.V. school" when mentioning IIT Kharagpur or campus
  text = text.replace(
    /\b(?:davos|dave|davy|d\.?\s*a\.?\s*v\.?|d-a-v)\s+school(?=\s*,?\s*(?:iit|kharagpur|campus)|\b)/gi,
    CANONICAL_INSTITUTION_NAME
  );

  // 2. IIT Kharagpur
  text = text.replace(
    /\b(?:i\.?\s*i\.?\s*t\.?|eye\s+eye\s+tea)\s+(?:kharagpur|karagpur|kharakpur|kgp)\b/gi,
    'IIT Kharagpur'
  );

  // 3. Project name ROOMWISE
  text = text.replace(/\broom[\s-]+(?:wise|vice|eyes)\b/gi, 'ROOMWISE');
  text = text.replace(/\broomwise\b/gi, 'ROOMWISE');

  // 4. Technical notation: "three-D" / "three D" -> "3D" ONLY in technical/spatial contexts
  text = text.replace(
    /\bthree[\s-]+d(?=\s*(?:campus|digital|twin|model|view|map|replica|scene|layout|building|visuali[sz]ation|mode|campus\s+live|\b))/gi,
    '3D'
  );
  text = text.replace(/\b3[\s-]+d\b/gi, '3D');

  // 5. Building identifier: "G plus three" / "G plus 3" / "G+three" -> "G+3"
  text = text.replace(/\bg\s*(?:plus|\+)\s*(?:three|3)\b/gi, 'G+3');

  // 6. Acronyms & domain terms (context-safe)
  text = text.replace(/\br\.?\s*c\.?\s*e\.?\s*m\.?\b/gi, 'RCEM');
  text = text.replace(/\b(?:r[\s-]*cem|arcem|arsem|r\s+see\s+em)\b/gi, 'RCEM');
  text = text.replace(/\bp\.?\s*v\.?\s*g\.?\s*i\.?\s*s\.?\b/gi, 'PVGIS');
  text = text.replace(/\bpv[\s-]+gis\b/gi, 'PVGIS');
  text = text.replace(/\bb\.?\s*e\.?\s*e\.?(?=\s+(?:audit|report|rating|certif|guideline|standard|ecbc|compliance|star))/gi, 'BEE');
  text = text.replace(/\be\.?\s*c\.?\s*b\.?\s*c\.?\b/gi, 'ECBC');
  text = text.replace(/\bp\.?\s*i\.?\s*r\.?(?=\s+(?:sensor|motion|detect|grace|vacan|inactiv|node))/gi, 'PIR');
  text = text.replace(/\bl\.?\s*d\.?\s*r\.?(?=\s+(?:sensor|lux|light|daylight|read))/gi, 'LDR');
  text = text.replace(/\bd\.?\s*h\.?\s*t\.?\s*(?:11|eleven)\b/gi, 'DHT11');
  text = text.replace(/\bm\.?\s*p\.?\s*h\.?(?=\s*(?:block|hall|building|roof|load|power|area|,|\.|\?|$))/gi, 'MPH');
  text = text.replace(/\bcampus\s+live\b/gi, 'CAMPUS LIVE');
  text = text.replace(/\bdigital\s+twin\b/gi, 'Digital Twin');

  // 7. Classroom Roman numeral normalization in written form (preserve X-B, IX-A, XII-A when spoken as "X B" / "ex b")
  text = text.replace(/\b(Class|Room)\s+(XII|XI|IX|VIII|VII|VI|IV|III|II|X)\s+([A-F])\b/g, '$1 $2-$3');

  return text;
}

/**
 * Canonicalizes final written display text (assistant responses, transcripts, summaries)
 * without corrupting unrelated prose, numbers, or units.
 *
 * Guarantees:
 * - "D A V Model School" (never "Davos Model School", "Dave Model School", or "DAV Model School")
 * - "3D" (never "three-D" in technical labels)
 * - "G+3" (never "G plus three" in building labels)
 * - Preserves "X-B", "RCEM", "PVGIS", "PIR", "LDR", "DHT11", "BEE", "kWh", "kW", "W", "₹"
 * - Preserves numeric precision and never conflates W with Wh or kW with kWh
 */
export function canonicalizeWrittenText(text: string): string {
  if (!text) return '';

  let out = normalizeRawUtterance(text);

  // Normalize spoken unit spellings only when immediately preceded by a numeric figure
  // e.g., "10,080 kilowatt-hours" -> "10,080 kWh", "540 watts" -> "540 W", "13.39 kilowatts" -> "13.39 kW"
  out = out.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s+kilowatt[\s-]*hours?\b/gi, '$1 kWh');
  out = out.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s+watt[\s-]*hours?\b/gi, '$1 Wh');
  out = out.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s+kilowatts?\b/gi, '$1 kW');
  out = out.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s+watts?\b/gi, '$1 W');
  out = out.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s+kilowatt[\s-]*peak\b/gi, '$1 kWp');

  // Fix lowercase unit typos right after numbers ("540 w" -> "540 W", "10.5 kwh" -> "10.5 kWh", "4.2 kw" -> "4.2 kW")
  out = out.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s*kwh\b/gi, '$1 kWh');
  out = out.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s*kwp\b/gi, '$1 kWp');
  out = out.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s*kw\b/gi, '$1 kW');
  out = out.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s*wh\b/gi, '$1 Wh');
  out = out.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s+w\b/g, '$1 W');

  // Ensure standard rupee notation when written as "Rs. 70,560" or "INR 70,560"
  out = out.replace(/\b(?:Rs\.?|INR)\s*(\d+(?:,\d+)*(?:\.\d+)?)/g, '₹$1');

  // Clean up any accidental "three-D" / "Three-D" anywhere in technical UI text
  out = out.replace(/\bthree[\s-]d\b/gi, '3D');

  // Ensure canonical spacing of "D A V Model School" (never bare "DAV Model School")
  out = out.replace(/\bDAV\s+Model\s+School\b/g, CANONICAL_INSTITUTION_NAME);

  return out;
}

/**
 * Converts canonical written text into a natural spoken TTS representation
 * WITHOUT mutating the underlying written display text.
 *
 * Examples:
 * - "D A V Model School" -> "D-A-V Model School"
 * - "Class X-B" -> "Class 10-B"
 * - "G+3 Block" -> "G plus 3 Block"
 * - "3D Digital Twin" -> "three-D Digital Twin"
 * - "540 W" -> "540 watts"
 * - "10,080 kWh" -> "10,080 kilowatt-hours"
 * - "₹70,560" -> "70,560 rupees"
 * - "RCEM" -> "R-C-E-M"
 * - "PVGIS" -> "P-V-G-I-S"
 */
export function formatTextForSpeech(writtenText: string): string {
  if (!writtenText) return '';

  // First apply Roman class numeral conversion ("Class X-B" -> "Class 10-B")
  let spoken = formatRoomNameForSpeech(writtenText);

  // Institution name: pronounce letter by letter "D-A-V Model School"
  spoken = spoken.replace(/\bD\s+A\s+V\s+Model\s+School\b/g, 'D-A-V Model School');
  spoken = spoken.replace(/\bDAV\s+Model\s+School\b/g, 'D-A-V Model School');

  // Building identifier G+3 -> "G plus 3" for speech only
  spoken = spoken.replace(/\bG\+3\b/g, 'G plus 3');

  // Technical acronyms that TTS engines frequently slur or misread
  spoken = spoken.replace(/\bIIT\b/g, 'I-I-T');
  spoken = spoken.replace(/\bRCEM\b/g, 'R-C-E-M');
  spoken = spoken.replace(/\bPVGIS\b/g, 'P-V-G-I-S');
  spoken = spoken.replace(/\bECBC\b/g, 'E-C-B-C');
  spoken = spoken.replace(/\bBEE\b/g, 'B-E-E');
  spoken = spoken.replace(/\bPIR\b/g, 'P-I-R');
  spoken = spoken.replace(/\bLDR\b/g, 'L-D-R');
  spoken = spoken.replace(/\bDHT11\b/g, 'D-H-T eleven');
  spoken = spoken.replace(/\bMPH\b/g, 'Multipurpose Hall');

  // 3D -> natural spoken form without touching written text
  spoken = spoken.replace(/\b3D\b/g, 'three-D');

  // Currency & energy/power units for clear spoken delivery
  spoken = spoken.replace(/₹\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*\/\s*kWh\b/gi, '$1 rupees per kilowatt-hour');
  spoken = spoken.replace(/₹\s*(\d+(?:,\d+)*(?:\.\d+)?)/g, '$1 rupees');
  spoken = spoken.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s*kWp\b/g, '$1 kilowatt-peak');
  spoken = spoken.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s*kWh\s*\/\s*(?:yr|year)\b/gi, '$1 kilowatt-hours per year');
  spoken = spoken.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s*kWh\b/g, '$1 kilowatt-hours');
  spoken = spoken.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s*kW\b/g, '$1 kilowatts');
  spoken = spoken.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s*Wh\b/g, '$1 watt-hours');
  spoken = spoken.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s*W\b/g, '$1 watts');
  spoken = spoken.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s*m²(?=\s|$|[.,;:)])/g, '$1 square meters');
  spoken = spoken.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s*ft²(?=\s|$|[.,;:)])/g, '$1 square feet');
  spoken = spoken.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s*°C\b/g, '$1 degrees Celsius');
  spoken = spoken.replace(/µg\/m³/g, 'micrograms per cubic meter');
  // Mathematical & chemical notation for natural spoken delivery (never mutates written display text)
  spoken = spoken.replace(/CO₂/g, 'C-O-2');
  spoken = spoken.replace(/\bCO2\b/g, 'C-O-2');
  spoken = spoken.replace(/Σ_?\{?[^}\s]*\}?/g, 'sum of ');
  spoken = spoken.replace(/∫_?\{?[^}\s]*\}?\^?\{?[^}\s]*\}?/g, 'integral of ');
  spoken = spoken.replace(/Δt_?i?/g, 'delta t');
  spoken = spoken.replace(/×/g, ' times ');
  spoken = spoken.replace(/−/g, ' minus ');

  return spoken.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Extracts a canonical ROOMWISE building name from natural language, if present.
 */
export function extractBuildingEntity(text: string): CanonicalBuildingName | null {
  if (!text) return null;
  const normalized = normalizeRawUtterance(text);
  for (const entry of BUILDING_ALIASES) {
    if (entry.patterns.some((p) => p.test(normalized))) {
      return entry.canonical;
    }
  }
  return null;
}

/**
 * Extracts all distinct canonical buildings mentioned in an utterance (e.g. for "Compare OB and NB").
 */
export function extractAllBuildingEntities(text: string): CanonicalBuildingName[] {
  if (!text) return [];
  const normalized = normalizeRawUtterance(text);
  const found: CanonicalBuildingName[] = [];
  for (const entry of BUILDING_ALIASES) {
    if (entry.patterns.some((p) => p.test(normalized))) {
      found.push(entry.canonical);
    }
  }
  return found;
}

/**
 * Detects an explicitly impossible calendar date in user input (e.g. "2026-02-31", "February 30", "2026-13-01")
 * so the assistant reports an honest invalid-date explanation instead of silently querying a wrong window.
 */
export function detectInvalidExplicitDate(text: string): string | null {
  if (!text) return null;
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return isoMatch[0];
    }
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
      probe.getUTCFullYear() !== year ||
      probe.getUTCMonth() + 1 !== month ||
      probe.getUTCDate() !== day
    ) {
      return isoMatch[0];
    }
  }

  const namedMatch = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/i
  );
  if (namedMatch) {
    const monthMap: Record<string, number> = {
      january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
      july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    };
    const month = monthMap[namedMatch[1].toLowerCase()];
    const day = Number(namedMatch[2]);
    const year = namedMatch[3] ? Number(namedMatch[3]) : new Date().getUTCFullYear();
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
      day < 1 ||
      day > 31 ||
      probe.getUTCMonth() + 1 !== month ||
      probe.getUTCDate() !== day
    ) {
      return namedMatch[0];
    }
  }

  return null;
}

/**
 * Extracts a canonical ROOMWISE time-period identifier from natural language.
 */
export function extractTimePeriodEntity(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();

  // Explicit ISO date (YYYY-MM-DD) when valid
  const isoMatch = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch && !detectInvalidExplicitDate(isoMatch[1])) {
    return isoMatch[1];
  }

  // Relative shifts — MUST be checked BEFORE bare "yesterday" so "day before yesterday" is never misread
  if (/\b(day before yesterday|2 days ago|two days ago)\b/.test(lower)) {
    return 'day_before_yesterday';
  }
  if (/\b(3 days ago|three days ago)\b/.test(lower)) {
    return '3_days_ago';
  }
  if (/\b(the day before|previous day|preceding day|day prior|a day earlier|the prior day)\b/.test(lower)) {
    return 'relative_previous_day';
  }

  if (/\b(previous month|last month|past month|prior month)\b/.test(lower)) return 'previous_month';
  if (/\b(this month|current month|month to date)\b/.test(lower)) return 'this_month';
  if (/\b(last 30 days|past 30 days|30 days|thirty days)\b/.test(lower)) return 'last_30_days';
  if (/\b(last week|previous week|prior week)\b/.test(lower)) return 'previous_week';
  if (/\b(this week|last 7 days|past 7 days|past week|7 days|seven days)\b/.test(lower)) return 'last_7_days';
  if (/\byesterday\b/.test(lower)) return 'yesterday';
  if (/\btoday\b/.test(lower)) return 'today';

  // Explicit month names (e.g. "October", "September")
  const monthMatch = lower.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/
  );
  if (monthMatch) return monthMatch[1];

  return null;
}

/**
 * Forbidden placeholder / malformed output patterns that must NEVER appear in an assistant response.
 */
const FORBIDDEN_PLACEHOLDER_PATTERNS: RegExp[] = [
  /\bcalculated\s+(?:kwh|kw|wh|w|value|amount|total|energy|consumption)\b/i,
  /\b(?:undefined|NaN)\s*(?:kwh|kw|wh|w|%|°c|ppm|lux|m²|₹)?\b/,
  /\[\s*(?:value|building|room|result|number|date|amount|kwh|placeholder)\s*\]/i,
  /\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}/,
  /\\(?:frac|sum|int|left|right|times|text)\b/,
  /^\s*[\[{]\s*"[a-zA-Z0-9_]+"/,
];

export function hasForbiddenResponsePlaceholder(text: string): boolean {
  if (!text || !text.trim()) return true;
  return FORBIDDEN_PLACEHOLDER_PATTERNS.some((re) => re.test(text));
}

/**
 * Cleans up accidental LaTeX formatting and validates that an assistant response contains
 * no unfilled template tokens, placeholder strings ("calculated kWh"), or raw JSON dumps.
 */
export function validateAndSanitizeAssistantResponse(
  rawText: string,
  fallbackMessage = 'I was unable to retrieve complete data for that request right now. Please try again or specify the building, classroom, or date window.'
): { text: string; hadPlaceholder: boolean } {
  if (!rawText || !rawText.trim()) {
    return { text: fallbackMessage, hadPlaceholder: true };
  }

  let cleaned = rawText
    .replace(/\\\[|\\\]|\\\(|\\\)/g, '')
    .replace(/\\times\b/g, '×')
    .replace(/\\Delta\b/g, 'Δ')
    .replace(/\\sum\b/g, 'Σ')
    .replace(/\\int\b/g, '∫')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (hasForbiddenResponsePlaceholder(cleaned)) {
    return { text: fallbackMessage, hadPlaceholder: true };
  }

  return { text: canonicalizeWrittenText(cleaned), hadPlaceholder: false };
}

/**
 * Formats a compact number with standard grouping without losing decimal precision.
 */
export function formatCompactNumber(value: number, maxFractionDigits = 2): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}
