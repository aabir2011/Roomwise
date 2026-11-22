/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Appliance, Classroom, SchoolSettings } from './energy';

export type VoiceAssistantPhase =
  | 'disabled'
  | 'permission_required'
  | 'requesting_mic'
  | 'loading_model'
  | 'starting_audio'
  | 'audio_suspended'
  | 'muted'
  | 'standby'
  | 'wake_detected'
  | 'connecting'
  | 'listening'
  | 'processing'
  | 'executing'
  | 'speaking'
  | 'returning_idle'
  | 'error'
  | 'unavailable';

export type MicPermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported';

export type WakeLoadStage =
  | 'idle'
  | 'downloading'
  | 'extracting'
  | 'initializing'
  | 'creating_recognizer'
  | 'ready'
  | 'error';

export type WakeEngineStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'paused'
  | 'error'
  | 'unsupported';

export interface VoiceTranscriptEntry {
  id: string;
  speaker: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
  final: boolean;
}

export interface VoiceActionNotice {
  id: string;
  kind: 'navigation' | 'appliance' | 'auth_required' | 'info' | 'error';
  title: string;
  detail?: string;
  timestamp: number;
}

export interface VoiceSnapshotPayload {
  activeTab: string;
  activeSubTab?: string | null;
  selectedRoomId: string | null;
  isAdmin: boolean;
  adminName?: string;
  adminRole?: string;
  settings: SchoolSettings;
  classrooms: Classroom[];
  resolvedFindingIds: string[];
  timestamp: number;
}

export type VoiceNavigationTarget =
  | 'dashboard'
  | 'digital-twin'
  | 'campus-live'
  | 'classrooms'
  | 'environmental-solar'
  | 'environmental'
  | 'solar'
  | 'analytics'
  | 'history'
  | 'space-intelligence'
  | 'audit'
  | 'reports'
  | 'settings'
  | 'admin-login'
  | 'classroom'
  | 'go-back';

export type VoiceHistorySubTab = 'consumption' | 'interventions';
export type VoiceEnvironmentalSolarSubTab =
  | 'environmental'
  | 'mapping'
  | 'solar-potential'
  | 'comparison'
  | 'assumptions';

export interface VoiceHistoryFilterDirective {
  preset?: 'today' | 'yesterday' | 'last_7_days' | 'last_30_days' | 'this_month' | 'previous_month';
  verificationStatus?: 'all' | 'meter_verified' | 'estimated';
  building?: string;
  roomId?: string;
  triggerSource?: string;
  circuitType?: string;
}

export interface VoiceClientNavigationAction {
  target: VoiceNavigationTarget;
  roomId?: string;
  roomCode?: string;
  openQrPlacard?: boolean;
  subTab?: VoiceHistorySubTab | VoiceEnvironmentalSolarSubTab;
  historyFilters?: VoiceHistoryFilterDirective;
  solarScenario?: 'conservative' | 'moderate' | 'high_theoretical';
  campusLivePreset?: 'live' | 'today' | 'yesterday' | 'last_7_days';
}

export interface VoiceNavDirective {
  id: string;
  target: VoiceNavigationTarget;
  subTab?: VoiceHistorySubTab | VoiceEnvironmentalSolarSubTab;
  historyFilters?: VoiceHistoryFilterDirective;
  solarScenario?: 'conservative' | 'moderate' | 'high_theoretical';
  campusLivePreset?: 'live' | 'today' | 'yesterday' | 'last_7_days';
  timestamp: number;
}

export interface VoicePendingConfirmation {
  id: string;
  toolName: string;
  summary: string;
  expiresAt: number;
}

export interface VoiceApplianceSyncPayload {
  roomId: string;
  roomCode: string;
  appliances: Appliance[];
  totalPowerWatts: number;
  summary: string;
}

export interface VoiceCampusOptimizedPayload {
  optimizedRooms: Array<{
    roomId: string;
    roomCode: string;
    appliances: Appliance[];
    totalPowerWatts: number;
  }>;
  resolvedFindingIds: string[];
  curtailedWatts: number;
  summary: string;
}

export interface VoiceUiActionPayload {
  kind:
    | 'close_modals'
    | 'open_classroom_page'
    | 'open_phone_qr_scanner'
    | 'set_simulation'
    | 'export_analytics_csv'
    | 'print_audit_report'
    | 'logout_admin'
    | 'mute_standby'
    | 'close_overlay';
  roomCode?: string;
  enabled?: boolean;
}

export type VoiceClientToServerMessage =
  | {
      type: 'auth_token';
      token: string | null;
    }
  | {
      type: 'context_snapshot';
      snapshot: VoiceSnapshotPayload;
    }
  | {
      type: 'audio_in';
      data: string; // Base64 PCM16 16kHz mono
      rms?: number;
    }
  | {
      type: 'text_turn';
      text: string;
    }
  | {
      type: 'confirm_action';
      confirmed: boolean;
    }
  | {
      type: 'wake_greeting';
    }
  | {
      type: 'interrupt';
    }
  | {
      type: 'end_session';
    };

export type VoiceServerToClientMessage =
  | {
      type: 'live_ready';
      model: string;
      role: 'admin' | 'student';
      staffName?: string;
      capabilitiesCount?: number;
    }
  | {
      type: 'audio_out';
      data: string; // Base64 PCM16 24kHz mono
      mimeType?: string;
    }
  | {
      type: 'input_transcript';
      text: string;
      final?: boolean;
      isFinal?: boolean;
      mode?: 'append' | 'replace';
    }
  | {
      type: 'output_transcript';
      text: string;
      final?: boolean;
      isFinal?: boolean;
    }
  | {
      type: 'tool_status';
      toolName: string;
      status: 'running' | 'completed' | 'denied' | 'error';
      message?: string;
    }
  | {
      type: 'confirmation_required';
      confirmation: VoicePendingConfirmation | null;
    }
  | {
      type: 'client_navigation';
      action: VoiceClientNavigationAction;
    }
  | {
      type: 'appliance_state_updated';
      payload: VoiceApplianceSyncPayload;
    }
  | {
      type: 'campus_optimized';
      payload: VoiceCampusOptimizedPayload;
    }
  | {
      type: 'settings_updated';
      settings: Partial<SchoolSettings>;
      summary: string;
    }
  | {
      type: 'room_params_updated';
      roomIds: string[];
      params: Partial<{
        targetLux: number;
        maxFanSpeed: number;
        autoEcoMode: boolean;
        overtimeAllowed: boolean;
      }>;
      summary: string;
    }
  | {
      type: 'room_recalibrated';
      roomIds: string[];
      summary: string;
    }
  | {
      type: 'ui_action';
      action: VoiceUiActionPayload;
      summary: string;
    }
  | {
      type: 'turn_complete';
    }
  | {
      type: 'interrupted';
    }
  | {
      type: 'idle_timeout';
      message: string;
    }
  | {
      type: 'error';
      code: string;
      message: string;
    };

export type VoiceClientMessage = VoiceClientToServerMessage;
export type VoiceServerMessage = VoiceServerToClientMessage;
