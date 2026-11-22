/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BuildingPolygon,
  GeoPoint,
  SchoolBoundaryContext,
} from '../src/types/solar.ts';

const PRIMARY_OVERPASS_ENDPOINT =
  (process.env.ROOMWISE_OVERPASS_URL || 'https://overpass-api.de/api/interpreter').trim();
const FALLBACK_OVERPASS_ENDPOINT =
  (process.env.ROOMWISE_OVERPASS_FALLBACK_URL || 'https://overpass.kumi.systems/api/interpreter').trim();

const OVERPASS_TIMEOUT_MS = 28_000;
const OVERPASS_QUERY_TIMEOUT_SEC = 25;

// WGS84 ellipsoid constants for accurate local tangent-plane metric area calculations
const WGS84_A = 6378137.0; // semi-major axis (m)
const WGS84_E2 = 0.006694379990141316; // first eccentricity squared

export interface RawDiscoveredOsmBuilding {
  id: string; // e.g., "way/123456" or "relation/78901"
  osmType: 'way' | 'relation';
  osmId: string;
  osmName: string | null;
  buildingType: string | null;
  levels: number | null;
  heightMeters: number | null;
  tags: Record<string, string>;
  polygons: BuildingPolygon[];
  centroid: GeoPoint;
  grossFootprintAreaM2: number;
  componentCount: number;
  hasInvalidGeometryWarning: boolean;
  distanceFromCampusMeters: number;
  insideSchoolBoundary: boolean;
  duplicateOverlapNote: string | null;
}

export interface OverpassDiscoveryPayload {
  endpointUsed: string;
  campusLat: number;
  campusLon: number;
  searchRadiusMeters: number;
  buildings: RawDiscoveredOsmBuilding[];
  schoolBoundaries: SchoolBoundaryContext[];
  fetchedAtMs: number;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine distance in metres between two WGS84 points.
 */
export function haversineDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = degToRad(b.lat - a.lat);
  const dLon = degToRad(b.lon - a.lon);
  const lat1 = degToRad(a.lat);
  const lat2 = degToRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  return WGS84_A * c;
}

/**
 * Local tangent-plane metric projection (meters East/North) using WGS84 meridional
 * and prime-vertical radii of curvature at reference latitude.
 */
export function projectPointMeters(
  pt: GeoPoint,
  ref: GeoPoint
): { x: number; y: number } {
  const phi = degToRad(ref.lat);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const denom = Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  const primeVerticalRadius = WGS84_A / denom;
  const meridionalRadius =
    (WGS84_A * (1 - WGS84_E2)) / Math.pow(1 - WGS84_E2 * sinPhi * sinPhi, 1.5);

  const x = degToRad(pt.lon - ref.lon) * primeVerticalRadius * cosPhi;
  const y = degToRad(pt.lat - ref.lat) * meridionalRadius;
  return { x, y };
}

/**
 * Computes exact polygon ring area in square metres on the local WGS84 tangent plane.
 */
export function computeRingAreaM2(ring: GeoPoint[]): number {
  if (!Array.isArray(ring) || ring.length < 3) return 0;

  // Reference point at mean vertex position to minimize projection distortion
  let sumLat = 0;
  let sumLon = 0;
  for (const p of ring) {
    sumLat += p.lat;
    sumLon += p.lon;
  }
  const ref: GeoPoint = {
    lat: sumLat / ring.length,
    lon: sumLon / ring.length,
  };

  const pts = ring.map((p) => projectPointMeters(p, ref));
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    area2 += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(area2) / 2;
}

/**
 * Computes total net area in square metres across one or more polygon components (outer minus holes).
 */
export function computePolygonsAreaM2(polygons: BuildingPolygon[]): {
  areaM2: number;
  hasInvalid: boolean;
} {
  let total = 0;
  let hasInvalid = false;

  for (const poly of polygons) {
    if (!poly.outer || poly.outer.length < 3) {
      hasInvalid = true;
      continue;
    }
    const outerArea = computeRingAreaM2(poly.outer);
    if (!Number.isFinite(outerArea) || outerArea <= 0.2) {
      hasInvalid = true;
      continue;
    }
    let holesArea = 0;
    if (Array.isArray(poly.holes)) {
      for (const hole of poly.holes) {
        if (hole.length >= 3) {
          holesArea += computeRingAreaM2(hole);
        }
      }
    }
    total += Math.max(0, outerArea - holesArea);
  }

  return { areaM2: Number(total.toFixed(2)), hasInvalid };
}

/**
 * Computes weighted centroid of a set of polygons.
 */
