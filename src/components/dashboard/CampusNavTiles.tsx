/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Tooltip } from '../common/MotionPrimitives';

interface CampusNavTilesProps {
  onOpenDigitalTwin: () => void;
  onOpenCampusLive: () => void;
}

/**
 * Static isometric architectural thumbnail of the 5-block DAV Model School campus:
 * G+3 Block (NW 4-storey), Multipurpose Hall (W), Pre-Primary (SW L-wing),
 * New Building (Center courtyard complex + OB-NB bridge), and Old Building (NE).
 * Strictly static SVG (no looping animation, no bright gradients).
 */
const Campus3DThumbnail: React.FC = () => (
  <svg
    viewBox="0 0 220 82"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="w-full h-full block"
    aria-hidden="true"
  >
    {/* Calm architectural ground plane & subtle axonometric grid */}
    <rect width="220" height="82" fill="#0d1e17" />
    <g stroke="rgba(167, 243, 208, 0.08)" strokeWidth="0.6">
      <path d="M18 52 L110 8 L202 52" />
      <path d="M36 62 L128 18" />
      <path d="M56 72 L148 28" />
      <path d="M92 18 L184 62" />
      <path d="M72 28 L164 72" />
      <path d="M52 38 L144 82" />
    </g>

    {/* Campus plinth & internal driveway apron */}
    <polygon
      points="110,12 198,52 110,80 22,52"
      fill="#11271e"
      stroke="rgba(52, 211, 153, 0.16)"
      strokeWidth="0.75"
    />
    {/* Southern campus lawn / court strip */}
    <polygon
      points="76,58 128,44 156,57 104,72"
      fill="#133326"
      stroke="rgba(52, 211, 153, 0.22)"
      strokeWidth="0.6"
    />

    {/* 1. Old Building (NE 3-storey wing) */}
    <g>
      {/* Left shaded elevation */}
      <polygon points="138,24 166,36 166,47 138,35" fill="#12281f" stroke="rgba(167, 243, 208, 0.22)" strokeWidth="0.65" />
      {/* Right front elevation */}
      <polygon points="166,36 180,30 180,41 166,47" fill="#18362a" stroke="rgba(167, 243, 208, 0.28)" strokeWidth="0.65" />
      {/* Roof slab */}
      <polygon points="152,18 180,30 166,36 138,24" fill="#214839" stroke="rgba(167, 243, 208, 0.35)" strokeWidth="0.7" />
      {/* Facade window ribbons */}
      <line x1="142" y1="29" x2="162" y2="38" stroke="rgba(52, 211, 153, 0.38)" strokeWidth="0.8" />
      <line x1="142" y1="32.5" x2="162" y2="41.5" stroke="rgba(52, 211, 153, 0.28)" strokeWidth="0.8" />
    </g>

    {/* Covered OB-NB Connecting Corridor */}
    <polygon
      points="126,33 141,27 145,29 130,35"
      fill="#1b3c2f"
      stroke="rgba(167, 243, 208, 0.3)"
      strokeWidth="0.6"
    />

    {/* 2. G+3 Block (NW 4-storey notched flagship academic wing) */}
    <g>
      {/* Left face */}
      <polygon points="44,30 74,44 74,62 44,48" fill="#122920" stroke="rgba(167, 243, 208, 0.24)" strokeWidth="0.7" />
      {/* Front right face */}
      <polygon points="74,44 102,31 102,49 74,62" fill="#1a3b2e" stroke="rgba(167, 243, 208, 0.34)" strokeWidth="0.7" />
      {/* Roof slab */}
      <polygon points="72,17 102,31 74,44 44,30" fill="#255241" stroke="rgba(52, 211, 153, 0.48)" strokeWidth="0.75" />
      {/* Roof mechanical / PV inset */}
      <polygon points="72,21 90,29.5 74,37 56,28.5" fill="#17382b" stroke="rgba(52, 211, 153, 0.28)" strokeWidth="0.55" />
      {/* 4-storey window bands */}
      <line x1="48" y1="35" x2="70" y2="45" stroke="rgba(52, 211, 153, 0.45)" strokeWidth="0.85" />
      <line x1="48" y1="39.5" x2="70" y2="49.5" stroke="rgba(52, 211, 153, 0.38)" strokeWidth="0.85" />
      <line x1="48" y1="44" x2="70" y2="54" stroke="rgba(52, 211, 153, 0.3)" strokeWidth="0.85" />
      <line x1="78" y1="45" x2="98" y2="35.5" stroke="rgba(52, 211, 153, 0.45)" strokeWidth="0.85" />
      <line x1="78" y1="49.5" x2="98" y2="40" stroke="rgba(52, 211, 153, 0.36)" strokeWidth="0.85" />
      <line x1="78" y1="54" x2="98" y2="44.5" stroke="rgba(52, 211, 153, 0.28)" strokeWidth="0.85" />
    </g>

    {/* 3. Multipurpose Hall (West-Mid hall adjoining G+3 southern flank) */}
    <g>
      <polygon points="36,49 56,58 56,66 36,57" fill="#132b21" stroke="rgba(167, 243, 208, 0.22)" strokeWidth="0.65" />
      <polygon points="56,58 72,51 72,59 56,66" fill="#19382c" stroke="rgba(167, 243, 208, 0.28)" strokeWidth="0.65" />
      <polygon points="52,42 72,51 56,58 36,49" fill="#1f4536" stroke="rgba(167, 243, 208, 0.35)" strokeWidth="0.65" />
    </g>

    {/* 4. New Building (Central 3-storey C-shaped courtyard complex) */}
    <g>
      {/* Left face */}
      <polygon points="94,40 122,53 122,65 94,52" fill="#132b22" stroke="rgba(167, 243, 208, 0.26)" strokeWidth="0.7" />
      {/* Front right face */}
      <polygon points="122,53 150,40 150,52 122,65" fill="#1b3f31" stroke="rgba(167, 243, 208, 0.32)" strokeWidth="0.7" />
      {/* Roof slab */}
      <polygon points="122,27 150,40 122,53 94,40" fill="#234e3e" stroke="rgba(52, 211, 153, 0.42)" strokeWidth="0.7" />
      {/* Recessed central courtyard well + shade tree canopy */}
      <polygon points="122,33 136,39.5 122,46 108,39.5" fill="#0d1e17" stroke="rgba(52, 211, 153, 0.26)" strokeWidth="0.55" />
      <circle cx="122" cy="39.5" r="2.8" fill="#0b6e4f" stroke="rgba(167, 243, 208, 0.45)" strokeWidth="0.5" />
      {/* Facade window ribbons */}
      <line x1="98" y1="45" x2="118" y2="54" stroke="rgba(52, 211, 153, 0.4)" strokeWidth="0.8" />
      <line x1="98" y1="49" x2="118" y2="58" stroke="rgba(52, 211, 153, 0.3)" strokeWidth="0.8" />
      <line x1="126" y1="54" x2="146" y2="45" stroke="rgba(52, 211, 153, 0.38)" strokeWidth="0.8" />
    </g>

    {/* 5. Pre-Primary Block (SW single-storey wing) */}
    <g>
      <polygon points="64,61 86,71 86,76 64,66" fill="#142d23" stroke="rgba(167, 243, 208, 0.24)" strokeWidth="0.65" />
      <polygon points="86,71 102,64 102,69 86,76" fill="#1a3c2f" stroke="rgba(167, 243, 208, 0.3)" strokeWidth="0.65" />
      <polygon points="80,54 102,64 86,71 64,61" fill="#204738" stroke="rgba(167, 243, 208, 0.36)" strokeWidth="0.65" />
    </g>
  </svg>
);

