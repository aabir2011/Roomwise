/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { VerifiedAdminInfo, PasskeyCredentialSummary } from '../types/auth';
import { classifyDevice } from './deviceDetection';

export interface BiometricCapability {
  supported: boolean;
  platformAvailable: boolean;
  prefersFaceLabel: boolean;
  primaryLabel: string;
  helperDescription: string;
  deviceLabel: string;
  isMobileDevice: boolean;
  isEmbeddedIframe: boolean;
}

export function detectFriendlyDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Registered Device';
  const ua = navigator.userAgent;
  let browser = 'Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';

  if (/iPhone/i.test(ua)) return `iPhone · ${browser}`;
  if (/iPad/i.test(ua)) return `iPad · ${browser}`;
  if (/Android/i.test(ua)) return `Android · ${browser}`;
  if (/Mac OS X/i.test(ua)) return `Mac · ${browser}`;
  if (/Windows/i.test(ua)) return `Windows PC · ${browser}`;
  if (/CrOS/i.test(ua)) return `Chromebook · ${browser}`;
  return `Workstation · ${browser}`;
}

export async function detectBiometricCapability(): Promise<BiometricCapability> {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const device = classifyDevice();
  const isMobileDevice = device.isPhone || /iPhone|iPad|iPod|Android/i.test(ua);
  const isEmbeddedIframe =
    typeof window !== 'undefined' ? window.self !== window.top : false;

  const supported = browserSupportsWebAuthn();
  let platformAvailable = false;
  if (supported) {
    try {
      platformAvailable = await platformAuthenticatorIsAvailable();
    } catch {
      platformAvailable = false;
    }
  }

  // Only label "Continue with Face Recognition" when a platform authenticator is genuinely available
  // on OS platforms with native Face ID / Windows Hello / Android Biometrics.
  const osHasFaceBiometrics =
    /iPhone|iPad|Windows|Android|Macintosh|Mac OS X/i.test(ua);
  const prefersFaceLabel = supported && platformAvailable && osHasFaceBiometrics;

  const primaryLabel = prefersFaceLabel
    ? 'Continue with Face Recognition'
    : 'Continue with Passkey';

  let helperDescription = 'Verify using your device passkey or security key.';
  if (prefersFaceLabel) {
    if (/iPhone|iPad/i.test(ua)) {
      helperDescription = 'Uses native Apple Face ID or device passkey.';
    } else if (/Windows/i.test(ua)) {
      helperDescription = 'Uses Windows Hello facial recognition or passkey.';
    } else if (/Android/i.test(ua)) {
      helperDescription = 'Uses Android face recognition or device biometrics.';
    } else {
      helperDescription = 'Uses your device built-in biometric recognition or passkey.';
    }
  } else if (!supported) {
    helperDescription =
      'Passkeys are not supported in this browser. Use another sign-in option below.';
  }

  return {
    supported,
    platformAvailable,
    prefersFaceLabel,
    primaryLabel,
    helperDescription,
    deviceLabel: detectFriendlyDeviceLabel(),
    isMobileDevice,
    isEmbeddedIframe,
  };
}

