/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CloudSun,
  History,
  Layers,
  Loader2,
  MapPin,
  ShieldAlert,
  Sun,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SectionHeading, TelemetryReadout } from '../common/DesignSystem';
import { MathText } from '../common/MathText';
import type {
  SolarPlanningScenarioId,
  SolarScenarioComparisonRow,
  SolarWorkspaceResponse,
} from '../../types/solar';

interface SolarPotentialPanelProps {
  workspace: SolarWorkspaceResponse;
  onCalculateCampus: (buildingIds?: string[], forceRefresh?: boolean) => Promise<void>;
  onCalculateBuilding: (buildingId: string) => Promise<void>;
  onNavigateMapping: () => void;
  isBusy: boolean;
}

const formatMountingLabel = (mountingPlace: string) =>
  mountingPlace === 'free' ? 'Elevated open-rack' : 'Flush / BIPV';

export const SolarPotentialPanel: React.FC<SolarPotentialPanelProps> = ({
  workspace,
  onCalculateCampus,
  onCalculateBuilding,
  onNavigateMapping,
  isBusy,
}) => {
  const [subsetIds, setSubsetIds] = useState<string[]>([]);
  const [showMonthlyTable, setShowMonthlyTable] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showFeasibility, setShowFeasibility] = useState(true);
  const [calculatingId, setCalculatingId] = useState<string | null>(null);
  const [previewScenarioId, setPreviewScenarioId] = useState<SolarPlanningScenarioId | null>(null);

  const selectedBuildings = useMemo(
    () =>
      workspace.buildings.filter(
        (b) =>
          b.solarEligible &&
          (b.selectionStatus === 'confirmed' || b.selectionStatus === 'provisional')
      ),
    [workspace.buildings]
  );

  const toggleSubset = (id: string) => {
    setSubsetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const { campusSummary, shortTermSkyContext } = workspace;

  const isProvisional = campusSummary.mode === 'provisional_fallback';

  const activeScenarioRow: SolarScenarioComparisonRow | null = useMemo(() => {
    if (!previewScenarioId || previewScenarioId === campusSummary.activeScenarioId) return null;
    return (
      campusSummary.scenarioComparisons?.find((s) => s.scenarioId === previewScenarioId) ?? null
    );
  }, [previewScenarioId, campusSummary.activeScenarioId, campusSummary.scenarioComparisons]);

  // Unified figures for KPI cards & Monthly PVGIS Plot so switching planning scenarios stays 100% internally consistent
  const displayedAnnualKwh = activeScenarioRow
    ? activeScenarioRow.annualGenerationKwh
    : campusSummary.combinedAnnualGenerationKwh;
  const displayedMonthlyAvgKwh = activeScenarioRow
    ? Math.round(activeScenarioRow.annualGenerationKwh / 12)
    : Math.round(campusSummary.combinedMonthlyAvgGenerationKwh);
  const displayedDailyAvgKwh = activeScenarioRow
    ? Math.round((activeScenarioRow.annualGenerationKwh / 365) * 10) / 10
    : campusSummary.combinedDailyAvgGenerationKwh;
  const displayedCapacityKwp = activeScenarioRow
    ? activeScenarioRow.capacityKwp
    : campusSummary.combinedCapacityKwp;
  const displayedPanelCount = activeScenarioRow
    ? activeScenarioRow.estimatedPanelCount
    : campusSummary.combinedEstimatedPanelCount;
  const displayedPanelAreaM2 = activeScenarioRow
    ? activeScenarioRow.estimatedPanelAreaM2
    : campusSummary.combinedEstimatedPanelAreaM2;
  const displayedUsableAreaM2 = activeScenarioRow
    ? activeScenarioRow.usableRoofAreaM2
    : campusSummary.combinedUsableRoofAreaM2;
  const displayedObstructionSetbackM2 = activeScenarioRow
    ? activeScenarioRow.obstructionSetbackAreaM2
    : campusSummary.combinedObstructionSetbackAreaM2;
  const displayedRowSpacingM2 = activeScenarioRow
    ? activeScenarioRow.rowSpacingWalkwayAreaM2
    : campusSummary.combinedRowSpacingWalkwayAreaM2;
  const displayedMonthlyData = activeScenarioRow
    ? activeScenarioRow.monthlyGeneration
    : campusSummary.combinedMonthlyGeneration;
  const displayedScenarioLabel = activeScenarioRow
    ? activeScenarioRow.label
    : campusSummary.activeScenarioLabel;
  const displayedUsablePct = activeScenarioRow
    ? activeScenarioRow.usableRoofFractionPercent
    : workspace.assumptions.usableRoofFractionPercent;
  const displayedPackingPct = activeScenarioRow
    ? activeScenarioRow.packingFactorPercent
    : workspace.assumptions.packingFactorPercent;
  const displayedNetCoveragePct =
    campusSummary.combinedGrossFootprintAreaM2 > 0
      ? Math.round((displayedPanelAreaM2 / campusSummary.combinedGrossFootprintAreaM2) * 1000) / 10
      : 0;

  return (
    <div className="space-y-5">
      {/* Mode & Action Banner */}
      <div className="rw-surface rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border whitespace-nowrap ${
                isProvisional
                  ? 'bg-neutral-100 text-neutral-700 border-neutral-200'
                  : 'bg-emerald-50 text-emerald-900 border-emerald-200'
              }`}
            >
              {campusSummary.modeLabel}
            </span>
            <span className="text-[11px] font-mono text-neutral-500 whitespace-nowrap">
              {campusSummary.provenanceLabel}
            </span>
            <span className="text-[11px] font-medium text-neutral-400 whitespace-nowrap">
              · Planning estimate
            </span>
          </div>
          <p className="text-xs text-neutral-600 leading-relaxed">
            {isProvisional
              ? campusSummary.fallbackNotice
              : `${campusSummary.selectedBuildingsCount} academic buildings (${campusSummary.combinedGrossFootprintAreaM2.toLocaleString()} m² supplied horizontal footprint · actual roof-surface area: Not available) · ${campusSummary.calculatedBuildingsCount}/${campusSummary.selectedBuildingsCount} evaluated via PVGIS 5.3 · Active: ${displayedScenarioLabel}.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {subsetIds.length > 0 && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onCalculateCampus(subsetIds, false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-900 border border-emerald-300 hover:bg-emerald-100 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <Sun className="w-3.5 h-3.5" />
              Calculate Subset ({subsetIds.length})
            </button>
          )}
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onCalculateCampus(undefined, false)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#0b2e22] text-white hover:bg-emerald-950 disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            {isBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sun className="w-3.5 h-3.5" />
            )}
            {isProvisional ? 'Run PVGIS Scenario' : 'Calculate Campus PVGIS'}
          </button>
        </div>
      </div>

      {/* Radiation database fallback disclosure (e.g., SARAH3 -> ERA5 at Kharagpur) */}
      {campusSummary.fallbackNotice && !isProvisional && (
        <div className="rounded-xl border border-neutral-200 bg-[#f7f9f8] px-4 py-2.5 flex items-start gap-2 text-xs text-neutral-700">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>{campusSummary.fallbackNotice}</span>
        </div>
      )}

      {/* Planning Scenario Comparison Band (Conservative / Moderate / High-Utilisation Theoretical) */}
      {campusSummary.scenarioComparisons && campusSummary.scenarioComparisons.length > 0 && (
        <div className="rw-surface rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-700 shrink-0" />
              <div>
                <h3 className="text-xs font-bold text-neutral-900">
                  Flat RCC Rooftop Planning Scenarios (Physical Roof Potential Only)
                </h3>
                <p className="text-[11px] text-neutral-500">
                  Compare conservative, moderate (recommended default), and upper-bound theoretical utilisation. Selecting a scenario updates the KPI cards and monthly PVGIS plot below.
                </p>
              </div>
            </div>
            {previewScenarioId && previewScenarioId !== campusSummary.activeScenarioId && (
              <button
                type="button"
                onClick={() => setPreviewScenarioId(null)}
                className="text-[11px] font-semibold text-emerald-800 hover:underline self-start sm:self-center cursor-pointer whitespace-nowrap"
              >
                Return to Saved Default
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {campusSummary.scenarioComparisons.map((sc) => {
              const isSelected =
                (previewScenarioId ?? campusSummary.activeScenarioId) === sc.scenarioId;
              const isSavedDefault = campusSummary.activeScenarioId === sc.scenarioId;
              return (
                <button
                  key={sc.scenarioId}
                  type="button"
                  onClick={() =>
                    setPreviewScenarioId(
                      sc.scenarioId === campusSummary.activeScenarioId ? null : sc.scenarioId
                    )
                  }
                  className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-[#0b2e22] bg-emerald-50/55 rw-card-alive ring-1 ring-[#0b2e22]/20'
                      : 'border-neutral-200 bg-[#fafcfb] hover:border-neutral-300 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-neutral-900">{sc.shortLabel}</span>
                    {isSavedDefault && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900">
                        Active Default
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
                    <span className="text-base font-bold text-emerald-950">
                      {sc.capacityKwp.toLocaleString()} kWp
                    </span>
                    <span className="text-[11px] text-neutral-600">
                      · {Math.round(sc.annualGenerationKwh).toLocaleString()} kWh/yr
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-neutral-600 tabular-nums flex flex-wrap items-baseline gap-1">
                    <MathText
                      tex={`${sc.usableRoofFractionPercent}\\% \\times ${sc.packingFactorPercent}\\% = ${sc.netRoofCoveragePercent}\\%`}
                      ariaLabel={`${sc.usableRoofFractionPercent} percent times ${sc.packingFactorPercent} percent equals ${sc.netRoofCoveragePercent} percent`}
                    />
                    <span className="font-mono text-neutral-500">
                      net · {sc.estimatedPanelCount} panels
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-neutral-600 leading-snug">{sc.summary}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Primary KPI Readout Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-3.5">
        <TelemetryReadout
          tone="forest"
          label="Modelled Annual PV Yield"
          value={Math.round(displayedAnnualKwh).toLocaleString()}
          unit="kWh/yr"
          detail={`${displayedMonthlyAvgKwh.toLocaleString()} kWh/mo · ${displayedDailyAvgKwh} kWh/d`}
          footnote={`Specific yield: ${campusSummary.weightedSpecificYieldKwhPerKwp} kWh/kWp/yr`}
        />
        <TelemetryReadout
          tone="emerald"
          label="Hypothetical PV Capacity"
          value={displayedCapacityKwp.toLocaleString()}
          unit="kWp"
          detail={`${displayedPanelCount.toLocaleString()} × ${workspace.assumptions.panelRatedWatts} W modules`}
          footnote={`${displayedPanelAreaM2.toLocaleString()} m² net glass (${displayedNetCoveragePct}% of gross)`}
        />
        <TelemetryReadout
          label={isProvisional ? 'Provisional Roof Area' : 'Usable PV Area (Provisional)'}
          value={displayedUsableAreaM2.toLocaleString()}
          unit="m² usable"
          detail={`${campusSummary.combinedGrossFootprintAreaM2.toLocaleString()} m² footprint plan · ${displayedObstructionSetbackM2.toLocaleString()} m² setbacks/obstructions`}
          footnote={`${displayedRowSpacingM2.toLocaleString()} m² spacing/aisles (${displayedUsablePct}% × ${displayedPackingPct}%) · Actual roof surface: Not available`}
        />
        <TelemetryReadout
          label="PVGIS 5.3 Parameters"
          value={`${workspace.assumptions.systemLossesPercent}%`}
          unit="loss"
          detail={`${workspace.assumptions.pvTechnology} · ${formatMountingLabel(workspace.assumptions.mountingPlace)}`}
          footnote={`Tilt ${workspace.assumptions.flatRoofTiltDegrees}° · Aspect ${workspace.assumptions.flatRoofAspectDegrees}° (South)`}
        />
      </div>

      {/* Monthly PVGIS Generation & In-Plane Irradiation Chart */}
      <div className="rw-surface rounded-2xl p-4 sm:p-5 space-y-4">
        <SectionHeading
          title="Modelled Monthly PV Generation & Irradiation"
          subtitle={`PVGIS 5.3 multi-year climatology (${displayedScenarioLabel} — ${displayedCapacityKwp} kWp hypothetical array). Not an installed metered output.`}
          meta={campusSummary.provenanceLabel}
        />

        <div className="h-[270px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={displayedMonthlyData}
              margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e9e7" vertical={false} />
              <XAxis
                dataKey="monthLabel"
                tick={{ fontSize: 11, fill: '#4a5851' }}
                axisLine={{ stroke: '#d4dcd8' }}
                tickLine={false}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11, fill: '#4a5851' }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: '#92400e' }}
                axisLine={false}
                tickLine={false}
                width={44}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  borderColor: '#d4dcd8',
                  borderRadius: '12px',
                  fontSize: '12px',
                }}
              />
              <Bar
                yAxisId="left"
                dataKey="generationKwh"
                name="Modelled PV Generation (kWh)"
                fill="#0b5d42"
                radius={[5, 5, 0, 0]}
                maxBarSize={36}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="avgIrradiationKwhM2"
                name="In-Plane Irradiation (kWh/m²)"
                stroke="#d97706"
                strokeWidth={2}
                dot={{ r: 3, fill: '#d97706' }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Expandable 12-month data table */}
        <div>
          <button
            type="button"
            onClick={() => setShowMonthlyTable((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-900 hover:text-emerald-700 cursor-pointer"
          >
            {showMonthlyTable ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
            {showMonthlyTable ? 'Hide Monthly Breakdown Table' : 'Show 12-Month Breakdown Table'}
          </button>

          {showMonthlyTable && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 text-neutral-500 text-left">
                    <th className="py-2 pr-3 font-medium whitespace-nowrap">Month</th>
                    <th className="py-2 px-3 font-medium text-right whitespace-nowrap">
                      Modelled Generation (kWh)
                    </th>
                    <th className="py-2 pl-3 font-medium text-right whitespace-nowrap">
                      Irradiation (kWh/m²)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 font-mono">
                  {displayedMonthlyData.map((m) => (
                    <tr key={m.month}>
                      <td className="py-1.5 pr-3 font-sans font-medium text-neutral-800">
                        {m.monthLabel}
                      </td>
                      <td className="py-1.5 px-3 text-right text-neutral-900">
                        {m.generationKwh.toLocaleString()}
                      </td>
                      <td className="py-1.5 pl-3 text-right text-neutral-600">
                        {m.avgIrradiationKwhM2 !== null ? m.avgIrradiationKwhM2 : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Electrical, Grid-Connection & Structural Feasibility Boundary */}
      {campusSummary.gridFeasibilityChecklist && campusSummary.gridFeasibilityChecklist.length > 0 && (
        <div className="rw-surface rounded-2xl p-4 sm:p-5 space-y-3">
          <button
            type="button"
            onClick={() => setShowFeasibility((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
          >
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-xs font-bold text-neutral-900">
                  Grid-Connection, Structural &amp; Regulatory Feasibility (Separate from Roof Area Potential)
                </h3>
                <p className="text-[11px] text-neutral-500">
                  Physical rooftop PV capacity ({displayedCapacityKwp} kWp) is not yet an approved or buildable plant size until site electrical and structural limits are verified.
                </p>
              </div>
            </div>
            {showFeasibility ? (
              <ChevronUp className="w-4 h-4 text-neutral-500 shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 text-neutral-500 shrink-0" />
            )}
          </button>

          {showFeasibility && (
            <div className="pt-2 border-t border-neutral-200/70 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
              {campusSummary.gridFeasibilityChecklist.map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-xl bg-[#fafcfb] border border-neutral-200/80 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-neutral-900">{item.label}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200/80 whitespace-nowrap">
                      {item.valueLabel}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-600 leading-relaxed">{item.note}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Per-Building Breakdown & Subset Selector */}
      <div className="rw-surface rounded-2xl p-4 sm:p-5 space-y-3">
        <SectionHeading
          title="Per-Building Solar Breakdown"
          subtitle="Independent PVGIS evaluation per mapped campus roof."
          action={
            <button
              type="button"
              onClick={onNavigateMapping}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-neutral-200 text-xs font-medium text-neutral-700 hover:bg-neutral-50 cursor-pointer whitespace-nowrap"
            >
              <MapPin className="w-3.5 h-3.5 text-emerald-700" />
              Manage Roofs
            </button>
          }
        />

        {selectedBuildings.length === 0 ? (
          <div className="py-6 text-center text-xs text-neutral-500">
            No mapped buildings are marked Confirmed or Provisional yet. Open{' '}
            <button
              type="button"
              onClick={onNavigateMapping}
              className="text-emerald-800 font-semibold underline underline-offset-2 cursor-pointer"
            >
              Building &amp; Roof Mapping
            </button>{' '}
            to confirm campus roofs.
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[740px] text-xs border-collapse">
              <thead>
                <tr className="border-b border-neutral-200 text-neutral-500 text-left">
                  <th className="py-2 pl-4 sm:pl-0 pr-2 w-8 whitespace-nowrap">Subset</th>
                  <th className="py-2 px-2 font-medium whitespace-nowrap">Building</th>
                  <th className="py-2 px-2 font-medium text-right whitespace-nowrap">Footprint m²</th>
                  <th className="py-2 px-2 font-medium text-right whitespace-nowrap">Usable PV m²</th>
                  <th className="py-2 px-2 font-medium text-right whitespace-nowrap">Capacity</th>
                  <th className="py-2 px-2 font-medium text-right whitespace-nowrap">Tilt / Az</th>
                  <th className="py-2 px-2 font-medium text-right whitespace-nowrap">Annual PVGIS</th>
                  <th className="py-2 px-2 font-medium whitespace-nowrap">Provenance</th>
                  <th className="py-2 pl-2 pr-4 sm:pr-0 text-right whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {selectedBuildings.map((b) => (
                  <tr key={b.id} className="hover:bg-neutral-50/70">
                    <td className="py-2 pr-2">
                      <input
                        type="checkbox"
                        checked={subsetIds.includes(b.id)}
                        onChange={() => toggleSubset(b.id)}
                        aria-label={`Select ${b.displayName} for subset`}
                        className="rounded border-neutral-300 text-emerald-700 cursor-pointer"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <div className="font-semibold text-neutral-900">{b.displayName}</div>
                      <div className="text-[10px] text-neutral-500">
                        {b.geometry.areaProvenanceLabel}
                        {b.geometry.suppliedPerimeterM !== null
                          ? ` · Perim. ${b.geometry.suppliedPerimeterM} m`
                          : ' · Part of 1,209.21 m² OB+NB complex'}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-neutral-900">
                      {b.geometry.grossFootprintAreaM2.toLocaleString()}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-neutral-700">
                      {b.capacity.usableRoofAreaM2.toLocaleString()}
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-semibold text-neutral-900">
                      {b.capacity.effectiveCapacityKwp} kWp
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-neutral-600">
                      {b.roofConfig.tiltDegrees}° / {b.roofConfig.aspectDegrees}°
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-semibold text-emerald-900">
                      {b.solarEstimate
                        ? `${Math.round(b.solarEstimate.annualGenerationKwh).toLocaleString()} kWh`
                        : 'Pending'}
                    </td>
                    <td className="py-2 px-2 text-[11px] text-neutral-600">
                      {b.solarEstimate ? b.solarEstimate.provenanceLabel : 'Preliminary estimate'}
                    </td>
                    <td className="py-2 pl-2 text-right">
                      <button
                        type="button"
                        disabled={calculatingId === b.id || isBusy}
                        onClick={async () => {
                          setCalculatingId(b.id);
                          try {
                            await onCalculateBuilding(b.id);
                          } finally {
                            setCalculatingId(null);
                          }
                        }}
                        className="px-2 py-1 rounded-md border border-neutral-200 bg-white text-[11px] font-semibold text-neutral-800 hover:bg-emerald-50 disabled:opacity-50 cursor-pointer"
                      >
                        {calculatingId === b.id ? 'Running...' : 'Calculate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2.5 text-[11px] text-neutral-500 leading-relaxed">
              Horizontal footprint areas derive from supplied Google Maps Measure Distance polygons
              (total {campusSummary.combinedGrossFootprintAreaM2.toLocaleString()} m² across academic buildings;
              OB + NB measured together as 1,209.21 m² with zero double-counting). Actual roof-surface area is{' '}
              <span className="font-medium text-neutral-700">Not available</span>; usable PV areas and setbacks remain
              provisional pending an on-site roof survey. Football Ground (5,300.83 m²) and Basketball Court
              (737.14 m²) are excluded from building and solar totals.
            </p>
          </div>
        )}
      </div>

      {/* Compact Short-Term Open-Meteo Sky Context (Explicitly Separated from PVGIS Annual Totals) */}
      <div className="rw-surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <CloudSun className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="text-xs font-semibold text-neutral-900">
              Short-Term Sky Context (Open-Meteo — Separate from PVGIS Climatology)
            </div>
            <p className="text-[11px] text-neutral-500 leading-relaxed">
              {shortTermSkyContext.separationNote}
            </p>
          </div>
        </div>
        {shortTermSkyContext.available ? (
          <div className="flex items-center gap-4 text-xs font-mono shrink-0">
            <div>
              <div className="text-[10px] font-sans text-neutral-500">Cloud Cover</div>
              <div className="font-semibold text-neutral-900">
                {shortTermSkyContext.currentCloudCoverPercent ?? '—'}%
              </div>
            </div>
            <div>
              <div className="text-[10px] font-sans text-neutral-500">Current GHI</div>
              <div className="font-semibold text-neutral-900">
                {shortTermSkyContext.currentGhiWm2 ?? '—'} W/m²
              </div>
            </div>
            <div>
              <div className="text-[10px] font-sans text-neutral-500">Today Peak GTI</div>
              <div className="font-semibold text-neutral-900">
                {shortTermSkyContext.todayPeakGtiWm2 ?? '—'} W/m²
              </div>
            </div>
          </div>
        ) : (
          <span className="text-[11px] text-neutral-500 shrink-0">
            Open Environmental Conditions to refresh live sky snapshot
          </span>
        )}
      </div>

      {/* Expandable Persisted PVGIS Calculation History */}
      <div className="rw-surface rounded-2xl p-4">
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="w-full flex items-center justify-between text-xs font-semibold text-neutral-800 cursor-pointer"
        >
          <span className="inline-flex items-center gap-2">
            <History className="w-3.5 h-3.5 text-emerald-700" />
            Persisted PVGIS Calculation History ({workspace.history.length} saved runs)
          </span>
          {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showHistory && (
          <div className="mt-3 overflow-x-auto">
            {workspace.history.length === 0 ? (
              <p className="text-xs text-neutral-500 py-3">
                No PVGIS calculations have been recorded yet.
              </p>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 text-neutral-500 text-left">
                    <th className="py-1.5 pr-3 font-medium whitespace-nowrap">Timestamp</th>
                    <th className="py-1.5 px-2 font-medium whitespace-nowrap">Target</th>
                    <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">kWp</th>
                    <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">Annual kWh</th>
                    <th className="py-1.5 pl-2 font-medium whitespace-nowrap">Radiation DB</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 font-mono text-[11px]">
                  {workspace.history.map((h) => (
                    <tr key={h.id}>
                      <td className="py-1.5 pr-3 text-neutral-600">{h.createdAtIst}</td>
                      <td className="py-1.5 px-2 font-sans text-neutral-900">{h.targetLabel}</td>
                      <td className="py-1.5 px-2 text-right">{h.peakPowerKwp}</td>
                      <td className="py-1.5 px-2 text-right font-semibold text-emerald-900">
                        {Math.round(h.annualGenerationKwh).toLocaleString()}
                      </td>
                      <td className="py-1.5 pl-2 font-sans text-neutral-600">
                        {h.usedRadiationDatabase}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