/**
 * Static orthographic blueprint plan preview for the 2D Atlas secondary tile.
 * Mirrors the 5-block site footprint used in DigitalTwinView.
 */
const Campus2DPlanThumbnail: React.FC = () => (
  <svg
    viewBox="0 0 168 80"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="w-full h-full block"
    aria-hidden="true"
  >
    <rect width="168" height="80" fill="#f7f9f7" />
    {/* Subtle 16px drafting grid */}
    <g stroke="rgba(17, 25, 22, 0.055)" strokeWidth="0.6">
      <line x1="28" y1="0" x2="28" y2="80" />
      <line x1="56" y1="0" x2="56" y2="80" />
      <line x1="84" y1="0" x2="84" y2="80" />
      <line x1="112" y1="0" x2="112" y2="80" />
      <line x1="140" y1="0" x2="140" y2="80" />
      <line x1="0" y1="20" x2="168" y2="20" />
      <line x1="0" y1="40" x2="168" y2="40" />
      <line x1="0" y1="60" x2="168" y2="60" />
    </g>

    {/* 5-Block 2D Architectural Footprint */}
    <rect x="16" y="14" width="48" height="22" rx="2.5" fill="#e6f3ec" stroke="#0b6e4f" strokeWidth="1" />
    <rect x="72" y="14" width="42" height="22" rx="2.5" fill="#eef4f0" stroke="#46544e" strokeWidth="0.9" />
    <rect x="122" y="14" width="30" height="48" rx="2.5" fill="#eef4f0" stroke="#46544e" strokeWidth="0.9" />
    <rect x="16" y="44" width="48" height="18" rx="2.5" fill="#f1f4f2" stroke="#62706a" strokeWidth="0.85" />
    <rect x="72" y="44" width="42" height="18" rx="2.5" fill="#e6f3ec" stroke="#0b6e4f" strokeWidth="1" />

    {/* Subtle interior partition hairlines */}
    <g stroke="rgba(11, 110, 79, 0.25)" strokeWidth="0.6">
      <line x1="32" y1="14" x2="32" y2="36" />
      <line x1="48" y1="14" x2="48" y2="36" />
      <line x1="93" y1="14" x2="93" y2="36" />
      <line x1="93" y1="44" x2="93" y2="62" />
    </g>

    {/* Tiny architectural north tick */}
    <g transform="translate(148, 69)" stroke="#62706a" strokeWidth="0.8">
      <line x1="0" y1="5" x2="0" y2="-3" />
      <polyline points="-2,-1 0,-3 2,-1" fill="none" />
    </g>
  </svg>
);

