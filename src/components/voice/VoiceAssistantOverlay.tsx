/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mic,
  MicOff,
  X,
  Shield,
  GraduationCap,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Send,
  Volume2,
  Compass,
  Sliders,
  Square,
  RotateCcw,
} from 'lucide-react';
import { useVoiceAssistant } from '../../context/VoiceAssistantContext';
import { useAuth } from '../../context/AuthContext';
import { VoiceWaveformCanvas } from './VoiceWaveformCanvas';
import { ROOMWISE_EASE } from '../../utils/motion';

export const VoiceAssistantOverlay: React.FC = () => {
  const {
    phase,
    micPermission,
    isWakeWordEnabled,
    isMuted,
    isOverlayOpen,
    isPermissionCardVisible,
    lastError,
    pendingConfirmation,
    transcripts,
    actionNotices,
    amplitudeRef,
    enableWakeStandby,
    toggleMute,
    startManualSession,
    endLiveSession,
    interruptSpeaking,
    retrySession,
    confirmPendingAction,
    sendTextPrompt,
    openOverlay,
    closeOverlay,
    dismissPermissionCard,
    dismissNotice,
  } = useVoiceAssistant();
  const { isAdminUnlocked, authenticatedAdmin, openAuthModal } = useAuth();
  const [fallbackInput, setFallbackInput] = useState('');
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);

  const isTextOnlyMode =
    micPermission === 'denied' ||
    micPermission === 'unsupported' ||
    phase === 'permission_required' ||
    phase === 'unavailable';

  const latestTranscriptText = transcripts[transcripts.length - 1]?.text ?? '';

  useEffect(() => {
    const el = transcriptContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [transcripts.length, latestTranscriptText]);

  useEffect(() => {
    if (!isOverlayOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeOverlay();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOverlayOpen, closeOverlay]);

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fallbackInput.trim()) return;
    sendTextPrompt(fallbackInput);
    setFallbackInput('');
  };

  const getStatusLabel = () => {
    if (isMuted) return 'Microphone Muted';
    switch (phase) {
      case 'requesting_mic':
        return 'Requesting Microphone...';
      case 'loading_model':
        return 'Preparing Wake Model...';
      case 'starting_audio':
        return 'Starting Audio...';
      case 'audio_suspended':
        return 'Audio Paused — Tap to Resume';
      case 'unavailable':
      case 'permission_required':
        return 'Text Mode';
      case 'wake_detected':
        return 'Wake Phrase Detected';
      case 'connecting':
        return 'Connecting ROOMWISE Live...';
      case 'listening':
        return 'Listening';
      case 'processing':
        return 'Processing Request...';
      case 'executing':
        return 'Executing ROOMWISE Action...';
      case 'speaking':
        return 'Speaking';
      case 'returning_idle':
        return 'Returning to Standby...';
      case 'error':
        return 'Text Mode Ready';
      default:
        return isTextOnlyMode ? 'Text Mode' : 'Standby Ready';
    }
  };

  const showOnboardingCard =
    isPermissionCardVisible &&
    !isOverlayOpen &&
    phase !== 'standby' &&
    phase !== 'requesting_mic' &&
    phase !== 'loading_model' &&
    phase !== 'starting_audio' &&
    phase !== 'audio_suspended' &&
    phase !== 'unavailable' &&
    phase !== 'listening' &&
    phase !== 'speaking' &&
    phase !== 'executing' &&
    phase !== 'processing';

  return (
    <>
      {/* Concise Privacy-First Wake-Word Permission Card */}
      <AnimatePresence>
        {showOnboardingCard && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: ROOMWISE_EASE }}
            className="fixed top-16 sm:top-[4.5rem] right-3 sm:right-6 z-40 w-[calc(100vw-1.5rem)] max-w-sm rounded-2xl glass-modal p-4 shadow-lg"
            role="region"
            aria-label="Enable Hey ROOMWISE Voice Assistant"
          >
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                  <Mic className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-neutral-900">
                    Enable &ldquo;Hey ROOMWISE&rdquo;
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    Hands-free campus energy intelligence
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={dismissPermissionCard}
                className="p-1 text-neutral-400 hover:text-neutral-700 rounded-lg hover:bg-neutral-100 transition-colors"
                aria-label="Dismiss voice prompt"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <p className="text-[11px] text-neutral-600 leading-relaxed mt-2.5">
              Wake-word detection runs locally inside your browser. Ambient microphone audio is never transmitted until{' '}
              <strong className="text-neutral-800">&ldquo;Hey ROOMWISE&rdquo;</strong> triggers an active voice session.
            </p>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void enableWakeStandby()}
                className="flex-1 px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-2xs whitespace-nowrap"
              >
                <Mic className="w-3.5 h-3.5 shrink-0" />
                <span>Enable Voice</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  dismissPermissionCard();
                  openOverlay();
                }}
                className="px-3 py-2 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                Type Command
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Compact Active Voice Intelligence Overlay (Anchored cleanly to top-right workspace) */}
      <AnimatePresence>
        {isOverlayOpen && (
          <motion.section
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: ROOMWISE_EASE }}
            aria-label="ROOMWISE Voice Intelligence"
            className="fixed top-16 sm:top-[4.5rem] right-3 sm:right-6 z-40 w-[calc(100vw-1.5rem)] max-w-[392px] rounded-2xl glass-modal overflow-hidden shadow-xl"
          >
            {/* Top Emerald Accent Strip */}
            <div className="h-0.5 w-full gradient-rim-emerald" />

            {/* Header Bar */}
            <div className="px-4 py-3 border-b border-neutral-200/75 flex items-center justify-between gap-2 bg-white/70">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border transition-colors ${
                    phase === 'error'
                      ? 'bg-rose-50 border-rose-200 text-rose-700'
                      : isTextOnlyMode || isMuted
                      ? 'bg-[#f3f5f4] border-neutral-200 text-[#4a5851]'
                      : phase === 'listening' || phase === 'speaking' || phase === 'executing'
                      ? 'bg-[#0b2e22] border-emerald-700/40 text-emerald-300'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  }`}
                >
                  {phase === 'connecting' || phase === 'processing' || phase === 'executing' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : phase === 'speaking' ? (
                    <Volume2 className="w-4 h-4" />
                  ) : isMuted || isTextOnlyMode ? (
                    <MicOff className="w-4 h-4" />
                  ) : (
                    <Mic className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[#111815] flex items-center gap-1.5">
                    <span>ROOMWISE Voice</span>
                    <span
                      className={`text-[10px] font-semibold ${
                        phase === 'error'
                          ? 'text-rose-700'
                          : isTextOnlyMode
                          ? 'text-[#4a5851]'
                          : 'text-emerald-800'
                      }`}
                    >
                      · {getStatusLabel()}
                    </span>
                  </div>
                  <div className="text-[10px] text-neutral-500 flex items-center gap-1 truncate mt-0.5">
                    {isAdminUnlocked && authenticatedAdmin ? (
                      <>
                        <Shield className="w-3 h-3 text-emerald-700 shrink-0" />
                        <span className="truncate">
                          Admin · {authenticatedAdmin.name}
                        </span>
                      </>
                    ) : (
                      <>
                        <GraduationCap className="w-3 h-3 text-neutral-500 shrink-0" />
                        <span>Student Mode · Read-Only Queries & Navigation</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {!isTextOnlyMode && (
                  <button
                    type="button"
                    onClick={toggleMute}
                    className={`p-1.5 rounded-lg border text-xs transition-colors ${
                      isMuted
                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                        : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                    }`}
                    title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                    aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                  >
                    {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeOverlay}
                  className="p-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100 text-neutral-500 hover:text-neutral-900 transition-colors"
                  title="Close assistant"
                  aria-label="Close assistant"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Audio-Reactive Acoustic Waveform OR Calm Text-Only Mode Strip */}
            {isTextOnlyMode ? (
              <div className="px-4 py-2 bg-neutral-50/75 border-b border-neutral-200/70 flex items-center justify-between gap-2 text-[11px] text-neutral-600">
                <span className="flex items-center gap-1.5 min-w-0 truncate">
                  <MicOff className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  <span className="truncate">Microphone unavailable — text commands active</span>
                </span>
                <button
                  type="button"
                  onClick={() => void enableWakeStandby()}
                  className="px-2 py-1 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100 text-neutral-700 text-[10px] font-semibold shrink-0 transition-colors"
                >
                  Retry Mic
                </button>
              </div>
            ) : (
              <div className="px-4 py-2.5 bg-neutral-50/75 border-b border-neutral-200/70 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <VoiceWaveformCanvas
                    amplitudeRef={amplitudeRef}
                    phase={phase}
                    isMuted={isMuted}
                  />
                </div>
                {phase === 'speaking' && (
                  <button
                    type="button"
                    onClick={interruptSpeaking}
                    className="px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-800 text-[11px] font-semibold flex items-center gap-1.5 shrink-0 transition-colors"
                    title="Stop speaking and listen"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    Stop
                  </button>
                )}
              </div>
            )}

            {/* Confirmation Banner for Consequential Actions */}
            {pendingConfirmation && (
              <div className="mx-3.5 mt-3 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-950 space-y-2">
                <div className="font-bold">Confirm Action</div>
                <div className="text-amber-900">{pendingConfirmation.summary}</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => confirmPendingAction(true)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[10px] font-bold transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => confirmPendingAction(false)}
                    className="px-2.5 py-1 rounded-lg border border-amber-300 bg-white hover:bg-amber-100 text-amber-900 text-[10px] font-bold transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Error Notice */}
            {lastError && (
              <div className="mx-3.5 mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] text-rose-900 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1.5">
                  <div>{lastError}</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void retrySession()}
                      className="px-2.5 py-1 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-[10px] font-bold flex items-center gap-1 transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Retry Live Voice
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Action & Execution Notices (auto-dismiss after timeout) */}
            {actionNotices.length > 0 && (
              <div className="px-3.5 pt-2.5 space-y-1.5">
                <AnimatePresence initial={false}>
                  {actionNotices.slice(0, 2).map((notice) => (
                    <motion.div
                      key={notice.id}
                      layout
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.97 }}
                      transition={{ duration: 0.18, ease: ROOMWISE_EASE }}
                      className={`px-2.5 py-2 rounded-xl border text-[11px] flex items-center justify-between gap-2 ${
                        notice.kind === 'appliance'
                          ? 'bg-emerald-50/90 border-emerald-200 text-emerald-950'
                          : notice.kind === 'auth_required'
                          ? 'bg-amber-50/90 border-amber-200 text-amber-950'
                          : notice.kind === 'error'
                          ? 'bg-rose-50/90 border-rose-200 text-rose-950'
                          : 'bg-white border-neutral-200 text-neutral-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {notice.kind === 'appliance' ? (
                          <Sliders className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                        ) : notice.kind === 'navigation' ? (
                          <Compass className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="font-bold truncate">{notice.title}</div>
                          <div className="text-[10px] opacity-85 truncate">{notice.detail}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {notice.kind === 'auth_required' && !isAdminUnlocked && (
                          <button
                            type="button"
                            onClick={() => openAuthModal()}
                            className="px-2 py-1 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-[10px] font-bold shrink-0"
                          >
                            Login
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => dismissNotice(notice.id)}
                          className="p-0.5 rounded-md opacity-60 hover:opacity-100 hover:bg-black/5 transition-opacity"
                          aria-label="Dismiss update notice"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {/* Live Transcripts */}
            <div
              ref={transcriptContainerRef}
              className="p-3.5 max-h-52 overflow-y-auto space-y-2 text-xs"
            >
              {transcripts.length === 0 ? (
                <div className="text-[11px] text-[#64726b] py-2 text-center leading-relaxed">
                  Ask about Class X-B telemetry, Environmental &amp; Solar Intelligence, Campus Live 3D, Space Intelligence, or the Energy Intervention Ledger.
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {transcripts.slice(-6).map((entry) => (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.16, ease: ROOMWISE_EASE }}
                      className={`rounded-xl px-3 py-2 leading-relaxed ${
                        entry.speaker === 'user'
                          ? 'bg-[#f3f5f4] text-[#111815] ml-6'
                          : 'bg-[#eef3f0] border border-emerald-700/15 text-[#111815] mr-4'
                      }`}
                    >
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#64726b] mb-0.5">
                        {entry.speaker === 'user' ? 'You' : 'ROOMWISE'}
                      </div>
                      <div className="text-xs break-words" dir="auto">
                        {entry.text}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>

            {/* Prompt Input Fallback + Standby Footer */}
            <form
              onSubmit={handleTextSubmit}
              className="px-3.5 py-2.5 border-t border-neutral-200/75 bg-[#fafbfb] flex items-center gap-2"
            >
              <input
                type="text"
                value={fallbackInput}
                onChange={(e) => setFallbackInput(e.target.value)}
                autoFocus={isTextOnlyMode}
                placeholder={
                  isTextOnlyMode
                    ? 'Type a command (e.g. Open room ten b)...'
                    : 'Type a command or follow-up...'
                }
                className="flex-1 px-2.5 py-1.5 glass-input rounded-lg text-xs"
              />
              <button
                type="submit"
                disabled={!fallbackInput.trim()}
                className="p-1.5 rounded-lg rw-btn-forest disabled:opacity-40"
                aria-label="Send command"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={isTextOnlyMode ? closeOverlay : endLiveSession}
                className="px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 text-[11px] font-semibold transition-colors whitespace-nowrap"
              >
                {isTextOnlyMode ? 'Close' : isWakeWordEnabled ? 'Standby' : 'End'}
              </button>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
};
