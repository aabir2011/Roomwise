/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth, getStoredClientSessionToken } from './AuthContext';
import { useEnergy } from './EnergyContext';
import { useToast } from './ToastContext';
import { LocalWakeWordEngine, preloadWakeEngineAssets } from '../services/wakeWordEngine';
import {
  PcmLivePlayer,
  float32ToInt16,
  int16ToBase64,
  startMicCapture,
  type MicCaptureHandle,
} from '../utils/pcmAudio';
import { finalizeTranscriptText, mergeTranscriptChunk } from '../utils/voiceTranscript';
import type {
  MicPermissionState,
  VoiceActionNotice,
  VoiceAssistantPhase,
  VoiceClientNavigationAction,
  VoicePendingConfirmation,
  VoiceServerMessage,
  VoiceTranscriptEntry,
  WakeLoadStage,
} from '../types/voice';

const LS_ENABLED_KEY = 'roomwise_voice_enabled';
const LS_MUTED_KEY = 'roomwise_voice_muted';
const LS_PROMPT_DISMISSED_KEY = 'roomwise_voice_prompt_dismissed';
const CONNECT_TIMEOUT_MS = 12_000;
const MAX_PREROLL_FRAMES = 24; // ~2.8 seconds of 16kHz PCM audio

interface VoiceAssistantContextValue {
  phase: VoiceAssistantPhase;
  wakeLoadStage: WakeLoadStage;
  micPermission: MicPermissionState;
  isWakeWordEnabled: boolean;
  isMuted: boolean;
  isOverlayOpen: boolean;
  isWakeModelReady: boolean;
  isPermissionCardVisible: boolean;
  lastError: string | null;
  pendingConfirmation: VoicePendingConfirmation | null;
  transcripts: VoiceTranscriptEntry[];
  actionNotices: VoiceActionNotice[];
  amplitudeRef: React.MutableRefObject<number>;
  enableWakeStandby: () => Promise<void>;
  disableWakeStandby: () => Promise<void>;
  resumeSuspendedAudio: () => Promise<void>;
  toggleMute: () => void;
  startManualSession: () => Promise<void>;
  endLiveSession: () => void;
  interruptSpeaking: () => void;
  retrySession: () => Promise<void>;
  confirmPendingAction: (confirmed: boolean) => void;
  sendTextPrompt: (text: string) => void;
  openOverlay: () => void;
  closeOverlay: () => void;
  dismissPermissionCard: () => void;
  dismissNotice: (id: string) => void;
  clearTranscripts: () => void;
}

const VoiceAssistantContext = createContext<VoiceAssistantContextValue | undefined>(undefined);

function readBoolPref(key: string, defaultVal: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultVal;
    return raw === 'true';
  } catch {
    return defaultVal;
  }
}

