/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CloudSun,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  Sliders,
  Sun,
} from 'lucide-react';
import { PageHeader, SegmentedControl } from '../common/DesignSystem';
import { EnvironmentalIntelligenceView } from './EnvironmentalIntelligenceView';
import { BuildingRoofMappingPanel } from '../solar/BuildingRoofMappingPanel';
import { SolarPotentialPanel } from '../solar/SolarPotentialPanel';
import { CampusEnergyComparisonPanel } from '../solar/CampusEnergyComparisonPanel';
import { SolarAssumptionsPanel } from '../solar/SolarAssumptionsPanel';
import { authFetch, useAuth } from '../../context/AuthContext';
import { useEnergy } from '../../context/EnergyContext';
import { useToast } from '../../context/ToastContext';
import type { GeoPoint, SolarAssumptions, SolarWorkspaceResponse } from '../../types/solar';

export type EnvironmentalSolarModule = 'environmental' | 'solar';
export type EnvironmentalSolarTab =
  | 'environmental'
  | 'mapping'
  | 'solar-potential'
  | 'comparison'
  | 'assumptions';

// Lightweight client-side session cache so switching between ROOMWISE tabs restores PVGIS instantly
const SOLAR_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedSolarWorkspace: SolarWorkspaceResponse | null = null;
let cachedSolarFetchedAt = 0;

interface EnvironmentalSolarViewProps {
  initialModule?: EnvironmentalSolarModule;
  initialTab?: EnvironmentalSolarTab;
}

