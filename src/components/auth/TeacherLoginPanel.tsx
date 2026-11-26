/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ScanFace,
  Fingerprint,
  KeyRound,
  QrCode,
  Camera,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
  ArrowLeft,
  ExternalLink,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { RoomwiseLogo } from '../common/RoomwiseLogo';
import { DigitalAccessCardPanel } from './DigitalAccessCardPanel';
import { PhoneQRScanner } from './PhoneQRScanner';
import {
  InspectedChallenge,
  PhoneComputerApprovalCard,
  phoneChallengeFetch,
} from './PhoneComputerApprovalCard';
import {
  BiometricCapability,
  detectBiometricCapability,
  detectFriendlyDeviceLabel,
} from '../../utils/webauthnClient';
import { DeviceClass, useDeviceClassification } from '../../utils/deviceDetection';
import { ParsedQRChallengeParams } from '../../utils/qrChallengeParser';
import { VerifiedAdminInfo } from '../../types/auth';
import { ROOMWISE_EASE, tabContentVariants } from '../../utils/motion';
import { ActionButton, IconButton, InlineActionLink } from '../common/DesignSystem';

type LoginViewMode =
  | 'main'
  | 'qr'
  | 'scanner'
  | 'confirm-pc'
  | 'register'
  | 'register-success';

interface Props {
  variant?: 'auto' | 'desktop' | 'mobile';
  onSuccess?: (admin: VerifiedAdminInfo) => void;
  onCancel?: () => void;
  sessionEndedNotice?: boolean;
  onDismissSessionEnded?: () => void;
  initialMode?: 'main' | 'register';
}

