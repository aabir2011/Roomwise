/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Smartphone,
  Camera,
  AlertTriangle,
  ArrowLeft,
  LogOut,
  Loader2,
} from 'lucide-react';
import { RoomwiseLogo } from '../common/RoomwiseLogo';
import { AmbientBackdrop } from '../common/AmbientBackdrop';
import { TeacherLoginPanel } from './TeacherLoginPanel';
import { PhoneQRScanner } from './PhoneQRScanner';
import {
  InspectedChallenge,
  PhoneComputerApprovalCard,
  phoneChallengeFetch,
} from './PhoneComputerApprovalCard';
import { extractChallengeParams, ParsedQRChallengeParams } from '../../utils/qrChallengeParser';
import { useAuth } from '../../context/AuthContext';
import { VerifiedAdminInfo } from '../../types/auth';
import { tabContentVariants } from '../../utils/motion';
import { ActionButton } from '../common/DesignSystem';

const DEVICE_TOKEN_STORAGE_KEY = 'roomwise_mobile_device_token';

function setStoredDeviceToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

interface RegisteredDeviceSummary {
  deviceId: string;
  deviceName: string;
  registeredAt: number;
}

interface Props {
  onNavigateHome?: () => void;
}

export const MobileAccessCardView: React.FC<Props> = ({ onNavigateHome }) => {
  const {
    isAdminUnlocked,
    isAuthLoading,
    authenticatedAdmin,
    authenticatedDeviceName,
    logout,
  } = useAuth();

  const [legacyDeviceLoading, setLegacyDeviceLoading] = useState(true);
  const [legacyDevice, setLegacyDevice] = useState<RegisteredDeviceSummary | null>(null);
  const [legacyAdmin, setLegacyAdmin] = useState<VerifiedAdminInfo | null>(null);

  // Pending scanned QR params from URL (?c=...&n=...)
  const [pendingQrParams, setPendingQrParams] = useState<ParsedQRChallengeParams | null>(() => {
    if (typeof window === 'undefined') return null;
    return extractChallengeParams(window.location.href);
  });

  // Active challenge inspection & camera scanner state
  const [inspectedChallenge, setInspectedChallenge] = useState<InspectedChallenge | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [manualCodeInput, setManualCodeInput] = useState('');

  // Check any existing paired mobile device token on mount
  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        const meRes = await phoneChallengeFetch('/api/auth/device/me');
        if (meRes.ok) {
          const meJson = await meRes.json();
          if (active && meJson.registered && meJson.device && meJson.admin) {
            setLegacyDevice(meJson.device);
            setLegacyAdmin(meJson.admin);
          }
        }
      } catch {
        // ignore startup error
      } finally {
        if (active) setLegacyDeviceLoading(false);
      }
    };
    init();

    return () => {
      active = false;
    };
  }, []);

  const activeTeacher: VerifiedAdminInfo | null =
    (isAdminUnlocked && authenticatedAdmin) || legacyAdmin || null;
  const activeDeviceLabel =
    (isAdminUnlocked && authenticatedDeviceName) ||
    legacyDevice?.deviceName ||
    'Authenticated Phone';

  const inspectChallengePayload = useCallback(
    async (payload: { challengeId?: string; nonce?: string; shortCode?: string }) => {
      setIsInspecting(true);
      setInspectError(null);

      try {
        const res = await phoneChallengeFetch('/api/auth/challenge/inspect', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (!res.ok) {
          if (res.status === 401) {
            setLegacyDevice(null);
            setLegacyAdmin(null);
            setStoredDeviceToken(null);
          }
          setInspectedChallenge(null);
          setInspectError(data.error || 'Could not validate computer QR code.');
          return;
        }

        setInspectedChallenge(data as InspectedChallenge);
        setIsCameraOpen(false);
      } catch {
        setInspectError('Network error communicating with ROOMWISE server.');
      } finally {
        setIsInspecting(false);
      }
    },
    []
  );

  const isCheckingAuth = isAuthLoading || legacyDeviceLoading;

  // Inspect scanned QR params immediately on load (supports direct phone camera QR scans)
  useEffect(() => {
    if (!isCheckingAuth && pendingQrParams && !inspectedChallenge && !inspectError) {
      inspectChallengePayload(pendingQrParams);
      setPendingQrParams(null);
    }
  }, [isCheckingAuth, pendingQrParams, inspectedChallenge, inspectError, inspectChallengePayload]);

  const handlePhoneSignOut = async () => {
    setIsCameraOpen(false);
    try {
      await phoneChallengeFetch('/api/auth/device/revoke', { method: 'POST' });
    } catch {
      // ignore
    }
    setStoredDeviceToken(null);
    setLegacyDevice(null);
    setLegacyAdmin(null);
    setInspectedChallenge(null);
    await logout();
  };

  const handleManualCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCodeInput.trim()) return;
    inspectChallengePayload({ shortCode: manualCodeInput.trim() });
  };

  const resetForNextScan = () => {
    setInspectedChallenge(null);
    setInspectError(null);
    setManualCodeInput('');
    if (typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState({}, '', '/access-card');
    }
  };

  const activeScreenKey = isCheckingAuth
    ? 'checking'
    : inspectedChallenge
    ? 'confirm'
    : !activeTeacher
    ? 'signin'
    : 'scanner';

  return (
    <div className="min-h-screen bg-app-ambient text-neutral-900 flex flex-col justify-between relative selection:bg-[#0b6e4f] selection:text-white">
      <AmbientBackdrop />
      {/* Top Header */}
      <header className="sticky top-0 z-30 glass-header px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <RoomwiseLogo size="sm" showSubtitle={false} />
            <span className="text-neutral-300" aria-hidden="true">
              /
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 truncate">
              Mobile Access
            </span>
          </div>

          {onNavigateHome && (
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={onNavigateHome}
              icon={<ArrowLeft className="w-3.5 h-3.5" />}
            >
              Portal
            </ActionButton>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-6 sm:py-10">
        <div className="w-full max-w-md space-y-5">
          <AnimatePresence mode="wait">
            {activeScreenKey === 'checking' && (
              <motion.div
                key="mobile-checking"
                variants={tabContentVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="p-8 rounded-2xl border border-neutral-200 bg-white text-center space-y-3 shadow-xs"
              >
                <Loader2 className="w-6 h-6 animate-spin text-emerald-700 mx-auto" />
                <div className="text-xs font-medium text-neutral-600">
                  Checking teacher session...
                </div>
              </motion.div>
            )}

            {activeScreenKey === 'confirm' && inspectedChallenge && (
              <PhoneComputerApprovalCard
                challenge={inspectedChallenge}
                fallbackStaff={activeTeacher || undefined}
                onDone={resetForNextScan}
                onCancelScan={resetForNextScan}
                onExpired={(expiredMsg) => {
                  setInspectedChallenge(null);
                  setInspectError(expiredMsg);
                }}
              />
            )}

            {activeScreenKey === 'signin' && (
              <motion.div
                key="mobile-signin"
                variants={tabContentVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="space-y-4"
              >
                {inspectError && (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{inspectError}</span>
                  </div>
                )}

                <div className="rounded-2xl border border-neutral-200 shadow-sm overflow-hidden bg-white">
                  <TeacherLoginPanel variant="mobile" />
                </div>
              </motion.div>
            )}

            {activeScreenKey === 'scanner' && activeTeacher && (
              <motion.div
                key="mobile-scanner"
                variants={tabContentVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="space-y-4"
              >
                <div className="rounded-2xl border border-emerald-200/90 bg-white shadow-sm overflow-hidden">
                  <div className="h-1 bg-gradient-to-r from-emerald-800 via-emerald-600 to-teal-600" />
                  <div className="p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-xl bg-emerald-700 text-white font-bold text-sm flex items-center justify-center shrink-0">
                          {activeTeacher.avatarInitials}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-800">
                            Authenticated Teacher
                          </div>
                          <div className="text-sm font-extrabold text-neutral-900 truncate">
                            {activeTeacher.name}
                          </div>
                          <div className="text-xs text-neutral-500 truncate">{activeTeacher.role}</div>
                        </div>
                      </div>

                      <ActionButton
                        variant="secondary"
                        size="sm"
                        onClick={handlePhoneSignOut}
                        icon={<LogOut className="w-3.5 h-3.5" />}
                      >
                        Sign Out
                      </ActionButton>
                    </div>

                    <div className="text-[11px] text-neutral-500 flex items-center gap-2 pt-2 border-t border-neutral-100">
                      <Smartphone className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <span className="truncate">{activeDeviceLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-emerald-800 font-semibold">Verified</span>
                    </div>
                  </div>
                </div>

                {inspectError && !isCameraOpen && (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{inspectError}</span>
                  </div>
                )}

                <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm p-5 space-y-4">
                  <div className="space-y-1">
                    <h2 className="text-sm font-bold text-neutral-900">
                      Authorise a Computer Session
                    </h2>
                    <p className="text-xs text-neutral-500 leading-relaxed">
                      Scan the ROOMWISE QR code shown on a classroom or office computer to unlock administrator controls there.
                    </p>
                  </div>

                  <ActionButton
                    variant="forest"
                    size="lg"
                    fullWidth
                    loading={isInspecting}
                    icon={<Camera className="w-4 h-4" />}
                    onClick={() => {
                      setInspectError(null);
                      setIsCameraOpen(true);
                    }}
                    className="min-h-[48px]"
                  >
                    {isInspecting ? 'Validating QR...' : 'Scan Computer QR Code'}
                  </ActionButton>

                  <form onSubmit={handleManualCodeSubmit} className="pt-3 border-t border-neutral-100 space-y-2">
                    <label className="block text-[11px] font-semibold text-neutral-600">
                      Or enter 6-character pairing code shown below QR
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        maxLength={8}
                        value={manualCodeInput}
                        onChange={(e) => setManualCodeInput(e.target.value.toUpperCase())}
                        placeholder="e.g. A7K9M2"
                        className="flex-1 min-h-[44px] px-3 py-2 border border-neutral-300 rounded-xl font-mono text-xs uppercase tracking-widest text-neutral-900 focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                      />
                      <ActionButton
                        type="submit"
                        variant="primary"
                        size="lg"
                        disabled={isInspecting || !manualCodeInput.trim()}
                        className="min-h-[44px]"
                      >
                        Verify
                      </ActionButton>
                    </div>
                  </form>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <footer className="relative z-10 py-4 px-4 text-center text-[11px] text-neutral-400">
        ROOMWISE · DAV Model School, IIT Kharagpur
      </footer>

      <AnimatePresence>
        {isCameraOpen && (
          <PhoneQRScanner
            onDetected={inspectChallengePayload}
            onClose={() => setIsCameraOpen(false)}
            onManualCodeSubmit={(shortCode) => inspectChallengePayload({ shortCode })}
            allowManualCode
            isProcessing={isInspecting}
            externalError={inspectError}
            onClearError={() => setInspectError(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
