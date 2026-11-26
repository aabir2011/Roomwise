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
import { Tooltip } from '../common/MotionPrimitives';
import { ActionButton, IconButton } from '../common/DesignSystem';
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
            className="fixed top-16 sm:top-[4.25rem] right-3 sm:right-6 z-40 w-[calc(100vw-1.5rem)] max-w-sm rounded-xl bg-white border border-[#111916]/15 overflow-hidden shadow-lg"
            role="region"
            aria-label="Enable Hey ROOMWISE Voice Assistant"
          >
            <div className="px-4 py-3 rw-obsidian-panel border-none rounded-none shadow-none text-white flex items-start justify-between gap-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 text-[#34d399] flex items-center justify-center shrink-0">
                  <Mic className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-display text-xs font-bold text-white">
                    Enable &ldquo;Hey ROOMWISE&rdquo;
                  </div>
                  <div className="text-[11px] text-white/65">
                    Hands-free campus energy intelligence
                  </div>
                </div>
              </div>
              <IconButton
                variant="dark-ghost"
                size="xs"
                label="Dismiss voice prompt"
                onClick={dismissPermissionCard}
                className="!bg-transparent !border-transparent hover:!bg-white/10"
              >
                <X className="w-3.5 h-3.5" />
              </IconButton>
            </div>

            <div className="p-4">
              <p className="text-[11px] text-[#47534d] leading-relaxed">
                Wake-word detection runs locally inside your browser. Ambient microphone audio is never transmitted until{' '}
                <strong className="text-[#111916]">&ldquo;Hey ROOMWISE&rdquo;</strong> triggers an active voice session.
              </p>

              <div className="mt-3 flex items-center gap-2">
                <ActionButton
                  variant="primary"
                  size="md"
                  onClick={() => void enableWakeStandby()}
                  icon={<Mic className="w-3.5 h-3.5 text-[#34d399]" />}
                  className="flex-1"
                >
                  Enable Voice
                </ActionButton>
                <ActionButton
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    dismissPermissionCard();
                    openOverlay();
                  }}
                >
                  Type Command
                </ActionButton>
              </div>
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
            className="fixed top-16 sm:top-[4.25rem] right-3 sm:right-6 z-40 w-[calc(100vw-1.5rem)] max-w-[396px] rounded-xl bg-white border border-[#111916]/15 overflow-hidden shadow-xl"
          >
            {/* Obsidian-Pine Header Bar */}
            <div className="px-4 py-3 flex items-center justify-between gap-2 rw-obsidian-panel border-none rounded-none shadow-none text-white">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="relative shrink-0">
                  {!isTextOnlyMode &&
                    !isMuted &&
                    (phase === 'wake_detected' ||
                      phase === 'listening' ||
                      phase === 'speaking' ||
                      phase === 'executing') && (
                      <span
                        aria-hidden="true"
                        className="rw-voice-aura pointer-events-none absolute -inset-1 rounded-[10px] border border-[#34d399]/50"
                      />
                    )}
                  <div
                    className={`relative z-10 w-8 h-8 rounded-lg flex items-center justify-center border transition-colors ${
                      phase === 'error'
                        ? 'bg-rose-500/20 border-rose-400/30 text-rose-300'
                        : isTextOnlyMode || isMuted
                        ? 'bg-white/10 border-white/15 text-white/65'
                        : phase === 'wake_detected' ||
                          phase === 'listening' ||
                          phase === 'speaking' ||
                          phase === 'executing'
                        ? 'bg-[#0b6e4f] border-[#34d399]/45 text-white'
                        : 'bg-white/10 border-white/15 text-[#34d399]'
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
                </div>
                <div className="min-w-0">
                  <div className="font-display text-xs font-bold text-white flex items-center gap-1.5">
                    <span>ROOMWISE Voice</span>
                    <span
                      className={`text-[10px] font-mono font-medium ${
                        phase === 'error'
                          ? 'text-rose-300'
                          : isTextOnlyMode
                          ? 'text-white/60'
                          : 'text-[#34d399]'
                      }`}
                    >
                      · {getStatusLabel()}
                    </span>
                  </div>
                  <div className="text-[10px] text-white/60 flex items-center gap-1 truncate mt-0.5">
                    {isAdminUnlocked && authenticatedAdmin ? (
                      <>
                        <Shield className="w-3 h-3 text-[#34d399] shrink-0" />
                        <span className="truncate">
                          Admin · {authenticatedAdmin.name}
                        </span>
                      </>
                    ) : (
                      <>
                        <GraduationCap className="w-3 h-3 text-white/55 shrink-0" />
                        <span>Student Mode · Read-Only Queries & Navigation</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {!isTextOnlyMode && (
                  <Tooltip content={isMuted ? 'Unmute microphone' : 'Mute microphone'} side="bottom">
                    <IconButton
                      variant="dark-ghost"
                      size="xs"
                      label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                      onClick={toggleMute}
                      className={
                        isMuted
                          ? '!bg-amber-500/20 !border-amber-400/35 !text-amber-200'
                          : ''
                      }
                    >
                      {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip content="Close assistant (Esc)" side="bottom">
                  <IconButton
                    variant="dark-ghost"
                    size="xs"
                    label="Close assistant"
                    onClick={closeOverlay}
                  >
                    <X className="w-3.5 h-3.5" />
                  </IconButton>
                </Tooltip>
              </div>
            </div>

            {/* Audio-Reactive Acoustic Waveform OR Calm Text-Only Mode Strip */}
            {isTextOnlyMode ? (
              <div className="px-4 py-2 bg-[#f4f5f3] border-b border-[#111916]/10 flex items-center justify-between gap-2 text-[11px] text-[#46544e]">
                <span className="flex items-center gap-1.5 min-w-0 truncate">
                  <MicOff className="w-3.5 h-3.5 text-[#62706a] shrink-0" />
                  <span className="truncate">Microphone unavailable — text commands active</span>
                </span>
                <ActionButton
                  variant="secondary"
                  size="xs"
                  onClick={() => void enableWakeStandby()}
                >
                  Retry Mic
                </ActionButton>
              </div>
            ) : (
              <div className="px-4 py-2.5 bg-[#f4f5f3] border-b border-[#111916]/10 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <VoiceWaveformCanvas
                    amplitudeRef={amplitudeRef}
                    phase={phase}
                    isMuted={isMuted}
                  />
                </div>
                {phase === 'speaking' && (
                  <ActionButton
                    variant="secondary"
                    size="xs"
                    onClick={interruptSpeaking}
                    icon={<Square className="w-3 h-3 fill-current" />}
                    title="Stop speaking and listen"
                  >
                    Stop
                  </ActionButton>
                )}
              </div>
            )}

            {/* Confirmation Banner for Consequential Actions */}
            {pendingConfirmation && (
              <div className="mx-3.5 mt-3 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-950 space-y-2">
                <div className="font-bold">Confirm Action</div>
                <div className="text-amber-900">{pendingConfirmation.summary}</div>
                <div className="flex items-center gap-2">
                  <ActionButton
                    variant="forest"
                    size="xs"
                    onClick={() => confirmPendingAction(true)}
                  >
                    Confirm
                  </ActionButton>
                  <ActionButton
                    variant="amber"
                    size="xs"
                    onClick={() => confirmPendingAction(false)}
                  >
                    Cancel
                  </ActionButton>
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
                    <ActionButton
                      variant="danger-solid"
                      size="xs"
                      onClick={() => void retrySession()}
                      icon={<RotateCcw className="w-3 h-3" />}
                    >
                      Retry Live Voice
                    </ActionButton>
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
                          <ActionButton
                            variant="amber"
                            size="xs"
                            onClick={() => openAuthModal()}
                          >
                            Login
                          </ActionButton>
                        )}
                        <IconButton
                          variant="ghost"
                          size="xs"
                          label="Dismiss update notice"
                          onClick={() => dismissNotice(notice.id)}
                          className="!w-6 !h-6 opacity-70 hover:opacity-100"
                        >
                          <X className="w-3 h-3" />
                        </IconButton>
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
              <IconButton
                type="submit"
                variant="forest"
                size="xs"
                label="Send command"
                disabled={!fallbackInput.trim()}
              >
                <Send className="w-3.5 h-3.5" />
              </IconButton>
              <ActionButton
                variant="secondary"
                size="xs"
                onClick={isTextOnlyMode ? closeOverlay : endLiveSession}
              >
                {isTextOnlyMode ? 'Close' : isWakeWordEnabled ? 'Standby' : 'End'}
              </ActionButton>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
};
