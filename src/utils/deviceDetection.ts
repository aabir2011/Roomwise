/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

export type DeviceClass = 'phone' | 'desktop' | 'uncertain';

export interface DeviceClassification {
  deviceClass: DeviceClass;
  isPhone: boolean;
  isDesktop: boolean;
  isUncertain: boolean;
  hasTouch: boolean;
  hasCoarsePointer: boolean;
  hasFinePointer: boolean;
  canHover: boolean;
  viewportWidth: number;
  viewportHeight: number;
  userAgentMobileHint: boolean | null;
  reason: string;
}

interface NavigatorUADataLike {
  mobile?: boolean;
  platform?: string;
}

function safeMatchMedia(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/**
 * Classifies the active device using user-agent/platform hints, touch & pointer
 * capabilities, and viewport geometry. Narrow desktop windows are NOT classified
 * as phones when workstation OS + fine pointer / hover signals are present.
 */
export function classifyDevice(): DeviceClassification {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      deviceClass: 'uncertain',
      isPhone: false,
      isDesktop: false,
      isUncertain: true,
      hasTouch: false,
      hasCoarsePointer: false,
      hasFinePointer: false,
      canHover: false,
      viewportWidth: 0,
      viewportHeight: 0,
      userAgentMobileHint: null,
      reason: 'non-browser-environment',
    };
  }

  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUADataLike }).userAgentData;
  const userAgentMobileHint = typeof uaData?.mobile === 'boolean' ? uaData.mobile : null;

  const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
  const minDimension = Math.min(viewportWidth, viewportHeight);

  const maxTouchPoints = Number(navigator.maxTouchPoints || 0);
  const hasCoarsePointer = safeMatchMedia('(pointer: coarse)');
  const anyCoarsePointer = safeMatchMedia('(any-pointer: coarse)');
  const hasFinePointer = safeMatchMedia('(pointer: fine)');
  const anyFinePointer = safeMatchMedia('(any-pointer: fine)');
  const canHover = safeMatchMedia('(any-hover: hover)') || safeMatchMedia('(hover: hover)');
  const hoverNone = safeMatchMedia('(hover: none)');

  const hasTouch = maxTouchPoints > 0 || hasCoarsePointer || anyCoarsePointer;

  const isIPhoneOrIPod = /iPhone|iPod/i.test(ua);
  const isWindowsPhone = /Windows Phone|IEMobile/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isAndroidPhone = isAndroid && (/Mobile/i.test(ua) || userAgentMobileHint === true);
  const isAndroidTablet = isAndroid && !isAndroidPhone;
  const isIPad =
    /iPad/i.test(ua) ||
    (/Macintosh|Mac OS X/i.test(ua) && maxTouchPoints > 1);

  const isWorkstationUA =
    (/Windows NT/i.test(ua) && !isWindowsPhone) ||
    (/Macintosh|Mac OS X/i.test(ua) && !isIPad) ||
    (/X11|Linux x86_64|Linux aarch64/i.test(ua) && !isAndroid) ||
    /CrOS/i.test(ua) ||
    (/Win32|Win64|MacIntel|Linux/i.test(platform) && !isAndroid && !isIPad);

  let deviceClass: DeviceClass = 'uncertain';
  let reason = 'ambiguous-signals';

  // 1. Definite smartphone signatures
  if (isIPhoneOrIPod || isWindowsPhone || isAndroidPhone) {
    deviceClass = 'phone';
    reason = 'mobile-phone-ua';
  }
  // 2. Explicit UA-CH mobile hint paired with touch/coarse pointer (e.g. mobile emulators/browsers)
  else if (userAgentMobileHint === true && (hasTouch || hasCoarsePointer || hoverNone)) {
    deviceClass = 'phone';
    reason = 'ua-data-mobile-touch';
  }
  // 3. Definite desktop/laptop workstation (remains 'desktop' even in narrow browser windows!)
  else if (
    isWorkstationUA &&
    userAgentMobileHint !== true &&
    (hasFinePointer || anyFinePointer || canHover || maxTouchPoints === 0)
  ) {
    deviceClass = 'desktop';
    reason = 'workstation-pointer-and-os';
  }
  // 4. Compact touch-only handheld with unknown/generic UA
  else if (
    !isWorkstationUA &&
    (hasCoarsePointer || hoverNone) &&
    !hasFinePointer &&
    !canHover &&
    minDimension > 0 &&
    minDimension <= 560
  ) {
    deviceClass = 'phone';
    reason = 'compact-touch-only-viewport';
  }
  // 5. Tablet / convertible (iPad or Android tablet): check external fine pointer vs pure touch
  else if (isIPad || isAndroidTablet) {
    if (hasFinePointer && canHover) {
      deviceClass = 'desktop';
      reason = 'tablet-with-pointer-hover';
    } else if (minDimension > 0 && minDimension <= 520 && hasCoarsePointer) {
      deviceClass = 'phone';
      reason = 'compact-handheld-touch';
    } else {
      deviceClass = 'uncertain';
      reason = 'tablet-touch-uncertain';
    }
  }

  return {
    deviceClass,
    isPhone: deviceClass === 'phone',
    isDesktop: deviceClass === 'desktop',
    isUncertain: deviceClass === 'uncertain',
    hasTouch,
    hasCoarsePointer,
    hasFinePointer,
    canHover,
    viewportWidth,
    viewportHeight,
    userAgentMobileHint,
    reason,
  };
}

/**
 * React hook keeping device classification reactive across resizes,
 * orientation changes, and pointer media-query transitions.
 */
export function useDeviceClassification(): DeviceClassification {
  const [classification, setClassification] = useState<DeviceClassification>(() =>
    classifyDevice()
  );

  useEffect(() => {
    const update = () => {
      setClassification(classifyDevice());
    };

    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    const mediaQueries: MediaQueryList[] = [];
    if (typeof window.matchMedia === 'function') {
      for (const q of ['(pointer: coarse)', '(pointer: fine)', '(any-hover: hover)']) {
        try {
          const mq = window.matchMedia(q);
          mq.addEventListener('change', update);
          mediaQueries.push(mq);
        } catch {
          // ignore older browser media listener limitations
        }
      }
    }

    update();

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      for (const mq of mediaQueries) {
        try {
          mq.removeEventListener('change', update);
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return classification;
}
