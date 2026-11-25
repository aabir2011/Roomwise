/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  IndianRupee,
  Leaf,
  Sun,
  Shield,
  Save,
  CheckCircle2,
  Users,
  Building,
  Zap,
  Lock,
  KeyRound,
  Loader2,
  ScanFace,
  Fingerprint,
  Trash2,
  Smartphone,
  QrCode,
  AlertTriangle,
  Mic,
  MicOff,
  RotateCcw,
} from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { useAuth, getStoredClientSessionToken } from '../../context/AuthContext';
import { useVoiceAssistant } from '../../context/VoiceAssistantContext';
import { useDeviceClassification } from '../../utils/deviceDetection';
import { useToast } from '../../context/ToastContext';
import { ToggleSwitch } from '../common/MotionPrimitives';
import { PageHeader } from '../common/DesignSystem';
import { AcronymHint } from '../common/AcronymHint';
import { PasskeyCredentialSummary } from '../../types/auth';
import {
  detectBiometricCapability,
  detectFriendlyDeviceLabel,
} from '../../utils/webauthnClient';
import { ROOMWISE_EASE } from '../../utils/motion';

export const SettingsView: React.FC = () => {
  const { settings, updateSettings } = useEnergy();
  const {
    isAdminUnlocked,
    isAuthLoading,
    authenticatedAdmin,
    staffDirectory,
    openAuthModal,
    openPhoneQrModal,
    registerPasskey,
    listMyCredentials,
    revokeMyCredential,
  } = useAuth();
  const {
    phase: voicePhase,
    wakeLoadStage,
    micPermission,
    isWakeWordEnabled,
    isMuted: isVoiceMuted,
    isWakeModelReady,
    lastError: voiceError,
    enableWakeStandby,
    disableWakeStandby,
    resumeSuspendedAudio,
    toggleMute: toggleVoiceMute,
    startManualSession,
  } = useVoiceAssistant();
  const device = useDeviceClassification();
  const toast = useToast();

  const [institutionName, setInstitutionName] = useState(settings.institutionName);
  const [campusLocation, setCampusLocation] = useState(settings.campusLocation);
  const [campusLatitude, setCampusLatitude] = useState(
    settings.campusCoordinates?.latitude ?? 22.3121
  );
  const [campusLongitude, setCampusLongitude] = useState(
    settings.campusCoordinates?.longitude ?? 87.2994
  );
  const [tariff, setTariff] = useState(settings.tariffPerKWhINR);
  const [carbonFactor, setCarbonFactor] = useState(settings.gridCarbonFactorKgCO2PerKWh);
  const [classroomLux, setClassroomLux] = useState(settings.standardClassroomTargetLux);
  const [labLux, setLabLux] = useState(settings.labTargetLux);
  const [graceMinutes, setGraceMinutes] = useState(settings.defaultInactivityGraceMinutes);
  const [learningMode, setLearningMode] = useState(settings.learningMode);
  const [lowPowerMode, setLowPowerMode] = useState(settings.lowPowerMode ?? false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPropagating, setIsPropagating] = useState(false);

  const [myCredentials, setMyCredentials] = useState<PasskeyCredentialSummary[]>([]);
  const [isCredsLoading, setIsCredsLoading] = useState(false);
  const [isEnrollingPasskey, setIsEnrollingPasskey] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [passkeyMessage, setPasskeyMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [prefersFaceLabel, setPrefersFaceLabel] = useState(false);

  const loadCredentials = useCallback(async () => {
    if (!isAdminUnlocked) {
      setMyCredentials([]);
      return;
    }
    setIsCredsLoading(true);
    try {
      const list = await listMyCredentials();
      setMyCredentials(list);
    } finally {
      setIsCredsLoading(false);
    }
  }, [isAdminUnlocked, listMyCredentials]);

  useEffect(() => {
    loadCredentials();
  }, [loadCredentials, authenticatedAdmin?.id]);

  useEffect(() => {
    setInstitutionName(settings.institutionName);
    setCampusLocation(settings.campusLocation);
    setCampusLatitude(settings.campusCoordinates?.latitude ?? 22.3121);
    setCampusLongitude(settings.campusCoordinates?.longitude ?? 87.2994);
    setTariff(settings.tariffPerKWhINR);
    setCarbonFactor(settings.gridCarbonFactorKgCO2PerKWh);
    setClassroomLux(settings.standardClassroomTargetLux);
    setLabLux(settings.labTargetLux);
    setGraceMinutes(settings.defaultInactivityGraceMinutes);
    setLearningMode(settings.learningMode);
    setLowPowerMode(settings.lowPowerMode ?? false);
  }, [settings]);

  useEffect(() => {
    detectBiometricCapability().then((cap) => {
      setPrefersFaceLabel(cap.prefersFaceLabel);
    });
  }, []);

  const handleEnrollCurrentDevice = async () => {
    if (!isAdminUnlocked || !authenticatedAdmin) {
      openAuthModal();
      return;
    }
    setPasskeyMessage(null);
    setIsEnrollingPasskey(true);
    try {
      const result = await registerPasskey({
        staffId: authenticatedAdmin.id,
        deviceName: detectFriendlyDeviceLabel(),
        signInAfterRegister: false,
      });
      if (!result.ok) {
        const msg = result.error || 'Could not register passkey on this device.';
        setPasskeyMessage({ type: 'error', text: msg });
        toast.error('Passkey setup failed', msg);
        return;
      }
      setPasskeyMessage({
        type: 'success',
        text: 'Biometric login successfully enabled.',
      });
      toast.success('Passkey registered', 'Biometric login enabled for this device.');
      await loadCredentials();
    } finally {
      setIsEnrollingPasskey(false);
    }
  };

  const handleRevokeCredential = async (credId: string) => {
    setPasskeyMessage(null);
    setRevokingId(credId);
    try {
      const res = await revokeMyCredential(credId);
      if (!res.ok) {
        const msg = res.error || 'Could not revoke credential.';
        setPasskeyMessage({ type: 'error', text: msg });
        toast.error('Could not revoke credential', msg);
        return;
      }
      setPasskeyMessage({
        type: 'success',
        text: 'Registered credential revoked. It can no longer sign in.',
      });
      toast.info('Credential revoked', 'Removed passkey access for the selected device.');
      await loadCredentials();
    } finally {
      setRevokingId(null);
    }
  };

  const hasUnsavedChanges =
    institutionName !== settings.institutionName ||
    campusLocation !== settings.campusLocation ||
    Number(campusLatitude) !== (settings.campusCoordinates?.latitude ?? 22.3121) ||
    Number(campusLongitude) !== (settings.campusCoordinates?.longitude ?? 87.2994) ||
    Number(tariff) !== settings.tariffPerKWhINR ||
    Number(carbonFactor) !== settings.gridCarbonFactorKgCO2PerKWh ||
    Number(classroomLux) !== settings.standardClassroomTargetLux ||
    Number(labLux) !== settings.labTargetLux ||
    Number(graceMinutes) !== settings.defaultInactivityGraceMinutes ||
    learningMode !== settings.learningMode ||
    lowPowerMode !== (settings.lowPowerMode ?? false);

  const handleResetUnsaved = () => {
    setInstitutionName(settings.institutionName);
    setCampusLocation(settings.campusLocation);
    setCampusLatitude(settings.campusCoordinates?.latitude ?? 22.3121);
    setCampusLongitude(settings.campusCoordinates?.longitude ?? 87.2994);
    setTariff(settings.tariffPerKWhINR);
    setCarbonFactor(settings.gridCarbonFactorKgCO2PerKWh);
    setClassroomLux(settings.standardClassroomTargetLux);
    setLabLux(settings.labTargetLux);
    setGraceMinutes(settings.defaultInactivityGraceMinutes);
    setLearningMode(settings.learningMode);
    setLowPowerMode(settings.lowPowerMode ?? false);
    setSaveError(null);
    setSavedSuccess(false);
  };

  const validateParameters = (): string | null => {
    if (!institutionName.trim()) return 'School / Institution Name cannot be empty.';
    if (!campusLocation.trim()) return 'Campus Location & Address cannot be empty.';
    const latNum = Number(campusLatitude);
    const lngNum = Number(campusLongitude);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      return 'Campus Latitude must be between -90° and 90°.';
    }
    if (!Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      return 'Campus Longitude must be between -180° and 180°.';
    }
    const tariffNum = Number(tariff);
    if (!Number.isFinite(tariffNum) || tariffNum < 0.5 || tariffNum > 50) {
      return 'Electricity Tariff must be between ₹0.50 and ₹50.00 per kWh.';
    }
    const carbonNum = Number(carbonFactor);
    if (!Number.isFinite(carbonNum) || carbonNum < 0.1 || carbonNum > 2.5) {
      return 'Grid Carbon Emission Factor must be between 0.10 and 2.50 kg CO₂/kWh.';
    }
    const classLuxNum = Number(classroomLux);
    if (!Number.isFinite(classLuxNum) || classLuxNum < 100 || classLuxNum > 800) {
      return 'General Classroom Target Lux must be between 100 lx and 800 lx.';
    }
    const labLuxNum = Number(labLux);
    if (!Number.isFinite(labLuxNum) || labLuxNum < 100 || labLuxNum > 900) {
      return 'Science & Computer Lab Target Lux must be between 100 lx and 900 lx.';
    }
    const graceNum = Number(graceMinutes);
    if (!Number.isFinite(graceNum) || graceNum < 1 || graceNum > 60) {
      return 'PIR Inactivity Grace Window must be between 1 and 60 minutes.';
    }
    return null;
  };

  const applyParameters = async () => {
    setSaveError(null);
    setSavedSuccess(false);

    const validationError = validateParameters();
    if (validationError) {
      setSaveError(validationError);
      toast.error('Invalid system parameter', validationError);
      return;
    }

    const safeTariff = Number(Number(tariff).toFixed(2));
    const safeCarbon = Number(Number(carbonFactor).toFixed(3));
    const safeClassroomLux = Math.round(Number(classroomLux));
    const safeLabLux = Math.round(Number(labLux));
    const safeGrace = Math.round(Number(graceMinutes));
    const safeLat = Number(Number(campusLatitude).toFixed(4));
    const safeLng = Number(Number(campusLongitude).toFixed(4));

    setIsPropagating(true);
    try {
      const result = await updateSettings({
        institutionName: institutionName.trim(),
        campusLocation: campusLocation.trim(),
        campusCoordinates: {
          ...settings.campusCoordinates,
          latitude: safeLat,
          longitude: safeLng,
        },
        tariffPerKWhINR: safeTariff,
        gridCarbonFactorKgCO2PerKWh: safeCarbon,
        standardClassroomTargetLux: safeClassroomLux,
        labTargetLux: safeLabLux,
        defaultInactivityGraceMinutes: safeGrace,
        learningMode,
        lowPowerMode,
      });

      if (!result.ok) {
        const errMsg = result.error || 'Unable to save system parameters.';
        setSaveError(errMsg);
        toast.error('Settings save failed', errMsg);
        return;
      }

      setSavedSuccess(true);
      toast.success('System parameters applied', 'Updated tariffs and illumination targets across 25 rooms.');

      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.18);
      } catch {
        // audio optional
      }

      setTimeout(() => setSavedSuccess(false), 3000);
    } finally {
      setIsPropagating(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isPropagating) return;
    if (!isAdminUnlocked) {
      openAuthModal(() => {
        void applyParameters();
      });
      return;
    }
    void applyParameters();
  };

  const handlePolicySelect = (policyId: typeof settings.learningMode) => {
    if (!isAdminUnlocked) {
      openAuthModal(() => setLearningMode(policyId));
    } else {
      setLearningMode(policyId);
    }
  };

  const handleLowPowerToggle = (checked: boolean) => {
    if (!isAdminUnlocked) {
      openAuthModal(() => setLowPowerMode(checked));
    } else {
      setLowPowerMode(checked);
      toast.info(
        checked ? 'Low-power mode staged' : 'Standard rendering staged',
        'Apply parameters to save this preference across sessions.'
      );
    }
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-6 max-w-5xl mx-auto select-none">
      <PageHeader
        kicker="Campus Energy Parameters · DAV Model School, IIT Kharagpur"
        title="System Configuration & Energy Tariffs"
        subtitle="Changes to electricity tariffs or carbon coefficients propagate across all 25 classroom models and balance sheets."
      />

      {/* Read-Only Banner in Viewer Mode */}
      <AnimatePresence>
        {!isAdminUnlocked && !(isAuthLoading && getStoredClientSessionToken()) && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: ROOMWISE_EASE }}
            className="p-4 rounded-2xl bg-amber-50/90 border border-amber-300/80 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5">
              <Lock className="w-4 h-4 text-amber-800 shrink-0" />
              <div>
                <div className="font-semibold text-amber-950">Read-Only Viewer Mode</div>
                <div className="text-[11px] text-amber-900/90 mt-0.5">
                  Administrative authentication is required to modify tariffs or system thresholds.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => openAuthModal()}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[#111815] hover:bg-[#0b2e22] text-white rounded-xl font-semibold text-xs transition-colors shrink-0 whitespace-nowrap cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5 text-emerald-300" />
              <span>Unlock Admin</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Save Success / Validation Error Alert */}
      <AnimatePresence>
        {saveError && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: ROOMWISE_EASE }}
            role="alert"
            className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-950 flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{saveError}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {savedSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: ROOMWISE_EASE }}
            className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-950 flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>
              Configuration saved successfully across all 25 classrooms and financial sheets.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Institution Details */}
        <div className="p-5 sm:p-6 rounded-2xl rw-surface space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#111815] border-b border-neutral-200/70 pb-3">
            <Building className="w-4 h-4 text-emerald-700" />
            <span>School Identification</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-[#4a5851]">
                School / Institution Name
              </label>
              <input
                type="text"
                disabled={!isAdminUnlocked}
                value={institutionName}
                onChange={(e) => setInstitutionName(e.target.value)}
                className="mt-1.5 w-full px-3 py-2 glass-input rounded-xl text-xs disabled:opacity-65 disabled:bg-[#f3f5f4] disabled:cursor-not-allowed"
              />
              <span className="text-[11px] text-[#64726b] mt-1 block">
                Displays on all placards, dashboards, and audit sign-off sheets
              </span>
            </div>

            <div>
              <label className="block font-semibold text-[#4a5851]">
                Campus Location &amp; Address
              </label>
              <input
                type="text"
                disabled={!isAdminUnlocked}
                value={campusLocation}
                onChange={(e) => setCampusLocation(e.target.value)}
                className="mt-1.5 w-full px-3 py-2 glass-input rounded-xl text-xs disabled:opacity-65 disabled:bg-[#f3f5f4] disabled:cursor-not-allowed"
              />
              <span className="text-[11px] text-[#64726b] mt-1 block">
                IIT Kharagpur Campus, Paschim Medinipur
              </span>
            </div>

            <div>
              <label className="block font-semibold text-[#4a5851]">
                Campus Latitude (°N)
              </label>
              <input
                type="number"
                step="0.0001"
                min={-90}
                max={90}
                disabled={!isAdminUnlocked}
                value={campusLatitude}
                onChange={(e) => setCampusLatitude(Number(e.target.value))}
                className="mt-1.5 w-full px-3 py-2 glass-input rounded-xl font-mono tabular-nums text-xs disabled:opacity-65 disabled:bg-[#f3f5f4] disabled:cursor-not-allowed"
              />
              <span className="text-[11px] text-[#64726b] mt-1 block">
                Used by Open-Meteo Environmental &amp; PVGIS Solar Intelligence (default 22.3121)
              </span>
            </div>

            <div>
              <label className="block font-semibold text-[#4a5851]">
                Campus Longitude (°E)
              </label>
              <input
                type="number"
                step="0.0001"
                min={-180}
                max={180}
                disabled={!isAdminUnlocked}
                value={campusLongitude}
                onChange={(e) => setCampusLongitude(Number(e.target.value))}
                className="mt-1.5 w-full px-3 py-2 glass-input rounded-xl font-mono tabular-nums text-xs disabled:opacity-65 disabled:bg-[#f3f5f4] disabled:cursor-not-allowed"
              />
              <span className="text-[11px] text-[#64726b] mt-1 block">
                DAV Model School, IIT Kharagpur (default 87.2994)
              </span>
            </div>
          </div>
        </div>

        {/* Section 2: Tariffs & Carbon Parameters */}
        <div className="p-5 sm:p-6 rounded-2xl rw-surface space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#111815] border-b border-neutral-200/70 pb-3">
            <IndianRupee className="w-4 h-4 text-emerald-700" />
            <span>Tariff Rates &amp; Grid Carbon Factors</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-[#4a5851]">
                Electricity Tariff (₹ per kWh)
              </label>
              <div className="relative mt-1.5">
                <span className="absolute left-3 top-2 text-[#64726b] font-semibold">₹</span>
                <input
                  type="number"
                  step="0.05"
                  min={0.5}
                  max={50}
                  disabled={!isAdminUnlocked}
                  value={tariff}
                  onChange={(e) => setTariff(Number(e.target.value))}
                  className="w-full pl-7 pr-3 py-2 glass-input rounded-xl font-mono tabular-nums text-xs disabled:opacity-65 disabled:bg-[#f3f5f4] disabled:cursor-not-allowed"
                />
              </div>
              <span className="text-[11px] text-[#64726b] mt-1 block">
                <AcronymHint term="WBSEDCL" /> <AcronymHint term="HT-2" /> Educational schedule (base ₹7.40)
              </span>
            </div>

            <div>
              <label className="block font-semibold text-[#4a5851]">
                Grid Carbon Emission Factor (kg CO₂ per kWh)
              </label>
              <div className="relative mt-1.5">
                <span className="absolute left-3 top-2.5">
                  <Leaf className="w-3.5 h-3.5 text-emerald-700" />
                </span>
                <input
                  type="number"
                  step="0.001"
                  min={0.1}
                  max={2.5}
                  disabled={!isAdminUnlocked}
                  value={carbonFactor}
                  onChange={(e) => setCarbonFactor(Number(e.target.value))}
                  className="w-full pl-9 pr-3 py-2 glass-input rounded-xl font-mono tabular-nums text-xs disabled:opacity-65 disabled:bg-[#f3f5f4] disabled:cursor-not-allowed"
                />
              </div>
              <span className="text-[11px] text-[#64726b] mt-1 block">
                Central Electricity Authority (<AcronymHint term="CEA" />) national average: 0.716
              </span>
            </div>
          </div>
        </div>

        {/* Section 3: Visual & Thermal Norms */}
        <div className="p-5 sm:p-6 rounded-2xl rw-surface space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#111815] border-b border-neutral-200/70 pb-3">
            <Sun className="w-4 h-4 text-emerald-700" />
            <span>National Building Code (NBC) Illumination &amp; Inactivity Norms</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-[#4a5851]">
                General Classroom Target Lux
              </label>
              <input
                type="number"
                min={100}
                max={800}
                step={10}
                disabled={!isAdminUnlocked}
                value={classroomLux}
                onChange={(e) => setClassroomLux(Number(e.target.value))}
                className="mt-1.5 w-full px-3 py-2 glass-input rounded-xl font-mono tabular-nums text-xs disabled:opacity-65 disabled:bg-[#f3f5f4] disabled:cursor-not-allowed"
              />
              <span className="text-[11px] text-[#64726b] mt-1 block">
                NBC standard: 300 lx for study desks
              </span>
            </div>

            <div>
              <label className="block font-semibold text-[#4a5851]">
                Science &amp; Computer Lab Target Lux
              </label>
              <input
                type="number"
                min={100}
                max={900}
                step={10}
                disabled={!isAdminUnlocked}
                value={labLux}
                onChange={(e) => setLabLux(Number(e.target.value))}
                className="mt-1.5 w-full px-3 py-2 glass-input rounded-xl font-mono tabular-nums text-xs disabled:opacity-65 disabled:bg-[#f3f5f4] disabled:cursor-not-allowed"
              />
              <span className="text-[11px] text-[#64726b] mt-1 block">
                NBC laboratory precision standard: 400 lx
              </span>
            </div>

            <div>
              <label className="block font-semibold text-[#4a5851]">
                <AcronymHint term="PIR" /> Inactivity Grace Window (min)
              </label>
              <input
                type="number"
                min={1}
                max={60}
                step={1}
                disabled={!isAdminUnlocked}
                value={graceMinutes}
                onChange={(e) => setGraceMinutes(Number(e.target.value))}
                className="mt-1.5 w-full px-3 py-2 glass-input rounded-xl font-mono tabular-nums text-xs disabled:opacity-65 disabled:bg-[#f3f5f4] disabled:cursor-not-allowed"
              />
              <span className="text-[11px] text-[#64726b] mt-1 block">
                Buffer protecting silent examination periods
              </span>
            </div>
          </div>

          <div className="pt-2 text-xs">
            <label className="block font-semibold text-[#4a5851] mb-2">
              Campus Automation Policy Profile
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {[
                {
                  id: 'Adaptive Active' as const,
                  label: 'Adaptive Active',
                  desc: <>Continuous balancing of daylighting and <AcronymHint term="BLDC" /> fan speeds.</>,
                },
                {
                  id: 'Conservative' as const,
                  label: 'Conservative Sentry',
                  desc: 'Maximum saving with tighter lux thresholds and shorter grace.',
                },
                {
                  id: 'High Comfort' as const,
                  label: 'Comfort Priority',
                  desc: 'Higher lux targets and silent acoustic priority.',
                },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handlePolicySelect(opt.id)}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                    learningMode === opt.id
                      ? 'border-emerald-700 bg-[#eef3f0]'
                      : 'border-neutral-200/85 bg-[#fafbfb] hover:bg-white'
                  }`}
                >
                  <div className="font-semibold text-[#111815]">{opt.label}</div>
                  <div className="text-[11px] text-[#64726b] mt-0.5 leading-relaxed">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Section 4: Device Optimization & Low-Power Mode */}
        <div className="p-5 sm:p-6 rounded-2xl rw-surface space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#111815] border-b border-neutral-200/70 pb-3">
            <Zap className="w-4 h-4 text-emerald-700" />
            <span>Device Optimization &amp; Low-Power Mode</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
            <div>
              <div className="font-semibold text-[#111815]">
                Low-Power &amp; Reduced GPU Effects Mode
              </div>
              <p className="text-[11px] text-[#64726b] mt-0.5 max-w-xl leading-relaxed">
                Reduces background flow animations and blur passes to extend battery life on Chromebooks and low-spec laptops.
              </p>
            </div>

            <ToggleSwitch
              checked={lowPowerMode}
              onChange={handleLowPowerToggle}
              ariaLabel="Toggle Low-Power and GPU Acceleration Mode"
            />
          </div>
        </div>

        {/* Save Button / Reset Unsaved / Admin Unlock */}
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {!isAdminUnlocked ? (
            <motion.button
              type="button"
              whileTap={{ scale: 0.985 }}
              onClick={() => openAuthModal()}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#111815] hover:bg-[#0b2e22] text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              <Lock className="w-4 h-4 text-emerald-300" />
              <span>Unlock Admin to Edit Parameters</span>
            </motion.button>
          ) : (
            <>
              {hasUnsavedChanges && (
                <button
                  type="button"
                  onClick={handleResetUnsaved}
                  disabled={isPropagating}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-neutral-200 bg-white hover:bg-[#f3f5f4] text-[#4a5851] hover:text-[#111815] text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Unsaved</span>
                </button>
              )}
              <motion.button
                type="submit"
                whileTap={isPropagating ? undefined : { scale: 0.985 }}
                disabled={isPropagating}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#0b2e22] hover:bg-[#114231] text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer disabled:opacity-60"
              >
                {isPropagating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-300" />
                    <span>Saving Parameters...</span>
                  </>
                ) : savedSuccess ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                    <span>Parameters Propagated</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 text-emerald-300" />
                    <span>Apply &amp; Propagate Parameters</span>
                  </>
                )}
              </motion.button>
            </>
          )}
        </div>
      </form>

      {/* Voice Assistant & Wake-Word Controls */}
      <div className="p-4 sm:p-6 rounded-2xl rw-surface space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-neutral-200/70 pb-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#111815]">
            <Mic className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>Voice Assistant &amp; &ldquo;Hey ROOMWISE&rdquo; Standby</span>
          </div>

          <div className="text-[11px] font-mono text-[#64726b] whitespace-nowrap">
            Mic: <strong className="text-[#111815] capitalize">{micPermission}</strong>
            {' · '}
            <strong className="text-[#111815]">
              {voicePhase === 'standby'
                ? 'Listening for Wake Phrase'
                : voicePhase === 'audio_suspended'
                ? 'Audio Paused'
                : voicePhase === 'requesting_mic'
                ? 'Requesting Mic...'
                : voicePhase === 'loading_model'
                ? wakeLoadStage === 'downloading'
                  ? 'Downloading Model...'
                  : wakeLoadStage === 'extracting'
                  ? 'Extracting Model...'
                  : 'Initializing Model...'
                : voicePhase === 'starting_audio'
                ? 'Starting Audio...'
                : voicePhase === 'unavailable'
                ? 'Unavailable'
                : voicePhase === 'muted'
                ? 'Muted'
                : isWakeModelReady
                ? 'Model Cached'
                : 'Standby Off'}
            </strong>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
          <div className="space-y-1 max-w-xl min-w-0">
            <div className="font-semibold text-[#111815]">
              On-Device Wake-Word Detection (&ldquo;Hey ROOMWISE&rdquo;)
            </div>
            <p className="text-[11px] text-[#64726b] leading-relaxed">
              Listens locally in your browser without uploading ambient audio until the wake phrase or manual trigger activates a session. The first activation caches the local acoustic model for faster subsequent starts.
            </p>
            {voicePhase === 'audio_suspended' && (
              <p className="text-[11px] text-amber-800 font-medium pt-0.5">
                Browser autoplay rules paused microphone audio after page load. Click Resume Audio to activate hands-free detection.
              </p>
            )}
            {voiceError && (
              <p className="text-[11px] text-rose-700 font-medium pt-0.5">{voiceError}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {voicePhase === 'audio_suspended' && (
              <button
                type="button"
                onClick={() => void resumeSuspendedAudio()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-950 text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <Mic className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span>Resume Audio</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void startManualSession()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-neutral-200 bg-white hover:bg-[#f3f5f4] text-[#111815] text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Mic className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <span>Ask Manually</span>
            </button>

            {isWakeWordEnabled && (
              <button
                type="button"
                onClick={toggleVoiceMute}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap ${
                  isVoiceMuted
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-neutral-200 bg-white hover:bg-[#f3f5f4] text-[#111815]'
                }`}
              >
                {isVoiceMuted ? (
                  <>
                    <MicOff className="w-3.5 h-3.5 shrink-0" />
                    <span>Muted</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span>Mute Standby</span>
                  </>
                )}
              </button>
            )}

            <ToggleSwitch
              checked={isWakeWordEnabled && voicePhase !== 'disabled' && voicePhase !== 'unavailable'}
              onChange={(checked) => {
                if (checked) {
                  void enableWakeStandby();
                } else {
                  void disableWakeStandby();
                }
              }}
              ariaLabel="Toggle Hey ROOMWISE Wake-Word Standby"
            />
          </div>
        </div>
      </div>

      {/* Account Security: Biometric & Registered Devices */}
      <div className="p-5 sm:p-6 rounded-2xl rw-surface space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-200/70 pb-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#111815]">
            {prefersFaceLabel ? (
              <ScanFace className="w-4 h-4 text-emerald-700" />
            ) : (
              <Fingerprint className="w-4 h-4 text-emerald-700" />
            )}
            <span>Biometric &amp; Registered Devices</span>
          </div>

          {isAdminUnlocked && authenticatedAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              {device.isPhone && (
                <button
                  type="button"
                  onClick={openPhoneQrModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-950 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  <QrCode className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  <span>Scan Computer QR</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleEnrollCurrentDevice}
                disabled={isEnrollingPasskey}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0b2e22] hover:bg-[#114231] text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
              >
                {isEnrollingPasskey ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    <span>Waiting for device...</span>
                  </>
                ) : (
                  <>
                    <Shield className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                    <span>Set Up Biometric Passkey</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        <AnimatePresence>
          {passkeyMessage && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: ROOMWISE_EASE }}
              className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                passkeyMessage.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-950'
                  : 'bg-rose-50 border border-rose-200 text-rose-950'
              }`}
            >
              {passkeyMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{passkeyMessage.text}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {!isAdminUnlocked || !authenticatedAdmin ? (
          <div className="text-xs text-[#64726b] flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-1">
            <span>
              Sign in as a teacher to register or revoke biometric passkeys on your devices.
            </span>
            <button
              type="button"
              onClick={() => openAuthModal()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-neutral-200 bg-white hover:bg-[#f3f5f4] text-[#111815] text-xs font-semibold cursor-pointer shrink-0"
            >
              <KeyRound className="w-3.5 h-3.5 text-emerald-700" />
              <span>Teacher Sign-In</span>
            </button>
          </div>
        ) : isCredsLoading ? (
          <div className="text-xs text-[#64726b] flex items-center gap-2 py-2">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
            <span>Loading registered passkeys for {authenticatedAdmin.name}...</span>
          </div>
        ) : myCredentials.length === 0 ? (
          <div className="text-xs text-[#4a5851] py-1">
            No passkeys registered for <strong className="text-[#111815]">{authenticatedAdmin.name}</strong> yet. Use{' '}
            <strong>Set Up Biometric Passkey</strong> above to enable biometric sign-in on this device.
          </div>
        ) : (
          <div className="divide-y divide-neutral-200/70 border border-neutral-200/80 rounded-xl overflow-hidden">
            {myCredentials.map((cred) => (
              <div
                key={cred.id}
                className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white text-xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      cred.revoked
                        ? 'bg-[#f3f5f4] text-[#64726b]'
                        : 'bg-[#eef3f0] text-emerald-800 border border-emerald-700/20'
                    }`}
                  >
                    <Smartphone className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-[#111815] flex items-center gap-2">
                      <span className="truncate">{cred.deviceName}</span>
                      <span
                        className={`text-[11px] font-semibold ${
                          cred.revoked ? 'text-rose-600' : 'text-emerald-700'
                        }`}
                      >
                        · {cred.revoked ? 'Revoked' : 'Active'}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#64726b] tabular-nums">
                      Registered {new Date(cred.createdAt).toLocaleDateString()}
                      {cred.lastUsedAt
                        ? ` · Last used ${new Date(cred.lastUsedAt).toLocaleString()}`
                        : ' · Not used yet'}
                    </div>
                  </div>
                </div>

                {!cred.revoked && (
                  <button
                    type="button"
                    disabled={revokingId === cred.id}
                    onClick={() => handleRevokeCredential(cred.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 text-[11px] font-semibold transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{revokingId === cred.id ? 'Revoking...' : 'Revoke'}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Staff Directory Reference */}
      <div className="p-5 sm:p-6 rounded-2xl rw-surface space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#111815] border-b border-neutral-200/70 pb-3">
          <Users className="w-4 h-4 text-emerald-700" />
          <span>Campus Energy Management Committee ({settings.institutionName})</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
          {staffDirectory.map((st) => {
            const isCurrent = isAdminUnlocked && authenticatedAdmin?.id === st.id;
            return (
              <div
                key={st.id}
                className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 transition-all ${
                  isCurrent
                    ? 'bg-[#eef3f0] border-emerald-700/35'
                    : 'bg-[#fafbfb] border-neutral-200/80'
                }`}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div
                    className={`w-9 h-9 rounded-xl font-semibold flex items-center justify-center shrink-0 text-xs ${
                      isCurrent ? 'bg-[#0b2e22] text-emerald-200' : 'bg-[#111815] text-white'
                    }`}
                  >
                    {st.avatarInitials}
                  </div>
                  <div className="overflow-hidden">
                    <div className="font-semibold text-[#111815] truncate flex items-center gap-1.5">
                      <span className="truncate">{st.name}</span>
                      {isCurrent && (
                        <span className="text-[10px] text-emerald-800 font-semibold shrink-0">
                          · Signed In
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[#4a5851] truncate">{st.role}</div>
                    <div className="text-[11px] text-emerald-800 font-medium truncate mt-0.5">
                      {st.assignedBuilding}
                    </div>
                    <div className="text-[10px] text-[#64726b] font-mono mt-0.5">
                      {st.hasPasskey ? 'Passkey Enrolled · Ready' : 'Password / QR Sign-In'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
