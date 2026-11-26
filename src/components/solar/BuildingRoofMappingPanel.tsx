/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Link2,
  Lock,
  MapPin,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Sliders,
  Sun,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  ActionButton,
  FilterChipButton,
  IconButton,
  InlineActionLink,
  SectionHeading,
} from '../common/DesignSystem';
import { MathText } from '../common/MathText';
import { CampusFootprintMap } from './CampusFootprintMap';
import type {
  BuildingSelectionStatus,
  DiscoveredBuilding,
  GeoPoint,
  PvgisMountingPlace,
  PvgisTechnology,
  SolarWorkspaceResponse,
} from '../../types/solar';

interface BuildingRoofMappingPanelProps {
  workspace: SolarWorkspaceResponse;
  isAdminUnlocked: boolean;
  onRequestAdminUnlock: () => void;
  onRefreshDiscovery: (radiusMeters?: number) => Promise<void>;
  onRestoreCampus: () => Promise<void>;
  onUpdateBuilding: (
    buildingId: string,
    patch: Record<string, unknown>
  ) => Promise<void>;
  onCreateManualBuilding: (payload: {
    name: string;
    campusLabel?: string;
    buildingType?: string;
    polygonPoints?: GeoPoint[];
    footprintAreaM2?: number;
  }) => Promise<void>;
  onDeleteManualBuilding: (buildingId: string) => Promise<void>;
  onCalculateBuilding: (buildingId: string) => Promise<void>;
  isBusy: boolean;
}

type FilterTab = 'all' | 'academic' | 'sports' | 'osm';

