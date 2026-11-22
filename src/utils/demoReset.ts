/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { authFetch } from '../context/AuthContext';

let pageLoadResetPromise: Promise<void> | null = null;

function isMobileQrPairingRoute(): boolean {
  if (typeof window === 'undefined') return true;
  const path = window.location.pathname;
  const hash = window.location.hash;
  const search = new URLSearchParams(window.location.search);

  return (
    /^\/(?:access-card|mobile-access)\/?$/i.test(path) ||
    /^#\/(?:access-card|mobile-access)/i.test(hash) ||
    search.has('c') ||
    search.has('challenge')
  );
}

/**
 * Restores temporary demonstration state (simulated appliance overrides,
 * audit remediation markers, and temporary allocation runs/decisions)
 * exactly once per full browser page reload.
 *
 * Normal in-app tab and view navigation never triggers a reset because this
 * singleton promise persists for the lifetime of the loaded SPA session.
 */
export function ensureDemoResetOnPageLoad(): Promise<void> {
  if (typeof window === 'undefined' || isMobileQrPairingRoute()) {
    return Promise.resolve();
  }

  if (!pageLoadResetPromise) {
    pageLoadResetPromise = authFetch('/api/demo/reset', {
      method: 'POST',
      cache: 'no-store',
    })
      .then(() => undefined)
      .catch(() => undefined);
  }

  return pageLoadResetPromise;
}
