/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Lock,
  RotateCcw,
  Save,
  Sliders,
} from 'lucide-react';
import { SectionHeading } from '../common/DesignSystem';
import { MathText } from '../common/MathText';
import {
  DEFAULT_SOLAR_ASSUMPTIONS,
  SOLAR_PLANNING_SCENARIOS,
  type PvgisMountingPlace,
  type PvgisRadiationDatabaseChoice,
  type PvgisTechnology,
  type SolarAssumptions,
  type SolarWorkspaceResponse,
} from '../../types/solar';

interface SolarAssumptionsPanelProps {
  workspace: SolarWorkspaceResponse;
  isAdminUnlocked: boolean;
  onRequestAdminUnlock: () => void;
  onSaveAssumptions: (patch: Partial<SolarAssumptions>) => Promise<void>;
  onResetAssumptions: () => Promise<void>;
  isBusy: boolean;
}

export const SolarAssumptionsPanel: React.FC<SolarAssumptionsPanelProps> = ({
  workspace,
  isAdminUnlocked,
  onRequestAdminUnlock,
  onSaveAssumptions,
  onResetAssumptions,
  isBusy,
}) => {
  const [form, setForm] = useState<SolarAssumptions>(workspace.assumptions);
  const [showMethodology, setShowMethodology] = useState(false);

  useEffect(() => {
    setForm(workspace.assumptions);
  }, [workspace.assumptions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdminUnlocked) {
      onRequestAdminUnlock();
      return;
    }
    await onSaveAssumptions({
      planningScenario: form.planningScenario,
      searchRadiusMeters: form.searchRadiusMeters,
      usableRoofFractionPercent: form.usableRoofFractionPercent,
      panelRatedWatts: form.panelRatedWatts,
      panelAreaM2: form.panelAreaM2,
      packingFactorPercent: form.packingFactorPercent,
      systemLossesPercent: form.systemLossesPercent,
      flatRoofTiltDegrees: form.flatRoofTiltDegrees,
      flatRoofAspectDegrees: form.flatRoofAspectDegrees,
      pvTechnology: form.pvTechnology,
      mountingPlace: form.mountingPlace,
      radiationDatabase: form.radiationDatabase,
      provisionalFallbackRoofAreaM2: form.provisionalFallbackRoofAreaM2,
      currency: 'INR',
    });
  };

  const handleReset = async () => {
    if (!isAdminUnlocked) {
      onRequestAdminUnlock();
      return;
    }
    await onResetAssumptions();
  };

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="rw-surface rounded-2xl p-4 sm:p-6 space-y-5">
        <SectionHeading
          title="Rooftop Solar Assessment Defaults"
          subtitle="Engineering defaults persisted in SQLite. Override individual roofs under Building & Roof Mapping."
          action={
            isAdminUnlocked ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleReset}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Restore Defaults
                </button>
                <button
                  type="submit"
                  disabled={isBusy}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#0b2e22] text-white hover:bg-emerald-950 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  {isBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Save Assumptions
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onRequestAdminUnlock}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 cursor-pointer whitespace-nowrap"
              >
                <Lock className="w-3.5 h-3.5 text-neutral-500" />
                Unlock Admin
              </button>
            )
          }
        />

        {/* Planning Scenario Presets */}
        <div className="rounded-xl border border-neutral-200/80 bg-[#f7f9f8] p-3.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-neutral-800">
              Roof Utilisation Scenario Preset
            </span>
            <span className="text-[11px] text-neutral-500">
              Sets usable roof fraction &amp; row-spacing packing factor together
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {Object.values(SOLAR_PLANNING_SCENARIOS).map((preset) => {
              const active =
                form.usableRoofFractionPercent === preset.usableRoofFractionPercent &&
                form.packingFactorPercent === preset.packingFactorPercent;
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={!isAdminUnlocked}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      planningScenario: preset.id,
                      usableRoofFractionPercent: preset.usableRoofFractionPercent,
                      packingFactorPercent: preset.packingFactorPercent,
                    }))
                  }
                  className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors cursor-pointer disabled:opacity-65 ${
                    active
                      ? 'bg-[#0b2e22] text-white border-[#0b2e22]'
                      : 'bg-white text-neutral-800 border-neutral-200 hover:border-emerald-400'
                  }`}
                >
                  <div className="font-semibold">{preset.shortLabel}</div>
                  <div
                    className={`text-[10px] font-mono mt-0.5 ${
                      active ? 'text-emerald-200' : 'text-neutral-500'
                    }`}
                  >
                    {preset.usableRoofFractionPercent}% usable × {preset.packingFactorPercent}% pack
                    ({preset.netRoofCoveragePercent}% net)
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          {/* 1. Search Radius */}
          <div className="space-y-1">
            <label className="block font-semibold text-neutral-800">
              Overpass Search Radius (m)
            </label>
            <input
              type="number"
              min={100}
              max={2000}
              step={50}
              disabled={!isAdminUnlocked}
              value={form.searchRadiusMeters}
              onChange={(e) =>
                setForm((f) => ({ ...f, searchRadiusMeters: Number(e.target.value) }))
              }
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white font-mono text-neutral-900 disabled:bg-neutral-50"
            />
            <p className="text-[11px] text-neutral-500">
              Default: {DEFAULT_SOLAR_ASSUMPTIONS.searchRadiusMeters} m around canonical campus
              coordinates.
            </p>
          </div>

          {/* 2. Usable Roof Fraction */}
          <div className="space-y-1">
            <label className="block font-semibold text-neutral-800">
              Usable Roof Fraction (%)
            </label>
            <input
              type="number"
              min={10}
              max={100}
              step={1}
              disabled={!isAdminUnlocked}
              value={form.usableRoofFractionPercent}
              onChange={(e) =>
                setForm((f) => ({ ...f, usableRoofFractionPercent: Number(e.target.value) }))
              }
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white font-mono text-neutral-900 disabled:bg-neutral-50"
            />
            <p className="text-[11px] text-neutral-500">
              Default: {DEFAULT_SOLAR_ASSUMPTIONS.usableRoofFractionPercent}% accounting for
              parapets, access paths, and rooftop utilities.
            </p>
          </div>

          {/* 3. Packing Factor */}
          <div className="space-y-1">
            <label className="block font-semibold text-neutral-800">
              Array Packing / Row-Spacing Factor (%)
            </label>
            <input
              type="number"
              min={30}
              max={100}
              step={1}
              disabled={!isAdminUnlocked}
              value={form.packingFactorPercent}
              onChange={(e) =>
                setForm((f) => ({ ...f, packingFactorPercent: Number(e.target.value) }))
              }
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white font-mono text-neutral-900 disabled:bg-neutral-50"
            />
            <p className="text-[11px] text-neutral-500">
              Default: {DEFAULT_SOLAR_ASSUMPTIONS.packingFactorPercent}% to prevent inter-row
              shading on tilted flat-roof arrays.
            </p>
          </div>

          {/* 4. Panel Rated Power */}
          <div className="space-y-1">
            <label className="block font-semibold text-neutral-800">
              Standard PV Module Rating (W)
            </label>
            <input
              type="number"
              min={100}
              max={1000}
              step={5}
              disabled={!isAdminUnlocked}
              value={form.panelRatedWatts}
              onChange={(e) =>
                setForm((f) => ({ ...f, panelRatedWatts: Number(e.target.value) }))
              }
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white font-mono text-neutral-900 disabled:bg-neutral-50"
            />
            <p className="text-[11px] text-neutral-500">
              Default: {DEFAULT_SOLAR_ASSUMPTIONS.panelRatedWatts} W commercial mono-PERC / TOPCon
              module.
            </p>
          </div>

          {/* 5. Panel Area */}
          <div className="space-y-1">
            <label className="block font-semibold text-neutral-800">
              Standard PV Module Area (m²)
            </label>
            <input
              type="number"
              min={0.5}
              max={5}
              step={0.01}
              disabled={!isAdminUnlocked}
              value={form.panelAreaM2}
              onChange={(e) => setForm((f) => ({ ...f, panelAreaM2: Number(e.target.value) }))}
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white font-mono text-neutral-900 disabled:bg-neutral-50"
            />
            <p className="text-[11px] text-neutral-500">
              Default: {DEFAULT_SOLAR_ASSUMPTIONS.panelAreaM2} m² (
              <MathText
                tex="\approx 2.28\,\mathrm{m} \times 1.13\,\mathrm{m}"
                ariaLabel="approximately 2.28 meters by 1.13 meters"
              />{' '}
              module).
            </p>
          </div>

          {/* 6. PVGIS System Losses */}
          <div className="space-y-1">
            <label className="block font-semibold text-neutral-800">
              PVGIS System Losses (%)
            </label>
            <input
              type="number"
              min={0}
              max={50}
              step={0.5}
              disabled={!isAdminUnlocked}
              value={form.systemLossesPercent}
              onChange={(e) =>
                setForm((f) => ({ ...f, systemLossesPercent: Number(e.target.value) }))
              }
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white font-mono text-neutral-900 disabled:bg-neutral-50"
            />
            <p className="text-[11px] text-neutral-500">
              Default: {DEFAULT_SOLAR_ASSUMPTIONS.systemLossesPercent}% (cabling, inverter, soiling).
              Applied once inside PVGIS.
            </p>
          </div>

          {/* 7. Flat-Roof Tilt */}
          <div className="space-y-1">
            <label className="block font-semibold text-neutral-800">
              Default Flat-Roof Tilt (°)
            </label>
            <input
              type="number"
              min={0}
              max={90}
              step={1}
              disabled={!isAdminUnlocked}
              value={form.flatRoofTiltDegrees}
              onChange={(e) =>
                setForm((f) => ({ ...f, flatRoofTiltDegrees: Number(e.target.value) }))
              }
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white font-mono text-neutral-900 disabled:bg-neutral-50"
            />
            <p className="text-[11px] text-neutral-500">
              Default: {DEFAULT_SOLAR_ASSUMPTIONS.flatRoofTiltDegrees}° when OSM roof:angle is not
              mapped.
            </p>
          </div>

          {/* 8. Flat-Roof Aspect */}
          <div className="space-y-1">
            <label className="block font-semibold text-neutral-800">
              Default Flat-Roof Aspect (°)
            </label>
            <input
              type="number"
              min={-180}
              max={180}
              step={1}
              disabled={!isAdminUnlocked}
              value={form.flatRoofAspectDegrees}
              onChange={(e) =>
                setForm((f) => ({ ...f, flatRoofAspectDegrees: Number(e.target.value) }))
              }
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white font-mono text-neutral-900 disabled:bg-neutral-50"
            />
            <p className="text-[11px] text-neutral-500">
              Default: 0° (South in PVGIS convention; -90° = East, +90° = West).
            </p>
          </div>

          {/* 9. Provisional Fallback Area */}
          <div className="space-y-1">
            <label className="block font-semibold text-neutral-800">
              Provisional Fallback Roof Area (m²)
            </label>
            <input
              type="number"
              min={50}
              max={10000}
              step={25}
              disabled={!isAdminUnlocked}
              value={form.provisionalFallbackRoofAreaM2}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  provisionalFallbackRoofAreaM2: Number(e.target.value),
                }))
              }
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white font-mono text-neutral-900 disabled:bg-neutral-50"
            />
            <p className="text-[11px] text-neutral-500">
              Default: {DEFAULT_SOLAR_ASSUMPTIONS.provisionalFallbackRoofAreaM2} m² used only when
              no campus footprints are mapped/confirmed.
            </p>
          </div>

          {/* 10. PV Technology */}
          <div className="space-y-1">
            <label className="block font-semibold text-neutral-800">PV Technology</label>
            <select
              disabled={!isAdminUnlocked}
              value={form.pvTechnology}
              onChange={(e) =>
                setForm((f) => ({ ...f, pvTechnology: e.target.value as PvgisTechnology }))
              }
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-900 disabled:bg-neutral-50"
            >
              <option value="crystSi">Crystalline Silicon (crystSi — Default)</option>
              <option value="CIS">CIS Thin Film</option>
              <option value="CdTe">CdTe Thin Film</option>
              <option value="Unknown">Unknown / Generic</option>
            </select>
          </div>

          {/* 11. Mounting Place */}
          <div className="space-y-1">
            <label className="block font-semibold text-neutral-800">Mounting Configuration</label>
            <select
              disabled={!isAdminUnlocked}
              value={form.mountingPlace}
              onChange={(e) =>
                setForm((f) => ({ ...f, mountingPlace: e.target.value as PvgisMountingPlace }))
              }
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-900 disabled:bg-neutral-50"
            >
              <option value="free">Elevated / Open-Rack Rooftop (Ventilated — Flat RCC Default)</option>
              <option value="building">Flush / Building-Integrated (BIPV — Low Rear Airflow)</option>
            </select>
            <p className="text-[11px] text-neutral-500">
              PVGIS &quot;free&quot; models ventilated open-rack arrays standard on Indian flat RCC roofs.
            </p>
          </div>

          {/* 12. Radiation Database */}
          <div className="space-y-1">
            <label className="block font-semibold text-neutral-800">
              Preferred PVGIS Radiation Database
            </label>
            <select
              disabled={!isAdminUnlocked}
              value={form.radiationDatabase}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  radiationDatabase: e.target.value as PvgisRadiationDatabaseChoice,
                }))
              }
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-900 disabled:bg-neutral-50"
            >
              <option value="PVGIS-SARAH3">PVGIS-SARAH3 (Auto-fallback to ERA5 if out of coverage)</option>
              <option value="PVGIS-ERA5">PVGIS-ERA5 (Global Reanalysis — Covers Kharagpur)</option>
              <option value="auto">PVGIS Default Selection</option>
            </select>
          </div>
        </div>

        {workspace.assumptions.updatedBy && workspace.assumptions.updatedAtMs && (
          <div className="pt-2 border-t border-neutral-200/70 text-[11px] text-neutral-500 font-mono">
            Last updated by {workspace.assumptions.updatedBy}
          </div>
        )}
      </form>

      {/* Expandable Methodology & Limitations */}
      <div className="rw-surface rounded-2xl p-4 sm:p-5 space-y-3">
        <button
          type="button"
          onClick={() => setShowMethodology((v) => !v)}
          className="w-full flex items-center justify-between text-xs font-bold text-neutral-900 cursor-pointer"
        >
          <span className="inline-flex items-center gap-2">
            <Sliders className="w-3.5 h-3.5 text-emerald-700" />
            Calculation Methodology, Provenance Definitions & Engineering Limitations
          </span>
          {showMethodology ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showMethodology && (
          <div className="pt-2 border-t border-neutral-200/70 space-y-3 text-xs text-neutral-600 leading-relaxed">
            <div className="space-y-1.5">
              <div className="font-semibold text-neutral-900">Sizing Formula</div>
              <div className="bg-[#f5f7f6] p-3.5 rounded-xl border border-neutral-200/75 text-[#111815] overflow-x-auto space-y-2">
                <MathText
                  tex="A_{\mathrm{usable}} = A_{\mathrm{gross}} \times \dfrac{f_{\mathrm{usable}}}{100}"
                  display
                  compact
                  className="text-[13px] sm:text-[14px]"
                  ariaLabel="Usable area equals gross footprint area times usable fraction divided by 100"
                />
                <MathText
                  tex="N_{\mathrm{panels}} = \left\lfloor \dfrac{A_{\mathrm{usable}} \times (f_{\mathrm{pack}}/100)}{A_{\mathrm{panel}}} \right\rfloor"
                  display
                  compact
                  className="text-[13px] sm:text-[14px]"
                  ariaLabel="Panel count equals floor of usable area times packing factor percentage divided by panel area"
                />
                <MathText
                  tex="P_{\mathrm{kWp}} = \dfrac{N_{\mathrm{panels}} \times P_{\mathrm{panel}}}{1000}"
                  display
                  compact
                  className="text-[13px] sm:text-[14px]"
                  ariaLabel="Capacity in kWp equals panel count times panel rated watts divided by 1000"
                />
              </div>
            </div>
            <ul className="list-disc pl-4 space-y-1.5">
              {workspace.limitations.map((lim, i) => (
                <li key={i}>{lim}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Required Open Data Attributions */}
      <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 text-[11px] text-neutral-600">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            Map & building footprints:{' '}
            <a
              href={workspace.attributions.osm.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-emerald-800 hover:underline inline-flex items-center gap-0.5"
            >
              {workspace.attributions.osm.text}
              <ExternalLink className="w-2.5 h-2.5" />
            </a>{' '}
            (
            <a
              href={workspace.attributions.osm.licenseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-emerald-800"
            >
              {workspace.attributions.osm.licenseText}
            </a>
            )
          </span>
          <span>
            Photovoltaic modelling:{' '}
            <a
              href={workspace.attributions.pvgis.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-emerald-800 hover:underline inline-flex items-center gap-0.5"
            >
              {workspace.attributions.pvgis.text}
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </span>
        </div>
        <span className="font-mono text-[11px] text-neutral-600">
          Updated {workspace.generatedAtIst}
        </span>
      </div>
    </div>
  );
};
