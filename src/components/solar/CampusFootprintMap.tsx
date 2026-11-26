/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Compass,
  Grid2x2,
  Layers,
  Maximize2,
  Minus,
  PenTool,
  Plus,
  Undo2,
  X,
} from 'lucide-react';
import { ActionButton, IconButton, SegmentedControl } from '../common/DesignSystem';
import type {
  BuildingPolygon,
  CampusVisualOverlay,
  DiscoveredBuilding,
  GeoPoint,
  SchoolBoundaryContext,
} from '../../types/solar';

const WGS84_A = 6378137.0;
const WGS84_E2 = 0.006694379990141316;
const MAP_ASPECT = 16 / 10;
const MIN_HALF_SPAN = 26;
const MAX_HALF_SPAN = 520;
const INITIAL_VIEW_BOX = { cx: 8, cy: 4, halfSpan: 102 };

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function getLocalMetricScale(refLat: number): { metersPerDegLon: number; metersPerDegLat: number } {
  const phi = degToRad(refLat);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const primeVertical = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  const meridional =
    (WGS84_A * (1 - WGS84_E2)) / Math.pow(1 - WGS84_E2 * sinPhi * sinPhi, 1.5);
  return {
    metersPerDegLon: (Math.PI / 180) * primeVertical * cosPhi,
    metersPerDegLat: (Math.PI / 180) * meridional,
  };
}

function computeDraftAreaM2(points: Array<{ x: number; y: number }>): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

interface Pt2 {
  x: number;
  y: number;
}

function ringToSvgPts(
  ring: GeoPoint[],
  project: (pt: GeoPoint) => { x: number; y: number }
): Pt2[] {
  return ring.map((pt) => {
    const p = project(pt);
    return { x: p.x, y: -p.y };
  });
}

function ptsToPath(pts: Pt2[], offsetX = 0, offsetY = 0): string {
  if (pts.length < 3) return '';
  return (
    pts
      .map(
        (p, i) => `${i === 0 ? 'M' : 'L'}${(p.x + offsetX).toFixed(2)},${(p.y + offsetY).toFixed(2)}`
      )
      .join(' ') + ' Z'
  );
}

function polygonToSvgPath(
  poly: BuildingPolygon,
  project: (pt: GeoPoint) => { x: number; y: number },
  offsetX = 0,
  offsetY = 0
): string {
  let d = ptsToPath(ringToSvgPts(poly.outer, project), offsetX, offsetY);
  if (Array.isArray(poly.holes)) {
    for (const hole of poly.holes) {
      d += ' ' + ptsToPath(ringToSvgPts(hole, project), offsetX, offsetY);
    }
  }
  return d.trim();
}