export const CampusNavTiles: React.FC<CampusNavTilesProps> = ({
  onOpenDigitalTwin,
  onOpenCampusLive,
}) => {
  return (
    <div className="grid grid-cols-2 sm:flex sm:items-stretch gap-2 sm:gap-2.5 w-full sm:w-auto shrink-0">
      {/* Secondary Outlined Tile: 2D Atlas */}
      <Tooltip
        side="bottom"
        className="w-full sm:w-auto min-w-0"
        content="Open 2D Architectural Floor Atlas & Heatmaps"
      >
        <button
          type="button"
          onClick={onOpenDigitalTwin}
          aria-label="Open 2D Atlas — Floor plans and environmental heatmaps"
          className="group w-full sm:min-w-[144px] md:min-w-[158px] lg:w-[148px] xl:w-[164px] h-[74px] sm:h-[82px] lg:h-[86px] rounded-[14px] overflow-hidden border border-[#111916]/15 bg-white text-left flex flex-col justify-between transition-[transform,box-shadow,border-color,background-color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[#0b6e4f]/55 hover:bg-[#fbfdfb] hover:shadow-[0_10px_22px_-12px_rgba(11,110,79,0.2)] active:translate-y-0 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6e4f] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f5f3] motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100"
        >
          <div className="relative flex-1 w-full overflow-hidden border-b border-[#111916]/8 bg-[#f7f9f7]">
            <Campus2DPlanThumbnail />
          </div>

          <div className="px-2.5 sm:px-3 py-1.5 flex items-center justify-between gap-1.5 bg-white shrink-0">
            <span className="font-display text-[12px] sm:text-[13px] font-semibold text-[#111916] group-hover:text-[#08543c] transition-colors tracking-[-0.01em] truncate">
              2D Atlas
            </span>
            <ArrowRight
              aria-hidden="true"
              className="w-3.5 h-3.5 text-[#0b6e4f] shrink-0 transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-[3px] motion-reduce:group-hover:translate-x-0"
            />
          </div>
        </button>
      </Tooltip>

      {/* Primary Preview Tile: 3D Campus Live */}
      <Tooltip
        side="bottom"
        className="w-full sm:w-auto min-w-0"
        content="Launch Interactive 3D Campus Model"
      >
        <button
          type="button"
          onClick={onOpenCampusLive}
          aria-label="Open 3D Campus Live — Interactive 3D architectural model"
          className="group w-full sm:min-w-[168px] md:min-w-[186px] lg:w-[180px] xl:w-[200px] h-[74px] sm:h-[82px] lg:h-[86px] rounded-[14px] overflow-hidden border border-[#0b6e4f]/40 bg-[#0c1a15] text-left flex flex-col justify-between transition-[transform,box-shadow,border-color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[#34d399]/65 hover:shadow-[0_12px_24px_-12px_rgba(11,110,79,0.45)] active:translate-y-0 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6e4f] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f5f3] motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100"
        >
          <div className="relative flex-1 w-full overflow-hidden border-b border-white/10 bg-[#0d1e17]">
            <Campus3DThumbnail />
          </div>

          <div className="px-2.5 sm:px-3 py-1.5 flex items-center justify-between gap-1.5 bg-[#091511] shrink-0">
            <span className="font-display text-[12px] sm:text-[13px] font-semibold text-white tracking-[-0.01em] truncate">
              3D Campus Live
            </span>
            <ArrowRight
              aria-hidden="true"
              className="w-3.5 h-3.5 text-emerald-300 shrink-0 transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-[3px] motion-reduce:group-hover:translate-x-0"
            />
          </div>
        </button>
      </Tooltip>
    </div>
  );
};
