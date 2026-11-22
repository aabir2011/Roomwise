/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  UserProfile,
  UserRole,
  VerifiedAdminInfo,
  PasskeyCredentialSummary,
  DEMO_STUDENT_USER,
} from '../types/auth';
import { STAFF_PROFILES } from '../data/initialClassrooms';
import { runPasskeyLogin, runPasskeyRegistration } from '../utils/webauthnClient';

const CLIENT_SESSION_STORAGE_KEY = 'roomwise_client_session_token';

export function getStoredClientSessionToken(): string | null {
  try {
    return sessionStorage.getItem(CLIENT_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredClientSessionToken(token: string | null) {
  try {
    if (token) {
      sessionStorage.setItem(CLIENT_SESSION_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(CLIENT_SESSION_STORAGE_KEY);
    }
  } catch {
    // ignore storage restriction
  }
}

export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = getStoredClientSessionToken();
  if (token) {
    headers.set('X-Roomwise-Session', token);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, {
    ...init,
    headers,
    credentials: 'include',
  });
}

interface AuthResult {
  ok: boolean;
  admin?: VerifiedAdminInfo;
  error?: string;
  code?: string;
  isIframeBlocked?: boolean;
}

interface RegisterPasskeyResult {
  ok: boolean;
  admin?: VerifiedAdminInfo;
  credential?: PasskeyCredentialSummary;
  authenticated?: boolean;
  error?: string;
  isIframeBlocked?: boolean;
}

interface AuthContextType {
  user: UserProfile;
  role: UserRole;
  isAdminUnlocked: boolean;
  isAuthLoading: boolean;
  staffDirectory: VerifiedAdminInfo[];
  authenticatedAdmin: VerifiedAdminInfo | null;
  authenticatedDeviceName: string | null;
  sessionExpiresAt: number | null;
  isAuthModalOpen: boolean;
  isPhoneQrModalOpen: boolean;
  isLogoutConfirmOpen: boolean;
  isLoggingOut: boolean;
  sessionEndedNotice: boolean;
  verifyApprovedChallenge: (challengeId: string) => Promise<AuthResult>;
  loginWithPasskey: (staffId: string) => Promise<AuthResult>;
  loginWithPassword: (staffId: string, password: string) => Promise<AuthResult>;
  registerPasskey: (params: {
    staffId: string;
    password?: string;
    deviceName?: string;
    signInAfterRegister?: boolean;
  }) => Promise<RegisterPasskeyResult>;
  listMyCredentials: () => Promise<PasskeyCredentialSummary[]>;
  revokeMyCredential: (credId: string) => Promise<{ ok: boolean; error?: string }>;
  refreshStaffDirectory: () => Promise<void>;
  refreshSession: () => Promise<void>;
  lockAdmin: () => Promise<void>;
  openAuthModal: (onSuccess?: () => void) => void;
  closeAuthModal: () => void;
  openPhoneQrModal: () => void;
  closePhoneQrModal: () => void;
  requestLogout: () => void;
  cancelLogout: () => void;
  confirmLogout: () => Promise<void>;
  clearSessionEndedNotice: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Student Mode by default until server confirms an authenticated session
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(false);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [staffDirectory, setStaffDirectory] = useState<VerifiedAdminInfo[]>(STAFF_PROFILES);
  const [authenticatedAdmin, setAuthenticatedAdmin] = useState<VerifiedAdminInfo | null>(null);
  const [authenticatedDeviceName, setAuthenticatedDeviceName] = useState<string | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isPhoneQrModalOpen, setIsPhoneQrModalOpen] = useState(false);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [sessionEndedNotice, setSessionEndedNotice] = useState(false);
  const [authSuccessCallback, setAuthSuccessCallback] = useState<(() => void) | null>(null);

  const refreshStaffDirectory = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/staff-public');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.staff) && data.staff.length > 0) {
        setStaffDirectory(data.staff);
      }
    } catch {
      // keep fallback staff list
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const res = await authFetch('/api/auth/session');
      if (!res.ok) {
        setIsAdminUnlocked(false);
        setAuthenticatedAdmin(null);
        return;
      }
      const data = await res.json();
      if (data.clientSessionToken) {
        setStoredClientSessionToken(data.clientSessionToken);
      }

      if (data.authenticated === true && data.role === 'admin' && data.admin) {
        setIsAdminUnlocked(true);
        setAuthenticatedAdmin(data.admin);
        setAuthenticatedDeviceName(data.deviceName || null);
        setSessionExpiresAt(data.sessionExpiresAt || null);
      } else {
        setIsAdminUnlocked(false);
        setAuthenticatedAdmin(null);
        setAuthenticatedDeviceName(null);
        setSessionExpiresAt(null);
      }
    } catch (err) {
      console.warn('[Auth] Failed to reach session verification server:', err);
      setIsAdminUnlocked(false);
      setAuthenticatedAdmin(null);
    } finally {
      setIsAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
    refreshStaffDirectory();
  }, [refreshSession, refreshStaffDirectory]);

  const applyAuthenticatedSession = useCallback(
    (payload: {
      admin: VerifiedAdminInfo;
      deviceName?: string;
      sessionExpiresAt?: number;
    }) => {
      setIsAdminUnlocked(true);
      setAuthenticatedAdmin(payload.admin);
      setAuthenticatedDeviceName(payload.deviceName || null);
      setSessionExpiresAt(payload.sessionExpiresAt || null);
      setSessionEndedNotice(false);

      if (authSuccessCallback) {
        const cb = authSuccessCallback;
        setAuthSuccessCallback(null);
        cb();
      }
    },
    [authSuccessCallback]
  );

  const verifyApprovedChallenge = useCallback(
    async (challengeId: string): Promise<AuthResult> => {
      try {
        const res = await authFetch(`/api/auth/challenge/${encodeURIComponent(challengeId)}/verify`, {
          method: 'POST',
        });
        const data = await res.json();

        if (!res.ok || !data.verified || !data.admin) {
          return { ok: false, error: data.error || 'Server verification rejected.' };
        }

        if (data.clientSessionToken) {
          setStoredClientSessionToken(data.clientSessionToken);
        }

        applyAuthenticatedSession({
          admin: data.admin,
          deviceName: data.deviceName,
          sessionExpiresAt: data.sessionExpiresAt,
        });

        return { ok: true, admin: data.admin };
      } catch {
        return { ok: false, error: 'Network error while verifying authorisation with server.' };
      }
    },
    [applyAuthenticatedSession]
  );

  const loginWithPasskey = useCallback(
    async (staffId: string): Promise<AuthResult> => {
      const result = await runPasskeyLogin(staffId, authFetch, setStoredClientSessionToken);
      if (!result.ok || !result.admin) {
        return {
          ok: false,
          error: result.error,
          code: result.code,
          isIframeBlocked: result.isIframeBlocked,
        };
      }

      applyAuthenticatedSession({
        admin: result.admin,
        deviceName: result.deviceName,
        sessionExpiresAt: result.sessionExpiresAt,
      });
      refreshStaffDirectory();
      return { ok: true, admin: result.admin };
    },
    [applyAuthenticatedSession, refreshStaffDirectory]
  );

  const loginWithPassword = useCallback(
    async (staffId: string, password: string): Promise<AuthResult> => {
      try {
        const res = await authFetch('/api/auth/password/login', {
          method: 'POST',
          body: JSON.stringify({ staffId, password }),
        });
        const data = await res.json();

        if (!res.ok || !data.verified || !data.admin) {
          return { ok: false, error: data.error || 'Invalid credentials.' };
        }

        if (data.clientSessionToken) {
          setStoredClientSessionToken(data.clientSessionToken);
        }

        applyAuthenticatedSession({
          admin: data.admin,
          deviceName: data.deviceName,
          sessionExpiresAt: data.sessionExpiresAt,
        });
        return { ok: true, admin: data.admin };
      } catch {
        return { ok: false, error: 'Network error while signing in.' };
      }
    },
    [applyAuthenticatedSession]
  );

  const registerPasskey = useCallback(
    async (params: {
      staffId: string;
      password?: string;
      deviceName?: string;
      signInAfterRegister?: boolean;
    }): Promise<RegisterPasskeyResult> => {
      const result = await runPasskeyRegistration(params, authFetch, setStoredClientSessionToken);
      if (!result.ok) {
        return result;
      }

      if (result.authenticated && result.admin) {
        applyAuthenticatedSession({
          admin: result.admin,
          deviceName: result.deviceName,
          sessionExpiresAt: result.sessionExpiresAt,
        });
      }

      await refreshStaffDirectory();
      return result;
    },
    [applyAuthenticatedSession, refreshStaffDirectory]
  );

  const listMyCredentials = useCallback(async (): Promise<PasskeyCredentialSummary[]> => {
    try {
      const res = await authFetch('/api/auth/credentials');
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.credentials) ? data.credentials : [];
    } catch {
      return [];
    }
  }, []);

  const revokeMyCredential = useCallback(
    async (credId: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await authFetch(`/api/auth/credentials/${encodeURIComponent(credId)}/revoke`, {
          method: 'POST',
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, error: data.error || 'Could not revoke credential.' };
        }
        await refreshStaffDirectory();
        return { ok: true };
      } catch {
        return { ok: false, error: 'Network error revoking credential.' };
      }
    },
    [refreshStaffDirectory]
  );

  const performLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // always clear local state even if offline
    } finally {
      setStoredClientSessionToken(null);
      setIsAdminUnlocked(false);
      setAuthenticatedAdmin(null);
      setAuthenticatedDeviceName(null);
      setSessionExpiresAt(null);
      setIsAuthModalOpen(false);
      setIsLogoutConfirmOpen(false);
      setIsLoggingOut(false);
      setSessionEndedNotice(true);
    }
  }, []);

  const openAuthModal = useCallback((onSuccess?: () => void) => {
    if (onSuccess) {
      setAuthSuccessCallback(() => onSuccess);
    } else {
      setAuthSuccessCallback(null);
    }
    setIsAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setIsAuthModalOpen(false);
    setAuthSuccessCallback(null);
  }, []);

  const openPhoneQrModal = useCallback(() => {
    setIsAuthModalOpen(false);
    setIsPhoneQrModalOpen(true);
  }, []);

  const closePhoneQrModal = useCallback(() => {
    setIsPhoneQrModalOpen(false);
  }, []);

  const requestLogout = useCallback(() => {
    setIsLogoutConfirmOpen(true);
  }, []);

  const cancelLogout = useCallback(() => {
    if (!isLoggingOut) {
      setIsLogoutConfirmOpen(false);
    }
  }, [isLoggingOut]);

  const confirmLogout = useCallback(async () => {
    await performLogout();
    if (typeof window !== 'undefined' && !/^\/(?:admin-login|admin)\/?$/i.test(window.location.pathname)) {
      window.history.pushState({}, '', '/admin-login');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [performLogout]);

  const clearSessionEndedNotice = useCallback(() => {
    setSessionEndedNotice(false);
  }, []);

  const currentUser: UserProfile =
    isAdminUnlocked && authenticatedAdmin
      ? {
          id: authenticatedAdmin.id,
          role: 'admin',
          name: authenticatedAdmin.name,
          email: authenticatedAdmin.email,
          departmentOrClass: authenticatedAdmin.role,
          avatarInitials: authenticatedAdmin.avatarInitials,
        }
      : DEMO_STUDENT_USER;

  return (
    <AuthContext.Provider
      value={{
        user: currentUser,
        role: currentUser.role,
        isAdminUnlocked,
        isAuthLoading,
        staffDirectory,
        authenticatedAdmin,
        authenticatedDeviceName,
        sessionExpiresAt,
        isAuthModalOpen,
        isPhoneQrModalOpen,
        isLogoutConfirmOpen,
        isLoggingOut,
        sessionEndedNotice,
        verifyApprovedChallenge,
        loginWithPasskey,
        loginWithPassword,
        registerPasskey,
        listMyCredentials,
        revokeMyCredential,
        refreshStaffDirectory,
        refreshSession,
        lockAdmin: performLogout,
        openAuthModal,
        closeAuthModal,
        openPhoneQrModal,
        closePhoneQrModal,
        requestLogout,
        cancelLogout,
        confirmLogout,
        clearSessionEndedNotice,
        logout: performLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