export const BuildingRoofMappingPanel: React.FC<BuildingRoofMappingPanelProps> = ({
  workspace,
  isAdminUnlocked,
  onRequestAdminUnlock,
  onRefreshDiscovery,
  onRestoreCampus,
  onUpdateBuilding,
  onCreateManualBuilding,
  onDeleteManualBuilding,
  onCalculateBuilding,
  isBusy,
}) => {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [searchText, setSearchText] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(
    () => workspace.buildings[0]?.id ?? null
  );
  const [savingBuilding, setSavingBuilding] = useState(false);
  const [calculatingId, setCalculatingId] = useState<string | null>(null);
  const [showParamsForm, setShowParamsForm] = useState(false);
  const [showPositionTools, setShowPositionTools] = useState(false);

  const [showManualForm, setShowManualForm] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualLabel, setManualLabel] = useState('');
  const [manualAreaM2, setManualAreaM2] = useState<string>('320');
  const [drawnPolygonDraft, setDrawnPolygonDraft] = useState<{
    points: GeoPoint[];
    approxAreaM2: number;
  } | null>(null);

  // Per-building analytical & identity editable fields
  const [editCustomName, setEditCustomName] = useState('');
  const [editCampusLabel, setEditCampusLabel] = useState('');
  const [editGrossAreaM2, setEditGrossAreaM2] = useState('');
  const [editUsablePct, setEditUsablePct] = useState('');
  const [editRoofType, setEditRoofType] = useState('');
  const [editTilt, setEditTilt] = useState('');
  const [editAspect, setEditAspect] = useState('');
  const [editLosses, setEditLosses] = useState('');
  const [editManualKwp, setEditManualKwp] = useState('');
  const [editMount, setEditMount] = useState<PvgisMountingPlace | ''>('');
  const [editTech, setEditTech] = useState<PvgisTechnology | ''>('');

  useEffect(() => {
    if (!selectedId && workspace.buildings.length > 0) {
      setSelectedId(workspace.buildings[0].id);
    } else if (selectedId && !workspace.buildings.some((b) => b.id === selectedId)) {
      setSelectedId(workspace.buildings[0]?.id ?? null);
    }
  }, [workspace.buildings, selectedId]);

  const selectedBuilding: DiscoveredBuilding | null = useMemo(
    () => workspace.buildings.find((b) => b.id === selectedId) || null,
    [workspace.buildings, selectedId]
  );

  const relatedBuilding: DiscoveredBuilding | null = useMemo(() => {
    if (!selectedBuilding) return null;
    if (selectedBuilding.parentBuildingId) {
      return workspace.buildings.find((b) => b.id === selectedBuilding.parentBuildingId) || null;
    }
    return workspace.buildings.find((b) => b.parentBuildingId === selectedBuilding.id) || null;
  }, [workspace.buildings, selectedBuilding]);

  useEffect(() => {
    if (!selectedBuilding) return;
    const ov = selectedBuilding.override;
    setEditCustomName(ov?.customName ?? '');
    setEditCampusLabel(ov?.campusLabel ?? '');
    setEditGrossAreaM2(ov?.grossAreaOverrideM2 != null ? String(ov.grossAreaOverrideM2) : '');
    setEditUsablePct(
      ov?.usableRoofFractionPercent != null ? String(ov.usableRoofFractionPercent) : ''
    );
    setEditRoofType(ov?.roofTypeOverride ?? '');
    setEditTilt(ov?.tiltDegreesOverride != null ? String(ov.tiltDegreesOverride) : '');
    setEditAspect(ov?.aspectDegreesOverride != null ? String(ov.aspectDegreesOverride) : '');
    setEditLosses(ov?.systemLossesOverride != null ? String(ov.systemLossesOverride) : '');
    setEditManualKwp(
      ov?.manualCapacityKwpOverride != null ? String(ov.manualCapacityKwpOverride) : ''
    );
    setEditMount(ov?.mountingPlaceOverride ?? '');
    setEditTech(ov?.pvTechnologyOverride ?? '');
  }, [selectedBuilding]);

  const filteredBuildings = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return workspace.buildings.filter((b) => {
      if (filter === 'academic' && !b.solarEligible) return false;
      if (filter === 'sports' && b.featureKind !== 'sports_ground') return false;
      if (filter === 'osm' && b.source !== 'osm') return false;
      if (q) {
        const hay = `${b.displayName} ${b.campusLabel || ''} ${b.linkedRoomwiseBuilding || ''}`.toLowerCase();
        return hay.includes(q);
      }
      return true;
    });
  }, [workspace.buildings, filter, searchText]);

  const handleStatusChange = async (
    buildingId: string,
    status: BuildingSelectionStatus,
    analyticalConfirmed?: boolean
  ) => {
    if (!isAdminUnlocked) {
      onRequestAdminUnlock();
      return;
    }
    setSavingBuilding(true);
    try {
      await onUpdateBuilding(buildingId, {
        selectionStatus: status,
        ...(typeof analyticalConfirmed === 'boolean' ? { analyticalConfirmed } : {}),
      });
    } finally {
      setSavingBuilding(false);
    }
  };

  const handleNudgePosition = async (dEast: number, dNorth: number) => {
    if (!selectedBuilding) return;
    if (!isAdminUnlocked) {
      onRequestAdminUnlock();
      return;
    }
    const prevE = selectedBuilding.override?.offsetEastMeters ?? 0;
    const prevN = selectedBuilding.override?.offsetNorthMeters ?? 0;
    setSavingBuilding(true);
    try {
      await onUpdateBuilding(selectedBuilding.id, {
        offsetEastMeters: prevE + dEast,
        offsetNorthMeters: prevN + dNorth,
      });
    } finally {
      setSavingBuilding(false);
    }
  };

  const handleResetVisualOffset = async () => {
    if (!selectedBuilding) return;
    if (!isAdminUnlocked) {
      onRequestAdminUnlock();
      return;
    }
    setSavingBuilding(true);
    try {
      await onUpdateBuilding(selectedBuilding.id, {
        offsetEastMeters: 0,
        offsetNorthMeters: 0,
      });
    } finally {
      setSavingBuilding(false);
    }
  };

  const handleSaveBuildingOverrides = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBuilding) return;
    if (!isAdminUnlocked) {
      onRequestAdminUnlock();
      return;
    }
    setSavingBuilding(true);
    try {
      await onUpdateBuilding(selectedBuilding.id, {
        customName: editCustomName.trim() || null,
        campusLabel: editCampusLabel.trim() || null,
        grossAreaOverrideM2: editGrossAreaM2.trim() === '' ? null : Number(editGrossAreaM2),
        usableRoofFractionPercent: editUsablePct.trim() === '' ? null : Number(editUsablePct),
        roofTypeOverride: editRoofType.trim() || null,
        tiltDegreesOverride: editTilt.trim() === '' ? null : Number(editTilt),
        aspectDegreesOverride: editAspect.trim() === '' ? null : Number(editAspect),
        systemLossesOverride: editLosses.trim() === '' ? null : Number(editLosses),
        manualCapacityKwpOverride: editManualKwp.trim() === '' ? null : Number(editManualKwp),
        mountingPlaceOverride: editMount || null,
        pvTechnologyOverride: editTech || null,
        analyticalConfirmed: editGrossAreaM2.trim() !== '' ? true : selectedBuilding.analyticalConfirmed,
      });
    } finally {
      setSavingBuilding(false);
    }
  };

  const handleSubmitManualBuilding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdminUnlocked) {
      onRequestAdminUnlock();
      return;
    }
    setSavingBuilding(true);
    try {
      await onCreateManualBuilding({
        name: manualName.trim() || 'Campus Academic Wing',
        campusLabel: manualLabel.trim() || undefined,
        buildingType: 'school',
        polygonPoints: drawnPolygonDraft?.points,
        footprintAreaM2: drawnPolygonDraft ? undefined : Number(manualAreaM2) || 300,
      });
      setShowManualForm(false);
      setDrawnPolygonDraft(null);
      setManualName('');
      setManualLabel('');
    } finally {
      setSavingBuilding(false);
    }
  };

  const { campusSummary, discovery } = workspace;
  const academicCount = workspace.buildings.filter((b) => b.solarEligible).length;
  const sportsCount = workspace.buildings.filter((b) => b.featureKind === 'sports_ground').length;

  return (
    <div className="space-y-5">
      {/* Compact Campus Mapping Control Bar (clean unboxed metadata, zero warning clutter) */}
      <div className="rw-surface rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
        <div className="space-y-1 min-w-0">
          <div className="text-xs font-bold text-neutral-900">
            Campus Building & Rooftop Geometry
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500 tabular-nums">
            <span className="font-mono text-neutral-700">
              {academicCount} academic buildings ({campusSummary.combinedGrossFootprintAreaM2.toLocaleString()} m² footprint)
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-neutral-700">
              {campusSummary.combinedUsableRoofAreaM2.toLocaleString()} m² usable (provisional)
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-emerald-800 font-semibold">
              {campusSummary.combinedCapacityKwp} kWp
            </span>
            <span aria-hidden="true">·</span>
            <span>{sportsCount} non-building sports grounds</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 font-mono text-[11px]">
              <MapPin className="w-3 h-3 text-emerald-700" />
              {workspace.campus.latitude.toFixed(4)}°N, {workspace.campus.longitude.toFixed(4)}°E
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isAdminUnlocked ? (
            <>
              <ActionButton
                variant="primary"
                size="sm"
                disabled={isBusy}
                onClick={() => {
                  setDrawnPolygonDraft(null);
                  setShowManualForm((v) => !v);
                }}
                icon={<Plus className="w-3.5 h-3.5 text-emerald-300" />}
              >
                Add Building
              </ActionButton>
              <ActionButton
                variant="secondary"
                size="sm"
                loading={isBusy}
                onClick={() => onRefreshDiscovery()}
                title={`Query supplementary OpenStreetMap footprints within ${discovery.searchRadiusMeters} m`}
                icon={<RefreshCw className="w-3.5 h-3.5" />}
              >
                Sync OSM
              </ActionButton>
              <ActionButton
                variant="secondary"
                size="sm"
                disabled={isBusy}
                onClick={() => onRestoreCampus()}
                title="Restore original image-reconstructed campus layout"
                icon={<RotateCcw className="w-3.5 h-3.5" />}
              >
                Restore Layout
              </ActionButton>
            </>
          ) : (
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={onRequestAdminUnlock}
              icon={<Lock className="w-3.5 h-3.5 text-[#5c6a64]" />}
            >
              Unlock Admin to Edit Campus
            </ActionButton>
          )}
        </div>
      </div>

      {/* Add / Save Drawn Custom Building Form */}
      {showManualForm && isAdminUnlocked && (
        <form
          onSubmit={handleSubmitManualBuilding}
          className="rw-surface rounded-2xl p-4 sm:p-5 border border-emerald-200 bg-emerald-50/30 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-emerald-950">
              {drawnPolygonDraft
                ? `Save Drawn Building Footprint (~${drawnPolygonDraft.approxAreaM2.toLocaleString()} m² · ${drawnPolygonDraft.points.length} vertices)`
                : 'Add Custom Campus Building'}
            </h3>
            <InlineActionLink
              tone="neutral"
              onClick={() => {
                setShowManualForm(false);
                setDrawnPolygonDraft(null);
              }}
            >
              Cancel
            </InlineActionLink>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                Building Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g., Science Annex"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs text-neutral-900"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                Campus Label (optional)
              </label>
              <input
                type="text"
                placeholder="e.g., West Academic Wing"
                value={manualLabel}
                onChange={(e) => setManualLabel(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs text-neutral-900"
              />
            </div>
            {!drawnPolygonDraft && (
              <div>
                <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                  Confirmed Gross Roof Area (m²)
                </label>
                <input
                  type="number"
                  min={10}
                  max={50000}
                  required
                  value={manualAreaM2}
                  onChange={(e) => setManualAreaM2(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-mono text-neutral-900"
                />
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <ActionButton
              type="submit"
              variant="primary"
              size="sm"
              loading={savingBuilding}
              icon={<Save className="w-3.5 h-3.5 text-emerald-300" />}
            >
              Save Building
            </ActionButton>
          </div>
        </form>
      )}

      {/* Main 2-column architectural workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <div className="xl:col-span-7 space-y-4">
          <CampusFootprintMap
            campusLat={workspace.campus.latitude}
            campusLon={workspace.campus.longitude}
            institutionName={workspace.campus.institutionName}
            searchRadiusMeters={workspace.assumptions.searchRadiusMeters}
            campusLayout={workspace.campusLayout}
            buildings={workspace.buildings}
            schoolBoundaries={workspace.schoolBoundaries}
            selectedBuildingId={selectedId}
            onSelectBuilding={setSelectedId}
            isAdminUnlocked={isAdminUnlocked}
            onCreateDrawnBuilding={(points, approxAreaM2) => {
              setDrawnPolygonDraft({ points, approxAreaM2 });
              setManualName('Custom Campus Roof');
              setShowManualForm(true);
            }}
          />

          {/* Clean Campus Structures Directory */}
          <div className="rw-surface rounded-2xl p-3.5 sm:p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="overflow-x-auto max-w-full">
                <div className="flex items-center gap-1.5">
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'academic', label: 'Academic Roofs' },
                      { id: 'sports', label: 'Sports' },
                      { id: 'osm', label: `OSM (${discovery.osmBuildingsCount})` },
                    ] as Array<{ id: FilterTab; label: string }>
                  ).map((tab) => (
                    <FilterChipButton
                      key={tab.id}
                      layoutId="roof-directory-filter"
                      active={filter === tab.id}
                      onClick={() => setFilter(tab.id)}
                    >
                      {tab.label}
                    </FilterChipButton>
                  ))}
                </div>
              </div>

              <input
                type="search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search structures..."
                className="px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs text-neutral-800 w-full sm:w-44 focus:outline-none focus:border-emerald-700"
              />
            </div>

            <div className="max-h-[340px] overflow-y-auto divide-y divide-neutral-200/70">
              {filteredBuildings.length === 0 ? (
                <div className="py-8 text-center text-xs text-neutral-500">
                  No campus features match this filter.
                </div>
              ) : (
                filteredBuildings.map((b) => {
                  const active = b.id === selectedId;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelectedId(b.id)}
                      className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                        active ? 'bg-emerald-50/75' : 'hover:bg-neutral-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-semibold text-neutral-900 truncate">
                            {b.displayName}
                          </span>
                          <span className="text-[11px] text-neutral-500">
                            {b.sourceLabel}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-neutral-500 flex flex-wrap items-center gap-x-2 tabular-nums">
                          <span className="font-mono">
                            {b.geometry.grossFootprintAreaM2.toLocaleString()} m²
                          </span>
                          {b.solarEligible ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono">{b.capacity.effectiveCapacityKwp} kWp</span>
                              {b.linkedRoomCount > 0 && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{b.linkedRoomCount} rooms</span>
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>Campus sports ground</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0 tabular-nums">
                        {b.solarEligible ? (
                          <>
                            <div className="text-xs font-mono font-semibold text-neutral-900">
                              {b.solarEstimate
                                ? `${Math.round(b.solarEstimate.annualGenerationKwh).toLocaleString()} kWh/yr`
                                : `${b.capacity.estimatedPanelCount} panels`}
                            </div>
                            <div className="text-[10px] text-neutral-500">
                              {b.solarEstimate ? b.solarEstimate.provenanceLabel : 'Ready for PVGIS'}
                            </div>
                          </>
                        ) : (
                          <div className="text-[11px] text-neutral-500">Non-roof feature</div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Selected Building / Campus Feature Detail & Separated Visual/Analytical Controls */}
        <div className="xl:col-span-5 rw-surface rounded-2xl p-4 sm:p-5 space-y-4">
          {!selectedBuilding ? (
            <div className="py-12 text-center space-y-2">
              <Building2 className="w-7 h-7 text-neutral-300 mx-auto" />
              <div className="text-xs font-semibold text-neutral-800">
                Select a campus building or sports ground
              </div>
              <p className="text-[11px] text-neutral-500">
                Inspect reconstructed roof geometry, linked ROOMWISE classrooms, and PVGIS solar output.
              </p>
            </div>
          ) : (
            <>
              <SectionHeading
                title={selectedBuilding.displayName}
                meta={`${selectedBuilding.sourceLabel}${
                  selectedBuilding.levels
                    ? ` · ${selectedBuilding.levels === 4 ? 'G+3 (4 floors)' : `${selectedBuilding.levels} floor${selectedBuilding.levels > 1 ? 's' : ''}`}`
                    : ''
                }`}
                action={
                  selectedBuilding.source === 'manual' && isAdminUnlocked ? (
                    <IconButton
                      variant="danger"
                      size="xs"
                      label="Delete custom building"
                      onClick={() => onDeleteManualBuilding(selectedBuilding.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </IconButton>
                  ) : undefined
                }
              />

              {/* Parent-Child Building Relationship & ROOMWISE Classroom Linkage */}
              {(selectedBuilding.relationshipNote || selectedBuilding.linkedRoomCount > 0) && (
                <div className="text-xs text-neutral-600 space-y-2 pb-3 border-b border-neutral-200/70">
                  {selectedBuilding.relationshipNote && (
                    <p className="leading-relaxed">{selectedBuilding.relationshipNote}</p>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    {selectedBuilding.linkedRoomCount > 0 && (
                      <span className="text-emerald-900 font-medium font-mono tabular-nums">
                        ROOMWISE Record: {selectedBuilding.linkedRoomwiseBuilding} ·{' '}
                        {selectedBuilding.linkedRoomCount} room
                        {selectedBuilding.linkedRoomCount > 1 ? 's' : ''} ·{' '}
                        {selectedBuilding.linkedRatedCapacityWatts.toLocaleString()} W rated
                      </span>
                    )}

                    {relatedBuilding && (
                      <InlineActionLink
                        tone="emerald"
                        icon={<Link2 className="w-3 h-3" />}
                        onClick={() => setSelectedId(relatedBuilding.id)}
                      >
                        Inspect {relatedBuilding.displayName}
                      </InlineActionLink>
                    )}
                  </div>
                </div>
              )}

              {/* Branch: Sports Grounds vs Solar-Eligible Academic Roofs */}
              {!selectedBuilding.solarEligible ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-xl bg-[#f6f8f7] border border-neutral-200/70">
                      <div className="text-[11px] text-neutral-500">
                        Supplied Ground Area ({selectedBuilding.geometry.areaProvenanceLabel})
                      </div>
                      <div className="mt-1 font-mono font-bold text-neutral-900 tabular-nums">
                        {selectedBuilding.geometry.grossFootprintAreaM2.toLocaleString()} m²
                      </div>
                      <div className="text-[10px] font-mono text-neutral-500">
                        {selectedBuilding.geometry.grossFootprintAreaFt2.toLocaleString()} ft²
                        {selectedBuilding.geometry.suppliedPerimeterM !== null
                          ? ` · Perim. ${selectedBuilding.geometry.suppliedPerimeterM} m`
                          : ''}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-[#f6f8f7] border border-neutral-200/70">
                      <div className="text-[11px] text-neutral-500">Campus Classification</div>
                      <div className="mt-1 font-semibold text-neutral-900">
                        Open Sports Facility (Non-Building)
                      </div>
                      <div className="text-[10px] text-neutral-500">
                        Source: {selectedBuilding.geometry.measurementSource || 'Campus map'}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-neutral-500 leading-relaxed">
                    Open-air sports facilities are preserved on the campus map for spatial orientation
                    and strictly excluded from academic building footprint totals, rooftop PV capacity,
                    and classroom electrical load tallies.
                  </p>
                </div>
              ) : (
                <>
                  {/* 1. Primary PVGIS Annual Generation Card (Top of Hierarchy) */}
                  <div className="rounded-xl border border-emerald-200/80 p-3.5 bg-emerald-50/40 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-emerald-950">
                        PVGIS 5.3 Estimated Output
                      </div>
                      {selectedBuilding.solarEstimate ? (
                        <div className="mt-0.5 text-sm font-mono text-emerald-950 font-bold tabular-nums">
                          {Math.round(
                            selectedBuilding.solarEstimate.annualGenerationKwh
                          ).toLocaleString()}{' '}
                          kWh/yr{' '}
                          <span className="text-[11px] font-normal text-emerald-900/80 whitespace-nowrap">
                            · {selectedBuilding.solarEstimate.specificYieldKwhPerKwp} kWh/kWp
                          </span>
                        </div>
                      ) : (
                        <div className="text-[11px] text-neutral-600">
                          Run PVGIS 5.3 to estimate multi-year roof yield.
                        </div>
                      )}
                    </div>
                    <ActionButton
                      variant="primary"
                      size="sm"
                      loading={calculatingId === selectedBuilding.id}
                      disabled={isBusy}
                      onClick={async () => {
                        setCalculatingId(selectedBuilding.id);
                        try {
                          await onCalculateBuilding(selectedBuilding.id);
                        } finally {
                          setCalculatingId(null);
                        }
                      }}
                      icon={<Sun className="w-3.5 h-3.5 text-emerald-300" />}
                    >
                      Calculate PVGIS
                    </ActionButton>
                  </div>

                  {/* 2. Authoritative Building Footprint vs Provisional Roof & PV Sizing Metrics */}
                  <div className="grid grid-cols-2 gap-2.5 text-xs tabular-nums">
                    <div className="p-2.5 rounded-xl bg-[#f6f8f7] border border-neutral-200/70 min-w-0">
                      <div className="text-[11px] text-neutral-500 whitespace-nowrap">
                        Building Footprint
                      </div>
                      <div className="mt-0.5 font-mono font-bold text-neutral-900">
                        {selectedBuilding.geometry.grossFootprintAreaM2.toLocaleString()} m²
                      </div>
                      <div className="text-[10px] font-mono text-neutral-500 truncate">
                        {selectedBuilding.geometry.grossFootprintAreaFt2.toLocaleString()} ft²
                        {selectedBuilding.geometry.suppliedPerimeterM !== null
                          ? ` · Perim. ${selectedBuilding.geometry.suppliedPerimeterM} m`
                          : ''}
                      </div>
                      <div className="text-[10px] text-emerald-800/90 truncate mt-0.5">
                        {selectedBuilding.geometry.areaProvenanceLabel}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[#f6f8f7] border border-neutral-200/70 min-w-0">
                      <div className="text-[11px] text-neutral-500 whitespace-nowrap">
                        Usable PV Area (Provisional)
                      </div>
                      <div className="mt-0.5 font-mono font-bold text-neutral-900">
                        {selectedBuilding.capacity.usableRoofAreaM2.toLocaleString()} m²
                      </div>
                      <div className="text-[10px] text-neutral-500 truncate">
                        {selectedBuilding.capacity.obstructionSetbackAreaM2.toLocaleString()} m² setbacks ·{' '}
                        {selectedBuilding.capacity.rowSpacingWalkwayAreaM2.toLocaleString()} m² spacing
                      </div>
                      <div className="text-[10px] text-neutral-500 truncate mt-0.5">
                        Actual roof surface: {selectedBuilding.geometry.roofSurfaceAreaProvenanceLabel}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[#f6f8f7] border border-neutral-200/70 min-w-0">
                      <div className="text-[11px] text-neutral-500 whitespace-nowrap">Hypothetical PV</div>
                      <div className="mt-0.5 font-mono font-bold text-emerald-900">
                        {selectedBuilding.capacity.effectiveCapacityKwp} kWp
                      </div>
                      <div className="text-[10px] text-neutral-500 truncate">
                        {selectedBuilding.capacity.estimatedPanelCount} panels (
                        {selectedBuilding.capacity.estimatedPanelAreaM2} m² net glass)
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[#f6f8f7] border border-neutral-200/70 min-w-0">
                      <div className="text-[11px] text-neutral-500 whitespace-nowrap">Roof Plan &amp; Tilt</div>
                      <div className="mt-0.5 font-semibold text-neutral-900 truncate">
                        {selectedBuilding.geometry.estimatedRoofPlanAreaM2?.toLocaleString() ?? '—'} m² plan
                      </div>
                      <div className="text-[10px] font-mono text-neutral-500 truncate">
                        {selectedBuilding.roofConfig.tiltDegrees}° tilt ·{' '}
                        {selectedBuilding.roofConfig.aspectDegrees}° az · Height: {selectedBuilding.geometry.verticalGeometryProvenanceLabel}
                      </div>
                    </div>
                  </div>

                  {selectedBuilding.geometry.combinedComplexNote && (
                    <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/40 px-3 py-2 text-[11px] text-emerald-950 leading-relaxed">
                      <span className="font-semibold">Combined OB + NB Measurement: </span>
                      {selectedBuilding.geometry.combinedComplexNote}
                    </div>
                  )}

                  {selectedBuilding.geometry.measurementSource && (
                    <div className="text-[10.5px] text-neutral-500 leading-relaxed">
                      <span className="font-medium text-neutral-700">Geometry Source:</span>{' '}
                      {selectedBuilding.geometry.measurementSource}
                      {selectedBuilding.geometry.lastUpdated
                        ? ` (updated ${selectedBuilding.geometry.lastUpdated})`
                        : ''}
                      . Horizontal footprint plan area does not equal actual roof-surface area or verified usable solar area.
                    </div>
                  )}

                  {/* 3. Analytical Confirmation Status Controls */}
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionButton
                      variant={selectedBuilding.selectionStatus === 'confirmed' ? 'forest' : 'secondary'}
                      size="sm"
                      disabled={savingBuilding}
                      onClick={() => handleStatusChange(selectedBuilding.id, 'confirmed', true)}
                      icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                      className="flex-1"
                    >
                      {selectedBuilding.selectionStatus === 'confirmed'
                        ? 'Confirmed Roof'
                        : 'Confirm Roof'}
                    </ActionButton>
                    <ActionButton
                      variant={selectedBuilding.selectionStatus === 'excluded' ? 'primary' : 'secondary'}
                      size="sm"
                      disabled={savingBuilding}
                      onClick={() =>
                        handleStatusChange(
                          selectedBuilding.id,
                          selectedBuilding.selectionStatus === 'excluded'
                            ? 'provisional'
                            : 'excluded'
                        )
                      }
                      icon={<XCircle className="w-3.5 h-3.5" />}
                    >
                      {selectedBuilding.selectionStatus === 'excluded'
                        ? 'Include Roof'
                        : 'Exclude'}
                    </ActionButton>
                  </div>

                  {/* 4. Collapsible Secondary Details: Roof & PV Parameters */}
                  <div className="pt-3 border-t border-neutral-200/75">
                    <button
                      type="button"
                      onClick={() => setShowParamsForm((v) => !v)}
                      aria-expanded={showParamsForm}
                      className="w-full flex items-center justify-between gap-2 text-left rounded-xl px-2 py-1.5 -mx-2 -my-1 hover:bg-[#f6f8f7] transition-colors cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6e4f]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Sliders className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                        <span className="text-xs font-bold text-neutral-800 whitespace-nowrap">
                          Roof &amp; PV Parameters
                        </span>
                        <span className="text-[11px] font-mono text-neutral-500 truncate hidden sm:inline">
                          {selectedBuilding.roofConfig.tiltDegrees}° · {selectedBuilding.roofConfig.aspectDegrees}° · {selectedBuilding.roofConfig.systemLossesPercent}% loss
                        </span>
                      </div>
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500 group-hover:text-neutral-900 shrink-0 whitespace-nowrap">
                        {!isAdminUnlocked && <span>Read-only</span>}
                        <span className="w-6 h-6 rounded-md bg-white border border-[#111916]/12 group-hover:border-[#0b6e4f]/35 transition-colors inline-flex items-center justify-center text-[#46544e]">
                          {showParamsForm ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </span>
                      </span>
                    </button>

                    {showParamsForm && (
                      <form onSubmit={handleSaveBuildingOverrides} className="mt-3 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                          <div>
                            <label className="block text-[11px] text-neutral-500 mb-0.5">
                              Building Name
                            </label>
                            <input
                              type="text"
                              disabled={!isAdminUnlocked}
                              placeholder={selectedBuilding.osmName || 'Building name'}
                              value={editCustomName}
                              onChange={(e) => setEditCustomName(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs disabled:bg-neutral-50"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-neutral-500 mb-0.5">
                              Gross Area (m²)
                            </label>
                            <input
                              type="number"
                              min={5}
                              max={50000}
                              step={1}
                              disabled={!isAdminUnlocked}
                              placeholder={String(selectedBuilding.geometry.grossFootprintAreaM2)}
                              value={editGrossAreaM2}
                              onChange={(e) => setEditGrossAreaM2(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white font-mono text-xs disabled:bg-neutral-50"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-neutral-500 mb-0.5">
                              Usable Roof (%)
                            </label>
                            <input
                              type="number"
                              min={10}
                              max={100}
                              step={1}
                              disabled={!isAdminUnlocked}
                              placeholder={String(workspace.assumptions.usableRoofFractionPercent)}
                              value={editUsablePct}
                              onChange={(e) => setEditUsablePct(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white font-mono text-xs disabled:bg-neutral-50"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-neutral-500 mb-0.5">
                              Manual Capacity (kWp)
                            </label>
                            <input
                              type="number"
                              min={0.1}
                              max={5000}
                              step={0.1}
                              disabled={!isAdminUnlocked}
                              placeholder={String(selectedBuilding.capacity.calculatedCapacityKwp)}
                              value={editManualKwp}
                              onChange={(e) => setEditManualKwp(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white font-mono text-xs disabled:bg-neutral-50"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-neutral-500 mb-0.5">
                              Tilt (°)
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={90}
                              disabled={!isAdminUnlocked}
                              placeholder={String(selectedBuilding.roofConfig.tiltDegrees)}
                              value={editTilt}
                              onChange={(e) => setEditTilt(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white font-mono text-xs disabled:bg-neutral-50"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-neutral-500 mb-0.5">
                              Aspect (
                              <MathText
                                tex="0^\circ = \mathrm{S},\; \pm 90^\circ = \mathrm{E/W}"
                                ariaLabel="0 degrees equals South, plus or minus 90 degrees equals East or West"
                              />
                              )
                            </label>
                            <input
                              type="number"
                              min={-180}
                              max={180}
                              disabled={!isAdminUnlocked}
                              placeholder={String(selectedBuilding.roofConfig.aspectDegrees)}
                              value={editAspect}
                              onChange={(e) => setEditAspect(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white font-mono text-xs disabled:bg-neutral-50"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-neutral-500 mb-0.5">
                              System Losses (%)
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={50}
                              step={0.5}
                              disabled={!isAdminUnlocked}
                              placeholder={String(workspace.assumptions.systemLossesPercent)}
                              value={editLosses}
                              onChange={(e) => setEditLosses(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white font-mono text-xs disabled:bg-neutral-50"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-neutral-500 mb-0.5">
                              Mounting
                            </label>
                            <select
                              disabled={!isAdminUnlocked}
                              value={editMount}
                              onChange={(e) => setEditMount(e.target.value as PvgisMountingPlace | '')}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs disabled:bg-neutral-50"
                            >
                              <option value="">
                                Default ({workspace.assumptions.mountingPlace === 'free' ? 'Elevated open-rack' : 'Flush / BIPV'})
                              </option>
                              <option value="free">Elevated open-rack (Flat RCC)</option>
                              <option value="building">Flush / BIPV roof-mounted</option>
                            </select>
                          </div>
                        </div>

                        {isAdminUnlocked && (
                          <ActionButton
                            type="submit"
                            variant="primary"
                            size="sm"
                            fullWidth
                            loading={savingBuilding}
                            icon={<Save className="w-3.5 h-3.5 text-emerald-300" />}
                          >
                            Save Parameters
                          </ActionButton>
                        )}
                      </form>
                    )}
                  </div>
                </>
              )}

              {/* 5. Collapsible Visual Placement Nudge Controls (Admin) */}
              {isAdminUnlocked && (
                <div className="pt-3 border-t border-neutral-200/75">
                  <button
                    type="button"
                    onClick={() => setShowPositionTools((v) => !v)}
                    aria-expanded={showPositionTools}
                    className="w-full flex items-center justify-between gap-2 text-xs rounded-xl px-2 py-1.5 -mx-2 -my-1 hover:bg-[#f6f8f7] transition-colors cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6e4f]"
                  >
                    <span className="font-bold text-neutral-800 whitespace-nowrap">
                      Visual Map Position
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-neutral-500 tabular-nums">
                      <span>
                        <MathText
                          tex={`\\Delta E = ${selectedBuilding.override?.offsetEastMeters ?? 0}\\,\\mathrm{m},\\; \\Delta N = ${selectedBuilding.override?.offsetNorthMeters ?? 0}\\,\\mathrm{m}`}
                          ariaLabel={`Delta E equals ${selectedBuilding.override?.offsetEastMeters ?? 0} meters, Delta N equals ${selectedBuilding.override?.offsetNorthMeters ?? 0} meters`}
                        />
                      </span>
                      <span className="w-6 h-6 rounded-md bg-white border border-[#111916]/12 group-hover:border-[#0b6e4f]/35 transition-colors inline-flex items-center justify-center text-[#46544e]">
                        {showPositionTools ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </span>
                    </span>
                  </button>

                  {showPositionTools && (
                    <div className="mt-2.5 space-y-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ActionButton
                          variant="secondary"
                          size="xs"
                          disabled={savingBuilding}
                          onClick={() => handleNudgePosition(0, 2)}
                          icon={<ArrowUp className="w-3 h-3" />}
                        >
                          2m N
                        </ActionButton>
                        <ActionButton
                          variant="secondary"
                          size="xs"
                          disabled={savingBuilding}
                          onClick={() => handleNudgePosition(0, -2)}
                          icon={<ArrowDown className="w-3 h-3" />}
                        >
                          2m S
                        </ActionButton>
                        <ActionButton
                          variant="secondary"
                          size="xs"
                          disabled={savingBuilding}
                          onClick={() => handleNudgePosition(-2, 0)}
                          icon={<ArrowLeft className="w-3 h-3" />}
                        >
                          2m W
                        </ActionButton>
                        <ActionButton
                          variant="secondary"
                          size="xs"
                          disabled={savingBuilding}
                          onClick={() => handleNudgePosition(2, 0)}
                          icon={<ArrowRight className="w-3 h-3" />}
                        >
                          2m E
                        </ActionButton>
                        <InlineActionLink
                          tone="neutral"
                          disabled={savingBuilding}
                          onClick={handleResetVisualOffset}
                          className="ml-auto"
                        >
                          Reset
                        </InlineActionLink>
                      </div>
                      <p className="text-[11px] text-neutral-500">
                        Visual alignment only; analytical roof area is unchanged.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