function writeBoolPref(key: string, val: boolean): void {
  try {
    localStorage.setItem(key, val ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
}

export const VoiceAssistantProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const {
    isAdminUnlocked,
    authenticatedAdmin,
    openAuthModal,
    openPhoneQrModal,
    logout,
  } = useAuth();
  const {
    classrooms,
    settings,
    auditFindings,
    activeTab,
    selectedRoom,
    setActiveTab,
    goBackTab,
    setVoiceNavDirective,
    setSelectedRoomId,
    setQrModalRoom,
    applyServerRoomAppliances,
    applyCampusOptimizationSync,
    updateSettings,
    triggerRoomRecalibration,
    updateRoomManualParams,
    setSimulationRunning,
    exportAnalyticsCsv,
  } = useEnergy();
  const toast = useToast();

  const [isWakeWordEnabled, setIsWakeWordEnabled] = useState<boolean>(() =>
    readBoolPref(LS_ENABLED_KEY, false)
  );
  const [isMuted, setIsMuted] = useState<boolean>(() => readBoolPref(LS_MUTED_KEY, false));
  const [isPromptDismissed, setIsPromptDismissed] = useState<boolean>(() =>
    readBoolPref(LS_PROMPT_DISMISSED_KEY, false)
  );
  const [micPermission, setMicPermission] = useState<MicPermissionState>('unknown');
  const [phase, setPhase] = useState<VoiceAssistantPhase>('disabled');
  const [wakeLoadStage, setWakeLoadStage] = useState<WakeLoadStage>('idle');
  const [isWakeModelReady, setIsWakeModelReady] = useState<boolean>(false);
  const [isOverlayOpen, setIsOverlayOpen] = useState<boolean>(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<VoicePendingConfirmation | null>(null);
  const [transcripts, setTranscripts] = useState<VoiceTranscriptEntry[]>([]);
  const [actionNotices, setActionNotices] = useState<VoiceActionNotice[]>([]);

  const amplitudeRef = useRef<number>(0);
  const micHandleRef = useRef<MicCaptureHandle | null>(null);
  const wakeEngineRef = useRef<LocalWakeWordEngine | null>(null);
  const enableInFlightRef = useRef<Promise<void> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<PcmLivePlayer | null>(null);
  const bargeInFramesRef = useRef<number>(0);
  const lastScrollActivityAtRef = useRef<number>(0);
  const voiceGateHoldRef = useRef<number>(0);
  const silentFrameCacheRef = useRef<Map<number, string>>(new Map());
  const noticeTimersRef = useRef<Map<string, number>>(new Map());
  const resumeStandbyTimerRef = useRef<number | null>(null);
  const connectTimeoutRef = useRef<number | null>(null);
  const turnWatchdogRef = useRef<number | null>(null);
  const lastSnapshotSentAtRef = useRef<number>(0);
  const lastStructuralSnapshotKeyRef = useRef<string>('');
  const preRollFramesRef = useRef<Array<{ data: string; rms: number }>>([]);
  const httpCommandSessionIdRef = useRef<string>(
    `rw_voice_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  );
  const lastHttpClassroomsFingerprintRef = useRef<string>('');
  const standbyCooldownUntilRef = useRef<number>(0);
  const phaseRef = useRef<VoiceAssistantPhase>(phase);
  phaseRef.current = phase;
  const micPermissionRef = useRef<MicPermissionState>(micPermission);
  micPermissionRef.current = micPermission;
  const isMutedRef = useRef<boolean>(isMuted);
  isMutedRef.current = isMuted;
  const isWakeEnabledRef = useRef<boolean>(isWakeWordEnabled);
  isWakeEnabledRef.current = isWakeWordEnabled;

  const getSilentAudioB64 = useCallback((sampleLength: number): string => {
    const cached = silentFrameCacheRef.current.get(sampleLength);
    if (cached) return cached;
    const silent = int16ToBase64(new Int16Array(sampleLength));
    if (silentFrameCacheRef.current.size < 8) {
      silentFrameCacheRef.current.set(sampleLength, silent);
    }
    return silent;
  }, []);

  const clearResumeStandbyTimer = useCallback(() => {
    if (resumeStandbyTimerRef.current !== null) {
      window.clearTimeout(resumeStandbyTimerRef.current);
      resumeStandbyTimerRef.current = null;
    }
  }, []);

  const clearConnectTimeout = useCallback(() => {
    if (connectTimeoutRef.current !== null) {
      window.clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  }, []);

  const clearTurnWatchdog = useCallback(() => {
    if (turnWatchdogRef.current !== null) {
      window.clearTimeout(turnWatchdogRef.current);
      turnWatchdogRef.current = null;
    }
  }, []);

  const armTurnWatchdog = useCallback(() => {
    clearTurnWatchdog();
    turnWatchdogRef.current = window.setTimeout(() => {
      turnWatchdogRef.current = null;
      if (phaseRef.current === 'processing' || phaseRef.current === 'executing') {
        setPhase(wsRef.current?.readyState === WebSocket.OPEN ? 'listening' : 'standby');
        setActionNotices((prev) => [
          {
            id: `${Date.now()}-watchdog`,
            kind: 'info',
            title: 'Voice Turn Recovered',
            detail: 'Assistant returned to listening after a delayed response.',
            timestamp: Date.now(),
          },
          ...prev.slice(0, 4),
        ]);
      }
    }, 30_000);
  }, [clearTurnWatchdog]);

  // Keep fresh state snapshot ref for WebSocket context syncing
  const latestContextRef = useRef({
    activeTab,
    selectedRoomId: selectedRoom?.id ?? null,
    settings,
    classrooms,
    auditFindings,
    isAdminUnlocked,
    adminName: authenticatedAdmin?.name ?? null,
  });
  latestContextRef.current = {
    activeTab,
    selectedRoomId: selectedRoom?.id ?? null,
    settings,
    classrooms,
    auditFindings,
    isAdminUnlocked,
    adminName: authenticatedAdmin?.name ?? null,
  };

  const dismissNotice = useCallback((id: string) => {
    const timer = noticeTimersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      noticeTimersRef.current.delete(id);
    }
    setActionNotices((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushNotice = useCallback((notice: Omit<VoiceActionNotice, 'id' | 'timestamp'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const entry: VoiceActionNotice = {
      id,
      timestamp: Date.now(),
      ...notice,
    };
    const ttlMs = notice.kind === 'error' || notice.kind === 'auth_required' ? 6500 : 4200;
    const timerId = window.setTimeout(() => {
      noticeTimersRef.current.delete(id);
      setActionNotices((prev) => prev.filter((item) => item.id !== id));
    }, ttlMs);
    noticeTimersRef.current.set(id, timerId);

    setActionNotices((prev) => {
      const next = [entry, ...prev];
      if (next.length > 5) {
        for (const dropped of next.slice(5)) {
          const oldTimer = noticeTimersRef.current.get(dropped.id);
          if (oldTimer !== undefined) {
            window.clearTimeout(oldTimer);
            noticeTimersRef.current.delete(dropped.id);
          }
        }
        return next.slice(0, 5);
      }
      return next;
    });
  }, []);

  const appendOrUpdateTranscript = useCallback(
    (
      speaker: 'user' | 'assistant' | 'system',
      delta: string,
      markFinal = false,
      mode: 'append' | 'replace' = 'append'
    ) => {
      const clean = typeof delta === 'string' ? delta : '';
      if (!clean && !markFinal) return;
      setTranscripts((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.speaker === speaker && !last.final) {
          const updated = [...prev];
          let nextText = last.text;
          if (mode === 'replace') {
            nextText = clean.trimStart() || last.text;
          } else if (clean) {
            nextText = mergeTranscriptChunk(last.text, clean);
          }
          if (markFinal) {
            nextText = finalizeTranscriptText(nextText);
          }
          updated[updated.length - 1] = {
            ...last,
            text: nextText,
            final: markFinal || last.final,
            timestamp: Date.now(),
          };
          return updated.slice(-14);
        }

        // Starting a new bubble for a different speaker: finalize any previous open bubble cleanly
        const normalizedPrev = prev.map((entry) =>
          entry.final
            ? entry
            : { ...entry, text: finalizeTranscriptText(entry.text), final: true }
        );

        const initialText = markFinal
          ? finalizeTranscriptText(clean)
          : mergeTranscriptChunk('', clean);
        if (!initialText) return normalizedPrev;
        return [
          ...normalizedPrev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            speaker,
            text: initialText,
            timestamp: Date.now(),
            final: markFinal,
          },
        ].slice(-14);
      });
    },
    []
  );

  const sendContextSnapshotToWs = useCallback((ws: WebSocket | null) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const snap = latestContextRef.current;
    lastSnapshotSentAtRef.current = Date.now();
    lastStructuralSnapshotKeyRef.current = `${snap.activeTab}|${snap.selectedRoomId || ''}|${snap.settings.tariffPerKWhINR}|${snap.settings.learningMode}|${snap.auditFindings.length}`;
    ws.send(
      JSON.stringify({
        type: 'context_snapshot',
        snapshot: {
          activeTab: snap.activeTab,
          selectedRoomId: snap.selectedRoomId,
          settings: snap.settings,
          classrooms: snap.classrooms,
          auditFindings: snap.auditFindings,
          resolvedFindingIds: snap.auditFindings.filter((f) => f.isResolved).map((f) => f.id),
        },
      })
    );
  }, []);

  // Push fresh campus context immediately on structural view/settings changes,
  // and throttle routine live IoT simulation drift ticks to at most once every 8s
  // to avoid serializing ~45 KB payloads over the Live WebSocket every tick.
  useEffect(() => {
    const ws = wsRef.current;
    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN ||
      !(phase === 'listening' || phase === 'processing' || phase === 'executing' || phase === 'speaking')
    ) {
      return;
    }
    const structuralKey = `${activeTab}|${selectedRoom?.id || ''}|${settings.tariffPerKWhINR}|${settings.learningMode}|${auditFindings.length}`;
    const isStructuralChange = structuralKey !== lastStructuralSnapshotKeyRef.current;
    const elapsed = Date.now() - lastSnapshotSentAtRef.current;
    if (isStructuralChange || elapsed >= 8000) {
      sendContextSnapshotToWs(ws);
    }
  }, [activeTab, selectedRoom?.id, classrooms, settings, auditFindings, phase, sendContextSnapshotToWs]);

  const prevAuthKeyRef = useRef<string>(`${isAdminUnlocked ? 'admin' : 'student'}:${authenticatedAdmin?.id || ''}`);

  // Re-establish an open Live session seamlessly when admin auth changes so Gemini Live
  // immediately restarts with the verified Administrator systemInstruction and zero stale Student-Mode refusals
  useEffect(() => {
    const nextAuthKey = `${isAdminUnlocked ? 'admin' : 'student'}:${authenticatedAdmin?.id || ''}`;
    if (prevAuthKeyRef.current === nextAuthKey) return;
    prevAuthKeyRef.current = nextAuthKey;

    const ws = wsRef.current;
    if (ws && ws.readyState <= WebSocket.OPEN) {
      const token = getStoredClientSessionToken() || '';
      try {
        ws.send(JSON.stringify({ type: 'auth_token', token }));
      } catch {
        // ignore
      }

      wsRef.current = null;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'end_session' }));
        }
        ws.close();
      } catch {
        // ignore
      }
      playerRef.current?.stopAll();

      pushNotice({
        kind: isAdminUnlocked ? 'info' : 'auth_required',
        title: isAdminUnlocked
          ? `Admin Unlocked (${authenticatedAdmin?.name || 'Verified'})`
          : 'Returned to Student Mode',
        detail: isAdminUnlocked
          ? 'Voice assistant refreshed with full administrator controls.'
          : 'Appliance controls locked cleanly.',
      });

      void openLiveSessionRef.current('auth_refresh');
    }
  }, [isAdminUnlocked, authenticatedAdmin?.id, authenticatedAdmin?.name, pushNotice]);

  const handleClientNavigation = useCallback(
    (action: VoiceClientNavigationAction) => {
      if (action.target === 'go-back') {
        setSelectedRoomId(null);
        setQrModalRoom(null);
        const prev = goBackTab();
        pushNotice({
          kind: 'navigation',
          title: `Returned to ${prev.replace(/-/g, ' ')}`,
          detail: 'Restored previous ROOMWISE section.',
        });
        return;
      }

      if (action.target === 'admin-login') {
        openAuthModal();
        pushNotice({
          kind: 'auth_required',
          title: 'Opened Admin Login',
          detail: 'Sign in with Passkey, QR Access Card, or Password.',
        });
        return;
      }

      if (action.target === 'classroom' && action.roomId) {
        const room = latestContextRef.current.classrooms.find((c) => c.id === action.roomId);
        if (room) {
          if (action.openQrPlacard) {
            setSelectedRoomId(null);
            setQrModalRoom(room);
            pushNotice({
              kind: 'navigation',
              title: `Opened ${room.roomCode} QR Placard`,
              detail: room.name,
            });
          } else {
            setQrModalRoom(null);
            setSelectedRoomId(room.id);
            pushNotice({
              kind: 'navigation',
              title: `Opened ${room.roomCode}`,
              detail: `${room.name} telemetry & controls`,
            });
          }
        }
        return;
      }

      setSelectedRoomId(null);
      setQrModalRoom(null);

      const resolvedTab =
        action.target === 'environmental' || action.target === 'solar'
          ? 'environmental-solar'
          : action.target;
      setActiveTab(resolvedTab);

      if (action.subTab || action.historyFilters || action.solarScenario || action.campusLivePreset) {
        setVoiceNavDirective({
          id: `vnav_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          target: resolvedTab as VoiceClientNavigationAction['target'],
          subTab: action.subTab,
          historyFilters: action.historyFilters,
          solarScenario: action.solarScenario,
          campusLivePreset: action.campusLivePreset,
          timestamp: Date.now(),
        });
      }

      pushNotice({
        kind: 'navigation',
        title: action.subTab
          ? `Opened ${resolvedTab.replace(/-/g, ' ')} · ${action.subTab}`
          : `Navigated to ${resolvedTab.replace(/-/g, ' ')}`,
        detail: 'Updated active ROOMWISE workspace view.',
      });
    },
    [goBackTab, openAuthModal, pushNotice, setActiveTab, setQrModalRoom, setSelectedRoomId, setVoiceNavDirective]
  );

  const ensurePlayer = useCallback(() => {
    if (!playerRef.current) {
      playerRef.current = new PcmLivePlayer((speaking) => {
        if (
          phaseRef.current === 'listening' ||
          phaseRef.current === 'processing' ||
          phaseRef.current === 'executing' ||
          phaseRef.current === 'speaking'
        ) {
          setPhase(speaking ? 'speaking' : 'listening');
        }
      });
    }
    return playerRef.current;
  }, []);

  const stopLiveWebSocketOnly = useCallback(
    (restoreStandby = true) => {
      clearResumeStandbyTimer();
      clearConnectTimeout();
      clearTurnWatchdog();
      preRollFramesRef.current = [];
      setPendingConfirmation(null);

      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'end_session' }));
          }
          ws.close();
        } catch {
          // ignore
        }
      }

      playerRef.current?.stopAll();
      bargeInFramesRef.current = 0;

      // Always pause and flush/recreate the local KaldiRecognizer so buffered tokens
      // or trailing speaker audio cannot trigger a false wake-word detection after close
      if (wakeEngineRef.current) {
        wakeEngineRef.current.setPaused(true);
        wakeEngineRef.current.resetRecognizer();
      }

      if (restoreStandby) {
        if (isWakeEnabledRef.current && wakeEngineRef.current?.isReady() && micHandleRef.current) {
          const ctxRunning = micHandleRef.current.getContextState() === 'running';
          if (!ctxRunning) {
            setPhase('audio_suspended');
          } else {
            standbyCooldownUntilRef.current = Date.now() + 1400;
            setPhase('returning_idle');

            resumeStandbyTimerRef.current = window.setTimeout(() => {
              resumeStandbyTimerRef.current = null;
              if (!wsRef.current && wakeEngineRef.current) {
                const paused = isMutedRef.current || document.visibilityState === 'hidden';
                wakeEngineRef.current.setPaused(paused);
                setPhase(isMutedRef.current ? 'muted' : 'standby');
              }
            }, 1400);
          }
        } else if (isWakeEnabledRef.current && !micHandleRef.current) {
          setPhase('disabled');
        } else {
          setPhase(isWakeEnabledRef.current ? 'muted' : 'disabled');
        }
      }
    },
    [clearConnectTimeout, clearResumeStandbyTimer, clearTurnWatchdog]
  );

  // Clean up Mic + Wake Engine completely
  const teardownAudioAndWake = useCallback(async () => {
    clearResumeStandbyTimer();
    clearConnectTimeout();
    clearTurnWatchdog();
    stopLiveWebSocketOnly(false);
    if (micHandleRef.current) {
      await micHandleRef.current.stop().catch(() => undefined);
      micHandleRef.current = null;
    }
    if (wakeEngineRef.current) {
      wakeEngineRef.current.dispose();
      wakeEngineRef.current = null;
    }
    setIsWakeModelReady(false);
    setWakeLoadStage('idle');
    amplitudeRef.current = 0;
  }, [clearConnectTimeout, clearResumeStandbyTimer, clearTurnWatchdog, stopLiveWebSocketOnly]);

  // Ref for openLiveSession so wake callback always accesses the latest closure cleanly
  const openLiveSessionRef = useRef<(reason: 'wake' | 'manual' | 'auth_refresh') => Promise<void>>(async () => {});

  const ensureMicPipelineRunning = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicPermission('unsupported');
      setLastError('Microphone audio capture is not supported in this browser.');
      return false;
    }

    if (micHandleRef.current) {
      if (micHandleRef.current.getContextState() === 'suspended') {
        await micHandleRef.current.resumeContext();
      }
      return true;
    }

    try {
      const { handle } = await startMicCapture({
        onTrackEnded: () => {
          micHandleRef.current = null;
          wakeEngineRef.current?.setPaused(true);
          setLastError('Microphone input disconnected. Reconnect microphone or click Retry to re-enable voice.');
          setPhase('error');
        },
        onContextStateChange: (ctxState) => {
          if (ctxState === 'suspended') {
            if (phaseRef.current === 'standby') {
              wakeEngineRef.current?.setPaused(true);
              setPhase('audio_suspended');
            }
          } else if (ctxState === 'running') {
            if (
              phaseRef.current === 'audio_suspended' &&
              isWakeEnabledRef.current &&
              wakeEngineRef.current?.isReady()
            ) {
              const paused = isMutedRef.current || document.visibilityState === 'hidden';
              wakeEngineRef.current.setPaused(paused);
              setPhase(isMutedRef.current ? 'muted' : 'standby');
            }
          }
        },
        onAudio16kFrame: (samples16k, amp) => {
          const outAmp = playerRef.current?.getOutputAmplitude() || 0;
          amplitudeRef.current = Math.max(amp, outAmp);

          if (isMutedRef.current) return;

          const activePhase = phaseRef.current;
          const ws = wsRef.current;

          // CRITICAL FIX: Buffer continuous speech spoken right after "Hey ROOMWISE"
          // during wake_detected / connecting so the opening words are NEVER dropped!
          if (activePhase === 'wake_detected' || activePhase === 'connecting') {
            const b64 = int16ToBase64(float32ToInt16(samples16k));
            preRollFramesRef.current.push({ data: b64, rms: amp });
            if (preRollFramesRef.current.length > MAX_PREROLL_FRAMES) {
              preRollFramesRef.current.shift();
            }
            return;
          }

          if (
            ws &&
            ws.readyState === WebSocket.OPEN &&
            (activePhase === 'listening' ||
              activePhase === 'processing' ||
              activePhase === 'executing' ||
              activePhase === 'speaking')
          ) {
            const player = playerRef.current;
            const isPlayingOut = Boolean(player?.isPlaying()) || activePhase === 'speaking';
            const inEchoTail =
              !isPlayingOut &&
              Boolean(player && Date.now() - player.getLastPlaybackEndedAt() < 420);
            const isRecentlyScrolling = Date.now() - lastScrollActivityAtRef.current < 800;

            // Natural conversational barge-in (0.065 RMS sustained for 3 frames)
            if (isPlayingOut && !isRecentlyScrolling && amp >= 0.065) {
              bargeInFramesRef.current += 1;
              if (bargeInFramesRef.current >= 3) {
                player?.stopAll();
                bargeInFramesRef.current = 0;
                ws.send(JSON.stringify({ type: 'interrupt' }));
              }
            } else {
              bargeInFramesRef.current = 0;
            }

            // While AI audio is genuinely playing or inside the 420ms acoustic echo tail,
            // suppress speaker bleed while allowing intentional barge-in speech through.
            let b64: string;
            let effectiveRms = amp;
            if (isPlayingOut || inEchoTail) {
              const speechGate = isRecentlyScrolling ? 0.14 : 0.065;
              if (amp >= speechGate) {
                voiceGateHoldRef.current = 4;
                b64 = int16ToBase64(float32ToInt16(samples16k));
              } else if (voiceGateHoldRef.current > 0) {
                voiceGateHoldRef.current -= 1;
                b64 = int16ToBase64(float32ToInt16(samples16k));
              } else {
                b64 = getSilentAudioB64(samples16k.length);
                effectiveRms = 0;
              }
            } else {
              voiceGateHoldRef.current = 0;
              b64 = int16ToBase64(float32ToInt16(samples16k));
            }

            ws.send(JSON.stringify({ type: 'audio_in', data: b64, rms: effectiveRms }));
            return;
          }

          // Local passive wake-word scanning ONLY (never uploaded while in standby)
          if (
            activePhase === 'standby' &&
            wakeEngineRef.current &&
            Date.now() >= standbyCooldownUntilRef.current
          ) {
            wakeEngineRef.current.processAudioFrame16k(samples16k);
          }
        },
      });

      micHandleRef.current = handle;
      setMicPermission('granted');
      return true;
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Grant access in browser settings or use manual prompts.'
          : err instanceof Error
          ? err.message
          : 'Could not access microphone.';
      setMicPermission(err instanceof Error && err.name === 'NotAllowedError' ? 'denied' : 'prompt');
      setLastError(msg);
      return false;
    }
  }, [getSilentAudioB64]);

  const dispatchServerMessage = useCallback(
    (msg: VoiceServerMessage, player?: PcmLivePlayer) => {
      switch (msg.type) {
        case 'live_ready': {
          clearConnectTimeout();
          setPhase('listening');
          // Flush any pre-roll speech captured right after "Hey ROOMWISE"
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN && preRollFramesRef.current.length > 0) {
            const buffered = preRollFramesRef.current.splice(0);
            for (const frame of buffered) {
              ws.send(JSON.stringify({ type: 'audio_in', data: frame.data, rms: frame.rms }));
            }
          }
          break;
        }
        case 'audio_out': {
          clearTurnWatchdog();
          const isRunning = player?.enqueueBase64Pcm(msg.data);
          if (isRunning) {
            setPhase('speaking');
          }
          break;
        }
        case 'input_transcript': {
          const isFinal = Boolean(msg.final ?? msg.isFinal);
          if ((typeof msg.text === 'string' && msg.text.length > 0) || isFinal) {
            appendOrUpdateTranscript('user', msg.text || '', isFinal, msg.mode || 'append');
          }
          break;
        }
        case 'output_transcript': {
          clearTurnWatchdog();
          const isFinal = Boolean(msg.final ?? msg.isFinal);
          if ((typeof msg.text === 'string' && msg.text.length > 0) || isFinal) {
            appendOrUpdateTranscript('assistant', msg.text || '', isFinal, 'append');
          }
          break;
        }
        case 'turn_complete': {
          clearTurnWatchdog();
          setTranscripts((prev) =>
            prev.map((t) =>
              t.final ? t : { ...t, text: finalizeTranscriptText(t.text), final: true }
            )
          );
          if (!player?.isPlaying() && phaseRef.current !== 'error') {
            setPhase('listening');
          }
          break;
        }
        case 'interrupted': {
          clearTurnWatchdog();
          player?.stopAll();
          setTranscripts((prev) =>
            prev.map((t) =>
              t.final ? t : { ...t, text: finalizeTranscriptText(t.text), final: true }
            )
          );
          setPhase('listening');
          break;
        }
        case 'confirmation_required': {
          setPendingConfirmation(msg.confirmation);
          if (msg.confirmation) {
            pushNotice({
              kind: 'info',
              title: 'Confirmation Required',
              detail: msg.confirmation.summary,
            });
          }
          break;
        }
        case 'tool_status': {
          if (msg.status === 'running') {
            if (!player?.isPlaying()) {
              setPhase('executing');
              armTurnWatchdog();
            }
          } else if (msg.status === 'denied') {
            pushNotice({
              kind: 'auth_required',
              title: 'Administrator Sign-In Required',
              detail: msg.message || 'Student Mode cannot execute restricted administrator controls.',
            });
          } else if (msg.status === 'error' && msg.message) {
            pushNotice({
              kind: 'error',
              title: 'Action Notice',
              detail: msg.message,
            });
          }
          break;
        }
        case 'client_navigation': {
          handleClientNavigation(msg.action);
          break;
        }
        case 'appliance_state_updated': {
          const p = msg.payload;
          applyServerRoomAppliances(p.roomId, p.appliances, p.totalPowerWatts, p.summary);
          pushNotice({
            kind: 'appliance',
            title: `${p.roomCode} Updated`,
            detail: p.summary,
          });
          toast.success('Voice command executed', p.summary);
          break;
        }
        case 'campus_optimized': {
          const p = msg.payload;
          applyCampusOptimizationSync(p.optimizedRooms, p.resolvedFindingIds, p.summary);
          pushNotice({
            kind: 'appliance',
            title: 'Campus Optimization Executed',
            detail: p.summary,
          });
          toast.success('Campus optimization executed', p.summary);
          break;
        }
        case 'settings_updated': {
          void updateSettings(msg.settings).then((res) => {
            if (res && !res.ok) {
              pushNotice({
                kind: 'error',
                title: 'Settings Update Failed',
                detail: res.error || 'Unable to save updated campus settings.',
              });
              return;
            }
            pushNotice({
              kind: 'info',
              title: 'Campus Policy Updated',
              detail: msg.summary,
            });
            toast.success('Campus settings updated', msg.summary);
          });
          break;
        }
        case 'room_recalibrated': {
          for (const roomId of msg.roomIds) {
            triggerRoomRecalibration(roomId);
          }
          pushNotice({
            kind: 'info',
            title: 'Sensor Recalibration Complete',
            detail: msg.summary,
          });
          toast.success('Recalibration completed', msg.summary);
          break;
        }
        case 'room_params_updated': {
          for (const roomId of msg.roomIds) {
            updateRoomManualParams(roomId, msg.params);
          }
          pushNotice({
            kind: 'info',
            title: 'Room Parameters Updated',
            detail: msg.summary,
          });
          toast.success('Room parameters updated', msg.summary);
          break;
        }
        case 'ui_action': {
          const act = msg.action;
          switch (act.kind) {
            case 'close_modals': {
              setSelectedRoomId(null);
              setQrModalRoom(null);
              break;
            }
            case 'open_classroom_page': {
              setSelectedRoomId(null);
              setQrModalRoom(null);
              if (act.roomCode) {
                window.history.pushState({}, '', `/classroom/${encodeURIComponent(act.roomCode)}`);
                window.dispatchEvent(new PopStateEvent('popstate'));
              }
              break;
            }
            case 'open_phone_qr_scanner': {
              openPhoneQrModal();
              break;
            }
            case 'set_simulation': {
              setSimulationRunning(act.enabled !== false);
              break;
            }
            case 'export_analytics_csv': {
              const { count } = exportAnalyticsCsv();
              toast.success('Analytics dataset exported', `${count} classroom records saved as CSV.`);
              break;
            }
            case 'print_audit_report': {
              setSelectedRoomId(null);
              setQrModalRoom(null);
              setActiveTab('reports');
              window.setTimeout(() => {
                try {
                  window.print();
                } catch {
                  // ignore print block in headless contexts
                }
              }, 400);
              break;
            }
            case 'logout_admin': {
              void logout();
              break;
            }
            case 'mute_standby': {
              const targetMuted = act.enabled !== false;
              if (isMutedRef.current !== targetMuted) {
                setIsMuted(targetMuted);
                isMutedRef.current = targetMuted;
                writeBoolPref(LS_MUTED_KEY, targetMuted);
                if (wakeEngineRef.current) {
                  const isLive =
                    phaseRef.current === 'listening' ||
                    phaseRef.current === 'processing' ||
                    phaseRef.current === 'executing' ||
                    phaseRef.current === 'speaking';
                  wakeEngineRef.current.setPaused(
                    targetMuted || isLive || document.visibilityState === 'hidden'
                  );
                }
              }
              break;
            }
            case 'close_overlay': {
              window.setTimeout(() => {
                stopLiveWebSocketOnly(true);
                setIsOverlayOpen(false);
              }, 1200);
              break;
            }
          }
          pushNotice({
            kind: 'navigation',
            title: 'Action Executed',
            detail: msg.summary,
          });
          break;
        }
        case 'idle_timeout': {
          pushNotice({
            kind: 'info',
            title: 'Returned to Standby',
            detail: msg.message,
          });
          stopLiveWebSocketOnly(true);
          setIsOverlayOpen(false);
          break;
        }
        case 'error': {
          clearConnectTimeout();
          clearTurnWatchdog();
          setLastError(msg.message);
          setPhase('error');
          pushNotice({
            kind: 'error',
            title: msg.code === 'MISSING_API_KEY' ? 'Voice Configuration Notice' : 'Voice Service Error',
            detail: msg.message,
          });
          break;
        }
      }
    },
    [
      appendOrUpdateTranscript,
      applyCampusOptimizationSync,
      applyServerRoomAppliances,
      armTurnWatchdog,
      clearConnectTimeout,
      clearTurnWatchdog,
      exportAnalyticsCsv,
      handleClientNavigation,
      logout,
      openPhoneQrModal,
      pushNotice,
      setActiveTab,
      setQrModalRoom,
      setSelectedRoomId,
      setSimulationRunning,
      stopLiveWebSocketOnly,
      toast,
      triggerRoomRecalibration,
      updateRoomManualParams,
      updateSettings,
    ]
  );

  const openLiveSession = useCallback(
    async (reason: 'wake' | 'manual' | 'auth_refresh') => {
      if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
        setIsOverlayOpen(true);
        return;
      }

      clearResumeStandbyTimer();
      clearConnectTimeout();
      preRollFramesRef.current = [];
      standbyCooldownUntilRef.current = 0;
      setLastError(null);
      setPendingConfirmation(null);
      setIsOverlayOpen(true);
      setPhase(reason === 'wake' ? 'wake_detected' : 'connecting');

      if (wakeEngineRef.current) {
        wakeEngineRef.current.setPaused(true);
        wakeEngineRef.current.resetRecognizer();
      }

      const player = ensurePlayer();
      if (reason === 'wake') {
        // Immediate local wake-word chime (<15ms feedback) without blocking WebSocket handshake
        player.playWakeChime();
      } else {
        void player.resume();
      }

      // Resume mic capture IN PARALLEL with opening the Live WebSocket (eliminates 300-950ms serial startup stall)
      if (micPermissionRef.current !== 'denied' && micPermissionRef.current !== 'unsupported') {
        if (!micHandleRef.current) {
          void ensureMicPipelineRunning();
        } else if (micHandleRef.current.getContextState() === 'suspended') {
          void micHandleRef.current.resumeContext();
        }
      }

      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const token = getStoredClientSessionToken();
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      const wsUrl = `${proto}://${window.location.host}/api/voice/live${qs}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // Connection watchdog: never stay stuck indefinitely in wake_detected / connecting
      connectTimeoutRef.current = window.setTimeout(() => {
        if (
          wsRef.current === ws &&
          (phaseRef.current === 'wake_detected' || phaseRef.current === 'connecting')
        ) {
          try {
            ws.close();
          } catch {
            // ignore
          }
          wsRef.current = null;
          setLastError(
            'Live voice connection timed out. You can still type a command below or click Retry.'
          );
          setPhase('error');
        }
      }, CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        if (phaseRef.current === 'wake_detected') {
          setPhase('connecting');
        }
        sendContextSnapshotToWs(ws);
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return;
        let msg: VoiceServerMessage;
        try {
          msg = JSON.parse(String(event.data)) as VoiceServerMessage;
        } catch {
          return;
        }
        dispatchServerMessage(msg, player);
      };

      ws.onerror = () => {
        clearConnectTimeout();
        if (wsRef.current === ws) {
          setLastError(
            'Unable to reach ROOMWISE live voice socket. You can type a command below or click Retry.'
          );
          setPhase('error');
        }
      };

      ws.onclose = () => {
        clearConnectTimeout();
        if (wsRef.current === ws) {
          wsRef.current = null;
          if (phaseRef.current !== 'error') {
            stopLiveWebSocketOnly(true);
          }
        }
      };
    },
    [
      clearConnectTimeout,
      clearResumeStandbyTimer,
      dispatchServerMessage,
      ensureMicPipelineRunning,
      ensurePlayer,
      sendContextSnapshotToWs,
      stopLiveWebSocketOnly,
    ]
  );

  openLiveSessionRef.current = openLiveSession;

  const enableWakeStandby = useCallback(async () => {
    if (enableInFlightRef.current) {
      return enableInFlightRef.current;
    }

    const run = (async () => {
      setLastError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setMicPermission('unsupported');
        setLastError(null);
        setPhase('unavailable');
        setIsOverlayOpen(true);
        return;
      }

      setIsWakeWordEnabled(true);
      writeBoolPref(LS_ENABLED_KEY, true);
      writeBoolPref(LS_PROMPT_DISMISSED_KEY, true);
      setIsPromptDismissed(true);

      // CRITICAL FIX: Pre-unlock the 24kHz playback AudioContext inside this direct
      // user gesture so async wake-word triggers never deadlock on a suspended context!
      void ensurePlayer().preUnlock();

      if (!wakeEngineRef.current) {
        wakeEngineRef.current = new LocalWakeWordEngine({
          onWakeDetected: () => {
            void openLiveSessionRef.current('wake');
          },
          onStatus: (st) => {
            setIsWakeModelReady(st.modelReady);
            setWakeLoadStage(st.stage);
            if (st.error) {
              setLastError(
                `Local wake-word model unavailable (${st.error}). You can still use Ask ROOMWISE manually.`
              );
            }
          },
        });
      }

      const needsMic = !micHandleRef.current;
      const needsModelLoad = !wakeEngineRef.current.isReady();

      if (needsMic) {
        setPhase('requesting_mic');
      } else if (needsModelLoad) {
        setPhase('loading_model');
      } else {
        setPhase('starting_audio');
      }

      // Parallelize mic permission/worklet setup and offline wake model warmup
      const micPromise = ensureMicPipelineRunning().then((ok) => {
        if (ok && needsModelLoad && !wakeEngineRef.current?.isReady()) {
          setPhase('loading_model');
        }
        return ok;
      });

      const modelPromise = needsModelLoad
        ? wakeEngineRef.current.ensureLoaded().then(
            () => ({ ok: true as const }),
            (err) => ({ ok: false as const, err })
          )
        : Promise.resolve({ ok: true as const });

      const [micOk, modelOutcome] = await Promise.all([micPromise, modelPromise]);

      if (!micOk) {
        setLastError(null);
        setPhase(
          typeof navigator.mediaDevices?.getUserMedia === 'function'
            ? 'permission_required'
            : 'unavailable'
        );
        setIsOverlayOpen(true);
        return;
      }

      if (!modelOutcome.ok) {
        const msg =
          modelOutcome.err instanceof Error
            ? modelOutcome.err.message
            : 'Offline wake-word model could not be loaded. Manual voice or text commands remain available.';
        setLastError(msg);
        setPhase('error');
        setIsOverlayOpen(true);
        return;
      }

      setPhase('starting_audio');
      const ctxState = micHandleRef.current
        ? micHandleRef.current.getContextState() === 'running'
          ? 'running'
          : await micHandleRef.current.resumeContext()
        : 'suspended';

      if (ctxState !== 'running') {
        wakeEngineRef.current.setPaused(true);
        setPhase('audio_suspended');
        return;
      }

      const paused = isMutedRef.current || document.visibilityState === 'hidden';
      wakeEngineRef.current.setPaused(paused);
      setPhase(isMutedRef.current ? 'muted' : 'standby');
    })();

    enableInFlightRef.current = run;
    try {
      await run;
    } finally {
      if (enableInFlightRef.current === run) {
        enableInFlightRef.current = null;
      }
    }
  }, [ensureMicPipelineRunning, ensurePlayer]);

  const resumeSuspendedAudio = useCallback(async () => {
    void ensurePlayer().preUnlock();
    if (!micHandleRef.current) {
      await enableWakeStandby();
      return;
    }
    const nextState = await micHandleRef.current.resumeContext();
    if (nextState === 'running') {
      if (isWakeEnabledRef.current && wakeEngineRef.current?.isReady()) {
        const paused = isMutedRef.current || document.visibilityState === 'hidden';
        wakeEngineRef.current.setPaused(paused);
        setPhase(isMutedRef.current ? 'muted' : 'standby');
      }
    }
  }, [enableWakeStandby, ensurePlayer]);

  const disableWakeStandby = useCallback(async () => {
    setIsWakeWordEnabled(false);
    writeBoolPref(LS_ENABLED_KEY, false);
    setIsOverlayOpen(false);
    setLastError(null);
    await teardownAudioAndWake();
    setPhase('disabled');
  }, [teardownAudioAndWake]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      writeBoolPref(LS_MUTED_KEY, next);
      if (wakeEngineRef.current) {
        const isLive =
          phaseRef.current === 'listening' ||
          phaseRef.current === 'processing' ||
          phaseRef.current === 'executing' ||
          phaseRef.current === 'speaking';
        wakeEngineRef.current.setPaused(next || isLive || document.visibilityState === 'hidden');
      }
      if (phaseRef.current === 'standby' && next) {
        setPhase('muted');
      } else if (phaseRef.current === 'muted' && !next && wakeEngineRef.current?.isReady()) {
        setPhase('standby');
      }
      return next;
    });
  }, []);

  const startManualSession = useCallback(async () => {
    void ensurePlayer().preUnlock();
    if (isMutedRef.current) {
      setIsMuted(false);
      isMutedRef.current = false;
      writeBoolPref(LS_MUTED_KEY, false);
    }
    if (
      micPermissionRef.current === 'denied' ||
      micPermissionRef.current === 'unsupported' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setLastError(null);
      setPhase(micPermissionRef.current === 'denied' ? 'permission_required' : 'unavailable');
      setIsOverlayOpen(true);
      return;
    }
    await openLiveSession('manual');
  }, [ensurePlayer, openLiveSession]);

  const endLiveSession = useCallback(() => {
    stopLiveWebSocketOnly(true);
    setIsOverlayOpen(false);
  }, [stopLiveWebSocketOnly]);

  const interruptSpeaking = useCallback(() => {
    playerRef.current?.stopAll();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
      setPhase('listening');
    }
  }, []);

  const retrySession = useCallback(async () => {
    setLastError(null);
    stopLiveWebSocketOnly(false);
    await openLiveSession('manual');
  }, [openLiveSession, stopLiveWebSocketOnly]);

  const executeHttpFallbackCommand = useCallback(
    async (clean: string) => {
      setLastError(null);
      setPhase('executing');
      try {
        const token = getStoredClientSessionToken();
        const snap = latestContextRef.current;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;

        // Avoid re-transmitting ~45 KB of unchanged classroom state on every turn;
        // the server caches the latest per-session snapshot and merges live appliance state.
        const classroomsFingerprint = snap.classrooms
          .map(
            (c) =>
              `${c.id}:${Math.round(c.currentPowerWatts)}:${c.occupancyStatus}:${Math.round(
                c.environment.temperature
              )}`
          )
          .join('|');
        const shouldIncludeClassrooms =
          classroomsFingerprint !== lastHttpClassroomsFingerprintRef.current;

        const payload: Record<string, unknown> = {
          sessionId: httpCommandSessionIdRef.current,
          text: clean,
          activeTab: snap.activeTab,
          selectedRoomId: snap.selectedRoomId,
          settings: snap.settings,
          resolvedFindingIds: snap.auditFindings.filter((f) => f.isResolved).map((f) => f.id),
        };
        if (shouldIncludeClassrooms) {
          payload.classrooms = snap.classrooms;
        }
        const bodyJson = JSON.stringify(payload);

        let finalData: Record<string, unknown> | null = null;
        let dispatchedImmediateCount = 0;
        let receivedAnyStreamEvent = false;

        try {
          const streamRes = await fetch('/api/voice/command/stream', {
            method: 'POST',
            headers: {
              ...headers,
              Accept: 'text/event-stream',
            },
            body: bodyJson,
          });

          if (streamRes.ok && streamRes.body) {
            if (shouldIncludeClassrooms) {
              lastHttpClassroomsFingerprintRef.current = classroomsFingerprint;
            }
            const reader = streamRes.body.getReader();
            const decoder = new TextDecoder();
            let sseBuffer = '';

            const processFrame = (rawFrame: string) => {
              const lines = rawFrame.split(/\r?\n/);
              let eventName = 'message';
              const dataLines: string[] = [];
              for (const line of lines) {
                if (line.startsWith('event:')) {
                  eventName = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                  dataLines.push(line.slice(5).trimStart());
                }
              }
              if (dataLines.length === 0) return;
              let parsed: unknown;
              try {
                parsed = JSON.parse(dataLines.join('\n'));
              } catch {
                return;
              }
              receivedAnyStreamEvent = true;

              if (eventName === 'client_message' && parsed && typeof parsed === 'object') {
                dispatchedImmediateCount += 1;
                dispatchServerMessage(parsed as VoiceServerMessage, playerRef.current || undefined);
              } else if (eventName === 'text_delta' && parsed && typeof parsed === 'object') {
                const delta = (parsed as { delta?: unknown }).delta;
                if (typeof delta === 'string' && delta.length > 0) {
                  appendOrUpdateTranscript('assistant', delta, false, 'append');
                }
              } else if (eventName === 'tool_status') {
                setPhase('executing');
              } else if (eventName === 'done' && parsed && typeof parsed === 'object') {
                finalData = parsed as Record<string, unknown>;
              } else if (eventName === 'error' && parsed && typeof parsed === 'object') {
                finalData = parsed as Record<string, unknown>;
              }
            };

            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              sseBuffer += decoder.decode(value, { stream: true });
              const frames = sseBuffer.split(/\r?\n\r?\n/);
              sseBuffer = frames.pop() || '';
              for (const frame of frames) {
                if (frame.trim()) processFrame(frame);
              }
            }
            sseBuffer += decoder.decode();
            if (sseBuffer.trim()) {
              processFrame(sseBuffer);
            }
          }
        } catch {
          // If SSE failed before any streamed event arrived, cleanly fall back to JSON endpoint
          if (receivedAnyStreamEvent) {
            throw new Error('Voice response stream was interrupted. Please try again.');
          }
        }

        if (!finalData) {
          const res = await fetch('/api/voice/command', {
            method: 'POST',
            headers,
            body: bodyJson,
          });
          if (res.ok && shouldIncludeClassrooms) {
            lastHttpClassroomsFingerprintRef.current = classroomsFingerprint;
          }
          finalData = (await res.json()) as Record<string, unknown>;
        }

        if (dispatchedImmediateCount === 0 && Array.isArray(finalData?.emittedMessages)) {
          for (const msg of finalData.emittedMessages as VoiceServerMessage[]) {
            dispatchServerMessage(msg, playerRef.current || undefined);
          }
        }
        const reply =
          typeof finalData?.visualReply === 'string' && finalData.visualReply.trim()
            ? finalData.visualReply
            : typeof finalData?.error === 'string'
            ? finalData.error
            : 'Unable to process your request right now. Please try again.';
        appendOrUpdateTranscript('assistant', reply, true, 'replace');

        const isLlmUnavailable =
          finalData?.errorCode === 'GEMINI_UNAVAILABLE' || finalData?.errorCode === 'MISSING_API_KEY';
        if (isLlmUnavailable) {
          setLastError(reply);
          pushNotice({
            kind: 'error',
            title:
              finalData?.errorCode === 'MISSING_API_KEY'
                ? 'AI Service Not Configured'
                : 'AI Service Temporarily Unavailable',
            detail: reply,
          });
        }

        setPhase(
          wsRef.current?.readyState === WebSocket.OPEN
            ? 'listening'
            : micPermissionRef.current === 'denied'
            ? 'permission_required'
            : micPermissionRef.current === 'unsupported'
            ? 'unavailable'
            : isWakeEnabledRef.current
            ? 'standby'
            : 'disabled'
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to reach the ROOMWISE assistant service.';
        setLastError(msg);
        appendOrUpdateTranscript('assistant', msg, true, 'replace');
        setPhase('error');
      }
    },
    [appendOrUpdateTranscript, dispatchServerMessage, pushNotice]
  );

  const confirmPendingAction = useCallback(
    (confirmed: boolean) => {
      setPendingConfirmation(null);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'confirm_action', confirmed }));
        setPhase('executing');
        return;
      }
      void executeHttpFallbackCommand(confirmed ? 'yes, confirm' : 'cancel');
    },
    [executeHttpFallbackCommand]
  );

  const sendTextPrompt = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      appendOrUpdateTranscript('user', clean, true);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'text_turn', text: clean }));
        setPhase('processing');
      } else {
        void executeHttpFallbackCommand(clean);
      }
    },
    [appendOrUpdateTranscript, executeHttpFallbackCommand]
  );

  const openOverlay = useCallback(() => setIsOverlayOpen(true), []);
  const closeOverlay = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
      endLiveSession();
    } else {
      setIsOverlayOpen(false);
    }
  }, [endLiveSession]);

  const dismissPermissionCard = useCallback(() => {
    setIsPromptDismissed(true);
    writeBoolPref(LS_PROMPT_DISMISSED_KEY, true);
  }, []);

  const clearTranscripts = useCallback(() => {
    for (const timerId of noticeTimersRef.current.values()) {
      window.clearTimeout(timerId);
    }
    noticeTimersRef.current.clear();
    setTranscripts([]);
    setActionNotices([]);
  }, []);

  // Track user scroll/wheel/touch gestures so scrolling never trips barge-in playback interruption
  useEffect(() => {
    const markScrollActivity = () => {
      lastScrollActivityAtRef.current = Date.now();
    };
    window.addEventListener('scroll', markScrollActivity, { passive: true, capture: true });
    window.addEventListener('wheel', markScrollActivity, { passive: true, capture: true });
    window.addEventListener('touchmove', markScrollActivity, { passive: true, capture: true });
    return () => {
      window.removeEventListener('scroll', markScrollActivity, { capture: true });
      window.removeEventListener('wheel', markScrollActivity, { capture: true });
      window.removeEventListener('touchmove', markScrollActivity, { capture: true });
    };
  }, []);

  // Inspect initial browser microphone permission state, preload wake assets, & auto-resume fast
  useEffect(() => {
    let cancelled = false;
    let idleTimerId: number | null = null;
    let permissionStatusRef: PermissionStatus | null = null;
    const savedEnabled = readBoolPref(LS_ENABLED_KEY, false);

    // Pre-warm worker script (and model on fast unmetered connections when wake-word is enabled)
    idleTimerId = window.setTimeout(() => {
      if (!cancelled) {
        preloadWakeEngineAssets(savedEnabled);
      }
    }, 600);

    const initPermissionStatus = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMicPermission('unsupported');
        return;
      }
      if (navigator.permissions?.query) {
        try {
          const status = await navigator.permissions.query({
            name: 'microphone' as PermissionName,
          });
          if (cancelled) return;
          permissionStatusRef = status;
          setMicPermission(status.state as MicPermissionState);
          status.onchange = () => {
            if (!cancelled) {
              setMicPermission(status.state as MicPermissionState);
            }
          };

          if (status.state === 'granted' && savedEnabled) {
            void enableWakeStandby();
          }
          return;
        } catch {
          // Permissions API not available for microphone in Safari/Firefox
        }
      }
      setMicPermission('prompt');
    };

    void initPermissionStatus();

    return () => {
      cancelled = true;
      if (permissionStatusRef) {
        permissionStatusRef.onchange = null;
        permissionStatusRef = null;
      }
      if (idleTimerId !== null) {
        window.clearTimeout(idleTimerId);
      }
    };
  }, [enableWakeStandby]);

  // Auto-resume suspended AudioContext cleanly on the very next user gesture
  useEffect(() => {
    if (phase !== 'audio_suspended') return;
    const handleGesture = () => {
      void resumeSuspendedAudio();
    };
    window.addEventListener('pointerdown', handleGesture, { passive: true, once: true });
    window.addEventListener('keydown', handleGesture, { passive: true, once: true });
    return () => {
      window.removeEventListener('pointerdown', handleGesture);
      window.removeEventListener('keydown', handleGesture);
    };
  }, [phase, resumeSuspendedAudio]);

  // Pause wake detector automatically when browser tab is backgrounded or any live turn is active
  useEffect(() => {
    const handleVisibility = () => {
      if (!wakeEngineRef.current) return;
      const hidden = document.visibilityState === 'hidden';
      const isLive =
        phaseRef.current === 'wake_detected' ||
        phaseRef.current === 'connecting' ||
        phaseRef.current === 'listening' ||
        phaseRef.current === 'processing' ||
        phaseRef.current === 'executing' ||
        phaseRef.current === 'speaking';
      wakeEngineRef.current.setPaused(hidden || isMutedRef.current || isLive);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Release all audio handles and notice timers cleanly on unmount
  useEffect(() => {
    const timers = noticeTimersRef.current;
    return () => {
      for (const timerId of timers.values()) {
        window.clearTimeout(timerId);
      }
      timers.clear();
      void teardownAudioAndWake();
      void playerRef.current?.dispose();
    };
  }, [teardownAudioAndWake]);

  const isPermissionCardVisible = useMemo(() => {
    if (isPromptDismissed) return false;
    if (isWakeWordEnabled && micPermission === 'granted') return false;
    if (micPermission === 'unsupported') return false;
    return micPermission === 'prompt' || micPermission === 'unknown';
  }, [isPromptDismissed, isWakeWordEnabled, micPermission]);

  const value = useMemo<VoiceAssistantContextValue>(
    () => ({
      phase,
      wakeLoadStage,
      micPermission,
      isWakeWordEnabled,
      isMuted,
      isOverlayOpen,
      isWakeModelReady,
      isPermissionCardVisible,
      lastError,
      pendingConfirmation,
      transcripts,
      actionNotices,
      amplitudeRef,
      enableWakeStandby,
      disableWakeStandby,
      resumeSuspendedAudio,
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
      clearTranscripts,
    }),
    [
      phase,
      wakeLoadStage,
      micPermission,
      isWakeWordEnabled,
      isMuted,
      isOverlayOpen,
      isWakeModelReady,
      isPermissionCardVisible,
      lastError,
      pendingConfirmation,
      transcripts,
      actionNotices,
      enableWakeStandby,
      disableWakeStandby,
      resumeSuspendedAudio,
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
      clearTranscripts,
    ]
  );

  return <VoiceAssistantContext.Provider value={value}>{children}</VoiceAssistantContext.Provider>;
};

export function useVoiceAssistant(): VoiceAssistantContextValue {
  const ctx = useContext(VoiceAssistantContext);
  if (!ctx) {
    throw new Error('useVoiceAssistant must be used within a VoiceAssistantProvider');
  }
  return ctx;
}