export const EnvironmentalSolarView: React.FC<EnvironmentalSolarViewProps> = ({
  initialModule = 'environmental',
  initialTab,
}) => {
  const { isAdminUnlocked, openAuthModal } = useAuth();
  const { voiceNavDirective, clearVoiceNavDirective } = useEnergy();
  const toast = useToast();

  const resolvedInitial: EnvironmentalSolarTab =
    initialTab || (initialModule === 'solar' ? 'solar-potential' : 'environmental');

  const [activeTab, setActiveTab] = useState<EnvironmentalSolarTab>(resolvedInitial);
  const [workspace, setWorkspaceState] = useState<SolarWorkspaceResponse | null>(
    () => cachedSolarWorkspace
  );
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  const setWorkspace = useCallback((next: SolarWorkspaceResponse) => {
    cachedSolarWorkspace = next;
    cachedSolarFetchedAt = Date.now();
    setWorkspaceState(next);
  }, []);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    } else if (initialModule === 'solar') {
      setActiveTab('solar-potential');
    } else {
      setActiveTab('environmental');
    }
  }, [initialModule, initialTab]);

  useEffect(() => {
    if (!voiceNavDirective) return;
    if (
      voiceNavDirective.target === 'environmental-solar' ||
      voiceNavDirective.target === 'environmental' ||
      voiceNavDirective.target === 'solar'
    ) {
      const validSubTabs: EnvironmentalSolarTab[] = [
        'environmental',
        'mapping',
        'solar-potential',
        'comparison',
        'assumptions',
      ];
      if (
        voiceNavDirective.subTab &&
        validSubTabs.includes(voiceNavDirective.subTab as EnvironmentalSolarTab)
      ) {
        setActiveTab(voiceNavDirective.subTab as EnvironmentalSolarTab);
      } else if (voiceNavDirective.target === 'solar') {
        setActiveTab('solar-potential');
      } else if (voiceNavDirective.target === 'environmental') {
        setActiveTab('environmental');
      }
      clearVoiceNavDirective(voiceNavDirective.id);
    }
  }, [voiceNavDirective, clearVoiceNavDirective]);

  const loadWorkspace = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingWorkspace(true);
      setWorkspaceError(null);
      try {
        const res = await authFetch('/api/solar/workspace');
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || 'Failed to load rooftop solar assessment workspace.');
        }
        setWorkspace(data as SolarWorkspaceResponse);
      } catch (err: any) {
        if (!cachedSolarWorkspace) {
          setWorkspaceError(err?.message || 'Unable to load rooftop solar workspace.');
        }
      } finally {
        if (!silent) setLoadingWorkspace(false);
      }
    },
    [setWorkspace]
  );

  // Load solar workspace when entering any solar tab; reuse warm cache immediately and revalidate only if stale
  useEffect(() => {
    if (activeTab === 'environmental') return;
    if (!workspace && !loadingWorkspace && !workspaceError) {
      void loadWorkspace(false);
    } else if (workspace && Date.now() - cachedSolarFetchedAt > SOLAR_CACHE_TTL_MS) {
      void loadWorkspace(true);
    }
  }, [activeTab, workspace, loadingWorkspace, workspaceError, loadWorkspace]);

  const handleRefreshDiscovery = async (radiusMeters?: number) => {
    setBusyAction(true);
    try {
      const res = await authFetch('/api/solar/discover', {
        method: 'POST',
        body: JSON.stringify({ searchRadiusMeters: radiusMeters }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Overpass discovery refresh failed.');
      }
      setWorkspace(data as SolarWorkspaceResponse);
      toast.success(
        'OpenStreetMap footprints refreshed',
        `${data.buildings?.length ?? 0} buildings found within ${data.assumptions?.searchRadiusMeters ?? 500} m.`
      );
    } catch (err: any) {
      toast.error('Overpass refresh failed', err?.message || 'Unable to refresh Overpass discovery.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleRestoreCampus = async () => {
    setBusyAction(true);
    try {
      const res = await authFetch('/api/solar/campus/restore', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data?.ok || !data?.workspace) {
        throw new Error(data?.error || 'Failed to restore campus reconstruction.');
      }
      setWorkspace(data.workspace as SolarWorkspaceResponse);
      toast.success('Image-reconstructed campus layout restored');
    } catch (err: any) {
      toast.error('Restore failed', err?.message || 'Unable to restore campus layout.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleUpdateBuilding = async (
    buildingId: string,
    patch: Record<string, unknown>
  ) => {
    setBusyAction(true);
    try {
      const res = await authFetch(`/api/solar/buildings/${encodeURIComponent(buildingId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok || !data?.workspace) {
        throw new Error(data?.error || 'Failed to save building update.');
      }
      setWorkspace(data.workspace as SolarWorkspaceResponse);
      toast.success('Building configuration saved');
    } catch (err: any) {
      toast.error('Update failed', err?.message || 'Unable to update building.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCreateManualBuilding = async (payload: {
    name: string;
    campusLabel?: string;
    buildingType?: string;
    polygonPoints?: GeoPoint[];
    footprintAreaM2?: number;
  }) => {
    setBusyAction(true);
    try {
      const res = await authFetch('/api/solar/buildings/manual', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok || !data?.workspace) {
        throw new Error(data?.error || 'Failed to add manual building footprint.');
      }
      setWorkspace(data.workspace as SolarWorkspaceResponse);
      toast.success('Custom building footprint saved and confirmed');
    } catch (err: any) {
      toast.error('Save failed', err?.message || 'Failed to create building footprint.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleDeleteManualBuilding = async (buildingId: string) => {
    setBusyAction(true);
    try {
      const res = await authFetch(
        `/api/solar/buildings/manual/${encodeURIComponent(buildingId)}`,
        {
          method: 'DELETE',
        }
      );
      const data = await res.json();
      if (!res.ok || !data?.ok || !data?.workspace) {
        throw new Error(data?.error || 'Failed to remove manual building.');
      }
      setWorkspace(data.workspace as SolarWorkspaceResponse);
      toast.success('Custom building footprint removed');
    } catch (err: any) {
      toast.error('Delete failed', err?.message || 'Failed to delete building footprint.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCalculateBuilding = async (buildingId: string) => {
    setBusyAction(true);
    try {
      const res = await authFetch('/api/solar/calculate/building', {
        method: 'POST',
        body: JSON.stringify({ buildingId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok || !data?.workspace) {
        throw new Error(data?.error || 'PVGIS building calculation failed.');
      }
      setWorkspace(data.workspace as SolarWorkspaceResponse);
      toast.success(
        'PVGIS building calculation complete',
        `${Math.round(data.result?.annualGenerationKwh || 0).toLocaleString()} kWh/yr estimated.`
      );
    } catch (err: any) {
      toast.error('PVGIS calculation failed', err?.message || 'Failed to calculate building solar potential.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCalculateCampus = async (buildingIds?: string[], forceRefresh = false) => {
    setBusyAction(true);
    try {
      const res = await authFetch('/api/solar/calculate/campus', {
        method: 'POST',
        body: JSON.stringify({ buildingIds, forceRefresh }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Campus PVGIS calculation failed.');
      }
      setWorkspace(data as SolarWorkspaceResponse);
      toast.success(
        'Campus PVGIS assessment updated',
        `${Math.round(data.campusSummary?.combinedAnnualGenerationKwh || 0).toLocaleString()} kWh/yr combined estimate.`
      );
    } catch (err: any) {
      toast.error('PVGIS calculation failed', err?.message || 'Failed to run campus PVGIS calculation.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSaveAssumptions = async (patch: Partial<SolarAssumptions>) => {
    setBusyAction(true);
    try {
      const res = await authFetch('/api/solar/assumptions', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok || !data?.workspace) {
        throw new Error(data?.error || 'Failed to save assumptions.');
      }
      setWorkspace(data.workspace as SolarWorkspaceResponse);
      toast.success('Solar assessment defaults saved');
    } catch (err: any) {
      toast.error('Save failed', err?.message || 'Unable to save solar assumptions.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleResetAssumptions = async () => {
    setBusyAction(true);
    try {
      const res = await authFetch('/api/solar/assumptions/reset', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data?.ok || !data?.workspace) {
        throw new Error(data?.error || 'Failed to restore defaults.');
      }
      setWorkspace(data.workspace as SolarWorkspaceResponse);
      toast.success('Restored ROOMWISE standard solar defaults');
    } catch (err: any) {
      toast.error('Reset failed', err?.message || 'Unable to restore defaults.');
    } finally {
      setBusyAction(false);
    }
  };

  const subtitleByTab: Record<EnvironmentalSolarTab, string> = {
    environmental:
      'Open-Meteo weather, air quality, and solar radiation paired with 25 classroom sensor nodes.',
    mapping:
      'Interactive campus building map, roof sizing confirmation, and per-building PVGIS modelling.',
    'solar-potential':
      'Per-building and campus rooftop photovoltaic yield via European Commission PVGIS 5.3.',
    comparison:
      'Comparing PVGIS solar generation against ROOMWISE observed SQLite campus energy demand.',
    assumptions:
      'Rooftop sizing defaults, PVGIS modelling parameters, and open-data attributions.',
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      <PageHeader
        kicker="Open-Meteo · OpenStreetMap · PVGIS 5.3"
        title="Environmental & Solar Intelligence"
        subtitle={subtitleByTab[activeTab]}
      />

      {/* Compact 5-Tab Internal Navigation inside the single Environmental & Solar destination */}
      <div className="overflow-x-auto -mx-1 px-1 pb-1">
        <SegmentedControl<EnvironmentalSolarTab>
          layoutId="env-solar-subtabs"
          size="sm"
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { id: 'environmental', label: 'Environmental', icon: CloudSun },
            {
              id: 'mapping',
              label: 'Roof Mapping',
              icon: MapIcon,
              suffix: workspace ? workspace.buildings.length : undefined,
            },
            { id: 'solar-potential', label: 'Solar Potential', icon: Sun },
            { id: 'comparison', label: 'Energy Comparison', icon: BarChart3 },
            { id: 'assumptions', label: 'Assumptions', icon: Sliders },
          ]}
        />
      </div>

      {activeTab === 'environmental' ? (
        <EnvironmentalIntelligenceView
          embedded
          onNavigateSolar={() => setActiveTab('solar-potential')}
        />
      ) : loadingWorkspace && !workspace ? (
        <div className="rw-surface rounded-2xl py-20 flex flex-col items-center justify-center gap-2.5 text-xs text-neutral-600">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-700" />
          <span>Loading OpenStreetMap footprints and PVGIS solar assessment workspace...</span>
        </div>
      ) : workspaceError && !workspace ? (
        <div className="rw-surface rounded-2xl p-6 flex flex-col items-center justify-center gap-3 text-center">
          <AlertTriangle className="w-6 h-6 text-amber-600" />
          <div className="text-sm font-semibold text-neutral-900">
            Unable to load rooftop solar workspace
          </div>
          <p className="text-xs text-neutral-600 max-w-md">{workspaceError}</p>
          <button
            type="button"
            onClick={() => void loadWorkspace()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#0b2e22] text-white hover:bg-emerald-950 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      ) : workspace ? (
        <>
          {activeTab === 'mapping' && (
            <BuildingRoofMappingPanel
              workspace={workspace}
              isAdminUnlocked={isAdminUnlocked}
              onRequestAdminUnlock={() => openAuthModal()}
              onRefreshDiscovery={handleRefreshDiscovery}
              onRestoreCampus={handleRestoreCampus}
              onUpdateBuilding={handleUpdateBuilding}
              onCreateManualBuilding={handleCreateManualBuilding}
              onDeleteManualBuilding={handleDeleteManualBuilding}
              onCalculateBuilding={handleCalculateBuilding}
              isBusy={busyAction}
            />
          )}

          {activeTab === 'solar-potential' && (
            <SolarPotentialPanel
              workspace={workspace}
              onCalculateCampus={handleCalculateCampus}
              onCalculateBuilding={handleCalculateBuilding}
              onNavigateMapping={() => setActiveTab('mapping')}
              isBusy={busyAction}
            />
          )}

          {activeTab === 'comparison' && (
            <CampusEnergyComparisonPanel workspace={workspace} />
          )}

          {activeTab === 'assumptions' && (
            <SolarAssumptionsPanel
              workspace={workspace}
              isAdminUnlocked={isAdminUnlocked}
              onRequestAdminUnlock={() => openAuthModal()}
              onSaveAssumptions={handleSaveAssumptions}
              onResetAssumptions={handleResetAssumptions}
              isBusy={busyAction}
            />
          )}
        </>
      ) : null}
    </div>
  );
};
