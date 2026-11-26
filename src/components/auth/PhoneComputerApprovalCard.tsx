/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import {
  ShieldCheck,
  Monitor,
  ScanFace,
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  ArrowLeft,
} from 'lucide-react';
import { VerifiedAdminInfo } from '../../types/auth';
import {
  authFetch,
  setStoredClientSessionToken,
  useAuth,
} from '../../context/AuthContext';
import { formatWebAuthnError } from '../../utils/webauthnClient';
import { tabContentVariants } from '../../utils/motion';
import { ActionButton, IconButton, InlineActionLink } from '../common/DesignSystem';

export interface InspectedChallenge {
  challengeId: string;
  nonce: string;
  shortCode: string;
  status: string;
  createdAt: number;
  expiresAt: number;
  browserInfo: string;
  targetSystem: string;
  scope: string;
  requestedStaff?: VerifiedAdminInfo;
  phoneAuthenticated?: boolean;
  authenticatedPhoneStaff?: VerifiedAdminInfo;
  staffMismatch?: boolean;
  requiresPasskeyVerification?: boolean;
}

const DEVICE_TOKEN_STORAGE_KEY = 'roomwise_mobile_device_token';

function getStoredDeviceToken(): string | null {
  try {
    return localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function phoneChallengeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const deviceToken = getStoredDeviceToken();
  if (deviceToken) {
    headers.set('X-Roomwise-Device', deviceToken);
  }
  return authFetch(input, {
    ...init,
    headers,
  });
}

interface Props {
  challenge: InspectedChallenge;
  fallbackStaff?: VerifiedAdminInfo;
  onApproved?: (approvedByName: string) => void;
  onDone: () => void;
  onCancelScan: () => void;
  onExpired: (message: string) => void;
}

export const PhoneComputerApprovalCard: React.FC<Props> = ({
  challenge,
  fallbackStaff,
  onApproved,
  onDone,
  onCancelScan,
  onExpired,
}) => {
  const { refreshSession, staffDirectory } = useAuth();

  const [secondsLeft, setSecondsLeft] = useState<number>(() =>
    Math.max(0, Math.ceil((challenge.expiresAt - Date.now()) / 1000))
  );
  const [decisionState, setDecisionState] = useState<
    'idle' | 'verifying-passkey' | 'submitting' | 'approved'
  >('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [approvedByName, setApprovedByName] = useState<string>('');

  // Inline credentials when the phone is not already signed in (or mismatched)
  const targetTeacher =
    challenge.requestedStaff ||
    challenge.authenticatedPhoneStaff ||
    fallbackStaff ||
    staffDirectory[0];

  const needsInlineVerify = !challenge.phoneAuthenticated || Boolean(challenge.staffMismatch);
  const canUsePasskeyInline = Boolean(
    targetTeacher?.hasPasskey && challenge.requiresPasskeyVerification
  );

  const [usePasswordOverride, setUsePasswordOverride] = useState<boolean>(
    () => needsInlineVerify && !canUsePasskeyInline
  );
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (decisionState === 'approved') return;
    const interval = window.setInterval(() => {
      const rem = Math.max(0, Math.ceil((challenge.expiresAt - Date.now()) / 1000));
      setSecondsLeft(rem);
      if (rem <= 0) {
        window.clearInterval(interval);
        onExpired(
          'This QR code expired before you authorised the computer. Generate a fresh QR code on the computer and scan again.'
        );
      }
    }, 500);

    return () => window.clearInterval(interval);
  }, [challenge.expiresAt, decisionState, onExpired]);

  const handleAuthoriseDevice = async () => {
    setErrorMsg(null);

    if (usePasswordOverride && !passwordInput) {
      setErrorMsg(`Enter the password for ${targetTeacher?.name || 'your profile'} to authorise.`);
      return;
    }

    let passkeyAssertion: unknown = undefined;

    if (!usePasswordOverride && challenge.requiresPasskeyVerification) {
      setDecisionState('verifying-passkey');
      try {
        const optRes = await phoneChallengeFetch(
          `/api/auth/challenge/${encodeURIComponent(challenge.challengeId)}/passkey-options`,
          {
            method: 'POST',
            body: JSON.stringify({
              nonce: challenge.nonce,
              staffId: targetTeacher?.id,
            }),
          }
        );
        const optData = await optRes.json();
        if (!optRes.ok) {
          setDecisionState('idle');
          setErrorMsg(optData.error || 'Could not start passkey confirmation.');
          return;
        }
        if (optData.clientSessionToken) {
          setStoredClientSessionToken(optData.clientSessionToken);
        }
        if (optData.required && optData.options) {
          passkeyAssertion = await startAuthentication({
            optionsJSON: optData.options as PublicKeyCredentialRequestOptionsJSON,
          });
        }
      } catch (err) {
        const formatted = formatWebAuthnError(err);
        setDecisionState('idle');
        setErrorMsg(formatted.message);
        if (needsInlineVerify) {
          setUsePasswordOverride(true);
        }
        return;
      }
    }

    setDecisionState('submitting');
    try {
      const res = await phoneChallengeFetch(
        `/api/auth/challenge/${encodeURIComponent(challenge.challengeId)}/respond`,
        {
          method: 'POST',
          body: JSON.stringify({
            nonce: challenge.nonce,
            decision: 'approve',
            staffId: targetTeacher?.id,
            passkeyResponse: passkeyAssertion,
            password: usePasswordOverride ? passwordInput : undefined,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setDecisionState('idle');
        setErrorMsg(data.error || 'Failed to authorise the computer session.');
        return;
      }

      setApprovedByName(data.approvedBy || targetTeacher?.name || 'Administrator');
      setPasswordInput('');
      setDecisionState('approved');
      await refreshSession();
      if (onApproved) {
        onApproved(data.approvedBy || targetTeacher?.name || 'Administrator');
      }
    } catch {
      setDecisionState('idle');
      setErrorMsg('Network error submitting computer authorisation.');
    }
  };

  if (decisionState === 'approved') {
    return (
      <motion.div
        key="phone-pc-approved"
        variants={tabContentVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="rounded-2xl border border-emerald-200 bg-white shadow-sm overflow-hidden"
      >
        <div className="h-1 bg-emerald-700" />
        <div className="p-6 sm:p-7 text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center border bg-emerald-50 border-emerald-200 text-emerald-700">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-800">
              Authorised
            </div>
            <h2 className="text-xl font-extrabold text-neutral-900">
              Computer Session Unlocked
            </h2>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Administrator access has been granted for{' '}
              <strong className="text-neutral-900">{challenge.browserInfo}</strong>.
            </p>
          </div>

          <div className="text-[11px] text-neutral-500 border-t border-neutral-100 pt-4">
            Authorised by <strong className="text-neutral-800">{approvedByName}</strong>
          </div>

          <ActionButton
            variant="primary"
            size="lg"
            fullWidth
            onClick={onDone}
            className="min-h-[46px]"
          >
            Done
          </ActionButton>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      key="phone-pc-confirm"
      variants={tabContentVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden"
    >
      <div className="h-1 bg-gradient-to-r from-emerald-800 via-emerald-600 to-teal-600" />
      <div className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <InlineActionLink
            tone="neutral"
            icon={<ArrowLeft className="w-3.5 h-3.5" />}
            onClick={onCancelScan}
          >
            Back
          </InlineActionLink>
          <span className="text-xs font-mono font-bold text-emerald-800 tabular-nums shrink-0">
            Expires in {secondsLeft}s
          </span>
        </div>

        <div className="space-y-0.5">
          <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-800">
            ROOMWISE · Computer Login Request
          </div>
          <h2 className="text-lg font-extrabold text-neutral-900 tracking-tight">
            Authorise This Computer?
          </h2>
        </div>

        {challenge.staffMismatch && challenge.requestedStaff && challenge.authenticatedPhoneStaff && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>
              This QR request is for <strong>{challenge.requestedStaff.name}</strong>, while this phone is signed in as{' '}
              <strong>{challenge.authenticatedPhoneStaff.name}</strong>. Confirm with {challenge.requestedStaff.name}'s credentials below.
            </span>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 divide-y divide-neutral-200/80 text-xs">
          {targetTeacher && (
            <div className="p-3.5 flex items-center justify-between gap-3">
              <span className="text-neutral-500">Teacher Profile</span>
              <span className="font-bold text-neutral-900 text-right">
                {targetTeacher.name}
              </span>
            </div>
          )}
          <div className="p-3.5 flex items-center justify-between gap-3">
            <span className="text-neutral-500 flex items-center gap-1.5">
              <Monitor className="w-3.5 h-3.5 text-emerald-700" />
              <span>Computer / Session</span>
            </span>
            <span className="font-semibold text-neutral-900 text-right">
              {challenge.browserInfo}
            </span>
          </div>
          <div className="p-3.5 flex items-center justify-between gap-3">
            <span className="text-neutral-500">System</span>
            <span className="font-semibold text-neutral-900 text-right">
              {challenge.targetSystem}
            </span>
          </div>
          <div className="p-3.5 flex items-center justify-between gap-3">
            <span className="text-neutral-500">Pairing Code</span>
            <span className="font-mono font-bold text-neutral-900 tracking-wider">
              {challenge.shortCode}
            </span>
          </div>
        </div>

        {/* Inline password verification if phone has not signed in yet or no passkey is available */}
        {usePasswordOverride && targetTeacher && (
          <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 space-y-2">
            <label className="block text-xs font-semibold text-neutral-700">
              Confirm password for {targetTeacher.name}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value);
                  setErrorMsg(null);
                }}
                autoComplete="current-password"
                placeholder="Enter staff password"
                className="w-full min-h-[42px] px-3.5 py-2 pr-10 bg-white border border-neutral-300 rounded-xl text-xs text-neutral-900 focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
              <IconButton
                variant="ghost"
                size="xs"
                label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((s) => !s)}
                className="!absolute right-2 top-1/2 -translate-y-1/2"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </IconButton>
            </div>
            {canUsePasskeyInline && (
              <InlineActionLink
                tone="emerald"
                onClick={() => {
                  setUsePasswordOverride(false);
                  setErrorMsg(null);
                }}
              >
                Use registered passkey instead
              </InlineActionLink>
            )}
          </div>
        )}

        {!usePasswordOverride && challenge.requiresPasskeyVerification && (
          <div className="px-3.5 py-2.5 rounded-xl bg-emerald-50/80 border border-emerald-200 text-[11px] text-emerald-950 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ScanFace className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>Your registered passkey will verify your identity when you authorise.</span>
            </div>
            {needsInlineVerify && (
              <InlineActionLink
                tone="emerald"
                icon={<KeyRound className="w-3 h-3" />}
                onClick={() => setUsePasswordOverride(true)}
                className="shrink-0"
              >
                Password
              </InlineActionLink>
            )}
          </div>
        )}

        <div className="space-y-2.5 pt-1">
          <ActionButton
            variant="forest"
            size="lg"
            fullWidth
            loading={decisionState !== 'idle'}
            icon={<ShieldCheck className="w-5 h-5" />}
            onClick={handleAuthoriseDevice}
            className="min-h-[48px] text-sm font-bold tracking-wide"
          >
            {decisionState === 'verifying-passkey'
              ? 'Verifying Passkey...'
              : decisionState === 'submitting'
              ? 'Authorising Computer...'
              : 'AUTHORISE DEVICE'}
          </ActionButton>
          <p className="text-[11px] text-center text-neutral-500">
            Review the computer details above before authorising. Close or tap Back to cancel.
          </p>
        </div>
      </div>
    </motion.div>
  );
};
