/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface Props {
  className?: string;
  showSubtitle?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  interactive?: boolean;
  variant?: 'badge' | 'pure';
}

export const RoomwiseLogo: React.FC<Props> = ({
  className = '',
  showSubtitle = true,
  size = 'md',
  onClick,
  interactive = false,
}) => {
  const emblemDimensions =
    size === 'sm'
      ? 'w-7 h-7'
      : size === 'lg'
      ? 'w-11 h-11'
      : 'w-8 h-8';

  const textStyles =
    size === 'sm'
      ? 'text-sm font-bold'
      : size === 'lg'
      ? 'text-lg font-extrabold'
      : 'text-base font-bold';

  const subtitleStyles =
    size === 'sm' ? 'text-[9px]' : size === 'lg' ? 'text-[11px]' : 'text-[10px]';

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2.5 ${className} select-none ${
        onClick || interactive ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''
      }`}
    >
      <div className={`${emblemDimensions} shrink-0 flex items-center justify-center`}>
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
          className={`${textStyles} text-neutral-900 tracking-tight flex items-baseline whitespace-nowrap`}
        >
          <span>ROOMWISE</span>
          <span className="text-emerald-700 font-extrabold ml-0.5" title="Campus Energy Intelligence">
            .
          </span>
        </div>
        {showSubtitle && (
          <div
            className={`${subtitleStyles} tracking-wide text-neutral-500 font-medium mt-0.5 whitespace-nowrap`}
          >
            Adaptive Campus Energy
          </div>
        )}
      </div>
    </div>
  );
};
