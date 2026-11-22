/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronDown,
  Menu,
  LogOut,
  KeyRound,
  Shield,
  GraduationCap,
  Smartphone,
  QrCode,
  Loader2,
  Mic,
  MicOff,
  ShieldCheck,
} from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { useAuth, getStoredClientSessionToken } from '../../context/AuthContext';
import { useVoiceAssistant } from '../../context/VoiceAssistantContext';
import { useDeviceClassification } from '../../utils/deviceDetection';
import { Tooltip } from '../common/MotionPrimitives';
import { ROOMWISE_EASE, popoverVariants } from '../../utils/motion';

export const Header: React.FC = () => {
  const {
    activeTab,
    currentStaff,
    setActiveTab,
    setIsMobileMenuOpen,
    auditFindings,
  } = useEnergy();
  const {
    isAdminUnlocked,
    isAuthLoading,
    authenticatedDeviceName,
    openAuthModal,
    openPhoneQrModal,
    requestLogout,
  } = useAuth();
  const {
    phase: voicePhase,
    wakeLoadStage,
    isMuted: isVoiceMuted,
    isOverlayOpen: isVoiceOverlayOpen,
    enableWakeStandby,
    resumeSuspendedAudio,
    startManualSession,
    openOverlay: openVoiceOverlay,
  } = useVoiceAssistant();
  const device = useDeviceClassification();

  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isAdminMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsAdminMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAdminMenuOpen]);

  const getBreadcrumbTitle = () => {
    switch (activeTab) {
      case 'dashboard':
        return 'Campus Overview';
      case 'digital-twin':
        return 'Digital Twin';
      case 'campus-live':
        return 'Campus Live (3D)';
      case 'classrooms':
        return 'Classrooms (25)';
      case 'environmental-solar':
        return 'Environmental & Solar';
      case 'environmental':
        return 'Environmental & Solar · Weather';
      case 'solar':
        return 'Environmental & Solar · PVGIS';
      case 'analytics':
        return 'Energy Analytics';
      case 'history':
        return 'Energy History';
      case 'space-intelligence':
        return 'Space Intelligence';
      case 'audit':
        return 'Energy Audit';
      case 'reports':
        return 'Reports & BEE';
      case 'settings':
        return 'Settings';
      default:
        return 'Campus Energy';
    }
  };

  const unresolvedCount = auditFindings.filter((f) => !f.isResolved).length;

  return (
    <header className="h-14 sm:h-15 glass-header px-3 sm:px-6 flex items-center justify-between sticky top-0 z-30 shrink-0">
      {/* Left: Mobile Menu + Editorial Breadcrumb */}
      <div className="flex items-center gap-2 sm:gap-3 overflow-hidden min-w-0">
        <button
          type="button"
          onClick={() => setIsMobileMenuOpen(true)}
          className="lg:hidden min-w-[40px] min-h-[40px] -ml-1.5 flex items-center justify-center text-[#4a5851] hover:text-[#111815] rounded-xl hover:bg-neutral-200/50 transition-colors shrink-0"
          aria-label="Open Navigation Menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 text-xs overflow-hidden min-w-0">
          <span className="font-semibold text-[#111815] shrink-0 whitespace-nowrap">
            DAV IIT KGP
          </span>
          <span className="text-neutral-300" aria-hidden="true">
            /
          </span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={activeTab}
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              transition={{ duration: 0.14, ease: ROOMWISE_EASE }}
              className="text-[#4a5851] font-medium truncate"
            >
              {getBreadcrumbTitle()}
            </motion.span>
          </AnimatePresence>
          <span className="hidden lg:inline text-neutral-300" aria-hidden="true">
            ·
          </span>
          <span className="hidden lg:inline text-[11px] font-mono text-[#64726b] whitespace-nowrap">
            25 Monitored Nodes
          </span>
        </div>
      </div>

      {/* Right Action Cluster */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Hey ROOMWISE Voice Control */}
        <Tooltip
          content={
            voicePhase === 'standby'
              ? 'Local wake-word active — say "Hey ROOMWISE" or click to ask now'
              : voicePhase === 'audio_suspended'
              ? 'Browser paused microphone audio — click anywhere to resume "Hey ROOMWISE" standby'
              : voicePhase === 'requesting_mic'
              ? 'Waiting for microphone permission...'
              : voicePhase === 'loading_model'
              ? wakeLoadStage === 'downloading'
                ? 'Downloading local wake-word model (cached after first load)...'
                : wakeLoadStage === 'extracting'
                ? 'Extracting offline wake-word acoustic model...'
                : 'Initializing offline wake-word detector...'
              : voicePhase === 'starting_audio'
              ? 'Starting microphone audio pipeline...'
              : voicePhase === 'unavailable' || voicePhase === 'permission_required'
              ? 'Microphone unavailable — click to open ROOMWISE Assistant for typed commands'
              : isVoiceMuted
              ? 'Voice assistant muted — click to ask manually'
              : 'Activate "Hey ROOMWISE" voice & text assistant'
          }
        >
          <button
            type="button"
            onClick={() => {
              if (isVoiceOverlayOpen) {
                openVoiceOverlay();
                return;
              }
              if (
                voicePhase === 'unavailable' ||
                voicePhase === 'permission_required' ||
                voicePhase === 'error'
              ) {
                openVoiceOverlay();
                return;
              }
              if (voicePhase === 'audio_suspended') {
                void resumeSuspendedAudio();
                return;
              }
              if (
                voicePhase === 'standby' ||
                voicePhase === 'muted' ||
                voicePhase === 'loading_model' ||
                voicePhase === 'starting_audio'
              ) {
                void startManualSession();
                return;
              }
              void enableWakeStandby();
            }}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs font-medium transition-all active:scale-[0.98] whitespace-nowrap shrink-0 min-h-[34px] ${
              voicePhase === 'listening' ||
              voicePhase === 'speaking' ||
              voicePhase === 'processing' ||
              voicePhase === 'executing'
                ? 'border-emerald-700/30 bg-[#0b2e22] text-white'
                : voicePhase === 'standby' || voicePhase === 'returning_idle'
                ? 'border-emerald-700/20 bg-[#eef3f0] hover:bg-emerald-50 text-[#071e17]'
                : voicePhase === 'audio_suspended'
                ? 'border-amber-300/90 bg-amber-50 hover:bg-amber-100/80 text-amber-950'
                : isVoiceMuted
                ? 'border-amber-300/80 bg-amber-50/90 text-amber-900'
                : 'border-neutral-200/90 bg-white hover:bg-[#f3f5f4] text-[#111815]'
            }`}
            aria-label="ROOMWISE Voice & Text Assistant"
          >
            {voicePhase === 'requesting_mic' ||
            voicePhase === 'loading_model' ||
            voicePhase === 'starting_audio' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700 shrink-0" />
            ) : isVoiceMuted ? (
              <MicOff className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            ) : voicePhase === 'unavailable' || voicePhase === 'permission_required' ? (
              <MicOff className="w-3.5 h-3.5 text-[#64726b] shrink-0" />
            ) : (
              <Mic
                className={`w-3.5 h-3.5 shrink-0 ${
                  voicePhase === 'listening' ||
                  voicePhase === 'speaking' ||
                  voicePhase === 'processing' ||
                  voicePhase === 'executing'
                    ? 'text-emerald-300'
                    : voicePhase === 'standby' || voicePhase === 'returning_idle'
                    ? 'text-emerald-700'
                    : voicePhase === 'audio_suspended'
                    ? 'text-amber-700'
                    : 'text-[#64726b]'
                }`}
              />
            )}
            <span className="hidden md:inline text-xs whitespace-nowrap">
              {voicePhase === 'listening'
                ? 'Listening'
                : voicePhase === 'speaking'
                ? 'Speaking'
                : voicePhase === 'executing'
                ? 'Executing'
                : voicePhase === 'processing'
                ? 'Thinking'
                : voicePhase === 'requesting_mic'
                ? 'Mic Access...'
                : voicePhase === 'loading_model'
                ? wakeLoadStage === 'downloading'
                  ? 'Downloading...'
                  : wakeLoadStage === 'extracting'
                  ? 'Extracting...'
                  : 'Initializing...'
                : voicePhase === 'starting_audio'
                ? 'Starting...'
                : voicePhase === 'audio_suspended'
                ? 'Resume Audio'
                : voicePhase === 'unavailable' || voicePhase === 'permission_required'
                ? 'Assistant'
                : voicePhase === 'standby' || voicePhase === 'returning_idle'
                ? 'Hey ROOMWISE'
                : isVoiceMuted
                ? 'Muted'
                : 'Voice'}
            </span>
          </button>
        </Tooltip>

        {/* Quick Audit Shortcut */}
        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all active:scale-[0.98] whitespace-nowrap shrink-0 ${
            activeTab === 'audit'
              ? 'border-emerald-700/25 bg-[#eef3f0] text-[#071e17] font-semibold'
              : 'border-neutral-200/90 bg-white hover:bg-[#f3f5f4] text-[#4a5851]'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
          <span>Audit</span>
          {unresolvedCount > 0 && (
            <span className="font-mono text-[11px] font-semibold text-amber-700 tabular-nums">
              {unresolvedCount}
            </span>
          )}
        </button>

        {/* Authority Zone */}
        {isAuthLoading && getStoredClientSessionToken() ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-neutral-200/85 text-xs text-[#64726b]">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />
            <span className="hidden sm:inline">Verifying...</span>
          </div>
        ) : !isAdminUnlocked ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#4a5851] whitespace-nowrap">
              <GraduationCap className="w-3.5 h-3.5 text-emerald-700" />
              <span>Student Mode</span>
            </span>

            <button
              type="button"
              onClick={() => openAuthModal()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#111815] hover:bg-[#0b2e22] text-white text-xs font-semibold transition-colors active:scale-[0.98] whitespace-nowrap shrink-0"
              title="Authorize administrator override controls"
            >
              <KeyRound className="w-3.5 h-3.5 text-emerald-300" />
              <span className="hidden sm:inline">Admin Login</span>
              <span className="sm:hidden">Admin</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            {device.isPhone && (
              <button
                type="button"
                onClick={openPhoneQrModal}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-emerald-300/90 bg-emerald-50 hover:bg-emerald-100 text-emerald-950 text-xs font-semibold transition-all active:scale-[0.98] whitespace-nowrap cursor-pointer min-h-[34px]"
                title="Scan Computer QR Code to authorise a laptop or desktop"
              >
                <QrCode className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span>Scan PC QR</span>
              </button>
            )}

            <div className="relative" ref={menuContainerRef}>
              <button
                type="button"
                aria-expanded={isAdminMenuOpen}
                aria-haspopup="menu"
                onClick={() => setIsAdminMenuOpen((v) => !v)}
                className="flex items-center gap-2 py-1 pl-1.5 pr-2.5 rounded-xl border border-neutral-200/90 hover:border-emerald-700/30 bg-white transition-all"
              >
                <div className="w-7 h-7 rounded-lg bg-[#0b2e22] text-white font-semibold text-xs flex items-center justify-center shrink-0">
                  {currentStaff.avatarInitials}
                </div>
                <div className="text-left hidden xl:block">
                  <div className="text-xs font-semibold text-[#111815] leading-tight">
                    {currentStaff.name}
                  </div>
                  <div className="text-[10px] text-emerald-800 font-medium leading-none flex items-center gap-1 mt-0.5">
                    <Shield className="w-2.5 h-2.5" />
                    <span>Admin Mode</span>
                  </div>
                </div>
                <motion.span
                  animate={{ rotate: isAdminMenuOpen ? 180 : 0 }}
                  transition={{ duration: 0.16, ease: ROOMWISE_EASE }}
                  className="hidden sm:inline-flex"
                >
                  <ChevronDown className="w-3.5 h-3.5 text-[#64726b]" />
                </motion.span>
              </button>

              <AnimatePresence>
                {isAdminMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsAdminMenuOpen(false)}
                    />
                    <motion.div
                      variants={popoverVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      role="menu"
                      className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-1.5rem)] rw-glass-float rounded-2xl py-3 z-50 origin-top-right"
                    >
                      <div className="px-4 pb-3 border-b border-neutral-100 space-y-1">
                        <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                          <span>Authenticated Administrator</span>
                          <span>Active</span>
                        </div>
                        <div className="text-sm font-semibold text-[#111815]">
                          {currentStaff.name}
                        </div>
                        <div className="text-[11px] text-[#4a5851]">
                          {currentStaff.role}
                        </div>
                        <div className="text-[10px] text-[#64726b] flex items-center gap-1.5 pt-1">
                          <Smartphone className="w-3 h-3 text-emerald-700 shrink-0" />
                          <span className="truncate">
                            {authenticatedDeviceName || 'Registered Digital Access Card'}
                          </span>
                        </div>
                      </div>

                      {device.isPhone && (
                        <div className="px-4 py-2.5 border-b border-neutral-100">
                          <button
                            type="button"
                            onClick={() => {
                              setIsAdminMenuOpen(false);
                              openPhoneQrModal();
                            }}
                            className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-[#0b2e22] hover:bg-[#114231] text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
                          >
                            <QrCode className="w-4 h-4 shrink-0 text-emerald-300" />
                            <span>Scan Computer QR Code</span>
                          </button>
                        </div>
                      )}

                      <div className="pt-2.5 px-4 flex items-center justify-between gap-2">
                        <span className="text-[10px] text-[#64726b]">
                          Session-scoped access
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setIsAdminMenuOpen(false);
                            requestLogout();
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#111815] hover:bg-neutral-800 text-white text-xs font-semibold transition-colors active:scale-[0.98]"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Logout</span>
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <button
              type="button"
              onClick={requestLogout}
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-neutral-200/90 bg-white hover:bg-[#f3f5f4] text-[#4a5851] hover:text-[#111815] text-xs font-medium transition-colors active:scale-[0.98] whitespace-nowrap shrink-0"
              title="End administrator session"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
