/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertCircle } from 'lucide-react';
import type { BuildingName, Floor } from '../../types/energy';
import { CAMPUS_BUILDINGS_SCHEMA } from './campusLayoutSchema';
import type { CampusRoomVisualState, CampusVisualMode } from './types';

interface WebGLFallbackViewProps {
  reason: string;
  visualMode: CampusVisualMode;
  selectedFloor: Floor | 'All';
  selectedRoomId: string | null;
  visualStatesByRoomId: Map<string, CampusRoomVisualState>;
  onSelectRoom: (roomId: string) => void;
  onSelectBuilding: (building: BuildingName) => void;
}

function getRoomFillClass(
  st: CampusRoomVisualState | undefined,
  mode: CampusVisualMode
): string {
  if (!st) return 'bg-[#1a2227] border-white/10 text-[#9eb0a9]';
  if (mode === 'intensity') {
    if (st.intensityTier === 'inactive') return 'bg-[#1a2227] border-white/10 text-[#8d9d97]';
    if (st.intensityTier === 'efficient')
      return 'bg-emerald-950/65 border-emerald-500/45 text-emerald-100';
    if (st.intensityTier === 'moderate') return 'bg-teal-950/65 border-teal-400/45 text-teal-100';
    return 'bg-amber-950/65 border-amber-400/55 text-amber-100';
  }
  if (mode === 'lighting') {
    if (st.lightingLevel <= 2) return 'bg-[#1a2227] border-white/10 text-[#7f918b]';
    if (st.lightingLevel <= 45) return 'bg-[#543c1a] border-[#9c6e2c] text-amber-100';
    if (st.lightingLevel <= 78) return 'bg-[#8a5d1c] border-[#e39e38] text-amber-50';
    return 'bg-[#b98222] border-[#ffdf82] text-[#fff9e6]';
  }
  if (mode === 'architectural') {
    if (st.lightingLevel <= 2) return 'bg-[#1a2227] border-white/10 text-[#9eb0a9]';
    return 'bg-[#242e34] border-emerald-400/30 text-[#edf2f0]';
  }
  if (st.temperatureC < 25.5) return 'bg-sky-950/65 border-sky-400/45 text-sky-100';
  if (st.temperatureC > 27.4) return 'bg-orange-950/65 border-orange-400/50 text-orange-100';
  return 'bg-emerald-950/65 border-emerald-400/45 text-emerald-100';
}

/**
 * Honest 2D architectural schematic fallback when WebGL is unavailable or context is lost.
 */
export const WebGLFallbackView: React.FC<WebGLFallbackViewProps> = ({
  reason,
  visualMode,
  selectedFloor,
  selectedRoomId,
  visualStatesByRoomId,
  onSelectRoom,
  onSelectBuilding,
}) => {
  return (
    <div className="w-full h-full overflow-y-auto bg-[#151a1d] p-6 pt-24 pb-28 text-[#edf2f0]">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="px-4 py-3 rounded-xl bg-[#1b2328] border border-white/12 flex items-start gap-2.5 text-xs text-[#b7c4bf]">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-[#f3f7f5]">
              Interactive 3D WebGL viewport unavailable on this device.
            </span>{' '}
            {reason} Showing the synchronized 2D schematic campus model with all 5 blocks and 25
            canonical rooms.
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {CAMPUS_BUILDINGS_SCHEMA.map((bldg) => (
            <div
              key={bldg.id}
              className="rounded-2xl bg-[#1b2328] border border-white/10 p-4 space-y-3"
            >
              <button
                type="button"
                onClick={() => onSelectBuilding(bldg.id)}
                className="w-full text-left flex items-baseline justify-between gap-2 hover:text-emerald-300 transition-colors"
              >
                <span className="text-sm font-semibold text-[#f3f7f5]">{bldg.shortLabel}</span>
                <span className="text-[10px] text-[#8d9d97]">
                  {bldg.floors.length} {bldg.floors.length === 1 ? 'storey' : 'storeys'}
                </span>
              </button>

              <div className="space-y-2.5">
                {[...bldg.floors].reverse().map((fl) => {
                  const isDimmed = selectedFloor !== 'All' && selectedFloor !== fl.floor;
                  return (
                    <div
                      key={fl.floor}
                      className={`space-y-1 transition-opacity ${isDimmed ? 'opacity-30' : 'opacity-100'}`}
                    >
                      <div className="text-[10px] font-medium uppercase tracking-wider text-[#8d9d97]">
                        {fl.floor}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {fl.rooms.map((rm) => {
                          const st = visualStatesByRoomId.get(rm.roomId);
                          const isSelected = selectedRoomId === rm.roomId;
                          return (
                            <button
                              key={rm.roomId}
                              type="button"
                              onClick={() => onSelectRoom(rm.roomId)}
                              className={`p-2 rounded-xl border text-left transition-all ${getRoomFillClass(
                                st,
                                visualMode
                              )} ${isSelected ? 'ring-2 ring-emerald-400' : ''}`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-mono text-[11px] font-semibold">
                                  {rm.roomCode}
                                </span>
                                <span className="font-mono text-[10px] tabular-nums">
                                  {st ? `${st.powerWatts} W` : '—'}
                                </span>
                              </div>
                              <div className="text-[10px] truncate opacity-80 mt-0.5">
                                {st?.name || rm.roomCode}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