export function computePolygonsCentroid(polygons: BuildingPolygon[]): GeoPoint {
  let weightedLat = 0;
  let weightedLon = 0;
  let totalWeight = 0;

  for (const poly of polygons) {
    const ring = poly.outer;
    if (!ring || ring.length === 0) continue;
    // Ignore closing duplicate vertex if present
    const count =
      ring.length > 1 &&
      Math.abs(ring[0].lat - ring[ring.length - 1].lat) < 1e-7 &&
      Math.abs(ring[0].lon - ring[ring.length - 1].lon) < 1e-7
        ? ring.length - 1
        : ring.length;
    if (count <= 0) continue;

    let latSum = 0;
    let lonSum = 0;
    for (let i = 0; i < count; i++) {
      latSum += ring[i].lat;
      lonSum += ring[i].lon;
    }
    const w = Math.max(1, computeRingAreaM2(ring));
    weightedLat += (latSum / count) * w;
    weightedLon += (lonSum / count) * w;
    totalWeight += w;
  }

  if (totalWeight <= 0) {
    return { lat: 22.3121, lon: 87.2994 };
  }
  return {
    lat: Number((weightedLat / totalWeight).toFixed(6)),
    lon: Number((weightedLon / totalWeight).toFixed(6)),
  };
}

function pointInRing(pt: GeoPoint, ring: GeoPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lon;
    const yi = ring[i].lat;
    const xj = ring[j].lon;
    const yj = ring[j].lat;
    const intersect =
      yi > pt.lat !== yj > pt.lat &&
      pt.lon < ((xj - xi) * (pt.lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygons(pt: GeoPoint, polygons: BuildingPolygon[]): boolean {
  for (const poly of polygons) {
    if (!pointInRing(pt, poly.outer)) continue;
    const inHole = (poly.holes || []).some((h) => pointInRing(pt, h));
    if (!inHole) return true;
  }
  return false;
}

function pointsClose(a: GeoPoint, b: GeoPoint): boolean {
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;
}

/**
 * Stitches open way segments (common in OSM multipolygon relations) into closed polygon rings.
 */
function stitchSegmentsIntoRings(segments: GeoPoint[][]): GeoPoint[][] {
  const remaining = segments
    .filter((s) => Array.isArray(s) && s.length >= 2)
    .map((s) => s.slice());
  const rings: GeoPoint[][] = [];

  while (remaining.length > 0) {
    const current = remaining.shift()!;
    if (current.length >= 4 && pointsClose(current[0], current[current.length - 1])) {
      rings.push(current);
      continue;
    }

    let merged = true;
    while (merged && remaining.length > 0) {
      merged = false;
      const head = current[0];
      const tail = current[current.length - 1];
      if (current.length >= 4 && pointsClose(head, tail)) break;

      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i];
        const segStart = seg[0];
        const segEnd = seg[seg.length - 1];

        if (pointsClose(tail, segStart)) {
          current.push(...seg.slice(1));
          remaining.splice(i, 1);
          merged = true;
          break;
        } else if (pointsClose(tail, segEnd)) {
          current.push(...seg.slice(0, -1).reverse());
          remaining.splice(i, 1);
          merged = true;
          break;
        } else if (pointsClose(head, segEnd)) {
          current.unshift(...seg.slice(0, -1));
          remaining.splice(i, 1);
          merged = true;
          break;
        } else if (pointsClose(head, segStart)) {
          current.unshift(...seg.slice(1).reverse());
          remaining.splice(i, 1);
          merged = true;
          break;
        }
      }
    }

    if (current.length >= 3) {
      // Ensure closed ring
      if (!pointsClose(current[0], current[current.length - 1])) {
        current.push({ ...current[0] });
      }
      rings.push(current);
    }
  }

  return rings;
}

function parseGeometryArray(rawGeom: any): GeoPoint[] {
  if (!Array.isArray(rawGeom)) return [];
  const pts: GeoPoint[] = [];
  for (const g of rawGeom) {
    if (typeof g?.lat === 'number' && typeof g?.lon === 'number' && Number.isFinite(g.lat) && Number.isFinite(g.lon)) {
      pts.push({ lat: g.lat, lon: g.lon });
    }
  }
  return pts;
}

function extractElementPolygons(el: any): BuildingPolygon[] {
  if (el.type === 'way') {
    const pts = parseGeometryArray(el.geometry);
    if (pts.length < 3) return [];
    if (!pointsClose(pts[0], pts[pts.length - 1])) {
      pts.push({ ...pts[0] });
    }
    return [{ outer: pts }];
  }

  if (el.type === 'relation' && Array.isArray(el.members)) {
    const outerSegs: GeoPoint[][] = [];
    const innerSegs: GeoPoint[][] = [];

    for (const member of el.members) {
      if (member?.type !== 'way' || !Array.isArray(member.geometry)) continue;
      const pts = parseGeometryArray(member.geometry);
      if (pts.length < 2) continue;
      if (member.role === 'inner') {
        innerSegs.push(pts);
      } else {
        // Default empty role or 'outer' or 'part' treated as outer ring
        outerSegs.push(pts);
      }
    }

    const outerRings = stitchSegmentsIntoRings(outerSegs);
    const innerRings = stitchSegmentsIntoRings(innerSegs);

    return outerRings.map((outer) => {
      const assignedHoles = innerRings.filter(
        (inner) => inner.length >= 3 && pointInRing(inner[0], outer)
      );
      return {
        outer,
        holes: assignedHoles.length > 0 ? assignedHoles : undefined,
      };
    });
  }

  return [];
}

function parseNumericTag(raw: string | undefined): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/[^\d.\-+]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Converts OpenStreetMap `roof:direction` (compass bearing: 0°/360°=N, 90°=E, 180°=S, 270°=W
 * or cardinal string N/NE/E/SE/S/SW/W/NW) to PVGIS aspect (-180..+180 where 0°=South, -90°=East, +90°=West).
 * NOTE: Does NOT convert `roof:orientation` (which describes ridge orientation, not panel facing direction).
 */
export function parseOsmRoofDirectionToPvgisAspect(raw: string | null | undefined): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  const cardinalCompass: Record<string, number> = {
    N: 0,
    NNE: 22.5,
    NE: 45,
    ENE: 67.5,
    E: 90,
    ESE: 112.5,
    SE: 135,
    SSE: 157.5,
    S: 180,
    SSW: 202.5,
    SW: 225,
    WSW: 247.5,
    W: 270,
    WNW: 292.5,
    NW: 315,
    NNW: 337.5,
  };

  let compassDeg: number | null = null;
  if (upper in cardinalCompass) {
    compassDeg = cardinalCompass[upper];
  } else {
    const parsed = parseNumericTag(upper);
    if (parsed !== null) {
      compassDeg = ((parsed % 360) + 360) % 360;
    }
  }
  if (compassDeg === null) return null;

  // Convert compass bearing (180° = South, 90° = East, 270° = West) to PVGIS aspect (0° = South, -90° = East, +90° = West)
  let aspect = compassDeg - 180;
  if (aspect > 180) aspect -= 360;
  if (aspect < -180) aspect += 360;
  return Math.round(aspect);
}