export const TeacherLoginPanel: React.FC<Props> = ({
  variant = 'auto',
  onSuccess,
  onCancel,
  sessionEndedNotice = false,
  onDismissSessionEnded,
  initialMode = 'main',
}) => {
  const {
    staffDirectory,
    isAdminUnlocked,
    authenticatedAdmin,
    loginWithPasskey,
    loginWithPassword,
    registerPasskey,
  } = useAuth();

  const device = useDeviceClassification();
  const effectiveDevice: DeviceClass =
    variant === 'desktop'
      ? 'desktop'
      : variant === 'mobile'
      ? 'phone'
      : device.deviceClass;

  const isPhoneUI = effectiveDevice === 'phone';
  const isDesktopUI = effectiveDevice === 'desktop';

  const [mode, setMode] = useState<LoginViewMode>(initialMode);
  const [selectedStaffId, setSelectedStaffId] = useState<string>(
    authenticatedAdmin?.id || staffDirectory[0]?.id || 'staff-1'
  );

  // Capability detection (honest OS check)
  const [capability, setCapability] = useState<BiometricCapability>({
    supported: true,
    platformAvailable: false,
    prefersFaceLabel: false,
    primaryLabel: 'Continue with Passkey',
    helperDescription: 'Verify using your device biometric or passkey.',
    deviceLabel: detectFriendlyDeviceLabel(),
    isMobileDevice: isPhoneUI,
    isEmbeddedIframe: false,
  });

  // Primary Passkey auth state
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);

  // Password fallback state
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [showPasswordText, setShowPasswordText] = useState(false);
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);

  // Separate registration flow state
  const [regStaffId, setRegStaffId] = useState<string>(
    authenticatedAdmin?.id || staffDirectory[0]?.id || 'staff-1'
  );
  const [regPassword, setRegPassword] = useState('');
  const [regShowPassword, setRegShowPassword] = useState(false);
  const [regDeviceLabel, setRegDeviceLabel] = useState(detectFriendlyDeviceLabel);
  const [isRegisterLoading, setIsRegisterLoading] = useState(false);
  const [registeredStaff, setRegisteredStaff] = useState<VerifiedAdminInfo | null>(null);

  // Phone QR Scanner & PC Authorisation Confirmation state
  const [isInspectingQr, setIsInspectingQr] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scannedChallenge, setScannedChallenge] = useState<InspectedChallenge | null>(null);

  // Shared error / guidance state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [iframeBlockedNotice, setIframeBlockedNotice] = useState(false);

  useEffect(() => {
    let mounted = true;
    detectBiometricCapability().then((cap) => {
      if (mounted) {
        setCapability(cap);
        setRegDeviceLabel(cap.deviceLabel);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Keep view mode consistent with active device classification
  useEffect(() => {
    if (!isDesktopUI && mode === 'qr') {
      setMode('main');
    }
    if (!isPhoneUI && (mode === 'scanner' || mode === 'confirm-pc')) {
      setScannedChallenge(null);
      setScannerError(null);
      setMode('main');
    }
  }, [isDesktopUI, isPhoneUI, mode]);

  useEffect(() => {
    if (staffDirectory.length > 0 && !staffDirectory.some((s) => s.id === selectedStaffId)) {
      setSelectedStaffId(staffDirectory[0].id);
    }
    if (staffDirectory.length > 0 && !staffDirectory.some((s) => s.id === regStaffId)) {
      setRegStaffId(staffDirectory[0].id);
    }
  }, [staffDirectory, selectedStaffId, regStaffId]);

  const selectedStaff =
    staffDirectory.find((s) => s.id === selectedStaffId) || staffDirectory[0];
  const targetRegStaff =
    staffDirectory.find((s) => s.id === regStaffId) || staffDirectory[0];

  const showPhonePasskeyOption =
    isPhoneUI && capability.supported && Boolean(selectedStaff?.hasPasskey);
  const showDesktopPasskeyOption = isDesktopUI && capability.supported;
  const showUncertainPasskeyOption =
    effectiveDevice === 'uncertain' &&
    capability.supported &&
    Boolean(selectedStaff?.hasPasskey);

  const showPasskeyButton =
    showPhonePasskeyOption || showDesktopPasskeyOption || showUncertainPasskeyOption;

  const handlePrimaryBiometricClick = async () => {
    setErrorMessage(null);
    setIframeBlockedNotice(false);

    if (!capability.supported) {
      setErrorMessage(
        isDesktopUI
          ? 'Passkeys are not supported in this browser. Sign in with your password or Verify with Phone.'
          : isPhoneUI
          ? 'Passkeys are not supported in this browser. Sign in with your password or scan a computer QR code.'
          : 'Passkeys are not supported in this browser. Sign in with your password.'
      );
      setShowPasswordForm(true);
      return;
    }

    if (selectedStaff && selectedStaff.hasPasskey === false) {
      setErrorMessage(
        `No biometric passkey is registered for ${selectedStaff.name} yet. Click "Register New Face / Set Up Biometric Login" below or sign in with password.`
      );
      return;
    }

    setIsPasskeyLoading(true);
    try {
      const result = await loginWithPasskey(selectedStaffId);
      if (!result.ok || !result.admin) {
        if (result.isIframeBlocked) {
          setIframeBlockedNotice(true);
        }
        if (result.code === 'NO_PASSKEY') {
          setErrorMessage(
            `No biometric passkey is registered for ${selectedStaff?.name || 'this profile'} yet. Use "Register New Face / Set Up Biometric Login" below or password fallback.`
          );
        } else {
          setErrorMessage(result.error || 'Biometric sign-in could not be completed.');
        }
        return;
      }

      if (onSuccess) {
        onSuccess(result.admin);
      }
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIframeBlockedNotice(false);

    if (!passwordInput) {
      setErrorMessage('Enter your profile password.');
      return;
    }

    setIsPasswordLoading(true);
    try {
      const result = await loginWithPassword(selectedStaffId, passwordInput);
      if (!result.ok || !result.admin) {
        setErrorMessage(result.error || 'Invalid credentials.');
        return;
      }
      setPasswordInput('');
      if (onSuccess) {
        onSuccess(result.admin);
      }
    } finally {
      setIsPasswordLoading(false);
    }
  };

  const handleRegisterBiometric = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIframeBlockedNotice(false);

    const isAlreadySameAdmin =
      isAdminUnlocked && authenticatedAdmin?.id === regStaffId;

    if (!isAlreadySameAdmin && !regPassword) {
      setErrorMessage(
        'Enter your profile password to verify identity before enabling biometric login.'
      );
      return;
    }

    setIsRegisterLoading(true);
    try {
      const result = await registerPasskey({
        staffId: regStaffId,
        password: isAlreadySameAdmin ? undefined : regPassword,
        deviceName: regDeviceLabel.trim() || capability.deviceLabel,
        signInAfterRegister: false,
      });

      if (!result.ok) {
        if (result.isIframeBlocked) {
          setIframeBlockedNotice(true);
        }
        setErrorMessage(result.error || 'Could not register biometric credential.');
        return;
      }

      setRegPassword('');
      setSelectedStaffId(regStaffId);
      setRegisteredStaff(result.admin || targetRegStaff || null);
      setMode('register-success');
    } finally {
      setIsRegisterLoading(false);
    }
  };

  const handleScannedChallengeParams = useCallback(async (params: ParsedQRChallengeParams) => {
    setIsInspectingQr(true);
    setScannerError(null);
    setErrorMessage(null);

    try {
      const res = await phoneChallengeFetch('/api/auth/challenge/inspect', {
        method: 'POST',
        body: JSON.stringify(params),
      });
      const data = await res.json();

      if (!res.ok) {
        setScannerError(
          data.error || 'This computer QR code is invalid or expired. Scan a fresh QR code.'
        );
        return;
      }

      setScannedChallenge(data as InspectedChallenge);
      setMode('confirm-pc');
    } catch {
      setScannerError('Network error validating the scanned QR code. Try again.');
    } finally {
      setIsInspectingQr(false);
    }
  }, []);

  const BiometricIcon = capability.prefersFaceLabel ? ScanFace : Fingerprint;

  return (
    <div className="bg-white text-[#111916] relative overflow-hidden">
      {/* Obsidian-Pine Institutional Masthead */}
      <div className="px-6 py-5 rw-obsidian-panel border-none rounded-none shadow-none text-white flex items-start justify-between gap-4">
        <div className="space-y-1 pr-6">
          <RoomwiseLogo size="sm" tone="dark" showSubtitle={false} />
          <h2 className="font-display text-base sm:text-lg font-semibold tracking-tight text-white pt-1.5">
            {mode === 'register' || mode === 'register-success'
              ? 'Set Up Biometric Login'
              : mode === 'qr'
              ? 'Verify with Phone'
              : mode === 'confirm-pc'
              ? 'Authorise Computer Access'
              : 'Teacher & Administrator Sign-In'}
          </h2>
          <p className="text-[11px] font-mono text-white/60">
            DAV Model School, IIT Kharagpur
          </p>
        </div>

        {onCancel && (
          <ActionButton
            variant="dark-ghost"
            size="xs"
            onClick={onCancel}
          >
            Cancel
          </ActionButton>
        )}
      </div>

      <div className="p-6 sm:p-7 space-y-5">

        {/* Short Confirmation Banner After Logout */}
        <AnimatePresence>
          {sessionEndedNotice && mode === 'main' && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: ROOMWISE_EASE }}
              className="px-3.5 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-2 text-xs text-emerald-950"
            >
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Admin session ended</span>
              </div>
              {onDismissSessionEnded && (
                <InlineActionLink
                  tone="emerald"
                  onClick={onDismissSessionEnded}
                >
                  Dismiss
                </InlineActionLink>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error / Guidance Banner */}
        <AnimatePresence>
          {errorMessage && mode !== 'qr' && mode !== 'scanner' && mode !== 'confirm-pc' && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: ROOMWISE_EASE }}
              className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 space-y-2"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{errorMessage}</span>
              </div>
              {iframeBlockedNotice && typeof window !== 'undefined' && (
                <div className="pl-6">
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-bold text-emerald-800 hover:text-emerald-950 underline underline-offset-2"
                  >
                    <span>Open in full browser tab for Face ID / Passkey</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {/* MODE 1: MAIN SIGN-IN */}
          {mode === 'main' && (
            <motion.div
              key={`login-mode-main-${effectiveDevice}`}
              variants={tabContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="space-y-4"
            >
              {/* Teacher Profile Selector */}
              <div>
                <label
                  htmlFor={`teacher-profile-select-${variant}`}
                  className="block text-xs font-semibold text-neutral-700 mb-1.5"
                >
                  Select Teacher Profile
                </label>
                <div className="relative">
                  <select
                    id={`teacher-profile-select-${variant}`}
                    value={selectedStaffId}
                    onChange={(e) => {
                      setSelectedStaffId(e.target.value);
                      setErrorMessage(null);
                    }}
                    className="w-full min-h-[46px] appearance-none pl-3.5 pr-10 py-2.5 bg-neutral-50 border border-neutral-300 rounded-xl text-xs font-semibold text-neutral-900 focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 focus:outline-none cursor-pointer transition-colors"
                  >
                    {staffDirectory.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name} — {staff.role}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-neutral-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>

                {selectedStaff && (
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-neutral-500 px-0.5">
                    <span className="truncate">{selectedStaff.role}</span>
                    <span
                      className={`shrink-0 font-semibold ${
                        selectedStaff.hasPasskey ? 'text-emerald-700' : 'text-neutral-400'
                      }`}
                    >
                      {selectedStaff.hasPasskey ? 'Passkey ready' : 'No passkey yet'}
                    </span>
                  </div>
                )}
              </div>

              {/* Primary Biometric / Passkey Button (Device-aware & registered) */}
              {showPasskeyButton && (
                <div className="space-y-1.5">
                  <ActionButton
                    variant="forest"
                    size="lg"
                    fullWidth
                    loading={isPasskeyLoading}
                    disabled={isPasskeyLoading || isPasswordLoading}
                    icon={<BiometricIcon className="w-4 h-4 shrink-0" />}
                    onClick={handlePrimaryBiometricClick}
                    className="min-h-[46px] text-sm"
                  >
                    {isPasskeyLoading ? 'Verifying on device...' : capability.primaryLabel}
                  </ActionButton>
                  <p className="text-[11px] text-center text-neutral-500">
                    {capability.helperDescription}
                  </p>
                </div>
              )}

              {/* PHONE-ONLY: Clearly visible "Scan Computer QR Code" option */}
              {isPhoneUI && (
                <div className="space-y-1.5">
                  <ActionButton
                    variant={showPasskeyButton ? 'soft' : 'forest'}
                    size="lg"
                    fullWidth
                    icon={<Camera className="w-4 h-4 shrink-0" />}
                    onClick={() => {
                      setErrorMessage(null);
                      setScannerError(null);
                      setMode('scanner');
                    }}
                    className="min-h-[46px] text-sm"
                  >
                    Scan Computer QR Code
                  </ActionButton>
                  <p className="text-[11px] text-center text-neutral-500">
                    Authorise a classroom or office computer login using this phone.
                  </p>
                </div>
              )}

              {/* Secondary Authentication Actions (Strictly Device-Aware) */}
              <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-1">
                {isDesktopUI && (
                  <InlineActionLink
                    tone="emerald"
                    icon={<QrCode className="w-3.5 h-3.5" />}
                    onClick={() => {
                      setErrorMessage(null);
                      setMode('qr');
                    }}
                  >
                    Verify with Phone
                  </InlineActionLink>
                )}

                <InlineActionLink
                  tone="neutral"
                  icon={<KeyRound className="w-3.5 h-3.5" />}
                  onClick={() => {
                    setErrorMessage(null);
                    setShowPasswordForm((prev) => !prev);
                  }}
                >
                  {showPasswordForm ? 'Hide Password Sign-In' : 'Use Password Instead'}
                </InlineActionLink>
              </div>

              {/* Collapsible Password Fallback Form */}
              <AnimatePresence initial={false}>
                {showPasswordForm && (
                  <motion.form
                    key="password-fallback-form"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: ROOMWISE_EASE }}
                    onSubmit={handlePasswordSubmit}
                    className="overflow-hidden"
                  >
                    <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 space-y-3">
                      <div>
                        <label
                          htmlFor={`teacher-password-${variant}`}
                          className="block text-xs font-semibold text-neutral-700 mb-1"
                        >
                          Password for {selectedStaff?.name}
                        </label>
                        <div className="relative">
                          <input
                            id={`teacher-password-${variant}`}
                            type={showPasswordText ? 'text' : 'password'}
                            value={passwordInput}
                            onChange={(e) => {
                              setPasswordInput(e.target.value);
                              setErrorMessage(null);
                            }}
                            autoComplete="current-password"
                            placeholder="Enter staff password"
                            className="w-full min-h-[42px] px-3.5 py-2 pr-10 bg-white border border-neutral-300 rounded-xl text-xs text-neutral-900 focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                          />
                          <IconButton
                            variant="ghost"
                            size="xs"
                            label={showPasswordText ? 'Hide password' : 'Show password'}
                            onClick={() => setShowPasswordText((s) => !s)}
                            className="!absolute right-2 top-1/2 -translate-y-1/2"
                          >
                            {showPasswordText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </IconButton>
                        </div>
                      </div>

                      <ActionButton
                        type="submit"
                        variant="primary"
                        size="lg"
                        fullWidth
                        loading={isPasswordLoading}
                        className="min-h-[42px]"
                      >
                        {isPasswordLoading ? 'Signing in...' : 'Sign In with Password'}
                      </ActionButton>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>

              {/* Separate Accessible Enrollment Trigger */}
              <div className="pt-3 border-t border-neutral-200/80 text-center">
                <InlineActionLink
                  tone="emerald"
                  icon={<ShieldCheck className="w-3.5 h-3.5" />}
                  onClick={() => {
                    setErrorMessage(null);
                    setIframeBlockedNotice(false);
                    setRegStaffId(selectedStaffId);
                    setMode('register');
                  }}
                >
                  Register New Face / Set Up Biometric Login
                </InlineActionLink>
              </div>
            </motion.div>
          )}

          {/* MODE 2: DESKTOP-ONLY VERIFY WITH PHONE (QR CHALLENGE) */}
          {mode === 'qr' && isDesktopUI && (
            <motion.div
              key="login-mode-qr"
              variants={tabContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <DigitalAccessCardPanel
                embedded
                selectedStaff={selectedStaff}
                onBack={() => {
                  setErrorMessage(null);
                  setMode('main');
                }}
                onSuccess={(admin) => {
                  if (onSuccess) onSuccess(admin);
                }}
              />
            </motion.div>
          )}

          {/* MODE 3: PHONE-ONLY COMPUTER AUTHORISATION CONFIRMATION */}
          {mode === 'confirm-pc' && isPhoneUI && scannedChallenge && (
            <PhoneComputerApprovalCard
              challenge={scannedChallenge}
              fallbackStaff={selectedStaff}
              onDone={() => {
                setScannedChallenge(null);
                setErrorMessage(null);
                setMode('main');
              }}
              onCancelScan={() => {
                setScannedChallenge(null);
                setScannerError(null);
                setMode('main');
              }}
              onExpired={(expiredMsg) => {
                setScannedChallenge(null);
                setErrorMessage(expiredMsg);
                setMode('main');
              }}
            />
          )}

          {/* MODE 4: SEPARATE BIOMETRIC / PASSKEY ENROLLMENT */}
          {mode === 'register' && (
            <motion.form
              key="login-mode-register"
              variants={tabContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              onSubmit={handleRegisterBiometric}
              className="space-y-4"
            >
              <InlineActionLink
                tone="neutral"
                icon={<ArrowLeft className="w-3.5 h-3.5" />}
                onClick={() => {
                  setErrorMessage(null);
                  setIframeBlockedNotice(false);
                  setMode('main');
                }}
              >
                Back to Sign-In
              </InlineActionLink>

              <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/80 text-[11px] text-emerald-950 leading-relaxed">
                Registers a hardware-backed WebAuthn passkey on this device (Face ID, Windows Hello, Android biometrics, or passkey). No webcam images or biometric scans are captured or stored by ROOMWISE.
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
                  Teacher Profile
                </label>
                <div className="relative">
                  <select
                    value={regStaffId}
                    onChange={(e) => {
                      setRegStaffId(e.target.value);
                      setErrorMessage(null);
                    }}
                    className="w-full min-h-[44px] appearance-none pl-3.5 pr-10 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs font-semibold text-neutral-900 focus:ring-2 focus:ring-emerald-600 focus:outline-none cursor-pointer"
                  >
                    {staffDirectory.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name} — {staff.role}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-neutral-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
                  Device Name
                </label>
                <input
                  type="text"
                  value={regDeviceLabel}
                  onChange={(e) => setRegDeviceLabel(e.target.value)}
                  maxLength={60}
                  placeholder="e.g. Faculty Laptop · Windows Hello"
                  className="w-full min-h-[42px] px-3.5 py-2 bg-white border border-neutral-300 rounded-xl text-xs text-neutral-900 focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                />
              </div>

              {!(isAdminUnlocked && authenticatedAdmin?.id === regStaffId) && (
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
                    Verify Profile Password
                  </label>
                  <div className="relative">
                    <input
                      type={regShowPassword ? 'text' : 'password'}
                      value={regPassword}
                      onChange={(e) => {
                        setRegPassword(e.target.value);
                        setErrorMessage(null);
                      }}
                      required
                      placeholder={`Enter password for ${targetRegStaff?.name || 'selected profile'}`}
                      className="w-full min-h-[44px] px-3.5 py-2 pr-10 bg-white border border-neutral-300 rounded-xl text-xs text-neutral-900 focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                    />
                    <IconButton
                      variant="ghost"
                      size="xs"
                      label={regShowPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setRegShowPassword((s) => !s)}
                      className="!absolute right-2 top-1/2 -translate-y-1/2"
                    >
                      {regShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </IconButton>
                  </div>
                  <p className="text-[11px] text-neutral-500 mt-1">
                    Password verification ensures only the account holder can enroll a new device passkey.
                  </p>
                </div>
              )}

              <ActionButton
                type="submit"
                variant="forest"
                size="lg"
                fullWidth
                loading={isRegisterLoading}
                icon={<BiometricIcon className="w-4 h-4" />}
                className="min-h-[46px]"
              >
                {isRegisterLoading ? 'Waiting for device prompt...' : 'Register Face / Passkey on This Device'}
              </ActionButton>
            </motion.form>
          )}

          {/* MODE 5: REGISTRATION CONFIRMATION */}
          {mode === 'register-success' && (
            <motion.div
              key="login-mode-success"
              variants={tabContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="py-5 text-center space-y-4"
            >
              <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center bg-emerald-50 border border-emerald-200 text-emerald-700">
                <CheckCircle2 className="w-7 h-7" />
              </div>

              <div className="space-y-1">
                <h3 className="text-base font-extrabold text-neutral-900">
                  Biometric login successfully enabled.
                </h3>
                <p className="text-xs text-neutral-600">
                  {registeredStaff?.name || targetRegStaff?.name} can now sign in on{' '}
                  <strong className="text-neutral-800">{regDeviceLabel || capability.deviceLabel}</strong>{' '}
                  with {capability.prefersFaceLabel ? 'Face Recognition' : 'Passkey'}.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
                <ActionButton
                  variant="forest"
                  size="lg"
                  onClick={async () => {
                    setMode('main');
                    setErrorMessage(null);
                    await handlePrimaryBiometricClick();
                  }}
                  className="flex-1 min-h-[44px]"
                >
                  {capability.primaryLabel}
                </ActionButton>
                <ActionButton
                  variant="secondary"
                  size="lg"
                  onClick={() => {
                    setErrorMessage(null);
                    setMode('main');
                  }}
                  className="min-h-[44px]"
                >
                  Done
                </ActionButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Live Camera QR Scanner Overlay (mounted ONLY when explicitly triggered on a phone) */}
      <AnimatePresence>
        {mode === 'scanner' && isPhoneUI && (
          <PhoneQRScanner
            onDetected={handleScannedChallengeParams}
            onClose={() => {
              setScannerError(null);
              setMode('main');
            }}
            isProcessing={isInspectingQr}
            externalError={scannerError}
            onClearError={() => setScannerError(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
