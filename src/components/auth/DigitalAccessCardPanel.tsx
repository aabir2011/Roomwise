/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck,
  Smartphone,
  RefreshCw,
  Clock,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  ArrowLeft,
  Loader2,
} from 'lucide-react';
import { useAuth, authFetch, setStoredClientSessionToken } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { VerifiedAdminInfo } from '../../types/auth';
import { ROOMWISE_EASE } from '../../utils/motion';

interface Props {
  selectedStaff?: VerifiedAdminInfo;
  onSuccess?: (admin: VerifiedAdminInfo) => void;
  onBack?: () => void;
  embedded?: boolean;
}

type ChallengePhase =
  | 'initializing'
  | 'awaiting'
  | 'scanned'
  | 'verifying'
  | 'granted'
  | 'expired'
  | 'error';

interface ChallengeData {
  challengeId: string;
  publicNonce: string;
  shortCode: string;
  expiresAt: number;
  qrPayloadUrl: string;
  requestedStaff?: VerifiedAdminInfo;
}

export const DigitalAccessCardPanel: React.FC<Props> = ({
  selectedStaff,
  onSuccess,
  onBack,
  embedded = false,
}) => {
  const { verifyApprovedChallenge } = useAuth();
  const toast = useToast();

  const [phase, setPhase] = useState<ChallengePhase>('initializing');
  const [challenge, setChallenge] = useState<ChallengeData | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [secondsLeft, setSecondsLeft] = useState<number>(90);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [grantedAdmin, setGrantedAdmin] = useState<VerifiedAdminInfo | null>(null);
  const [grantedDevice, setGrantedDevice] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const verifiedRef = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const selectedStaffId = selectedStaff?.id;

  const cleanupListeners = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const handleServerApproval = useCallback(
    async (challengeId: string, deviceLabel?: string) => {
      if (verifiedRef.current) return;
      verifiedRef.current = true;
      cleanupListeners();
      setPhase('verifying');

      const result = await verifyApprovedChallenge(challengeId);
      if (!result.ok || !result.admin) {
        verifiedRef.current = false;
        setPhase('error');
        setErrorMessage(result.error || 'Server verification failed. Please generate a fresh QR code.');
        return;
      }

      setGrantedAdmin(result.admin);
      setGrantedDevice(deviceLabel || 'Authenticated Phone');
      setPhase('granted');

      window.setTimeout(() => {
        if (onSuccess) {
          onSuccess(result.admin!);
        }
      }, 750);
    },
    [cleanupListeners, verifyApprovedChallenge, onSuccess]
  );

  const handleBackClick = useCallback(() => {
    if (challenge && (phase === 'awaiting' || phase === 'scanned' || phase === 'verifying')) {
      authFetch(`/api/auth/challenge/${encodeURIComponent(challenge.challengeId)}/cancel`, {
        method: 'POST',
      }).catch(() => {});
    }
    if (onBack) onBack();
  }, [challenge, phase, onBack]);

  const initiateChallenge = useCallback(async () => {
    cleanupListeners();
    verifiedRef.current = false;
    setPhase('initializing');
    setErrorMessage(null);
    setQrDataUrl('');
    setGrantedAdmin(null);

    try {
      const res = await authFetch('/api/auth/challenge', {
        method: 'POST',
        body: JSON.stringify(selectedStaffId ? { staffId: selectedStaffId } : {}),
      });
      const data = await res.json();

      if (!res.ok) {
        setPhase('error');
        setErrorMessage(data.error || 'Unable to issue QR verification challenge.');
        return;
      }

      if (data.clientSessionToken) {
        setStoredClientSessionToken(data.clientSessionToken);
      }

      const nextChallenge: ChallengeData = {
        challengeId: data.challengeId,
        publicNonce: data.publicNonce,
        shortCode: data.shortCode,
        expiresAt: data.expiresAt,
        qrPayloadUrl: data.qrPayloadUrl,
        requestedStaff: data.requestedStaff,
      };

      const dataUrl = await QRCode.toDataURL(nextChallenge.qrPayloadUrl, {
        width: 320,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: {
          dark: '#064e3b',
          light: '#ffffff',
        },
      });

      setChallenge(nextChallenge);
      setQrDataUrl(dataUrl);
      setSecondsLeft(Math.max(1, Math.round((nextChallenge.expiresAt - Date.now()) / 1000)));
      setPhase('awaiting');
    } catch {
      setPhase('error');
      setErrorMessage('Could not connect to ROOMWISE verification server.');
    }
  }, [cleanupListeners, selectedStaffId]);

  useEffect(() => {
    initiateChallenge();
    return () => {
      cleanupListeners();
    };
  }, [initiateChallenge, cleanupListeners]);

  useEffect(() => {
    if (phase !== 'awaiting' && phase !== 'scanned' && phase !== 'verifying') return;
    if (!challenge) return;

    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((challenge.expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        cleanupListeners();
        setPhase('expired');
      }
    }, 500);

    return () => window.clearInterval(timer);
  }, [phase, challenge, cleanupListeners]);

  const isWaitingForDecision = phase === 'awaiting' || phase === 'scanned' || phase === 'verifying';

  useEffect(() => {
    if (!challenge || !isWaitingForDecision) return;

    let isCancelled = false;

    const processStatusPayload = (payload: {
      status: string;
      deviceName?: string;
    }) => {
      if (isCancelled || verifiedRef.current) return;

      if (payload.status === 'scanned') {
        setPhase((prev) => (prev === 'awaiting' ? 'scanned' : prev));
      } else if (payload.status === 'verifying') {
        setPhase('verifying');
      } else if (payload.status === 'approved') {
        handleServerApproval(challenge.challengeId, payload.deviceName);
      } else if (payload.status === 'rejected' || payload.status === 'expired' || payload.status === 'consumed') {
        cleanupListeners();
        setPhase('expired');
      }
    };

    try {
      const es = new EventSource(
        `/api/auth/challenge/${encodeURIComponent(challenge.challengeId)}/events`,
        { withCredentials: true }
      );
      eventSourceRef.current = es;

      es.addEventListener('status', (evt) => {
        try {
          const parsed = JSON.parse((evt as MessageEvent).data);
          processStatusPayload(parsed);
        } catch {
          // ignore malformed event
        }
      });

      es.onerror = () => {
        es.close();
      };
    } catch {
      // fallback to polling
    }

    const poll = async () => {
      if (isCancelled || verifiedRef.current) return;
      try {
        const res = await authFetch(
          `/api/auth/challenge/${encodeURIComponent(challenge.challengeId)}/status`
        );
        if (!res.ok) return;
        const payload = await res.json();
        processStatusPayload(payload);
      } catch {
        // ignore transient poll errors
      }
    };

    pollTimerRef.current = window.setInterval(poll, 1400);

    return () => {
      isCancelled = true;
      cleanupListeners();
    };
  }, [challenge, isWaitingForDecision, handleServerApproval, cleanupListeners]);

  const formatCountdown = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  const mobileAccessUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/access-card` : '/access-card';

  const handleCopyMobileUrl = async () => {
    try {
      await navigator.clipboard.writeText(mobileAccessUrl);
      setCopiedLink(true);
      toast.success('Mobile access link copied');
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const statusText =
    phase === 'scanned'
      ? 'Phone detected'
      : phase === 'verifying'
      ? 'Verifying'
      : phase === 'granted'
      ? 'Authorised'
      : phase === 'expired'
      ? 'Expired'
      : 'Waiting for authorisation';

  const targetName = challenge?.requestedStaff?.name || selectedStaff?.name;

  return (
    <div className={embedded ? 'space-y-4' : 'p-6 space-y-5 bg-white'}>
      {onBack && phase !== 'granted' && (
        <button
          type="button"
          onClick={handleBackClick}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Sign-In options</span>
        </button>
      )}

      <AnimatePresence mode="wait">
        {phase === 'granted' && grantedAdmin ? (
          <motion.div
            key="granted"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: ROOMWISE_EASE }}
            className="py-6 flex flex-col items-center text-center space-y-4"
          >
            <div className="w-14 h-14 rounded-2xl bg-emerald-700 text-white flex items-center justify-center shadow-sm">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-700">
                Authorised
              </div>
              <h3 className="text-xl font-extrabold text-neutral-900">
                {grantedAdmin.name}
              </h3>
              <p className="text-xs text-neutral-600">
                {grantedAdmin.role} · Confirmed via {grantedDevice}
              </p>
            </div>
          </motion.div>
        ) : phase === 'expired' || phase === 'error' ? (
          <motion.div
            key="terminal-state"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: ROOMWISE_EASE }}
            className="py-5 flex flex-col items-center text-center space-y-4"
          >
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center border bg-amber-50 border-amber-200 text-amber-700">
              {phase === 'expired' ? <Clock className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
            </div>

            <div className="space-y-1 max-w-xs">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-800">
                {phase === 'expired' ? 'Expired' : 'Verification Interrupted'}
              </div>
              <p className="text-xs text-neutral-600 leading-relaxed">
                {phase === 'expired'
                  ? 'This short-lived QR challenge expired after 90 seconds. Generate a fresh QR code to continue.'
                  : errorMessage || 'Unable to verify authentication session.'}
              </p>
            </div>

            <motion.button
              type="button"
              whileTap={{ scale: 0.985 }}
              onClick={initiateChallenge}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Generate Fresh QR Code</span>
            </motion.button>
          </motion.div>
        ) : (
          <motion.div
            key="qr-active"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: ROOMWISE_EASE }}
            className="flex flex-col items-center text-center space-y-4"
          >
            <div className="space-y-1">
              <p className="text-xs font-semibold text-neutral-800 flex items-center justify-center gap-1.5">
                <Smartphone className="w-4 h-4 text-emerald-700" />
                <span>Open ROOMWISE on your phone and scan this QR code</span>
              </p>
              {targetName && (
                <p className="text-[11px] text-neutral-500">
                  Verifying session for <strong className="text-neutral-800">{targetName}</strong>
                </p>
              )}
            </div>

            <div className="relative p-3.5 bg-white rounded-2xl border border-neutral-200 shadow-xs">
              <div className="relative w-52 h-52 flex items-center justify-center bg-white rounded-xl overflow-hidden">
                {qrDataUrl ? (
                  <>
                    <motion.img
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{
                        opacity: phase === 'scanned' || phase === 'verifying' ? 0.25 : 1,
                        scale: 1,
                      }}
                      transition={{ duration: 0.22, ease: ROOMWISE_EASE }}
                      src={qrDataUrl}
                      alt="ROOMWISE Verify with Phone QR Code"
                      className="w-full h-full object-contain"
                    />

                    <AnimatePresence>
                      {(phase === 'scanned' || phase === 'verifying') && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.96 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.18, ease: ROOMWISE_EASE }}
                          className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-white/88 backdrop-blur-xs"
                        >
                          <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center mb-2">
                            <Smartphone className="w-5 h-5" />
                          </div>
                          <div className="text-xs font-bold text-neutral-900">{statusText}</div>
                          <div className="text-[11px] text-emerald-800 mt-0.5 font-medium">
                            {phase === 'verifying'
                              ? 'Confirming authorisation'
                              : 'Tap AUTHORISE DEVICE on your phone'}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-neutral-400">
                    <Loader2 className="w-5 h-5 animate-spin text-emerald-700" />
                    <span className="text-xs">Issuing QR challenge...</span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2 w-full">
              <div className="flex items-center justify-center gap-2 text-xs font-semibold text-emerald-900">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />
                <span>{statusText}</span>
              </div>

              {challenge && (
                <div className="flex items-center justify-center gap-2.5 text-xs text-neutral-500 font-mono tabular-nums flex-wrap">
                  <span>
                    Code: <strong className="text-neutral-900 tracking-wider">{challenge.shortCode}</strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className={secondsLeft <= 20 ? 'text-amber-700 font-semibold' : ''}>
                    Expires {formatCountdown(secondsLeft)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={initiateChallenge}
                    className="text-emerald-700 hover:text-emerald-900 font-sans font-semibold hover:underline cursor-pointer"
                  >
                    Refresh QR
                  </button>
                </div>
              )}

              <div className="pt-2 border-t border-neutral-100 flex items-center justify-between gap-2 text-[11px] text-neutral-500">
                <button
                  type="button"
                  onClick={handleCopyMobileUrl}
                  className="inline-flex items-center gap-1 text-neutral-600 hover:text-neutral-900 font-medium cursor-pointer"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                      <span className="text-emerald-700">Copied mobile URL</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy phone link</span>
                    </>
                  )}
                </button>
                <a
                  href="/access-card"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-900 font-semibold"
                >
                  <span>Open Phone Page</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