function polylineToSvgPath(
  points: GeoPoint[],
  project: (pt: GeoPoint) => { x: number; y: number }
): string {
  if (points.length < 2) return '';
  return points
    .map((pt, i) => {
      const p = project(pt);
      return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${(-p.y).toFixed(2)}`;
    })
    .join(' ');
}

function computePolygonBounds(pts: Pt2[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
  };
}

function buildExtrusionWalls(
  outerPts: Pt2[],
  dx: number,
  dy: number
): Array<{ d: string; isSouthFace: boolean; start: Pt2; end: Pt2 }> {
  const walls: Array<{ d: string; isSouthFace: boolean; start: Pt2; end: Pt2 }> = [];
  if (outerPts.length < 3) return walls;

  for (let i = 0; i < outerPts.length - 1; i++) {
    const a = outerPts[i];
    const b = outerPts[i + 1];
    const edgeX = b.x - a.x;
    const edgeY = b.y - a.y;
    if (Math.hypot(edgeX, edgeY) < 0.5) continue;

    const d = `M${a.x.toFixed(2)},${a.y.toFixed(2)} L${b.x.toFixed(2)},${b.y.toFixed(2)} L${(
      b.x + dx
    ).toFixed(2)},${(b.y + dy).toFixed(2)} L${(a.x + dx).toFixed(2)},${(a.y + dy).toFixed(2)} Z`;

    const isSouthFace = Math.abs(edgeX) >= Math.abs(edgeY);
    walls.push({ d, isSouthFace, start: a, end: b });
  }
  return walls;
}

interface CampusFootprintMapProps {
  campusLat: number;
  campusLon: number;
  institutionName: string;
  searchRadiusMeters: number;
  campusLayout: CampusVisualOverlay;
  buildings: DiscoveredBuilding[];
  schoolBoundaries: SchoolBoundaryContext[];
  selectedBuildingId: string | null;
  onSelectBuilding: (buildingId: string) => void;
  isAdminUnlocked: boolean;
  onCreateDrawnBuilding?: (points: GeoPoint[], approxAreaM2: number) => void;
}

export const CampusFootprintMap: React.FC<CampusFootprintMapProps> = ({
  campusLat,
  campusLon,
  institutionName,
  searchRadiusMeters,
  campusLayout,
  buildings,
  schoolBoundaries,
  selectedBuildingId,
  onSelectBuilding,
  isAdminUnlocked,
  onCreateDrawnBuilding,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const scale = useMemo(() => getLocalMetricScale(campusLat), [campusLat]);

  const project = useMemo(
    () => (pt: GeoPoint) => ({
      x: (pt.lon - campusLon) * scale.metersPerDegLon,
      y: (pt.lat - campusLat) * scale.metersPerDegLat,
    }),
    [campusLat, campusLon, scale]
  );

  const unproject = useMemo(
    () => (xMeters: number, yMetersNorth: number): GeoPoint => ({
      lat: Number((campusLat + yMetersNorth / scale.metersPerDegLat).toFixed(6)),
      lon: Number((campusLon + xMeters / scale.metersPerDegLon).toFixed(6)),
    }),
    [campusLat, campusLon, scale]
  );

  const [viewBox, setViewBox] = useState<{ cx: number; cy: number; halfSpan: number }>(
    INITIAL_VIEW_BOX
  );
  const viewBoxRef = useRef(viewBox);
  viewBoxRef.current = viewBox;

  const [viewMode, setViewMode] = useState<'2.5d' | 'topdown'>('2.5d');
  const [showPvArrays, setShowPvArrays] = useState<boolean>(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    cx: number;
    cy: number;
    moved: boolean;
  } | null>(null);

  // Two-finger pinch zoom state for touchscreens
  const activeTouchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ dist: number; halfSpan: number; cx: number; cy: number } | null>(
    null
  );

  const [drawMode, setDrawMode] = useState(false);
  const [draftPoints, setDraftPoints] = useState<Array<{ x: number; y: number }>>([]);
  const draftAreaM2 = useMemo(() => computeDraftAreaM2(draftPoints), [draftPoints]);

  const vbWidth = viewBox.halfSpan * 2 * MAP_ASPECT;
  const vbHeight = viewBox.halfSpan * 2;
  const vbMinX = viewBox.cx - vbWidth / 2;
  const vbMinY = viewBox.cy - vbHeight / 2;

  const isZoomedIn = viewBox.halfSpan < INITIAL_VIEW_BOX.halfSpan - 2;

  // Native non-passive wheel listener: zooms smoothly around the cursor without scrolling the page.
  // Scrolling outside containerRef continues scrolling the page normally.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      // Normalize mouse-wheel & high-resolution trackpad deltas gently
      const modeMultiplier = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 120 : 1;
      const rawDelta = e.deltaY * modeMultiplier;
      const clampedDelta = Math.max(-160, Math.min(160, rawDelta));
      if (Math.abs(clampedDelta) < 0.25) return;

      const factor = Math.exp(clampedDelta * 0.00145);
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;

      setViewBox((prev) => {
        const nextHalfSpan = Math.max(
          MIN_HALF_SPAN,
          Math.min(MAX_HALF_SPAN, prev.halfSpan * factor)
        );
        if (Math.abs(nextHalfSpan - prev.halfSpan) < 0.001) return prev;

        const prevW = prev.halfSpan * 2 * MAP_ASPECT;
        const prevH = prev.halfSpan * 2;
        const prevMinX = prev.cx - prevW / 2;
        const prevMinY = prev.cy - prevH / 2;

        // Keep the world coordinate under the cursor pinned in place
        const worldX = prevMinX + relX * prevW;
        const worldY = prevMinY + relY * prevH;

        const nextW = nextHalfSpan * 2 * MAP_ASPECT;
        const nextH = nextHalfSpan * 2;
        const nextMinX = worldX - relX * nextW;
        const nextMinY = worldY - relY * nextH;

        return {
          cx: nextMinX + nextW / 2,
          cy: nextMinY + nextH / 2,
          halfSpan: nextHalfSpan,
        };
      });
    };

    container.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleNativeWheel);
    };
  }, []);

  const clientToSvgCoords = (
    clientX: number,
    clientY: number
  ): { x: number; ySvg: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;
    return {
      x: vbMinX + relX * vbWidth,
      ySvg: vbMinY + relY * vbHeight,
    };
  };

  const handleZoom = (factor: number) => {
    setViewBox((prev) => ({
      ...prev,
      halfSpan: Math.max(MIN_HALF_SPAN, Math.min(MAX_HALF_SPAN, prev.halfSpan * factor)),
    }));
  };

  const handleFitCampus = () => {
    setViewBox(INITIAL_VIEW_BOX);
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drawMode) return;

    if (e.pointerType === 'touch') {
      activeTouchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activeTouchesRef.current.size === 2) {
        const pts = Array.from(activeTouchesRef.current.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        pinchStartRef.current = {
          dist: Math.max(10, dist),
          halfSpan: viewBoxRef.current.halfSpan,
          cx: viewBoxRef.current.cx,
          cy: viewBoxRef.current.cy,
        };
        setIsDragging(false);
        dragStartRef.current = null;
        return;
      }
      // On touchscreens at base zoom, allow natural vertical page scrolling instead of trapping pan
      if (!isZoomedIn) {
        dragStartRef.current = {
          clientX: e.clientX,
          clientY: e.clientY,
          cx: viewBox.cx,
          cy: viewBox.cy,
          moved: false,
        };
        return;
      }
    }

    setIsDragging(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      cx: viewBox.cx,
      cy: viewBox.cy,
      moved: false,
    };
    try {
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch' && activeTouchesRef.current.has(e.pointerId)) {
      activeTouchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activeTouchesRef.current.size === 2 && pinchStartRef.current) {
        const pts = Array.from(activeTouchesRef.current.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const ratio = pinchStartRef.current.dist / Math.max(10, dist);
        const nextHalfSpan = Math.max(
          MIN_HALF_SPAN,
          Math.min(MAX_HALF_SPAN, pinchStartRef.current.halfSpan * ratio)
        );
        setViewBox((prev) => ({ ...prev, halfSpan: nextHalfSpan }));
        return;
      }
    }

    if (!isDragging || !dragStartRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const dxPx = e.clientX - dragStartRef.current.clientX;
    const dyPx = e.clientY - dragStartRef.current.clientY;
    if (Math.abs(dxPx) > 4 || Math.abs(dyPx) > 4) {
      dragStartRef.current.moved = true;
    }
    const dxMeters = (dxPx / Math.max(1, rect.width)) * vbWidth;
    const dyMeters = (dyPx / Math.max(1, rect.height)) * vbHeight;
    setViewBox((prev) => ({
      ...prev,
      cx: dragStartRef.current!.cx - dxMeters,
      cy: dragStartRef.current!.cy - dyMeters,
    }));
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') {
      activeTouchesRef.current.delete(e.pointerId);
      if (activeTouchesRef.current.size < 2) {
        pinchStartRef.current = null;
      }
    }
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if not captured
      }
    }
  };

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drawMode) return;
    const coords = clientToSvgCoords(e.clientX, e.clientY);
    if (!coords) return;
    setDraftPoints((prev) => [...prev, { x: coords.x, y: -coords.ySvg }]);
  };

  const handleFinishDraw = () => {
    if (draftPoints.length < 3 || !onCreateDrawnBuilding) return;
    const geoPts = draftPoints.map((p) => unproject(p.x, p.y));
    onCreateDrawnBuilding(geoPts, Math.round(draftAreaM2));
    setDraftPoints([]);
    setDrawMode(false);
  };

  const scaleBarMeters = useMemo(() => {
    const raw = vbWidth * 0.16;
    const steps = [10, 20, 25, 50, 100, 200];
    return steps.reduce((best, s) => (Math.abs(s - raw) < Math.abs(best - raw) ? s : best), 50);
  }, [vbWidth]);

  // Pre-memoize all static & building SVG paths so panning/zooming/hovering runs at 60fps with zero re-projection
  const projectedStatic = useMemo(() => {
    const parcelPath = polygonToSvgPath(campusLayout.campusParcel, project);
    const boundaryPaths = schoolBoundaries.flatMap((sb) =>
      sb.polygons.map((poly, idx) => ({
        key: `sb-${sb.osmId}-${idx}`,
        d: polygonToSvgPath(poly, project),
      }))
    );
    const roads = campusLayout.roads.map((road) => ({
      ...road,
      d: polylineToSvgPath(road.points, project),
    }));
    const trees = campusLayout.trees.map((t) => {
      const p = project(t.center);
      return { id: t.id, x: p.x, y: -p.y, r: t.radiusMeters };
    });
    const gates = campusLayout.gates.map((g) => {
      const p = project(g.position);
      return { id: g.id, label: g.label, x: p.x, y: -p.y };
    });
    return { parcelPath, boundaryPaths, roads, trees, gates };
  }, [campusLayout, schoolBoundaries, project]);

  const projectedSports = useMemo(() => {
    return buildings
      .filter((b) => b.featureKind === 'sports_ground')
      .map((sg) => ({
        sg,
        c: project(sg.centroid),
        polyPaths: sg.polygons.map((poly) => polygonToSvgPath(poly, project)),
        rotDeg: -(sg.visualMeta?.orientationDeg ?? 7),
      }));
  }, [buildings, project]);

  const projectedAcademic = useMemo(() => {
    return buildings
      .filter((b) => b.featureKind !== 'sports_ground')
      .slice()
      .sort((a, b) => (a.levels ?? 1) - (b.levels ?? 1))
      .map((b) => {
        const levels = b.levels ?? 2;
        const extrudeScale = viewMode === '2.5d' ? Math.min(4.2, 0.9 + levels * 0.78) : 0;
        const ex = extrudeScale * 0.55;
        const ey = extrudeScale * 0.95;
        const clipId = `roof-clip-${b.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        const roofAngle = -(b.visualMeta?.orientationDeg ?? 0);
        const c = project(b.centroid);

        const polyGeoms = b.polygons.map((poly) => {
          const roofPts = ringToSvgPts(poly.outer, project);
          const bounds = computePolygonBounds(roofPts);
          const insetPts = roofPts.map((p) => ({
            x: bounds.cx + (p.x - bounds.cx) * 0.85,
            y: bounds.cy + (p.y - bounds.cy) * 0.85,
          }));
          const parapetPts = roofPts.map((p) => ({
            x: bounds.cx + (p.x - bounds.cx) * 0.93,
            y: bounds.cy + (p.y - bounds.cy) * 0.93,
          }));

          return {
            roofPath: polygonToSvgPath(poly, project),
            shadowPath: polygonToSvgPath(
              poly,
              project,
              viewMode === '2.5d' ? ex + 2.0 : 1.4,
              viewMode === '2.5d' ? ey + 2.4 : 1.6
            ),
            insetClipPath: ptsToPath(insetPts),
            parapetPath: ptsToPath(parapetPts),
            walls: viewMode === '2.5d' ? buildExtrusionWalls(roofPts, ex, ey) : [],
            bounds,
          };
        });

        return { b, levels, ex, ey, clipId, roofAngle, c, polyGeoms };
      });
  }, [buildings, project, viewMode]);

  const hoveredBuilding = useMemo(
    () => buildings.find((b) => b.id === hoveredId) || null,
    [buildings, hoveredId]
  );

  // Subtle metric reference grid
  const gridStep = viewBox.halfSpan > 220 ? 100 : viewBox.halfSpan > 90 ? 50 : 25;
  const gridLinesX = useMemo(() => {
    const start = Math.floor(vbMinX / gridStep) * gridStep;
    const end = vbMinX + vbWidth;
    const arr: number[] = [];
    for (let x = start; x <= end; x += gridStep) arr.push(x);
    return arr;
  }, [vbMinX, vbWidth, gridStep]);

  const gridLinesY = useMemo(() => {
    const start = Math.floor(vbMinY / gridStep) * gridStep;
    const end = vbMinY + vbHeight;
    const arr: number[] = [];
    for (let y = start; y <= end; y += gridStep) arr.push(y);
    return arr;
  }, [vbMinY, vbHeight, gridStep]);

  return (
    <div className="rw-surface rounded-2xl overflow-hidden flex flex-col">
      {/* Clean single-row responsive map toolbar */}
      <div className="px-3.5 py-2.5 border-b border-neutral-200/75 flex flex-wrap items-center justify-between gap-2 bg-[#fafcfb]">
        <div className="flex items-center gap-2 text-xs min-w-0">
          <Compass className="w-3.5 h-3.5 text-emerald-800 shrink-0" />
          <span className="font-semibold text-neutral-900 truncate">
            {institutionName}
          </span>
          <span className="text-[11px] font-mono text-neutral-500 hidden sm:inline tabular-nums whitespace-nowrap">
            {campusLat.toFixed(4)}°N, {campusLon.toFixed(4)}°E
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <SegmentedControl<'2.5d' | 'topdown'>
            layoutId="campus-map-viewmode"
            size="sm"
            tone="light"
            value={viewMode}
            onChange={setViewMode}
            ariaLabel="Map projection mode"
            options={[
              { id: '2.5d', label: '2.5D' },
              { id: 'topdown', label: 'Top-Down' },
            ]}
          />

          <ActionButton
            variant={showPvArrays ? 'primary' : 'secondary'}
            size="xs"
            aria-pressed={showPvArrays}
            onClick={() => setShowPvArrays((v) => !v)}
            icon={<Grid2x2 className="w-3 h-3" />}
          >
            PV Rows
          </ActionButton>

          {isAdminUnlocked && onCreateDrawnBuilding && !drawMode && (
            <ActionButton
              variant="soft"
              size="xs"
              onClick={() => {
                setDrawMode(true);
                setDraftPoints([]);
              }}
              icon={<PenTool className="w-3 h-3" />}
            >
              Draw
            </ActionButton>
          )}

          <div className="inline-flex items-center gap-1">
            <IconButton
              variant="secondary"
              size="xs"
              label="Zoom in"
              onClick={() => handleZoom(0.76)}
            >
              <Plus className="w-3.5 h-3.5" />
            </IconButton>
            <IconButton
              variant="secondary"
              size="xs"
              label="Zoom out"
              onClick={() => handleZoom(1.32)}
            >
              <Minus className="w-3.5 h-3.5" />
            </IconButton>
            <ActionButton
              variant="secondary"
              size="xs"
              onClick={handleFitCampus}
              title="Fit campus layout"
              icon={<Maximize2 className="w-3 h-3" />}
            >
              Fit
            </ActionButton>
          </div>
        </div>
      </div>

      {/* Draw mode active bar */}
      {drawMode && (
        <div className="px-3.5 py-2 rw-obsidian-panel border-none rounded-none text-emerald-50 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <PenTool className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
            <span>
              Click to place roof vertices ({draftPoints.length} pts
              {draftPoints.length >= 3 ? ` · ~${Math.round(draftAreaM2).toLocaleString()} m²` : ''})
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <ActionButton
              variant="dark-ghost"
              size="xs"
              disabled={draftPoints.length === 0}
              onClick={() => setDraftPoints((p) => p.slice(0, -1))}
              icon={<Undo2 className="w-3 h-3" />}
            >
              Undo
            </ActionButton>
            <ActionButton
              variant="forest"
              size="xs"
              disabled={draftPoints.length < 3}
              onClick={handleFinishDraw}
              icon={<Check className="w-3 h-3" />}
            >
              Save
            </ActionButton>
            <ActionButton
              variant="dark-ghost"
              size="xs"
              onClick={() => {
                setDrawMode(false);
                setDraftPoints([]);
              }}
              icon={<X className="w-3 h-3" />}
            >
              Cancel
            </ActionButton>
          </div>
        </div>
      )}

      {/* Interactive Architectural SVG Canvas (native non-passive wheel zoom prevents page scroll) */}
      <div
        ref={containerRef}
        className="relative w-full aspect-[4/3] sm:aspect-[16/10] bg-[#ebeee8] select-none overflow-hidden overscroll-contain"
      >
        <svg
          ref={svgRef}
          viewBox={`${vbMinX} ${vbMinY} ${vbWidth} ${vbHeight}`}
          className={`w-full h-full ${
            drawMode || isZoomedIn ? 'touch-none' : 'touch-pan-y'
          } ${drawMode ? 'cursor-crosshair' : isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onClick={handleSvgClick}
        >
          <defs>
            {/* Clean architectural PV row bands: simplified wide rows with crisp aisle gaps, zero noisy micro-lines */}
            <pattern
              id="rw-pv-array-pattern"
              width="6.4"
              height="5.4"
              patternUnits="userSpaceOnUse"
            >
              <rect
                x="0.35"
                y="0.55"
                width="5.7"
                height="3.25"
                rx="0.28"
                fill="#1f4163"
                stroke="#5b82ab"
                strokeWidth="0.18"
              />
              <line x1="3.2" y1="0.55" x2="3.2" y2="3.8" stroke="#3f658c" strokeWidth="0.14" />
            </pattern>

            {/* Subtle turf stripe pattern for Football Ground */}
            <pattern
              id="rw-football-turf"
              width="11"
              height="44"
              patternUnits="userSpaceOnUse"
            >
              <rect x="0" y="0" width="5.5" height="44" fill="#c0b58d" />
              <rect x="5.5" y="0" width="5.5" height="44" fill="#b7ad84" />
            </pattern>

            {/* Pre-memoized per-building clipPaths so PV arrays stay strictly inside roof boundaries */}
            {projectedAcademic.map(({ b, clipId, polyGeoms }) => (
              <clipPath key={`clip-${b.id}`} id={clipId}>
                {polyGeoms.map((pg, idx) => (
                  <path key={idx} d={pg.insetClipPath} />
                ))}
              </clipPath>
            ))}
          </defs>

          {/* Subtle metric background grid */}
          <g stroke="#dfe5dc" strokeWidth={vbWidth * 0.0009}>
            {gridLinesX.map((x) => (
              <line key={`gx-${x}`} x1={x} y1={vbMinY} x2={x} y2={vbMinY + vbHeight} />
            ))}
            {gridLinesY.map((y) => (
              <line key={`gy-${y}`} x1={vbMinX} y1={y} x2={vbMinX + vbWidth} y2={y} />
            ))}
          </g>

          {/* Reconstructed DAV Model School Campus Parcel */}
          <path
            d={projectedStatic.parcelPath}
            fill="#d9e5d4"
            stroke="#9fb59a"
            strokeWidth={vbWidth * 0.0022}
            strokeLinejoin="round"
          />

          {/* Supplementary OSM School Boundaries */}
          {projectedStatic.boundaryPaths.map((bp) => (
            <path
              key={bp.key}
              d={bp.d}
              fill="none"
              stroke="#047857"
              strokeOpacity={0.35}
              strokeWidth={vbWidth * 0.0018}
              strokeDasharray="4 3"
            />
          ))}

          {/* Search radius ring only when zoomed far out */}
          {viewBox.halfSpan > 160 && (
            <circle
              cx={0}
              cy={0}
              r={searchRadiusMeters}
              fill="none"
              stroke="#0f766e"
              strokeOpacity={0.2}
              strokeWidth={vbWidth * 0.0018}
              strokeDasharray="6 4"
            />
          )}

          {/* Campus Roads & Internal Walkways */}
          <g strokeLinecap="round" strokeLinejoin="round" fill="none">
            {projectedStatic.roads.map((road) => {
              const isConnector = road.id === 'path-ob-nb-connector';
              const isPath = road.kind === 'pathway';
              return (
                <g key={road.id}>
                  {isConnector && (
                    <path
                      d={road.d}
                      stroke="#1a2922"
                      strokeOpacity={0.18}
                      strokeWidth={road.widthMeters + 3.0}
                      transform="translate(1.4, 1.8)"
                    />
                  )}
                  <path
                    d={road.d}
                    stroke={isConnector ? '#62706b' : isPath ? '#d4cfc1' : '#cfd6d1'}
                    strokeWidth={road.widthMeters + (isConnector ? 1.7 : isPath ? 0.9 : 1.8)}
                    strokeLinecap={isConnector ? 'butt' : 'round'}
                  />
                  <path
                    d={road.d}
                    stroke={isConnector ? '#cfd5d2' : isPath ? '#f4f0e6' : '#ffffff'}
                    strokeWidth={road.widthMeters}
                    strokeLinecap={isConnector ? 'butt' : 'round'}
                  />
                </g>
              );
            })}
          </g>

          {/* Natural Campus Tree Canopy Clusters */}
          <g pointerEvents="none">
            {projectedStatic.trees.map((t) => (
              <g key={t.id}>
                <circle cx={t.x + 1.2} cy={t.y + 1.5} r={t.r} fill="#344e39" fillOpacity={0.14} />
                <circle
                  cx={t.x}
                  cy={t.y}
                  r={t.r}
                  fill="#7fa17a"
                  fillOpacity={0.48}
                  stroke="#5f825b"
                  strokeOpacity={0.42}
                  strokeWidth={0.5}
                />
                <circle
                  cx={t.x - t.r * 0.22}
                  cy={t.y - t.r * 0.22}
                  r={t.r * 0.55}
                  fill="#95b78e"
                  fillOpacity={0.36}
                />
              </g>
            ))}
          </g>

          {/* Sports Facilities: Football Ground & Basketball Court (BB) */}
          {projectedSports.map(({ sg, c, polyPaths, rotDeg }) => {
            const isSelected = sg.id === selectedBuildingId;
            const isHovered = sg.id === hoveredId;
            const isFootball = sg.visualMeta?.courtKind === 'football';
            const isBasketball = sg.visualMeta?.courtKind === 'basketball';

            return (
              <g
                key={sg.id}
                className={drawMode ? '' : 'cursor-pointer'}
                onMouseEnter={() => setHoveredId(sg.id)}
                onMouseLeave={() => setHoveredId((prev) => (prev === sg.id ? null : prev))}
                onClick={(e) => {
                  if (drawMode || dragStartRef.current?.moved) return;
                  e.stopPropagation();
                  onSelectBuilding(sg.id);
                }}
              >
                {polyPaths.map((d, idx) => (
                  <path
                    key={`${sg.id}-poly-${idx}`}
                    d={d}
                    fill={
                      isFootball
                        ? 'url(#rw-football-turf)'
                        : isBasketball
                        ? '#a15e57'
                        : '#b9c4b0'
                    }
                    stroke={isSelected ? '#0b2e22' : isHovered ? '#1e3a2f' : '#6f7c6b'}
                    strokeWidth={isSelected ? 1.8 : isHovered ? 1.2 : 0.85}
                  />
                ))}

                {isFootball && (
                  <g
                    transform={`translate(${c.x.toFixed(2)}, ${(-c.y).toFixed(2)}) rotate(${rotDeg})`}
                    fill="none"
                    stroke="#f7f5ee"
                    strokeOpacity={0.86}
                    strokeWidth={0.65}
                    pointerEvents="none"
                  >
                    <rect x={-51} y={-17.5} width={102} height={35} />
                    <line x1={0} y1={-17.5} x2={0} y2={17.5} />
                    <circle cx={0} cy={0} r={6.2} />
                    <circle cx={0} cy={0} r={0.55} fill="#f7f5ee" />
                    <rect x={-51} y={-10} width={11.5} height={20} />
                    <rect x={-51} y={-5} width={4.2} height={10} />
                    <rect x={39.5} y={-10} width={11.5} height={20} />
                    <rect x={46.8} y={-5} width={4.2} height={10} />
                  </g>
                )}

                {isBasketball && (
                  <g
                    transform={`translate(${c.x.toFixed(2)}, ${(-c.y).toFixed(2)}) rotate(${rotDeg})`}
                    pointerEvents="none"
                  >
                    <rect
                      x={-7.5}
                      y={-14}
                      width={15}
                      height={28}
                      fill="#4c6b86"
                      stroke="#f7f7f5"
                      strokeWidth={0.55}
                    />
                    <line x1={-7.5} y1={0} x2={7.5} y2={0} stroke="#f7f7f5" strokeWidth={0.5} />
                    <circle
                      cx={0}
                      cy={0}
                      r={2.2}
                      fill="#8f4c45"
                      fillOpacity={0.7}
                      stroke="#f7f7f5"
                      strokeWidth={0.45}
                    />
                    <rect
                      x={-2.5}
                      y={-14}
                      width={5}
                      height={5.8}
                      fill="#8f4c45"
                      fillOpacity={0.65}
                      stroke="#f7f7f5"
                      strokeWidth={0.45}
                    />
                    <rect
                      x={-2.5}
                      y={8.2}
                      width={5}
                      height={5.8}
                      fill="#8f4c45"
                      fillOpacity={0.65}
                      stroke="#f7f7f5"
                      strokeWidth={0.45}
                    />
                    <path d="M -5.8 -14 A 5.8 5.8 0 0 0 5.8 -14" fill="none" stroke="#f7f7f5" strokeWidth={0.42} />
                    <path d="M -5.8 14 A 5.8 5.8 0 0 1 5.8 14" fill="none" stroke="#f7f7f5" strokeWidth={0.42} />
                  </g>
                )}

                <g pointerEvents="none">
                  <text
                    x={c.x}
                    y={-c.y + (isFootball ? 1.5 : 1.0)}
                    textAnchor="middle"
                    fontSize={isFootball ? 4.6 : 3.5}
                    fontWeight={700}
                    fill="#1f2d24"
                    stroke="#f7f9f7"
                    strokeWidth={1.1}
                    paintOrder="stroke"
                    style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                  >
                    {isBasketball ? 'Basketball Court' : sg.shortLabel || sg.displayName}
                  </text>
                </g>
              </g>
            );
          })}

          {/* Academic Buildings */}
          {projectedAcademic.map(({ b, levels, ex, ey, clipId, roofAngle, c, polyGeoms }) => {
            const isSelected = b.id === selectedBuildingId;
            const isHovered = b.id === hoveredId;
            const isExcluded = b.selectionStatus === 'excluded';
            const isConfirmed = b.selectionStatus === 'confirmed';
            const isMph = b.id === 'campus/mph';

            const baseRoofFill = b.visualMeta?.roofColor
              ? b.visualMeta.roofColor
              : isConfirmed
              ? '#c9d7cf'
              : '#d2d7d5';
            const wallFill = b.visualMeta?.wallColor || '#dbd4c6';

            return (
              <g
                key={b.id}
                className={drawMode ? '' : 'cursor-pointer'}
                onMouseEnter={() => setHoveredId(b.id)}
                onMouseLeave={() => setHoveredId((prev) => (prev === b.id ? null : prev))}
                onClick={(e) => {
                  if (drawMode || dragStartRef.current?.moved) return;
                  e.stopPropagation();
                  onSelectBuilding(b.id);
                }}
              >
                {polyGeoms.map((pg, idx) => (
                  <g key={`${b.id}-p-${idx}`}>
                    <path
                      d={pg.shadowPath}
                      fill="#1a2922"
                      fillOpacity={viewMode === '2.5d' ? 0.18 : 0.12}
                    />

                    {viewMode === '2.5d' &&
                      pg.walls.map((w, wIdx) => (
                        <g key={`w-${wIdx}`}>
                          <path
                            d={w.d}
                            fill={w.isSouthFace ? wallFill : '#c5bdb0'}
                            stroke="#8c867a"
                            strokeWidth={0.35}
                          />
                          {levels >= 2 && w.isSouthFace && (
                            <>
                              {Array.from({ length: Math.min(3, levels - 1) }).map((_, fIdx) => {
                                const t = (fIdx + 1) / levels;
                                return (
                                  <line
                                    key={`fl-${fIdx}`}
                                    x1={w.start.x + ex * t}
                                    y1={w.start.y + ey * t}
                                    x2={w.end.x + ex * t}
                                    y2={w.end.y + ey * t}
                                    stroke="#5b6973"
                                    strokeOpacity={0.34}
                                    strokeWidth={0.32}
                                    strokeDasharray="1.8 1.2"
                                  />
                                );
                              })}
                            </>
                          )}
                        </g>
                      ))}

                    <path
                      d={pg.roofPath}
                      fill={isExcluded ? '#dfe3e1' : baseRoofFill}
                      fillOpacity={isExcluded ? 0.65 : 1}
                      stroke={
                        isSelected
                          ? '#0b2e22'
                          : isHovered
                          ? '#0f4c36'
                          : isConfirmed
                          ? '#146c4b'
                          : '#69746e'
                      }
                      strokeWidth={isSelected ? 1.85 : isHovered ? 1.25 : 0.85}
                      strokeLinejoin="round"
                      fillRule="evenodd"
                    />

                    {!isExcluded && (
                      <path
                        d={pg.parapetPath}
                        fill="none"
                        stroke="#ffffff"
                        strokeOpacity={0.45}
                        strokeWidth={0.4}
                      />
                    )}

                    {isSelected && (
                      <path
                        d={pg.roofPath}
                        fill="#059669"
                        fillOpacity={0.14}
                        pointerEvents="none"
                      />
                    )}

                    {/* Clean simplified PV array band overlay */}
                    {showPvArrays &&
                      b.solarEligible &&
                      !isExcluded &&
                      b.capacity.estimatedPanelCount > 0 && (
                        <g
                          clipPath={`url(#${clipId})`}
                          opacity={isSelected ? 0.86 : 0.66}
                          pointerEvents="none"
                        >
                          <rect
                            x={pg.bounds.minX - 18}
                            y={pg.bounds.minY - 18}
                            width={pg.bounds.w + 36}
                            height={pg.bounds.h + 36}
                            fill="url(#rw-pv-array-pattern)"
                            transform={`rotate(${roofAngle} ${pg.bounds.cx.toFixed(2)} ${pg.bounds.cy.toFixed(2)})`}
                          />
                        </g>
                      )}

                    {b.id === 'campus/g3-block' && (
                      <rect
                        x={pg.bounds.cx - 8}
                        y={pg.bounds.cy - 9}
                        width={6.5}
                        height={5}
                        rx={0.4}
                        fill="#b7beb9"
                        stroke="#7b857f"
                        strokeWidth={0.4}
                        pointerEvents="none"
                      />
                    )}
                  </g>
                ))}

                {/* Restrained building label */}
                <g pointerEvents="none">
                  <text
                    x={c.x}
                    y={-c.y + 0.6}
                    textAnchor="middle"
                    fontSize={isMph || b.id === 'campus/pre-primary-block' ? 3.7 : 4.2}
                    fontWeight={700}
                    fill="#0f1f18"
                    stroke="#ffffff"
                    strokeWidth={1.35}
                    paintOrder="stroke"
                    style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                  >
                    {b.shortLabel || b.displayName}
                  </text>
                  {b.capacity.effectiveCapacityKwp > 0 && (
                    <text
                      x={c.x}
                      y={-c.y + 4.8}
                      textAnchor="middle"
                      fontSize={2.65}
                      fontWeight={600}
                      fill="#31473d"
                      stroke="#ffffff"
                      strokeWidth={0.95}
                      paintOrder="stroke"
                      style={{ fontFamily: 'JetBrains Mono, monospace' }}
                    >
                      {b.capacity.effectiveCapacityKwp} kWp
                    </text>
                  )}
                </g>
              </g>
            );
          })}

          {/* Campus Gate Markers */}
          <g pointerEvents="none">
            {projectedStatic.gates.map((gate) => (
              <g key={gate.id} transform={`translate(${gate.x.toFixed(2)}, ${gate.y.toFixed(2)})`}>
                <rect
                  x={-11.5}
                  y={-3.8}
                  width={23}
                  height={7.6}
                  rx={2.2}
                  fill="#0b2e22"
                  fillOpacity={0.9}
                  stroke="#ffffff"
                  strokeWidth={0.65}
                />
                <text
                  x={0}
                  y={1.35}
                  textAnchor="middle"
                  fontSize={3.1}
                  fontWeight={700}
                  fill="#ffffff"
                  style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
                >
                  {gate.label}
                </text>
              </g>
            ))}
          </g>

          {/* Draft polygon while drawing */}
          {drawMode && draftPoints.length > 0 && (
            <g>
              <polygon
                points={draftPoints.map((p) => `${p.x.toFixed(2)},${(-p.y).toFixed(2)}`).join(' ')}
                fill="#059669"
                fillOpacity={0.32}
                stroke="#064e3b"
                strokeWidth={0.9}
              />
              {draftPoints.map((p, idx) => (
                <circle
                  key={`dp-${idx}`}
                  cx={p.x}
                  cy={-p.y}
                  r={1.6}
                  fill="#0b2e22"
                  stroke="#ffffff"
                  strokeWidth={0.6}
                />
              ))}
            </g>
          )}

          {/* Canonical Anchor Pin */}
          <g pointerEvents="none">
            <circle cx={0} cy={0} r={2.3} fill="#dc2626" fillOpacity={0.2} />
            <circle cx={0} cy={0} r={1.25} fill="#dc2626" stroke="#ffffff" strokeWidth={0.5} />
          </g>
        </svg>

        {/* Subtle Hover Tooltip */}
        {hoveredBuilding && !drawMode && (
          <div className="hidden sm:block absolute top-3 left-3 max-w-[260px] px-3 py-2 rounded-xl bg-white/95 border border-neutral-200/90 shadow-sm pointer-events-none">
            <div className="text-xs font-bold text-neutral-900 truncate">
              {hoveredBuilding.displayName}
            </div>
            {hoveredBuilding.solarEligible ? (
              <div className="mt-0.5 text-[11px] font-mono text-neutral-700 tabular-nums">
                {hoveredBuilding.geometry.grossFootprintAreaM2.toLocaleString()} m² ·{' '}
                {hoveredBuilding.capacity.effectiveCapacityKwp} kWp
              </div>
            ) : (
              <div className="mt-0.5 text-[11px] text-neutral-600">
                Sports facility · {hoveredBuilding.geometry.grossFootprintAreaM2.toLocaleString()} m²
              </div>
            )}
          </div>
        )}

        {/* North indicator */}
        <div className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-white/92 border border-neutral-200/80 text-[10px] font-mono font-bold text-neutral-700 pointer-events-none">
          N ↑
        </div>

        {/* Dynamic metric scale bar */}
        <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-lg bg-white/92 border border-neutral-200/80 flex items-center gap-2 pointer-events-none">
          <div
            className="h-1.5 border-x border-b border-neutral-800"
            style={{ width: `${Math.max(34, Math.min(92, (scaleBarMeters / vbWidth) * 500))}px` }}
          />
          <span className="text-[10px] font-mono text-neutral-700 tabular-nums whitespace-nowrap">
            {scaleBarMeters} m
          </span>
        </div>
      </div>

      {/* Compact Legend */}
      <div className="px-3.5 py-2 border-t border-neutral-200/75 bg-white flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-600">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#c6cdd0] border border-[#146c4b]" />
            Roofs
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#1f4163] border border-[#5b82ab]" />
            Illustrative PV
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#b8ad84] border border-[#6f7c6b]" />
            Sports
          </span>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] text-neutral-500">
          <Layers className="w-3 h-3 text-neutral-400 shrink-0" />
          <span>Scroll over map to zoom · Drag to pan</span>
        </span>
      </div>
    </div>
  );
};
