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
import { ActionButton, IconButton } from '../common/DesignSystem';
import { ROOMWISE_EASE, popoverVariants } from '../../utils/motion';

export const Header: React.FC = () => {
  const {
    activeTab,
    campusSummary,
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
  const liveLoadKW = (campusSummary.totalCurrentPowerWatts / 1000).toFixed(2);

  return (
    <header className="h-[48px] sm:h-[52px] glass-header px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 sticky top-0 z-30 shrink-0">
      {/* Left: Mobile Drawer Trigger + Precision Breadcrumb & Live Readout */}
      <div className="flex items-center gap-2 sm:gap-2.5 overflow-hidden min-w-0">
        <IconButton
          variant="ghost"
          size="sm"
          label="Open Navigation Menu"
          onClick={() => setIsMobileMenuOpen(true)}
          className="lg:hidden min-w-[36px] min-h-[36px] -ml-1"
        >
          <Menu className="w-5 h-5" />
        </IconButton>

        <div className="flex items-center gap-1.5 sm:gap-2 text-[11.5px] sm:text-xs overflow-hidden min-w-0">
          <span className="font-display font-bold text-[#111916] shrink-0 whitespace-nowrap tracking-tight">
            DAV IIT KGP
          </span>
          <span className="text-[#b8c2bc] shrink-0" aria-hidden="true">
            /
          </span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={activeTab}
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              transition={{ duration: 0.14, ease: ROOMWISE_EASE }}
              className="text-[#46544e] font-medium truncate"
            >
              {getBreadcrumbTitle()}
            </motion.span>
          </AnimatePresence>
          <span className="hidden xl:inline text-[#c8d0cb]" aria-hidden="true">
            ·
          </span>
          <span className="hidden xl:inline text-[11px] font-mono text-[#62706a] whitespace-nowrap tabular-nums">
            {liveLoadKW} kW · 25 Nodes
          </span>
        </div>
      </div>

      {/* Right: Streamlined Operational Controls */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
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
          <ActionButton
            variant={
              voicePhase === 'wake_detected' ||
              voicePhase === 'listening' ||
              voicePhase === 'speaking' ||
              voicePhase === 'processing' ||
              voicePhase === 'executing'
                ? 'primary'
                : voicePhase === 'standby' || voicePhase === 'returning_idle'
                ? 'soft'
                : voicePhase === 'audio_suspended' || isVoiceMuted
                ? 'amber'
                : 'secondary'
            }
            size="sm"
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
            className={
              voicePhase === 'wake_detected' ||
              voicePhase === 'listening' ||
              voicePhase === 'speaking' ||
              voicePhase === 'processing' ||
              voicePhase === 'executing'
                ? 'shadow-[0_0_0_2px_rgba(16,185,129,0.2)] border-emerald-400/40'
                : ''
            }
            aria-label="ROOMWISE Voice & Text Assistant"
          >
            {(voicePhase === 'wake_detected' ||
              voicePhase === 'listening' ||
              voicePhase === 'speaking' ||
              voicePhase === 'processing' ||
              voicePhase === 'executing') && (
              <span
                aria-hidden="true"
                className="rw-voice-aura pointer-events-none absolute -inset-[3px] rounded-[10px] border border-emerald-400/45"
              />
            )}
            {voicePhase === 'requesting_mic' ||
            voicePhase === 'loading_model' ||
            voicePhase === 'starting_audio' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0b6e4f] shrink-0" />
            ) : isVoiceMuted ? (
              <MicOff className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            ) : voicePhase === 'unavailable' || voicePhase === 'permission_required' ? (
              <MicOff className="w-3.5 h-3.5 text-[#62706a] shrink-0" />
            ) : (
              <Mic
                className={`w-3.5 h-3.5 shrink-0 ${
                  voicePhase === 'wake_detected' ||
                  voicePhase === 'listening' ||
                  voicePhase === 'speaking' ||
                  voicePhase === 'processing' ||
                  voicePhase === 'executing'
                    ? 'text-emerald-400'
                    : voicePhase === 'standby' || voicePhase === 'returning_idle'
                    ? 'text-[#0b6e4f]'
                    : voicePhase === 'audio_suspended'
                    ? 'text-amber-700'
                    : 'text-[#62706a]'
                }`}
              />
            )}
            <span className="hidden md:inline text-xs whitespace-nowrap">
              {voicePhase === 'wake_detected'
                ? 'Wake Word'
                : voicePhase === 'listening'
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
          </ActionButton>
        </Tooltip>

        {/* Quick Audit Link */}
        <ActionButton
          variant={activeTab === 'audit' ? 'soft' : 'secondary'}
          size="sm"
          onClick={() => setActiveTab('audit')}
          icon={<ShieldCheck className="w-3.5 h-3.5 text-[#0b6e4f]" />}
          className="hidden md:inline-flex"
        >
          <span>Audit</span>
          {unresolvedCount > 0 && (
            <span className="font-mono text-[11px] font-semibold text-amber-700 tabular-nums">
              {unresolvedCount}
            </span>
          )}
        </ActionButton>

        {/* Authority Zone */}
        {isAuthLoading && getStoredClientSessionToken() ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-[#111916]/12 text-xs text-[#62706a]">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0b6e4f]" />
            <span className="hidden sm:inline">Verifying...</span>
          </div>
        ) : !isAdminUnlocked ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-[#46544e] whitespace-nowrap">
              <GraduationCap className="w-3.5 h-3.5 text-[#0b6e4f]" />
              <span>Student Mode</span>
            </span>

            <ActionButton
              variant="primary"
              size="sm"
              onClick={() => openAuthModal()}
              icon={<KeyRound className="w-3.5 h-3.5 text-emerald-400" />}
              title="Authorize administrator override controls"
            >
              <span className="hidden sm:inline">Admin Login</span>
              <span className="sm:hidden">Admin</span>
            </ActionButton>
          </div>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            {device.isPhone && (
              <ActionButton
                variant="soft"
                size="sm"
                onClick={openPhoneQrModal}
                icon={<QrCode className="w-3.5 h-3.5 text-[#0b6e4f]" />}
                title="Scan Computer QR Code to authorise a laptop or desktop"
              >
                <span>Scan PC QR</span>
              </ActionButton>
            )}

            <div className="relative" ref={menuContainerRef}>
              <motion.button
                type="button"
                aria-expanded={isAdminMenuOpen}
                aria-haspopup="menu"
                whileTap={{ scale: 0.98 }}
                onPointerEnter={(e) => {
                  if (e.pointerType !== 'mouse') return;
                  const r = e.currentTarget.getBoundingClientRect();
                  e.currentTarget.style.setProperty('--rw-bx', `${(e.clientX - r.left).toFixed(1)}px`);
                  e.currentTarget.style.setProperty('--rw-by', `${(e.clientY - r.top).toFixed(1)}px`);
                }}
                onPointerMove={(e) => {
                  if (e.pointerType !== 'mouse') return;
                  const r = e.currentTarget.getBoundingClientRect();
                  e.currentTarget.style.setProperty('--rw-bx', `${(e.clientX - r.left).toFixed(1)}px`);
                  e.currentTarget.style.setProperty('--rw-by', `${(e.clientY - r.top).toFixed(1)}px`);
                }}
                onClick={() => setIsAdminMenuOpen((v) => !v)}
                className="group relative isolate overflow-hidden flex items-center gap-2 py-1 pl-1.5 pr-2.5 rounded-[9px] min-h-[32px] bg-white border border-[#111916]/13 hover:border-[#0b6e4f]/42 hover:bg-[#f7fbf9] hover:-translate-y-[1px] shadow-[0_1px_2px_rgba(11,23,19,0.04)] hover:shadow-[0_4px_10px_-4px_rgba(11,110,79,0.14)] cursor-pointer transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6e4f] focus-visible:ring-offset-1"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                  style={{
                    background:
                      'radial-gradient(95px circle at var(--rw-bx, 50%) var(--rw-by, 50%), rgba(11, 110, 79, 0.1), transparent 74%)',
                  }}
                />
                <div className="relative z-10 w-6 h-6 rounded-md bg-[#0b1713] text-emerald-300 font-semibold text-[11px] flex items-center justify-center shrink-0">
                  {currentStaff.avatarInitials}
                </div>
                <div className="relative z-10 text-left hidden xl:block">
                  <div className="text-xs font-semibold text-[#111916] leading-tight">
                    {currentStaff.name}
                  </div>
                  <div className="text-[10px] text-[#0b6e4f] font-medium leading-none flex items-center gap-1 mt-0.5">
                    <Shield className="w-2.5 h-2.5" />
                    <span>Admin</span>
                  </div>
                </div>
                <motion.span
                  animate={{ rotate: isAdminMenuOpen ? 180 : 0 }}
                  transition={{ duration: 0.16, ease: ROOMWISE_EASE }}
                  className="relative z-10 hidden sm:inline-flex"
                >
                  <ChevronDown className="w-3.5 h-3.5 text-[#62706a]" />
                </motion.span>
              </motion.button>

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
                      className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-1.5rem)] rw-glass-float rounded-xl py-3 z-50 origin-top-right"
                    >
                      <div className="px-4 pb-3 border-b border-[#111916]/8 space-y-1">
                        <div className="flex items-center justify-between gap-2 text-[10px] font-semibold tracking-wider text-[#0b6e4f]">
                          <span>Authenticated Administrator</span>
                          <span className="font-mono">Active</span>
                        </div>
                        <div className="font-display text-sm font-bold text-[#111916]">
                          {currentStaff.name}
                        </div>
                        <div className="text-[11px] text-[#46544e]">
                          {currentStaff.role}
                        </div>
                        <div className="text-[10px] text-[#62706a] flex items-center gap-1.5 pt-1">
                          <Smartphone className="w-3 h-3 text-[#0b6e4f] shrink-0" />
                          <span className="truncate">
                            {authenticatedDeviceName || 'Registered Digital Access Card'}
                          </span>
                        </div>
                      </div>

                      {device.isPhone && (
                        <div className="px-4 py-2.5 border-b border-[#111916]/8">
                          <ActionButton
                            variant="forest"
                            size="md"
                            fullWidth
                            onClick={() => {
                              setIsAdminMenuOpen(false);
                              openPhoneQrModal();
                            }}
                            icon={<QrCode className="w-4 h-4 text-emerald-200" />}
                          >
                            Scan Computer QR Code
                          </ActionButton>
                        </div>
                      )}

                      <div className="pt-2.5 px-4 flex items-center justify-between gap-2">
                        <span className="text-[10px] text-[#62706a]">
                          Session-scoped access
                        </span>
                        <ActionButton
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            setIsAdminMenuOpen(false);
                            requestLogout();
                          }}
                          icon={<LogOut className="w-3.5 h-3.5" />}
                        >
                          Logout
                        </ActionButton>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <ActionButton
              variant="secondary"
              size="sm"
              onClick={requestLogout}
              icon={<LogOut className="w-3.5 h-3.5 text-[#46544e]" />}
              className="hidden sm:inline-flex"
              title="End administrator session"
            >
              Logout
            </ActionButton>
          </div>
        )}
      </div>
    </header>
  );
};
