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
import { ActionButton, PageHeader } from '../common/DesignSystem';
import { SpotlightCard } from '../reactbits/SpotlightCard';
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
    <div className="px-4 pt-5 pb-7 sm:px-6 sm:pt-6 sm:pb-8 lg:px-8 lg:pt-7 lg:pb-10 space-y-5 sm:space-y-6 max-w-[1440px] mx-auto select-none">
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
            className="p-3.5 sm:p-4 rounded-xl bg-amber-50/90 border border-amber-300/80 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5">
              <Lock className="w-4 h-4 text-[#b45309] shrink-0" />
              <div>
                <div className="font-semibold text-amber-950">Read-Only Viewer Mode</div>
                <div className="text-[11px] text-amber-900/90 mt-0.5">
                  Administrative authentication is required to modify tariffs or system thresholds.
                </div>
              </div>
            </div>
            <ActionButton
              variant="primary"
              size="md"
              onClick={() => openAuthModal()}
              icon={<KeyRound className="w-3.5 h-3.5 text-[#34d399]" />}
              className="w-full sm:w-auto"
            >
              Unlock Admin
            </ActionButton>
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
            className="p-3.5 sm:p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-950 flex items-center gap-2"
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
            className="p-3.5 sm:p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-950 flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>
              Configuration saved successfully across all 25 classrooms and financial sheets.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
        {/* Section 1: Institution Details */}
        <div className="p-4 sm:p-6 rounded-xl border border-[#111916]/12 bg-white space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-[#111916]/10 pb-3">
            <div className="flex items-center gap-2">
              <Building className="w-4 h-4 text-[#0b6e4f]" />
              <h2 className="font-display text-sm font-semibold text-[#111916]">School Identification</h2>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-[#5c6862]">Section 01</span>
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
        <div className="p-5 sm:p-6 rounded-xl border border-[#111916]/12 bg-white space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-[#111916]/10 pb-3">
            <div className="flex items-center gap-2">
              <IndianRupee className="w-4 h-4 text-[#0b6e4f]" />
              <h2 className="font-display text-sm font-semibold text-[#111916]">Tariff Rates &amp; Grid Carbon Factors</h2>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-[#5c6862]">Section 02</span>
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
        <div className="p-5 sm:p-6 rounded-xl border border-[#111916]/12 bg-white space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-[#111916]/10 pb-3">
            <div className="flex items-center gap-2">
              <Sun className="w-4 h-4 text-[#0b6e4f]" />
              <h2 className="font-display text-sm font-semibold text-[#111916]">National Building Code (NBC) Illumination &amp; Inactivity Norms</h2>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-[#5c6862]">Section 03</span>
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
              ].map((opt) => {
                const selected = learningMode === opt.id;
                return (
                  <SpotlightCard
                    key={opt.id}
                    as="button"
                    aria-pressed={selected}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => handlePolicySelect(opt.id)}
                    spotlightColor="rgba(11, 110, 79, 0.12)"
                    className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6e4f] focus-visible:ring-offset-1 ${
                      selected
                        ? 'bg-[#eef6f2] border-[#0b6e4f]/45 shadow-[0_4px_12px_-8px_rgba(11,110,79,0.22)]'
                        : 'bg-white border-[#111916]/12 hover:border-[#0b6e4f]/38 hover:bg-[#fafcfb]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#111815]">{opt.label}</span>
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 transition-colors ${
                          selected ? 'bg-[#0b6e4f]' : 'bg-[#111916]/15'
                        }`}
                        aria-hidden="true"
                      />
                    </div>
                    <div className="text-[11px] text-[#64726b] mt-0.5 leading-relaxed">{opt.desc}</div>
                  </SpotlightCard>
                );
              })}
            </div>
          </div>
        </div>

        {/* Section 4: Device Optimization & Low-Power Mode */}
        <div className="p-5 sm:p-6 rounded-xl border border-[#111916]/12 bg-white space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-[#111916]/10 pb-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#0b6e4f]" />
              <h2 className="font-display text-sm font-semibold text-[#111916]">Device Optimization &amp; Low-Power Mode</h2>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-[#5c6862]">Section 04</span>
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
            <ActionButton
              variant="primary"
              size="lg"
              onClick={() => openAuthModal()}
              icon={<Lock className="w-4 h-4 text-[#34d399]" />}
            >
              Unlock Admin to Edit Parameters
            </ActionButton>
          ) : (
            <>
              {hasUnsavedChanges && (
                <ActionButton
                  variant="secondary"
                  size="lg"
                  onClick={handleResetUnsaved}
                  disabled={isPropagating}
                  icon={<RotateCcw className="w-3.5 h-3.5" />}
                >
                  Reset Unsaved
                </ActionButton>
              )}
              <ActionButton
                type="submit"
                variant="primary"
                size="lg"
                loading={isPropagating}
                icon={
                  savedSuccess ? (
                    <CheckCircle2 className="w-4 h-4 text-[#34d399]" />
                  ) : (
                    <Save className="w-4 h-4 text-[#34d399]" />
                  )
                }
              >
                {isPropagating
                  ? 'Saving Parameters...'
                  : savedSuccess
                  ? 'Parameters Propagated'
                  : 'Apply & Propagate Parameters'}
              </ActionButton>
            </>
          )}
        </div>
      </form>

      {/* Voice Assistant & Wake-Word Controls */}
      <div className="p-5 sm:p-6 rounded-xl border border-[#111916]/12 bg-white space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-[#111916]/10 pb-3">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-[#0b6e4f] shrink-0" />
            <h2 className="font-display text-sm font-semibold text-[#111916]">Voice Assistant &amp; &ldquo;Hey ROOMWISE&rdquo; Standby</h2>
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
              <ActionButton
                variant="amber"
                size="md"
                onClick={() => void resumeSuspendedAudio()}
                icon={<Mic className="w-3.5 h-3.5 text-amber-700" />}
              >
                Resume Audio
              </ActionButton>
            )}

            <ActionButton
              variant="secondary"
              size="md"
              onClick={() => void startManualSession()}
              icon={<Mic className="w-3.5 h-3.5 text-[#0b6e4f]" />}
            >
              Ask Manually
            </ActionButton>

            {isWakeWordEnabled && (
              <ActionButton
                variant={isVoiceMuted ? 'amber' : 'secondary'}
                size="md"
                onClick={toggleVoiceMute}
                icon={
                  isVoiceMuted ? (
                    <MicOff className="w-3.5 h-3.5 text-amber-800" />
                  ) : (
                    <Mic className="w-3.5 h-3.5 text-[#0b6e4f]" />
                  )
                }
              >
                {isVoiceMuted ? 'Muted' : 'Mute Standby'}
              </ActionButton>
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

      {/* Account Security: Biometric & Registered Devices — Obsidian-Pine Security Masthead */}
      <div className="rounded-xl border border-[#111916]/12 bg-white overflow-hidden">
        <div className="px-5 sm:px-6 py-4 rw-obsidian-panel border-none rounded-none shadow-none text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {prefersFaceLabel ? (
              <ScanFace className="w-4 h-4 text-[#34d399]" />
            ) : (
              <Fingerprint className="w-4 h-4 text-[#34d399]" />
            )}
            <div>
              <h2 className="font-display text-sm font-semibold text-white">Biometric &amp; Registered Devices</h2>
              <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-emerald-300/75">
                WebAuthn Hardware Passkeys · Digital Access Control
              </div>
            </div>
          </div>

          {isAdminUnlocked && authenticatedAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              {device.isPhone && (
                <ActionButton
                  variant="dark-ghost"
                  size="md"
                  onClick={openPhoneQrModal}
                  icon={<QrCode className="w-3.5 h-3.5 text-[#34d399]" />}
                >
                  Scan Computer QR
                </ActionButton>
              )}
              <ActionButton
                variant="forest"
                size="md"
                loading={isEnrollingPasskey}
                onClick={handleEnrollCurrentDevice}
                icon={<Shield className="w-3.5 h-3.5 text-emerald-200" />}
              >
                {isEnrollingPasskey ? 'Waiting for device...' : 'Set Up Biometric Passkey'}
              </ActionButton>
            </div>
          )}
        </div>

        <div className="p-5 sm:p-6 space-y-4">

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
            <ActionButton
              variant="secondary"
              size="md"
              onClick={() => openAuthModal()}
              icon={<KeyRound className="w-3.5 h-3.5 text-[#0b6e4f]" />}
            >
              Teacher Sign-In
            </ActionButton>
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
                  <ActionButton
                    variant="danger"
                    size="xs"
                    loading={revokingId === cred.id}
                    onClick={() => handleRevokeCredential(cred.id)}
                    icon={<Trash2 className="w-3.5 h-3.5" />}
                  >
                    {revokingId === cred.id ? 'Revoking...' : 'Revoke'}
                  </ActionButton>
                )}
              </div>
            ))}
          </div>
        )}
        </div>
      </div>

      {/* Staff Directory Reference */}
      <div className="p-5 sm:p-6 rounded-xl border border-[#111916]/12 bg-white space-y-4">
        <div className="flex items-center justify-between gap-2 border-b border-[#111916]/10 pb-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#0b6e4f]" />
            <h2 className="font-display text-sm font-semibold text-[#111916]">Campus Energy Management Committee ({settings.institutionName})</h2>
          </div>
          <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-[#5c6862]">{staffDirectory.length} Authorised</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
          {staffDirectory.map((st) => {
            const isCurrent = isAdminUnlocked && authenticatedAdmin?.id === st.id;
            return (
              <div
                key={st.id}
                className={`p-3.5 rounded-lg border flex items-center justify-between gap-3 transition-all ${
                  isCurrent
                    ? 'bg-[#eef4f1] border-[#0b6e4f]/35'
                    : 'bg-[#f4f5f3]/65 border-[#111916]/10'
                }`}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div
                    className={`w-9 h-9 rounded-lg font-mono font-semibold flex items-center justify-center shrink-0 text-xs ${
                      isCurrent ? 'bg-[#0b1713] text-[#34d399]' : 'bg-[#111916] text-white'
                    }`}
                  >
                    {st.avatarInitials}
                  </div>
                  <div className="overflow-hidden">
                    <div className="font-semibold text-[#111916] truncate flex items-center gap-1.5">
                      <span className="truncate">{st.name}</span>
                      {isCurrent && (
                        <span className="text-[10px] font-mono text-[#0b6e4f] font-semibold shrink-0">
                          · Signed In
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[#47534d] truncate">{st.role}</div>
                    <div className="text-[11px] text-[#0b6e4f] font-medium truncate mt-0.5">
                      {st.assignedBuilding}
                    </div>
                    <div className="text-[10px] text-[#5c6862] font-mono mt-0.5">
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
