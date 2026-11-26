/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface Props {
  className?: string;
  showSubtitle?: boolean;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'light' | 'dark';
  onClick?: () => void;
  interactive?: boolean;
  variant?: 'badge' | 'pure';
}

export const RoomwiseLogo: React.FC<Props> = ({
  className = '',
  showSubtitle = true,
  size = 'md',
  tone = 'light',
  onClick,
  interactive = false,
}) => {
  const emblemDimensions =
    size === 'sm'
      ? 'w-7 h-7'
      : size === 'lg'
      ? 'w-10 h-10'
      : 'w-8 h-8';

  const textStyles =
    size === 'sm'
      ? 'text-[14px] font-bold'
      : size === 'lg'
      ? 'text-[19px] font-extrabold'
      : 'text-[16px] font-bold';

  const subtitleStyles =
    size === 'sm' ? 'text-[9px]' : size === 'lg' ? 'text-[11px]' : 'text-[10px]';

  const isDark = tone === 'dark';

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2.5 ${className} select-none ${
        onClick || interactive ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''
      }`}
    >
      <div
        className={`${emblemDimensions} shrink-0 flex items-center justify-center rounded-lg ${
          isDark
            ? 'bg-white/[0.06] border border-white/10 p-1'
            : 'bg-[#0b1713]/[0.04] border border-neutral-200/80 p-0.5'
        }`}
      >
        <img
          src="/assets/aistudio/logo__transparent__55b16555.png"
          alt="ROOMWISE"
          className="w-full h-full object-contain"
          loading="eager"
          decoding="async"
        />
      </div>

      <div className="overflow-hidden leading-tight">
        <div
          className={`font-display ${textStyles} ${
            isDark ? 'text-[#f2f6f3]' : 'text-[#111916]'
          } tracking-[-0.025em] flex items-baseline whitespace-nowrap`}
        >
          <span>ROOMWISE</span>
          <span
            className={`${isDark ? 'text-emerald-400' : 'text-[#0b6e4f]'} font-extrabold ml-0.5`}
            title="Campus Energy Intelligence"
          >
            .
          </span>
        </div>
        {showSubtitle && (
          <div
            className={`${subtitleStyles} tracking-wide font-medium mt-0.5 whitespace-nowrap ${
              isDark ? 'text-[#8ea69b]' : 'text-[#62706a]'
            }`}
          >
            Campus Intelligence
          </div>
        )}
      </div>
    </div>
  );
};