async function queryOverpassSingleEndpoint(
  endpoint: string,
  qlQuery: string
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json',
        'User-Agent': 'ROOMWISE-Campus-Energy-Monitor/1.0 (DAV Model School IIT KGP)',
      },
      body: `data=${encodeURIComponent(qlQuery)}`,
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok || !parsed || !Array.isArray(parsed.elements)) {
      const reason =
        res.status === 429
          ? 'OpenStreetMap Overpass API rate limit reached (HTTP 429).'
          : res.status === 504 || res.status === 503
          ? `Overpass server busy (HTTP ${res.status}).`
          : `Overpass endpoint returned HTTP ${res.status}.`;
      return { ok: false, status: res.status, data: null, error: reason };
    }
    return { ok: true, status: res.status, data: parsed };
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      data: null,
      error: isAbort
        ? 'OpenStreetMap Overpass request timed out.'
        : err?.message || 'Network error querying Overpass API.',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executes a single campus-area Overpass QL query retrieving all mapped buildings
 * (ways & relations/multipolygons) and optional school boundaries around campus coordinates.
 */
export async function discoverBuildingsViaOverpass(params: {
  latitude: number;
  longitude: number;
  searchRadiusMeters: number;
}): Promise<{ ok: boolean; payload: OverpassDiscoveryPayload | null; error?: string }> {
  const radius = Math.max(100, Math.min(2000, Math.round(params.searchRadiusMeters)));
  const lat = Number(params.latitude.toFixed(6));
  const lon = Number(params.longitude.toFixed(6));

  const ql = `
[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_SEC}];
(
  way["building"](around:${radius},${lat},${lon});
  relation["building"](around:${radius},${lat},${lon});
  way["amenity"="school"](around:${radius},${lat},${lon});
  relation["amenity"="school"](around:${radius},${lat},${lon});
);
out body geom;
`.trim();

  const endpoints = [PRIMARY_OVERPASS_ENDPOINT];
  if (FALLBACK_OVERPASS_ENDPOINT && FALLBACK_OVERPASS_ENDPOINT !== PRIMARY_OVERPASS_ENDPOINT) {
    endpoints.push(FALLBACK_OVERPASS_ENDPOINT);
  }

  let response: { ok: boolean; status: number; data: any; error?: string } = {
    ok: false,
    status: 0,
    data: null,
    error: 'No Overpass endpoints configured.',
  };
  let endpointUsed = PRIMARY_OVERPASS_ENDPOINT;

  for (let i = 0; i < endpoints.length; i++) {
    endpointUsed = endpoints[i];
    response = await queryOverpassSingleEndpoint(endpointUsed, ql);
    if (response.ok) break;
    // Brief polite backoff before trying secondary Overpass mirror on transient errors
    if (i < endpoints.length - 1) {
      await new Promise((r) => setTimeout(r, 900));
    }
  }

  if (!response.ok || !response.data) {
    return { ok: false, payload: null, error: response.error };
  }

  const elements: any[] = response.data.elements || [];
  const campusRef: GeoPoint = { lat, lon };

  // 1. Extract school boundary polygons first (supporting context only)
  const schoolBoundaries: SchoolBoundaryContext[] = [];
  for (const el of elements) {
    const tags: Record<string, string> = el?.tags && typeof el.tags === 'object' ? el.tags : {};
    if (tags.amenity === 'school' && !tags.building) {
      const polygons = extractElementPolygons(el);
      if (polygons.length > 0) {
        const { areaM2 } = computePolygonsAreaM2(polygons);
        if (areaM2 > 20) {
          schoolBoundaries.push({
            osmId: `${el.type}/${el.id}`,
            name: tags.name || tags['name:en'] || null,
            polygons,
            areaM2,
          });
        }
      }
    }
  }

  // 2. Extract building footprints (ways and relations)
  const seenIds = new Set<string>();
  const buildings: RawDiscoveredOsmBuilding[] = [];

  for (const el of elements) {
    const tags: Record<string, string> = el?.tags && typeof el.tags === 'object' ? el.tags : {};
    if (!tags.building) continue;
    if (el.type !== 'way' && el.type !== 'relation') continue;

    const id = `${el.type}/${el.id}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const polygons = extractElementPolygons(el);
    if (polygons.length === 0) continue;

    const { areaM2, hasInvalid } = computePolygonsAreaM2(polygons);
    if (areaM2 < 4) continue; // Ignore degenerate micro-artifacts < 4 m²

    const centroid = computePolygonsCentroid(polygons);
    const distanceFromCampusMeters = Math.round(haversineDistanceMeters(campusRef, centroid));
    const insideSchoolBoundary = schoolBoundaries.some((b) =>
      pointInPolygons(centroid, b.polygons)
    );

    const levelsRaw = parseNumericTag(tags['building:levels']);
    const heightRaw = parseNumericTag(tags.height || tags['building:height']);

    buildings.push({
      id,
      osmType: el.type,
      osmId: String(el.id),
      osmName: tags.name || tags['name:en'] || tags.ref || null,
      buildingType: tags.building || null,
      levels: levelsRaw !== null && levelsRaw > 0 ? Math.round(levelsRaw) : null,
      heightMeters: heightRaw !== null && heightRaw > 0 ? Number(heightRaw.toFixed(1)) : null,
      tags,
      polygons,
      centroid,
      grossFootprintAreaM2: areaM2,
      componentCount: polygons.length,
      hasInvalidGeometryWarning: hasInvalid,
      distanceFromCampusMeters,
      insideSchoolBoundary,
      duplicateOverlapNote: null,
    });
  }

  // 3. Detect potential duplicate / overlapping building footprints
  for (let i = 0; i < buildings.length; i++) {
    for (let j = i + 1; j < buildings.length; j++) {
      const a = buildings[i];
      const b = buildings[j];
      const dist = haversineDistanceMeters(a.centroid, b.centroid);
      if (dist <= 4.5) {
        const ratio =
          Math.min(a.grossFootprintAreaM2, b.grossFootprintAreaM2) /
          Math.max(1, Math.max(a.grossFootprintAreaM2, b.grossFootprintAreaM2));
        if (ratio >= 0.75) {
          const noteA = `Possible overlap/duplicate with ${b.id} (${dist.toFixed(1)} m apart). Review before confirming both.`;
          const noteB = `Possible overlap/duplicate with ${a.id} (${dist.toFixed(1)} m apart). Review before confirming both.`;
          a.duplicateOverlapNote = a.duplicateOverlapNote || noteA;
          b.duplicateOverlapNote = b.duplicateOverlapNote || noteB;
        }
      }
    }
  }

  // Sort closest to campus first (with inside-school-boundary prioritized among nearby buildings)
  buildings.sort((a, b) => {
    if (a.insideSchoolBoundary !== b.insideSchoolBoundary) {
      return a.insideSchoolBoundary ? -1 : 1;
    }
    return a.distanceFromCampusMeters - b.distanceFromCampusMeters;
  });

  return {
    ok: true,
    payload: {
      endpointUsed,
      campusLat: lat,
      campusLon: lon,
      searchRadiusMeters: radius,
      buildings,
      schoolBoundaries,
      fetchedAtMs: Date.now(),
    },
  };
}
