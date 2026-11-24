/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type WorkspaceTabId =
  | 'dashboard'
  | 'digital-twin'
  | 'campus-live'
  | 'classrooms'
  | 'environmental-solar'
  | 'environmental'
  | 'solar'
  | 'analytics'
  | 'history'
  | 'space-intelligence'
  | 'audit'
  | 'reports'
  | 'settings';

export type AppRoute =
  | { type: 'classroom'; roomCode: string }
  | { type: 'access-card' }
  | { type: 'admin-login' }
  | { type: 'dashboard'; tab: WorkspaceTabId }
  | { type: 'not-found'; pathname: string };

const PATH_TO_TAB: Record<string, WorkspaceTabId> = {
  '/': 'dashboard',
  '/overview': 'dashboard',
  '/dashboard': 'dashboard',
  '/digital-twin': 'digital-twin',
  '/campus-live': 'campus-live',
  '/classrooms': 'classrooms',
  '/environmental-solar': 'environmental-solar',
  '/environmental': 'environmental',
  '/solar': 'solar',
  '/analytics': 'analytics',
  '/history': 'history',
  '/space-intelligence': 'space-intelligence',
  '/audit': 'audit',
  '/reports': 'reports',
  '/settings': 'settings',
};

const TAB_TO_PATH: Record<WorkspaceTabId, string> = {
  dashboard: '/',
  'digital-twin': '/digital-twin',
  'campus-live': '/campus-live',
  classrooms: '/classrooms',
  'environmental-solar': '/environmental-solar',
  environmental: '/environmental',
  solar: '/solar',
  analytics: '/analytics',
  history: '/history',
  'space-intelligence': '/space-intelligence',
  audit: '/audit',
  reports: '/reports',
  settings: '/settings',
};

export const VALID_WORKSPACE_TABS = new Set<string>(Object.keys(TAB_TO_PATH));

export function getPathForTab(tab: string): string {
  if (tab in TAB_TO_PATH) {
    return TAB_TO_PATH[tab as WorkspaceTabId];
  }
  return '/';
}

export function normalizePathname(pathname: string): string {
  const trimmed = (pathname || '/').trim();
  if (!trimmed || trimmed === '/') return '/';
  const collapsed = trimmed.replace(/\/{2,}/g, '/');
  return collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed;
}

export function parseRouteLocation(input: {
  pathname: string;
  search?: string;
  hash?: string;
}): AppRoute {
  const rawPath = input.pathname || '/';
  const normalizedPath = normalizePathname(rawPath);
  const lowerPath = normalizedPath.toLowerCase();
  const hash = input.hash || '';
  const search = new URLSearchParams(input.search || '');

  if (
    /^\/(?:access-card|mobile-access)$/i.test(normalizedPath) ||
    /^#\/(?:access-card|mobile-access)/i.test(hash) ||
    search.has('c') ||
    search.has('challenge')
  ) {
    return { type: 'access-card' };
  }

  if (/^\/(?:admin-login|admin)$/i.test(normalizedPath) || /^#\/(?:admin-login|admin)/i.test(hash)) {
    return { type: 'admin-login' };
  }

  const queryRoom = search.get('room') || search.get('classroom');
  if (queryRoom && queryRoom.trim()) {
    return { type: 'classroom', roomCode: queryRoom.trim() };
  }

  const pathMatch = normalizedPath.match(/^\/classroom\/([^/?#]+)$/i);
  if (pathMatch) {
    let decoded = pathMatch[1];
    try {
      decoded = decodeURIComponent(pathMatch[1]);
    } catch {
      // Keep raw segment if malformed percent encoding
    }
    return { type: 'classroom', roomCode: decoded.trim() };
  }

  const hashMatch = hash.match(/^#\/classroom\/([^/?#]+)/i);
  if (hashMatch) {
    let decoded = hashMatch[1];
    try {
      decoded = decodeURIComponent(hashMatch[1]);
    } catch {
      // Keep raw segment if malformed percent encoding
    }
    return { type: 'classroom', roomCode: decoded.trim() };
  }

  const matchedTab = PATH_TO_TAB[lowerPath];
  if (matchedTab) {
    return { type: 'dashboard', tab: matchedTab };
  }

  return { type: 'not-found', pathname: rawPath };
}

export function parseRouteFromUrl(): AppRoute {
  if (typeof window === 'undefined') return { type: 'dashboard', tab: 'dashboard' };
  return parseRouteLocation({
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  });
}