export function formatWebAuthnError(err: unknown): {
  message: string;
  isIframeBlocked: boolean;
  isCancelled: boolean;
} {
  const name = err instanceof Error ? err.name : '';
  const raw = err instanceof Error ? err.message : String(err || '');

  const isIframeBlocked =
    name === 'SecurityError' ||
    /publickey-credentials|permissions policy|not enabled in this document|same-origin/i.test(raw);

  if (isIframeBlocked) {
    return {
      isIframeBlocked: true,
      isCancelled: false,
      message:
        'Biometric passkeys are restricted inside an embedded preview frame. Open ROOMWISE in a top-level browser tab to use Face Recognition / Passkey, or use password sign-in below.',
    };
  }

  if (name === 'NotAllowedError' || name === 'AbortError') {
    return {
      isIframeBlocked: false,
      isCancelled: true,
      message:
        'Biometric prompt was cancelled or timed out on this device. Try again or choose another sign-in option.',
    };
  }

  if (name === 'InvalidStateError') {
    return {
      isIframeBlocked: false,
      isCancelled: false,
      message: 'This device passkey is already registered for your profile.',
    };
  }

  return {
    isIframeBlocked: false,
    isCancelled: false,
    message: raw || 'Biometric authentication could not be completed on this device.',
  };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function runPasskeyLogin(
  staffId: string,
  fetchFn: FetchLike,
  onToken?: (token: string) => void
): Promise<{
  ok: boolean;
  admin?: VerifiedAdminInfo;
  deviceName?: string;
  grantedAt?: number;
  sessionExpiresAt?: number;
  error?: string;
  code?: string;
  isIframeBlocked?: boolean;
}> {
  try {
    const optRes = await fetchFn('/api/auth/passkey/login/options', {
      method: 'POST',
      body: JSON.stringify({ staffId }),
    });
    const optData = await optRes.json();

    if (!optRes.ok || !optData.options) {
      return {
        ok: false,
        error: optData.error || 'Unable to start passkey sign-in.',
        code: optData.code,
      };
    }

    if (optData.clientSessionToken && onToken) {
      onToken(optData.clientSessionToken);
    }

    const assertion = await startAuthentication({
      optionsJSON: optData.options as PublicKeyCredentialRequestOptionsJSON,
    });

    const verifyRes = await fetchFn('/api/auth/passkey/login/verify', {
      method: 'POST',
      body: JSON.stringify({
        staffId,
        response: assertion,
      }),
    });
    const verifyData = await verifyRes.json();

    if (!verifyRes.ok || !verifyData.verified || !verifyData.admin) {
      return {
        ok: false,
        error: verifyData.error || 'Passkey verification failed on the server.',
      };
    }

    return {
      ok: true,
      admin: verifyData.admin,
      deviceName: verifyData.deviceName,
      grantedAt: verifyData.grantedAt,
      sessionExpiresAt: verifyData.sessionExpiresAt,
    };
  } catch (err) {
    const parsed = formatWebAuthnError(err);
    return {
      ok: false,
      error: parsed.message,
      isIframeBlocked: parsed.isIframeBlocked,
    };
  }
}

export async function runPasskeyRegistration(
  params: {
    staffId: string;
    password?: string;
    deviceName?: string;
    signInAfterRegister?: boolean;
  },
  fetchFn: FetchLike,
  onToken?: (token: string) => void
): Promise<{
  ok: boolean;
  admin?: VerifiedAdminInfo;
  credential?: PasskeyCredentialSummary;
  authenticated?: boolean;
  deviceName?: string;
  grantedAt?: number;
  sessionExpiresAt?: number;
  error?: string;
  isIframeBlocked?: boolean;
}> {
  try {
    const beginRes = await fetchFn('/api/auth/passkey/register/begin', {
      method: 'POST',
      body: JSON.stringify({
        staffId: params.staffId,
        password: params.password,
        deviceName: params.deviceName,
      }),
    });
    const beginData = await beginRes.json();

    if (!beginRes.ok || !beginData.options) {
      return {
        ok: false,
        error: beginData.error || 'Could not start biometric passkey registration.',
      };
    }

    if (beginData.clientSessionToken && onToken) {
      onToken(beginData.clientSessionToken);
    }

    const attestation = await startRegistration({
      optionsJSON: beginData.options as PublicKeyCredentialCreationOptionsJSON,
    });

    const finishRes = await fetchFn('/api/auth/passkey/register/finish', {
      method: 'POST',
      body: JSON.stringify({
        staffId: params.staffId,
        deviceName: params.deviceName,
        signInAfterRegister: params.signInAfterRegister,
        response: attestation,
      }),
    });
    const finishData = await finishRes.json();

    if (!finishRes.ok || !finishData.registered) {
      return {
        ok: false,
        error: finishData.error || 'Biometric passkey verification failed.',
      };
    }

    return {
      ok: true,
      admin: finishData.admin,
      credential: finishData.credential,
      authenticated: finishData.authenticated,
      deviceName: finishData.deviceName,
      grantedAt: finishData.grantedAt,
      sessionExpiresAt: finishData.sessionExpiresAt,
    };
  } catch (err) {
    const parsed = formatWebAuthnError(err);
    return {
      ok: false,
      error: parsed.message,
      isIframeBlocked: parsed.isIframeBlocked,
    };
  }
}
