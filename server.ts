/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import type { Appliance, Classroom, SchoolSettings } from './src/types/energy.ts';
import {
  applyApplianceState,
  clampPercent,
  computeAdaptiveTargetFanPercent,
  computeAdaptiveTargetLightPercent,
} from './src/utils/applianceUtils.ts';
import { INITIAL_CLASSROOMS, INITIAL_SCHOOL_SETTINGS } from './src/data/initialClassrooms.ts';
import { ROOM_APPLIANCE_SPECS, buildExpandedAppliancesFromSpec } from './src/data/roomApplianceSpecs.ts';
import {
  createRoomwiseVoiceCommandExecutor,
  registerVoiceLiveWebSocket,
  type BatchApplianceControlInput,
  type BatchApplianceControlOutput,
  type CampusOptimizationInput,
  type CampusOptimizationOutput,
  type SecurityAuditStaffOutput,
  type ServerApplianceCommandInput,
  type ServerApplianceCommandOutput,
  type VoiceAdminIdentity,
} from './server/voiceLiveBridge.ts';
import { energyHistoryService } from './server/energyHistoryService.ts';
import { interventionLedgerService } from './server/interventionLedgerService.ts';
import type { CreateInterventionInput } from './src/types/interventionLedger.ts';
import { spaceIntelligenceService } from './server/spaceIntelligenceService.ts';
import { environmentalService } from './server/environmentalService.ts';
import { solarService } from './server/solarService.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const CHALLENGE_TTL_MS = Math.max(1000, Number(process.env.ROOMWISE_CHALLENGE_TTL_MS) || 90 * 1000);
const WEBAUTHN_CHALLENGE_TTL_MS = 120 * 1000;
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours school day session
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RUNTIME_STATE_PATH = path.join(__dirname, '.roomwise-runtime.json');

interface StaffRecord {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  assignedBuilding: string;
  avatarInitials: string;
}

const STAFF_DIRECTORY: StaffRecord[] = [
  {
    id: 'staff-1',
    name: 'Avijit Kumar Dutta',
    role: 'Geography Faculty · Energy Auditor',
    email: 'avijit.dutta@davmodeliitkgp.org',
    phone: '+91 94340 12891',
    assignedBuilding: 'All Campus Buildings',
    avatarInitials: 'AD',
  },
  {
    id: 'staff-2',
    name: 'Mrigendra Kumar Mishra',
    role: 'Biology Faculty · Campus Supervisor',
    email: 'mrigendra.mishra@davmodeliitkgp.org',
    phone: '+91 94340 01100',
    assignedBuilding: 'Administrative Oversight',
    avatarInitials: 'MM',
  },
  {
    id: 'staff-3',
    name: 'Soubhik Chattopadhyay',
    role: 'Physics Faculty · Technical Coordinator',
    email: 'soubhik.c@davmodeliitkgp.org',
    phone: '+91 94343 77124',
    assignedBuilding: 'Computer Lab & Multipurpose Hall',
    avatarInitials: 'SC',
  },
  {
    id: 'staff-4',
    name: 'Debasis Roy',
    role: 'Technical Operations Supervisor',
    email: 'debasis.roy@davmodeliitkgp.org',
    phone: '+91 94341 55230',
    assignedBuilding: 'G+3 Block & New Building',
    avatarInitials: 'DR',
  },
  {
    id: 'staff-5',
    name: 'Sharmila Gautam',
    role: 'Political Science Faculty · Institutional Coordinator',
    email: 'sharmila.gautam@davmodeliitkgp.org',
    phone: '+91 94342 98411',
    assignedBuilding: 'New Building & Library Wing',
    avatarInitials: 'SG',
  },
];

// Server-side defaults (hashed with salted scrypt at initialization; never sent to client JS)
const SERVER_ENROLLMENT_CODE = (process.env.ROOMWISE_ENROLLMENT_CODE || 'DAV-2026').trim();
const INITIAL_STAFF_PASSWORD = (
  process.env.ROOMWISE_STAFF_INITIAL_PASSWORD ||
  process.env.ROOMWISE_ENROLLMENT_CODE ||
  'DAV-2026'
).trim();

type ChallengeStatus =
  | 'pending'
  | 'scanned'
  | 'verifying'
  | 'approved'
  | 'rejected'
  | 'consumed'
  | 'expired';

interface AuthChallenge {
  challengeId: string;
  publicNonce: string;
  shortCode: string;
  browserSessionId: string;
  browserInfo: string;
  requestedStaffId?: string;
  createdAt: number;
  expiresAt: number;
  status: ChallengeStatus;
  scannedAt?: number;
  respondedAt?: number;
  consumedAt?: number;
  approvedByAdminId?: string;
  approvedByDeviceId?: string;
  approvedByDeviceName?: string;
}

interface RegisteredDevice {
  deviceId: string;
  staffId: string;
  deviceName: string;
  registeredAt: number;
  lastSeenAt: number;
  active: boolean;
}

interface StoredPasskeyCredential {
  id: string;
  staffId: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  deviceName: string;
  rpId: string;
  createdAt: number;
  lastUsedAt?: number;
  revoked: boolean;
  revokedAt?: number;
}

interface StoredPasswordCredential {
  salt: string;
  hash: string;
  updatedAt: number;
}

interface WebAuthnChallengeRecord {
  challenge: string;
  type: 'register' | 'auth' | 'qr-approve';
  browserSessionId: string;
  staffId: string;
  rpId: string;
  expectedOrigin: string;
  deviceName?: string;
  qrChallengeId?: string;
  expiresAt: number;
}

interface AdminSession {
  browserSessionId: string;
  adminId: string;
  deviceId: string;
  deviceName: string;
  authMethod?: 'passkey' | 'password' | 'qr';
  grantedAt: number;
  expiresAt: number;
}

interface AccessAuditEvent {
  id: string;
  timestamp: number;
  type:
    | 'challenge_created'
    | 'device_registered'
    | 'challenge_scanned'
    | 'challenge_approved'
    | 'challenge_rejected'
    | 'session_granted'
    | 'session_revoked'
    | 'replay_blocked'
    | 'passkey_registered'
    | 'passkey_revoked'
    | 'password_login_failed'
    | 'appliance_command';
  summary: string;
  staffName?: string;
  deviceName?: string;
}

interface ServerRoomApplianceState {
  roomId: string;
  roomCode: string;
  isVacantDefault: boolean;
  commandSeq: number;
  updatedAt: number;
  appliances: Appliance[];
}

interface PersistedRuntimeState {
  sessionSecret: string;
  devices: RegisteredDevice[];
  adminSessions?: AdminSession[];
  passkeyCredentials?: StoredPasskeyCredential[];
  passwordCredentials?: Record<string, StoredPasswordCredential>;
  roomAppliances?: Record<string, ServerRoomApplianceState>;
  schoolSettings?: SchoolSettings;
}

function hashPasswordScrypt(password: string, saltHex?: string): { salt: string; hash: string } {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('base64url');
  return { salt, hash: derived };
}

const DUMMY_PASSWORD_RECORD = hashPasswordScrypt('roomwise-dummy-constant-time-guard');

function verifyPasswordScrypt(password: string, record: StoredPasswordCredential | undefined): boolean {
  const target = record || DUMMY_PASSWORD_RECORD;
  const candidate = crypto.scryptSync(password, target.salt, 64).toString('base64url');
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(target.hash, 'utf8');
  if (a.length !== b.length || !record) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function normalizeSchoolSettings(raw?: Partial<SchoolSettings>): SchoolSettings {
  const base = INITIAL_SCHOOL_SETTINGS;
  return {
    institutionName:
      typeof raw?.institutionName === 'string' && raw.institutionName.trim()
        ? raw.institutionName.trim()
        : base.institutionName,
    campusLocation:
      typeof raw?.campusLocation === 'string' && raw.campusLocation.trim()
        ? raw.campusLocation.trim()
        : base.campusLocation,
    campusCoordinates: {
      latitude:
        typeof raw?.campusCoordinates?.latitude === 'number' &&
        Number.isFinite(raw.campusCoordinates.latitude)
          ? Math.max(-90, Math.min(90, Number(raw.campusCoordinates.latitude.toFixed(6))))
          : base.campusCoordinates?.latitude ?? 22.3121,
      longitude:
        typeof raw?.campusCoordinates?.longitude === 'number' &&
        Number.isFinite(raw.campusCoordinates.longitude)
          ? Math.max(-180, Math.min(180, Number(raw.campusCoordinates.longitude.toFixed(6))))
          : base.campusCoordinates?.longitude ?? 87.2994,
      label:
        typeof raw?.campusCoordinates?.label === 'string' && raw.campusCoordinates.label.trim()
          ? raw.campusCoordinates.label.trim()
          : base.campusCoordinates?.label ?? 'DAV Model School, IIT Kharagpur',
      verifiedByAdmin:
        typeof raw?.campusCoordinates?.verifiedByAdmin === 'boolean'
          ? raw.campusCoordinates.verifiedByAdmin
          : Boolean(base.campusCoordinates?.verifiedByAdmin),
      verifiedAt:
        typeof raw?.campusCoordinates?.verifiedAt === 'string'
          ? raw.campusCoordinates.verifiedAt
          : base.campusCoordinates?.verifiedAt,
    },
    tariffPerKWhINR:
      typeof raw?.tariffPerKWhINR === 'number' && Number.isFinite(raw.tariffPerKWhINR)
        ? Math.max(0.5, Math.min(50, raw.tariffPerKWhINR))
        : base.tariffPerKWhINR,
    gridCarbonFactorKgCO2PerKWh:
      typeof raw?.gridCarbonFactorKgCO2PerKWh === 'number' &&
      Number.isFinite(raw.gridCarbonFactorKgCO2PerKWh)
        ? Math.max(0.1, Math.min(2.5, raw.gridCarbonFactorKgCO2PerKWh))
        : base.gridCarbonFactorKgCO2PerKWh,
    standardClassroomTargetLux:
      typeof raw?.standardClassroomTargetLux === 'number' &&
      Number.isFinite(raw.standardClassroomTargetLux)
        ? Math.max(100, Math.min(800, Math.round(raw.standardClassroomTargetLux)))
        : base.standardClassroomTargetLux,
    labTargetLux:
      typeof raw?.labTargetLux === 'number' && Number.isFinite(raw.labTargetLux)
        ? Math.max(100, Math.min(900, Math.round(raw.labTargetLux)))
        : base.labTargetLux,
    defaultInactivityGraceMinutes:
      typeof raw?.defaultInactivityGraceMinutes === 'number' &&
      Number.isFinite(raw.defaultInactivityGraceMinutes)
        ? Math.max(1, Math.min(60, Math.round(raw.defaultInactivityGraceMinutes)))
        : base.defaultInactivityGraceMinutes,
    schoolHours: {
      start:
        typeof raw?.schoolHours?.start === 'string' && raw.schoolHours.start.trim()
          ? raw.schoolHours.start.trim()
          : base.schoolHours.start,
      end:
        typeof raw?.schoolHours?.end === 'string' && raw.schoolHours.end.trim()
          ? raw.schoolHours.end.trim()
          : base.schoolHours.end,
    },
    learningMode:
      raw?.learningMode === 'Adaptive Active' ||
      raw?.learningMode === 'Conservative' ||
      raw?.learningMode === 'High Comfort'
        ? raw.learningMode
        : base.learningMode,
    lowPowerMode:
      typeof raw?.lowPowerMode === 'boolean' ? raw.lowPowerMode : Boolean(base.lowPowerMode),
  };
}

function loadRuntimeState(): {
  sessionSecret: string;
  devices: Map<string, RegisteredDevice>;
  sessions: Map<string, AdminSession>;
  passkeys: Map<string, StoredPasskeyCredential>;
  passwords: Map<string, StoredPasswordCredential>;
  roomAppliances: Map<string, ServerRoomApplianceState>;
  schoolSettings: SchoolSettings;
} {
  const envSecret = process.env.ROOMWISE_SESSION_SECRET?.trim();
  const now = Date.now();
  const devicesMap = new Map<string, RegisteredDevice>();
  const sessionsMap = new Map<string, AdminSession>();
  const passkeysMap = new Map<string, StoredPasskeyCredential>();
  const passwordsMap = new Map<string, StoredPasswordCredential>();
  const roomAppliancesMap = new Map<string, ServerRoomApplianceState>();
  let loadedSecret: string | undefined;
  let loadedRoomAppliances: Record<string, ServerRoomApplianceState> | undefined;
  let loadedSchoolSettings: Partial<SchoolSettings> | undefined;

  try {
    if (fs.existsSync(RUNTIME_STATE_PATH)) {
      const raw = fs.readFileSync(RUNTIME_STATE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as PersistedRuntimeState;
      loadedSecret = parsed.sessionSecret;

      for (const dev of parsed.devices || []) {
        if (dev && dev.deviceId) {
          devicesMap.set(dev.deviceId, dev);
        }
      }
      for (const sess of parsed.adminSessions || []) {
        if (sess && sess.browserSessionId && sess.expiresAt > now) {
          sessionsMap.set(sess.browserSessionId, sess);
        }
      }
      for (const pk of parsed.passkeyCredentials || []) {
        if (pk && pk.id && pk.staffId) {
          passkeysMap.set(pk.id, pk);
        }
      }
      if (parsed.passwordCredentials) {
        for (const [staffId, rec] of Object.entries(parsed.passwordCredentials)) {
          if (rec && rec.salt && rec.hash) {
            passwordsMap.set(staffId, rec);
          }
        }
      }
      loadedRoomAppliances = parsed.roomAppliances;
      loadedSchoolSettings = parsed.schoolSettings;
    }
  } catch (err) {
    console.warn('[auth] Could not load persisted runtime state, initializing fresh store.', err);
  }

  // Ensure every configured staff member has a salted scrypt password hash on server
  for (const staff of STAFF_DIRECTORY) {
    if (!passwordsMap.has(staff.id)) {
      const { salt, hash } = hashPasswordScrypt(INITIAL_STAFF_PASSWORD);
      passwordsMap.set(staff.id, { salt, hash, updatedAt: now });
    }
  }

  // Initialize or validate configured granular appliance states for all 25 classrooms
  for (const spec of ROOM_APPLIANCE_SPECS) {
    const defaultAppliances = buildExpandedAppliancesFromSpec(spec);
    const persisted = loadedRoomAppliances?.[spec.roomId];
    const hasExactUnitIds =
      persisted &&
      Array.isArray(persisted.appliances) &&
      persisted.appliances.length === defaultAppliances.length &&
      defaultAppliances.every((def, idx) => persisted.appliances[idx]?.id === def.id);

    const normalizedPersisted = hasExactUnitIds
      ? persisted.appliances.map((app, idx) => ({
          ...app,
          type: defaultAppliances[idx].type,
        }))
      : defaultAppliances;

    roomAppliancesMap.set(spec.roomId, {
      roomId: spec.roomId,
      roomCode: spec.roomCode,
      isVacantDefault: spec.isVacant,
      commandSeq: hasExactUnitIds ? Number(persisted.commandSeq) || 0 : 0,
      updatedAt: hasExactUnitIds ? Number(persisted.updatedAt) || now : now,
      appliances: normalizedPersisted,
    });
  }

  return {
    sessionSecret: envSecret || loadedSecret || crypto.randomBytes(32).toString('hex'),
    devices: devicesMap,
    sessions: sessionsMap,
    passkeys: passkeysMap,
    passwords: passwordsMap,
    roomAppliances: roomAppliancesMap,
    schoolSettings: normalizeSchoolSettings(loadedSchoolSettings),
  };
}

const initialRuntime = loadRuntimeState();
const SESSION_SECRET = initialRuntime.sessionSecret;
const registeredDevices = initialRuntime.devices;
const adminSessions = initialRuntime.sessions;
const passkeyCredentials = initialRuntime.passkeys;
const passwordCredentials = initialRuntime.passwords;
const roomApplianceStore = initialRuntime.roomAppliances;
let persistedSchoolSettings: SchoolSettings = initialRuntime.schoolSettings;

const challenges = new Map<string, AuthChallenge>();
const webauthnChallenges = new Map<string, WebAuthnChallengeRecord>();
const clientRoomSeqGuard = new Map<string, number>();
const rateLimitBuckets = new Map<string, number[]>();
const sseClients = new Map<string, Set<Response>>();
const accessAuditTrail: AccessAuditEvent[] = [];

function persistRuntimeState() {
  try {
    const now = Date.now();
    const activeSessions = Array.from(adminSessions.values()).filter((s) => s.expiresAt > now);
    const passwordRecordObj: Record<string, StoredPasswordCredential> = {};
    for (const [staffId, cred] of passwordCredentials.entries()) {
      passwordRecordObj[staffId] = cred;
    }
    const roomAppliancesObj: Record<string, ServerRoomApplianceState> = {};
    for (const [roomId, st] of roomApplianceStore.entries()) {
      roomAppliancesObj[roomId] = st;
    }

    const payload: PersistedRuntimeState = {
      sessionSecret: SESSION_SECRET,
      devices: Array.from(registeredDevices.values()),
      adminSessions: activeSessions,
      passkeyCredentials: Array.from(passkeyCredentials.values()),
      passwordCredentials: passwordRecordObj,
      roomAppliances: roomAppliancesObj,
      schoolSettings: persistedSchoolSettings,
    };
    fs.writeFileSync(RUNTIME_STATE_PATH, JSON.stringify(payload), 'utf8');
  } catch (err) {
    console.warn('[auth] Failed to persist runtime state:', err);
  }
}

persistRuntimeState();

function recordAudit(event: Omit<AccessAuditEvent, 'id' | 'timestamp'>) {
  accessAuditTrail.unshift({
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    ...event,
  });
  if (accessAuditTrail.length > 50) {
    accessAuditTrail.length = 50;
  }
}

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(key: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const existing = (rateLimitBuckets.get(key) || []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (existing.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    rateLimitBuckets.set(key, existing);
    const oldest = existing[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000));
    return { allowed: false, retryAfterSeconds };
  }
  rateLimitBuckets.set(key, existing);
  return { allowed: true, retryAfterSeconds: 0 };
}

function recordFailedRateLimitAttempt(key: string) {
  const now = Date.now();
  const existing = (rateLimitBuckets.get(key) || []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  existing.push(now);
  rateLimitBuckets.set(key, existing);
}

function clearRateLimit(key: string) {
  rateLimitBuckets.delete(key);
}

function signToken(id: string, scope: string): string {
  const payload = `${scope}:${id}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${id}.${sig}`;
}

function verifyToken(token: string | undefined, scope: string): string | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [id, providedSig] = parts;
  if (!id || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${scope}:${id}`)
    .digest('base64url');

  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return id;
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  const pairs = header.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function isHttpsRequest(req: Request): boolean {
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string') {
    return proto.split(',')[0].trim().toLowerCase() === 'https';
  }
  return req.secure;
}

function setSignedCookie(req: Request, res: Response, name: string, value: string, maxAgeSeconds?: number) {
  const secure = isHttpsRequest(req);
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    secure ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (typeof maxAgeSeconds === 'number') {
    parts.push(`Max-Age=${maxAgeSeconds}`);
  }
  if (secure) {
    parts.push('Secure');
  }
  res.append('Set-Cookie', parts.join('; '));
}

function resolveOrCreateBrowserSession(
  req: Request,
  res: Response
): { sessionId: string; clientSessionToken: string; isNew: boolean } {
  const cookies = parseCookies(req);
  const headerToken =
    typeof req.headers['x-roomwise-session'] === 'string'
      ? req.headers['x-roomwise-session']
      : undefined;

  const fromHeader = verifyToken(headerToken, 'sid');
  if (fromHeader) {
    return { sessionId: fromHeader, clientSessionToken: headerToken!, isNew: false };
  }

  const fromCookie = verifyToken(cookies.roomwise_sid, 'sid');
  if (fromCookie) {
    return { sessionId: fromCookie, clientSessionToken: cookies.roomwise_sid, isNew: false };
  }

  const newId = crypto.randomUUID();
  const signed = signToken(newId, 'sid');
  setSignedCookie(req, res, 'roomwise_sid', signed);
  return { sessionId: newId, clientSessionToken: signed, isNew: true };
}

function resolveExistingBrowserSession(req: Request): string | null {
  const cookies = parseCookies(req);
  const headerToken =
    typeof req.headers['x-roomwise-session'] === 'string'
      ? req.headers['x-roomwise-session']
      : undefined;

  return verifyToken(headerToken, 'sid') || verifyToken(cookies.roomwise_sid, 'sid');
}

function resolveRegisteredDevice(req: Request): { device: RegisteredDevice; staff: StaffRecord } | null {
  const cookies = parseCookies(req);
  const headerToken =
    typeof req.headers['x-roomwise-device'] === 'string'
      ? req.headers['x-roomwise-device']
      : undefined;

  const deviceId = verifyToken(headerToken, 'dev') || verifyToken(cookies.roomwise_device, 'dev');
  if (!deviceId) return null;

  const device = registeredDevices.get(deviceId);
  if (!device || !device.active) return null;

  const staff = STAFF_DIRECTORY.find((s) => s.id === device.staffId);
  if (!staff) return null;

  return { device, staff };
}

function getActivePasskeysForStaff(staffId: string): StoredPasskeyCredential[] {
  const result: StoredPasskeyCredential[] = [];
  for (const cred of passkeyCredentials.values()) {
    if (cred.staffId === staffId && !cred.revoked) {
      result.push(cred);
    }
  }
  return result;
}

// Resolves authenticated phone operator for QR confirmation (via active Admin session OR legacy registered mobile device)
function resolveAuthenticatedPhoneAuthority(req: Request): {
  staff: StaffRecord;
  deviceId: string;
  deviceName: string;
  hasActivePasskeys: boolean;
} | null {
  const sid = resolveExistingBrowserSession(req);
  if (sid) {
    const adminSess = adminSessions.get(sid);
    if (adminSess && Date.now() <= adminSess.expiresAt) {
      const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
      if (staff) {
        return {
          staff,
          deviceId: adminSess.deviceId || `mobile-${sid.slice(0, 8)}`,
          deviceName: adminSess.deviceName || summarizeUserAgent(req.headers['user-agent']),
          hasActivePasskeys: getActivePasskeysForStaff(staff.id).length > 0,
        };
      }
    }
  }

  const dev = resolveRegisteredDevice(req);
  if (dev) {
    return {
      staff: dev.staff,
      deviceId: dev.device.deviceId,
      deviceName: dev.device.deviceName,
      hasActivePasskeys: getActivePasskeysForStaff(dev.staff.id).length > 0,
    };
  }

  return null;
}

function summarizeUserAgent(ua: string | undefined): string {
  if (!ua) return 'Workstation Browser';
  let browser = 'Browser';
  if (ua.includes('Edg/')) browser = 'Microsoft Edge';
  else if (ua.includes('Chrome/') && !ua.includes('Chromium')) browser = 'Google Chrome';
  else if (ua.includes('Firefox/')) browser = 'Mozilla Firefox';
  else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari';

  let os = 'Workstation';
  if (ua.includes('iPhone')) os = 'iPhone';
  else if (ua.includes('iPad')) os = 'iPad';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('Mac OS X')) os = 'macOS';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('CrOS')) os = 'ChromeOS';

  return `${browser} · ${os}`;
}

function getPublicOrigin(req: Request): string {
  const reqOrigin = req.headers.origin;
  if (typeof reqOrigin === 'string' && reqOrigin.startsWith('http')) {
    return reqOrigin.replace(/\/$/, '');
  }

  const forwardedHost = req.headers['x-forwarded-host'];
  const host =
    typeof forwardedHost === 'string'
      ? forwardedHost.split(',')[0].trim()
      : req.get('host');

  if (host) {
    const proto = isHttpsRequest(req) ? 'https' : 'http';
    return `${proto}://${host}`;
  }

  if (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL') {
    return process.env.APP_URL.replace(/\/$/, '');
  }

  return `http://localhost:${PORT}`;
}

function getRpContext(req: Request): { rpName: string; rpID: string; expectedOrigin: string } {
  const expectedOrigin = getPublicOrigin(req);
  let rpID = 'localhost';
  try {
    rpID = new URL(expectedOrigin).hostname.toLowerCase();
  } catch {
    const forwardedHost = req.headers['x-forwarded-host'];
    const host =
      typeof forwardedHost === 'string'
        ? forwardedHost.split(',')[0].trim()
        : req.get('host') || 'localhost';
    rpID = host.split(':')[0].toLowerCase();
  }

  return {
    rpName: 'ROOMWISE · DAV Model School, IIT Kharagpur',
    rpID,
    expectedOrigin,
  };
}

function generateShortCode(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

function getEffectiveChallengeStatus(challenge: AuthChallenge): ChallengeStatus {
  if (
    (challenge.status === 'pending' ||
      challenge.status === 'scanned' ||
      challenge.status === 'verifying' ||
      challenge.status === 'approved') &&
    Date.now() > challenge.expiresAt
  ) {
    challenge.status = 'expired';
  }
  return challenge.status;
}

function notifyChallengeSubscribers(challenge: AuthChallenge) {
  const subs = sseClients.get(challenge.challengeId);
  if (!subs || subs.size === 0) return;

  const status = getEffectiveChallengeStatus(challenge);
  const staff = challenge.approvedByAdminId
    ? STAFF_DIRECTORY.find((s) => s.id === challenge.approvedByAdminId)
    : undefined;
  const requestedStaff = challenge.requestedStaffId
    ? STAFF_DIRECTORY.find((s) => s.id === challenge.requestedStaffId)
    : undefined;

  const payload = JSON.stringify({
    challengeId: challenge.challengeId,
    status,
    expiresAt: challenge.expiresAt,
    scannedAt: challenge.scannedAt,
    respondedAt: challenge.respondedAt,
    requestedStaff: requestedStaff
      ? { id: requestedStaff.id, name: requestedStaff.name, role: requestedStaff.role }
      : undefined,
    approvedBy: staff ? { id: staff.id, name: staff.name, role: staff.role } : undefined,
    deviceName: challenge.approvedByDeviceName,
  });

  for (const res of subs) {
    try {
      res.write(`event: status\ndata: ${payload}\n\n`);
    } catch {
      subs.delete(res);
    }
  }
}

function timingSafeStringMatch(input: string, expected: string): boolean {
  const a = Buffer.from(input, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

// Cleanup stale challenges & expired admin sessions every 60s
setInterval(() => {
  const now = Date.now();
  for (const [id, ch] of challenges.entries()) {
    if (now - ch.expiresAt > 10 * 60 * 1000) {
      challenges.delete(id);
      sseClients.delete(id);
    }
  }
  for (const [key, rec] of webauthnChallenges.entries()) {
    if (now > rec.expiresAt) {
      webauthnChallenges.delete(key);
    }
  }
  for (const [sid, sess] of adminSessions.entries()) {
    if (now > sess.expiresAt) {
      adminSessions.delete(sid);
    }
  }
}, 60 * 1000).unref();

async function startServer() {
  energyHistoryService.initialize();
  interventionLedgerService.initialize();
  spaceIntelligenceService.init();

  setInterval(() => {
    energyHistoryService.recordLiveSnapshot(Array.from(roomApplianceStore.values()), Date.now(), 'snapshot');
  }, 60 * 1000).unref();

  const app = express();
  app.set('trust proxy', 1);
  app.use('/api/space/attendance/parse', express.json({ limit: '10mb' }));
  app.use('/api/space/attendance/commit', express.json({ limit: '2mb' }));
  app.use(express.json({ limit: '256kb' }));

  // Admin gate middleware
  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const sid = resolveExistingBrowserSession(req);
    if (!sid) {
      res.status(401).json({ error: 'No active browser session.' });
      return;
    }
    const adminSess = adminSessions.get(sid);
    if (!adminSess || Date.now() > adminSess.expiresAt) {
      if (adminSess) adminSessions.delete(sid);
      res.status(403).json({ error: 'Administrator verification required.' });
      return;
    }
    (req as Request & { adminSession?: AdminSession }).adminSession = adminSess;
    next();
  };

  // 1. Health & Public Staff Directory (NO secrets/hashes/credentialIDs)
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'roomwise-auth-server', timestamp: Date.now() });
  });

  app.get('/api/auth/staff-public', (_req, res) => {
    const enriched = STAFF_DIRECTORY.map((staff) => {
      const activePasskeys = getActivePasskeysForStaff(staff.id);
      return {
        ...staff,
        hasPasskey: activePasskeys.length > 0,
        passkeyCount: activePasskeys.length,
      };
    });
    res.json({ staff: enriched });
  });

  // 2. Browser Session Status (Student by default; Admin only after server verification)
  app.get('/api/auth/session', (req, res) => {
    const { sessionId, clientSessionToken } = resolveOrCreateBrowserSession(req, res);
    const adminSess = adminSessions.get(sessionId);

    if (adminSess && Date.now() <= adminSess.expiresAt) {
      const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
      if (staff) {
        const activePasskeys = getActivePasskeysForStaff(staff.id);
        res.json({
          authenticated: true,
          role: 'admin',
          authMethod: adminSess.authMethod || 'qr',
          clientSessionToken,
          admin: {
            ...staff,
            hasPasskey: activePasskeys.length > 0,
            passkeyCount: activePasskeys.length,
          },
          deviceName: adminSess.deviceName,
          grantedAt: adminSess.grantedAt,
          sessionExpiresAt: adminSess.expiresAt,
        });
        return;
      }
    }

    if (adminSess) {
      adminSessions.delete(sessionId);
    }

    res.json({
      authenticated: false,
      role: 'student',
      clientSessionToken,
    });
  });

  // 3. Explicit Logout / Revoke Admin Session immediately
  app.post('/api/auth/logout', (req, res) => {
    const sid = resolveExistingBrowserSession(req);
    if (sid) {
      const existing = adminSessions.get(sid);
      if (existing) {
        const staff = STAFF_DIRECTORY.find((s) => s.id === existing.adminId);
        recordAudit({
          type: 'session_revoked',
          summary: `Administrator session ended (${staff?.name || 'Admin'})`,
          staffName: staff?.name,
          deviceName: existing.deviceName,
        });
        adminSessions.delete(sid);
        persistRuntimeState();
      }
      for (const ch of challenges.values()) {
        if (
          ch.browserSessionId === sid &&
          (ch.status === 'pending' || ch.status === 'scanned' || ch.status === 'verifying')
        ) {
          ch.status = 'expired';
          notifyChallengeSubscribers(ch);
        }
      }
    }
    setSignedCookie(req, res, 'roomwise_sid', '', 0);
    res.json({ ok: true, authenticated: false, role: 'student' });
  });

  // 4. Password Fallback Authentication (Salted scrypt + rate limiting + generic errors)
  app.post('/api/auth/password/login', (req, res) => {
    const { staffId, password } = req.body || {};
    const ip = getClientIp(req);
    const rateKey = `pwd:${ip}`;
    const limit = checkRateLimit(rateKey);
    if (!limit.allowed) {
      res.status(429).json({
        error: `Too many failed sign-in attempts. Please wait ${limit.retryAfterSeconds} seconds and try again.`,
        retryAfterSeconds: limit.retryAfterSeconds,
      });
      return;
    }

    const cleanStaffId = typeof staffId === 'string' ? staffId.trim() : '';
    const cleanPassword = typeof password === 'string' ? password : '';

    const staff = STAFF_DIRECTORY.find((s) => s.id === cleanStaffId);
    const storedCred = staff ? passwordCredentials.get(staff.id) : undefined;
    const ok = Boolean(cleanPassword.length > 0 && staff && verifyPasswordScrypt(cleanPassword, storedCred));

    if (!ok || !staff) {
      recordFailedRateLimitAttempt(rateKey);
      recordAudit({
        type: 'password_login_failed',
        summary: 'Failed password sign-in attempt',
      });
      res.status(401).json({
        error: 'Invalid credentials. Check your selected profile and password and try again.',
      });
      return;
    }

    clearRateLimit(rateKey);

    const { sessionId, clientSessionToken } = resolveOrCreateBrowserSession(req, res);
    const deviceLabel = `${summarizeUserAgent(req.headers['user-agent'])} · Password`;
    const grantedAt = Date.now();
    const sessionExpiresAt = grantedAt + ADMIN_SESSION_TTL_MS;

    adminSessions.set(sessionId, {
      browserSessionId: sessionId,
      adminId: staff.id,
      deviceId: `pwd-${sessionId.slice(0, 8)}`,
      deviceName: deviceLabel,
      authMethod: 'password',
      grantedAt,
      expiresAt: sessionExpiresAt,
    });
    persistRuntimeState();

    recordAudit({
      type: 'session_granted',
      summary: `Password sign-in verified for ${staff.name}`,
      staffName: staff.name,
      deviceName: deviceLabel,
    });

    const activePasskeys = getActivePasskeysForStaff(staff.id);
    res.json({
      verified: true,
      authenticated: true,
      role: 'admin',
      authMethod: 'password',
      clientSessionToken,
      admin: {
        ...staff,
        hasPasskey: activePasskeys.length > 0,
        passkeyCount: activePasskeys.length,
      },
      deviceName: deviceLabel,
      grantedAt,
      sessionExpiresAt,
    });
  });

  // 5. WebAuthn Passkey Registration (Requires active admin session for SAME teacher OR valid password verification)
  app.post('/api/auth/passkey/register/begin', async (req, res) => {
    try {
      const { staffId, password, deviceName } = req.body || {};
      const cleanStaffId = typeof staffId === 'string' ? staffId.trim() : '';
      const staff = STAFF_DIRECTORY.find((s) => s.id === cleanStaffId);

      const { sessionId, clientSessionToken } = resolveOrCreateBrowserSession(req, res);
      const currentAdminSess = adminSessions.get(sessionId);
      const isAlreadySameAdmin =
        Boolean(currentAdminSess && Date.now() <= currentAdminSess.expiresAt && currentAdminSess.adminId === cleanStaffId);

      if (!isAlreadySameAdmin) {
        const ip = getClientIp(req);
        const rateKey = `reg:${ip}`;
        const limit = checkRateLimit(rateKey);
        if (!limit.allowed) {
          res.status(429).json({
            error: `Too many failed verification attempts. Wait ${limit.retryAfterSeconds} seconds.`,
            retryAfterSeconds: limit.retryAfterSeconds,
          });
          return;
        }

        const cleanPassword = typeof password === 'string' ? password : '';
        const storedCred = staff ? passwordCredentials.get(staff.id) : undefined;
        const passwordValid = Boolean(
          cleanPassword.length > 0 && staff && verifyPasswordScrypt(cleanPassword, storedCred)
        );

        if (!passwordValid || !staff) {
          recordFailedRateLimitAttempt(rateKey);
          res.status(401).json({
            error: 'Invalid credentials. Enter the correct profile password to register a biometric passkey.',
          });
          return;
        }
        clearRateLimit(rateKey);
      }

      if (!staff) {
        res.status(404).json({ error: 'Profile not found.' });
        return;
      }

      const { rpName, rpID, expectedOrigin } = getRpContext(req);
      const activePasskeys = getActivePasskeysForStaff(staff.id);
      const cleanDeviceName =
        typeof deviceName === 'string' && deviceName.trim().length > 0
          ? deviceName.trim().slice(0, 64)
          : summarizeUserAgent(req.headers['user-agent']);

      const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userName: staff.email,
        userID: new Uint8Array(Buffer.from(staff.id, 'utf8')),
        userDisplayName: staff.name,
        timeout: WEBAUTHN_CHALLENGE_TTL_MS,
        attestationType: 'none',
        excludeCredentials: activePasskeys.map((cred) => ({
          id: cred.id,
          transports: cred.transports,
        })),
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
      });

      webauthnChallenges.set(`register:${sessionId}`, {
        challenge: options.challenge,
        type: 'register',
        browserSessionId: sessionId,
        staffId: staff.id,
        rpId: rpID,
        expectedOrigin,
        deviceName: cleanDeviceName,
        expiresAt: Date.now() + WEBAUTHN_CHALLENGE_TTL_MS,
      });

      res.json({ options, clientSessionToken });
    } catch (err) {
      console.error('[webauthn] register/begin error:', err);
      res.status(500).json({ error: 'Unable to initiate biometric registration challenge.' });
    }
  });

  app.post('/api/auth/passkey/register/finish', async (req, res) => {
    try {
      const { staffId, response, deviceName, signInAfterRegister } = req.body || {};
      const sid = resolveExistingBrowserSession(req);
      if (!sid) {
        res.status(401).json({ error: 'Browser session missing or expired.' });
        return;
      }

      const key = `register:${sid}`;
      const record = webauthnChallenges.get(key);
      // Atomically consume challenge on first verification attempt
      webauthnChallenges.delete(key);

      if (!record || record.type !== 'register') {
        res.status(400).json({ error: 'No pending biometric registration challenge found.' });
        return;
      }
      if (Date.now() > record.expiresAt) {
        res.status(410).json({ error: 'Biometric registration challenge expired. Please try again.' });
        return;
      }
      if (typeof staffId !== 'string' || record.staffId !== staffId.trim()) {
        res.status(403).json({ error: 'Profile mismatch for biometric registration challenge.' });
        return;
      }

      const staff = STAFF_DIRECTORY.find((s) => s.id === record.staffId);
      if (!staff) {
        res.status(404).json({ error: 'Staff profile not found.' });
        return;
      }

      const verification = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: record.challenge,
        expectedOrigin: record.expectedOrigin,
        expectedRPID: record.rpId,
        requireUserVerification: false,
      });

      if (!verification.verified || !verification.registrationInfo) {
        res.status(400).json({ error: 'Biometric credential signature verification failed.' });
        return;
      }

      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
      const now = Date.now();
      const label =
        typeof deviceName === 'string' && deviceName.trim().length > 0
          ? deviceName.trim().slice(0, 64)
          : record.deviceName || summarizeUserAgent(req.headers['user-agent']);

      const stored: StoredPasskeyCredential = {
        id: credential.id,
        staffId: staff.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: credential.transports,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        deviceName: label,
        rpId: record.rpId,
        createdAt: now,
        revoked: false,
      };

      passkeyCredentials.set(stored.id, stored);

      let adminSessionPayload: {
        authenticated?: boolean;
        deviceName?: string;
        grantedAt?: number;
        sessionExpiresAt?: number;
      } = {};

      if (signInAfterRegister) {
        const sessionExpiresAt = now + ADMIN_SESSION_TTL_MS;
        adminSessions.set(sid, {
          browserSessionId: sid,
          adminId: staff.id,
          deviceId: stored.id,
          deviceName: label,
          authMethod: 'passkey',
          grantedAt: now,
          expiresAt: sessionExpiresAt,
        });
        adminSessionPayload = {
          authenticated: true,
          deviceName: label,
          grantedAt: now,
          sessionExpiresAt,
        };
      }

      persistRuntimeState();
      recordAudit({
        type: 'passkey_registered',
        summary: `Registered WebAuthn passkey for ${staff.name} (${label})`,
        staffName: staff.name,
        deviceName: label,
      });

      const activeCount = getActivePasskeysForStaff(staff.id).length;
      res.status(201).json({
        registered: true,
        credential: {
          id: stored.id,
          staffId: stored.staffId,
          deviceName: stored.deviceName,
          deviceType: stored.deviceType,
          backedUp: stored.backedUp,
          createdAt: stored.createdAt,
          revoked: stored.revoked,
        },
        admin: {
          ...staff,
          hasPasskey: activeCount > 0,
          passkeyCount: activeCount,
        },
        ...adminSessionPayload,
      });
    } catch (err) {
      console.error('[webauthn] register/finish error:', err);
      res.status(400).json({ error: 'Unable to verify biometric credential registration.' });
    }
  });

  // 6. WebAuthn Passkey Authentication (Primary Login)
  app.post('/api/auth/passkey/login/options', async (req, res) => {
    try {
      const { staffId } = req.body || {};
      const cleanStaffId = typeof staffId === 'string' ? staffId.trim() : '';
      const staff = STAFF_DIRECTORY.find((s) => s.id === cleanStaffId);

      if (!staff) {
        res.status(404).json({ error: 'Administrator profile not found.' });
        return;
      }

      const activePasskeys = getActivePasskeysForStaff(staff.id);
      if (activePasskeys.length === 0) {
        res.status(404).json({
          code: 'NO_PASSKEY',
          error:
            'No biometric or passkey login is registered for this profile yet. Set up biometric login below or sign in with password.',
        });
        return;
      }

      const { sessionId, clientSessionToken } = resolveOrCreateBrowserSession(req, res);
      const { rpID, expectedOrigin } = getRpContext(req);

      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: activePasskeys.map((cred) => ({
          id: cred.id,
          transports: cred.transports,
        })),
        userVerification: 'preferred',
        timeout: WEBAUTHN_CHALLENGE_TTL_MS,
      });

      webauthnChallenges.set(`auth:${sessionId}`, {
        challenge: options.challenge,
        type: 'auth',
        browserSessionId: sessionId,
        staffId: staff.id,
        rpId: rpID,
        expectedOrigin,
        expiresAt: Date.now() + WEBAUTHN_CHALLENGE_TTL_MS,
      });

      res.json({ options, clientSessionToken });
    } catch (err) {
      console.error('[webauthn] login/options error:', err);
      res.status(500).json({ error: 'Could not generate biometric authentication challenge.' });
    }
  });

  app.post('/api/auth/passkey/login/verify', async (req, res) => {
    try {
      const { staffId, response } = req.body || {};
      const sid = resolveExistingBrowserSession(req);
      if (!sid) {
        res.status(401).json({ error: 'Browser session missing or expired.' });
        return;
      }

      const key = `auth:${sid}`;
      const record = webauthnChallenges.get(key);
      // Consume challenge atomically (anti-replay)
      webauthnChallenges.delete(key);

      if (!record || record.type !== 'auth') {
        res.status(400).json({ error: 'Authentication challenge missing or already consumed.' });
        return;
      }
      if (Date.now() > record.expiresAt) {
        res.status(410).json({ error: 'Authentication challenge expired. Please try again.' });
        return;
      }
      if (typeof staffId !== 'string' || record.staffId !== staffId.trim()) {
        res.status(403).json({ error: 'Selected profile does not match authentication challenge.' });
        return;
      }

      const staff = STAFF_DIRECTORY.find((s) => s.id === record.staffId);
      if (!staff) {
        res.status(404).json({ error: 'Profile not found.' });
        return;
      }

      const authResp = response as AuthenticationResponseJSON;
      const cred = authResp && authResp.id ? passkeyCredentials.get(authResp.id) : undefined;
      if (!cred || cred.revoked || cred.staffId !== staff.id) {
        res.status(403).json({ error: 'Credential is unknown, revoked, or belongs to a different profile.' });
        return;
      }

      const verification = await verifyAuthenticationResponse({
        response: authResp,
        expectedChallenge: record.challenge,
        expectedOrigin: record.expectedOrigin,
        expectedRPID: record.rpId,
        credential: {
          id: cred.id,
          publicKey: new Uint8Array(Buffer.from(cred.publicKey, 'base64url')),
          counter: cred.counter,
          transports: cred.transports,
        },
        requireUserVerification: false,
      });

      if (!verification.verified) {
        res.status(401).json({ error: 'Passkey signature verification failed.' });
        return;
      }

      const now = Date.now();
      cred.counter = verification.authenticationInfo.newCounter;
      cred.lastUsedAt = now;

      const sessionExpiresAt = now + ADMIN_SESSION_TTL_MS;
      adminSessions.set(sid, {
        browserSessionId: sid,
        adminId: staff.id,
        deviceId: cred.id,
        deviceName: cred.deviceName,
        authMethod: 'passkey',
        grantedAt: now,
        expiresAt: sessionExpiresAt,
      });
      persistRuntimeState();

      recordAudit({
        type: 'session_granted',
        summary: `Passkey authentication granted for ${staff.name}`,
        staffName: staff.name,
        deviceName: cred.deviceName,
      });

      const activePasskeys = getActivePasskeysForStaff(staff.id);
      res.json({
        verified: true,
        authenticated: true,
        role: 'admin',
        authMethod: 'passkey',
        admin: {
          ...staff,
          hasPasskey: activePasskeys.length > 0,
          passkeyCount: activePasskeys.length,
        },
        deviceName: cred.deviceName,
        grantedAt: now,
        sessionExpiresAt,
      });
    } catch (err) {
      console.error('[webauthn] login/verify error:', err);
      res.status(401).json({ error: 'Passkey verification failed.' });
    }
  });

  // 7. Authenticated Teacher Credential Management (Strictly scoped to logged-in teacher)
  app.get('/api/auth/credentials', requireAdmin, (req, res) => {
    const adminSess = (req as Request & { adminSession: AdminSession }).adminSession;
    const list = Array.from(passkeyCredentials.values())
      .filter((c) => c.staffId === adminSess.adminId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((c) => ({
        id: c.id,
        staffId: c.staffId,
        deviceName: c.deviceName,
        deviceType: c.deviceType,
        backedUp: c.backedUp,
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt,
        revoked: c.revoked,
        revokedAt: c.revokedAt,
      }));
    res.json({ credentials: list });
  });

  app.post('/api/auth/credentials/:credId/revoke', requireAdmin, (req, res) => {
    const adminSess = (req as Request & { adminSession: AdminSession }).adminSession;
    const credId = decodeURIComponent(req.params.credId || '');
    const cred = passkeyCredentials.get(credId);

    if (!cred || cred.staffId !== adminSess.adminId) {
      res.status(404).json({ error: 'Credential not found for your account.' });
      return;
    }

    if (!cred.revoked) {
      cred.revoked = true;
      cred.revokedAt = Date.now();
      persistRuntimeState();

      const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
      recordAudit({
        type: 'passkey_revoked',
        summary: `Passkey credential revoked (${cred.deviceName})`,
        staffName: staff?.name,
        deviceName: cred.deviceName,
      });
    }

    res.json({ ok: true, revokedId: cred.id });
  });

  // 8. PC QR Challenge Creation (Verify with Phone)
  app.post('/api/auth/challenge', (req, res) => {
    const { staffId } = req.body || {};
    let requestedStaff: StaffRecord | undefined;
    if (typeof staffId === 'string' && staffId.trim()) {
      requestedStaff = STAFF_DIRECTORY.find((s) => s.id === staffId.trim());
      if (!requestedStaff) {
        res.status(400).json({ error: 'Selected teacher profile not found.' });
        return;
      }
    }

    const { sessionId, clientSessionToken } = resolveOrCreateBrowserSession(req, res);

    for (const ch of challenges.values()) {
      if (
        ch.browserSessionId === sessionId &&
        (ch.status === 'pending' || ch.status === 'scanned' || ch.status === 'verifying')
      ) {
        ch.status = 'expired';
        notifyChallengeSubscribers(ch);
      }
    }

    const challengeId = crypto.randomBytes(16).toString('base64url');
    const publicNonce = crypto.randomBytes(12).toString('base64url');
    const shortCode = generateShortCode();
    const now = Date.now();
    const expiresAt = now + CHALLENGE_TTL_MS;
    const browserInfo = summarizeUserAgent(req.headers['user-agent']);

    const challenge: AuthChallenge = {
      challengeId,
      publicNonce,
      shortCode,
      browserSessionId: sessionId,
      browserInfo,
      requestedStaffId: requestedStaff?.id,
      createdAt: now,
      expiresAt,
      status: 'pending',
    };

    challenges.set(challengeId, challenge);
    recordAudit({
      type: 'challenge_created',
      summary: `Phone verification QR issued for ${browserInfo}${requestedStaff ? ` (${requestedStaff.name})` : ''}`,
      staffName: requestedStaff?.name,
    });

    const origin = getPublicOrigin(req);
    const qrPayloadUrl = `${origin}/access-card?c=${encodeURIComponent(challengeId)}&n=${encodeURIComponent(publicNonce)}`;

    res.status(201).json({
      challengeId,
      publicNonce,
      shortCode,
      expiresAt,
      ttlSeconds: Math.round(CHALLENGE_TTL_MS / 1000),
      qrPayloadUrl,
      clientSessionToken,
      requestedStaff: requestedStaff
        ? {
            id: requestedStaff.id,
            name: requestedStaff.name,
            role: requestedStaff.role,
            avatarInitials: requestedStaff.avatarInitials,
          }
        : undefined,
    });
  });

  // 9. Laptop SSE Stream & Polling Status
  app.get('/api/auth/challenge/:id/events', (req, res) => {
    const sid = resolveExistingBrowserSession(req);
    const challenge = challenges.get(req.params.id);

    if (!challenge) {
      res.status(404).json({ error: 'Challenge not found.' });
      return;
    }
    if (!sid || challenge.browserSessionId !== sid) {
      res.status(403).json({ error: 'Challenge is bound to a different browser session.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let subs = sseClients.get(challenge.challengeId);
    if (!subs) {
      subs = new Set();
      sseClients.set(challenge.challengeId, subs);
    }
    subs.add(res);

    const status = getEffectiveChallengeStatus(challenge);
    res.write(
      `event: status\ndata: ${JSON.stringify({
        challengeId: challenge.challengeId,
        status,
        expiresAt: challenge.expiresAt,
      })}\n\n`
    );

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      subs?.delete(res);
    });
  });

  app.get('/api/auth/challenge/:id/status', (req, res) => {
    const sid = resolveExistingBrowserSession(req);
    const challenge = challenges.get(req.params.id);

    if (!challenge) {
      res.status(404).json({ error: 'Challenge not found.' });
      return;
    }
    if (!sid || challenge.browserSessionId !== sid) {
      res.status(403).json({ error: 'Challenge does not belong to this browser session.' });
      return;
    }

    const status = getEffectiveChallengeStatus(challenge);
    const staff = challenge.approvedByAdminId
      ? STAFF_DIRECTORY.find((s) => s.id === challenge.approvedByAdminId)
      : undefined;

    res.json({
      challengeId: challenge.challengeId,
      status,
      expiresAt: challenge.expiresAt,
      scannedAt: challenge.scannedAt,
      respondedAt: challenge.respondedAt,
      approvedBy: staff ? { id: staff.id, name: staff.name, role: staff.role } : undefined,
      deviceName: challenge.approvedByDeviceName,
    });
  });

  app.post('/api/auth/challenge/:id/cancel', (req, res) => {
    const sid = resolveExistingBrowserSession(req);
    const challenge = challenges.get(req.params.id);
    if (challenge && sid && challenge.browserSessionId === sid) {
      if (challenge.status === 'pending' || challenge.status === 'scanned' || challenge.status === 'verifying') {
        challenge.status = 'expired';
        notifyChallengeSubscribers(challenge);
      }
    }
    res.json({ ok: true });
  });

  // 10. Server-Side Consumption & PC Admin Session Grant (Anti-Replay)
  app.post('/api/auth/challenge/:id/verify', (req, res) => {
    const sid = resolveExistingBrowserSession(req);
    const challenge = challenges.get(req.params.id);

    if (!challenge) {
      res.status(404).json({ error: 'Challenge not found.' });
      return;
    }
    if (!sid || challenge.browserSessionId !== sid) {
      res.status(403).json({ error: 'Challenge binding mismatch: cannot verify from another browser session.' });
      return;
    }

    const currentStatus = getEffectiveChallengeStatus(challenge);

    if (currentStatus === 'consumed' || challenge.consumedAt) {
      recordAudit({
        type: 'replay_blocked',
        summary: `Blocked replay attempt on consumed challenge ${challenge.challengeId.slice(0, 8)}`,
      });
      res.status(409).json({ error: 'Challenge has already been used.' });
      return;
    }

    if (currentStatus === 'expired') {
      res.status(410).json({ error: 'Challenge has expired. Generate a new QR code.' });
      return;
    }

    if (currentStatus === 'rejected') {
      res.status(403).json({ error: 'Challenge was rejected.' });
      return;
    }

    if (currentStatus !== 'approved' || !challenge.approvedByAdminId || !challenge.approvedByDeviceId) {
      res.status(409).json({ error: 'Challenge has not been authorised by an authenticated phone yet.' });
      return;
    }

    const staff = STAFF_DIRECTORY.find((s) => s.id === challenge.approvedByAdminId);
    if (!staff) {
      res.status(403).json({ error: 'Approving administrator profile is invalid.' });
      return;
    }

    if (challenge.requestedStaffId && challenge.requestedStaffId !== staff.id) {
      res.status(403).json({ error: 'Authorising phone profile does not match the profile requested by this computer.' });
      return;
    }

    // Atomically consume the challenge (single-use anti-replay)
    challenge.status = 'consumed';
    challenge.consumedAt = Date.now();

    const grantedAt = Date.now();
    const sessionExpiresAt = grantedAt + ADMIN_SESSION_TTL_MS;
    const adminSession: AdminSession = {
      browserSessionId: sid,
      adminId: staff.id,
      deviceId: challenge.approvedByDeviceId,
      deviceName: challenge.approvedByDeviceName || 'Authenticated Mobile Device',
      authMethod: 'qr',
      grantedAt,
      expiresAt: sessionExpiresAt,
    };
    adminSessions.set(sid, adminSession);
    persistRuntimeState();

    recordAudit({
      type: 'session_granted',
      summary: `QR phone-to-PC access granted for ${challenge.browserInfo}`,
      staffName: staff.name,
      deviceName: adminSession.deviceName,
    });

    const activePasskeys = getActivePasskeysForStaff(staff.id);
    const clientSessionToken = signToken(sid, 'sid');
    res.json({
      verified: true,
      authenticated: true,
      role: 'admin',
      authMethod: 'qr',
      clientSessionToken,
      admin: {
        ...staff,
        hasPasskey: activePasskeys.length > 0,
        passkeyCount: activePasskeys.length,
      },
      deviceName: adminSession.deviceName,
      grantedAt: adminSession.grantedAt,
      sessionExpiresAt,
    });
  });

  // 11. Legacy Mobile Device Registration & Status (kept compatible)
  app.get('/api/auth/device/me', (req, res) => {
    const resolved = resolveRegisteredDevice(req);
    if (!resolved) {
      res.json({ registered: false });
      return;
    }

    resolved.device.lastSeenAt = Date.now();
    persistRuntimeState();

    res.json({
      registered: true,
      device: {
        deviceId: resolved.device.deviceId,
        deviceName: resolved.device.deviceName,
        registeredAt: resolved.device.registeredAt,
      },
      admin: resolved.staff,
    });
  });

  app.post('/api/auth/device/register', (req, res) => {
    const { staffId, passcode, deviceName } = req.body || {};

    if (!staffId || typeof staffId !== 'string') {
      res.status(400).json({ error: 'Please select an administrator profile.' });
      return;
    }
    if (!passcode || typeof passcode !== 'string') {
      res.status(400).json({ error: 'Password or enrollment code is required.' });
      return;
    }

    const staff = STAFF_DIRECTORY.find((s) => s.id === staffId);
    if (!staff) {
      res.status(404).json({ error: 'Administrator profile not found.' });
      return;
    }

    const storedPass = passwordCredentials.get(staff.id);
    const valid =
      verifyPasswordScrypt(passcode.trim(), storedPass) ||
      timingSafeStringMatch(passcode.trim(), SERVER_ENROLLMENT_CODE);

    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    const cleanDeviceName =
      typeof deviceName === 'string' && deviceName.trim().length > 0
        ? deviceName.trim().slice(0, 60)
        : summarizeUserAgent(req.headers['user-agent']);

    const deviceId = `dev-${crypto.randomBytes(12).toString('base64url')}`;
    const now = Date.now();
    const device: RegisteredDevice = {
      deviceId,
      staffId: staff.id,
      deviceName: cleanDeviceName,
      registeredAt: now,
      lastSeenAt: now,
      active: true,
    };

    registeredDevices.set(deviceId, device);
    persistRuntimeState();

    const deviceToken = signToken(deviceId, 'dev');
    setSignedCookie(req, res, 'roomwise_device', deviceToken, 60 * 60 * 24 * 30);

    recordAudit({
      type: 'device_registered',
      summary: `Registered smartphone access card (${cleanDeviceName})`,
      staffName: staff.name,
      deviceName: cleanDeviceName,
    });

    res.status(201).json({
      registered: true,
      deviceToken,
      device: {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        registeredAt: device.registeredAt,
      },
      admin: staff,
    });
  });

  app.post('/api/auth/device/revoke', (req, res) => {
    const resolved = resolveRegisteredDevice(req);
    if (resolved) {
      resolved.device.active = false;
      persistRuntimeState();
    }
    setSignedCookie(req, res, 'roomwise_device', '', 0);
    res.json({ ok: true, registered: false });
  });

  // 12. Phone Challenge Inspection (supports high-entropy scanned QR or authenticated 6-char code)
  app.post('/api/auth/challenge/inspect', (req, res) => {
    const authority = resolveAuthenticatedPhoneAuthority(req);
    const { challengeId, nonce, shortCode } = req.body || {};
    let challenge: AuthChallenge | undefined;

    if (typeof challengeId === 'string' && challengeId.trim()) {
      const candidate = challenges.get(challengeId.trim());
      if (candidate && typeof nonce === 'string' && timingSafeStringMatch(nonce.trim(), candidate.publicNonce)) {
        challenge = candidate;
      }
    } else if (typeof shortCode === 'string' && shortCode.trim()) {
      if (!authority) {
        res.status(401).json({
          error: 'Sign in as a teacher on this phone before looking up a 6-character pairing code, or scan the QR code with the camera.',
        });
        return;
      }
      const cleanCode = shortCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      for (const ch of challenges.values()) {
        const eff = getEffectiveChallengeStatus(ch);
        if ((eff === 'pending' || eff === 'scanned' || eff === 'verifying') && ch.shortCode === cleanCode) {
          challenge = ch;
          break;
        }
      }
    }

    if (!challenge) {
      res.status(404).json({
        error: 'Invalid or unrecognized QR code. Please scan the live login QR code shown on your computer.',
      });
      return;
    }

    const status = getEffectiveChallengeStatus(challenge);
    if (status === 'expired') {
      res.status(410).json({ error: 'This QR code has expired. Generate a fresh code on your computer and try again.' });
      return;
    }
    if (status === 'consumed' || status === 'approved' || status === 'rejected') {
      res.status(409).json({
        error: `This QR code was already ${status} and cannot be reused.`,
        status,
      });
      return;
    }

    const requestedStaff = challenge.requestedStaffId
      ? STAFF_DIRECTORY.find((s) => s.id === challenge.requestedStaffId)
      : undefined;

    if (challenge.status === 'pending') {
      challenge.status = 'scanned';
      challenge.scannedAt = Date.now();
      recordAudit({
        type: 'challenge_scanned',
        summary: `QR challenge scanned by ${authority ? `${authority.staff.name}'s phone` : 'mobile QR scanner'}`,
        staffName: authority?.staff.name || requestedStaff?.name,
        deviceName: authority?.deviceName || summarizeUserAgent(req.headers['user-agent']),
      });
      notifyChallengeSubscribers(challenge);
    }

    const targetStaff = requestedStaff || authority?.staff;
    const staffMismatch = Boolean(authority && requestedStaff && authority.staff.id !== requestedStaff.id);
    const targetHasPasskeys = targetStaff ? getActivePasskeysForStaff(targetStaff.id).length > 0 : false;

    const requestedStaffPayload = requestedStaff
      ? {
          ...requestedStaff,
          hasPasskey: getActivePasskeysForStaff(requestedStaff.id).length > 0,
          passkeyCount: getActivePasskeysForStaff(requestedStaff.id).length,
        }
      : undefined;

    const authPhoneStaffPayload = authority
      ? {
          ...authority.staff,
          hasPasskey: authority.hasActivePasskeys,
          passkeyCount: getActivePasskeysForStaff(authority.staff.id).length,
        }
      : undefined;

    res.json({
      challengeId: challenge.challengeId,
      nonce: challenge.publicNonce,
      shortCode: challenge.shortCode,
      status: challenge.status,
      createdAt: challenge.createdAt,
      expiresAt: challenge.expiresAt,
      browserInfo: challenge.browserInfo,
      targetSystem: 'ROOMWISE · DAV Model School, IIT Kharagpur',
      scope: 'Administrator Override & Energy Tariff Control',
      requestedStaff: requestedStaffPayload,
      phoneAuthenticated: Boolean(authority),
      authenticatedPhoneStaff: authPhoneStaffPayload,
      staffMismatch,
      requiresPasskeyVerification: targetHasPasskeys,
    });
  });

  // 12b. Fresh Phone Passkey Assertion Options for QR Confirmation
  app.post('/api/auth/challenge/:id/passkey-options', async (req, res) => {
    try {
      const authority = resolveAuthenticatedPhoneAuthority(req);
      const challenge = challenges.get(req.params.id);
      const { nonce, staffId } = req.body || {};

      if (!challenge || typeof nonce !== 'string' || !timingSafeStringMatch(nonce.trim(), challenge.publicNonce)) {
        res.status(404).json({ error: 'QR challenge not found or nonce mismatch.' });
        return;
      }

      const status = getEffectiveChallengeStatus(challenge);
      if (status !== 'pending' && status !== 'scanned' && status !== 'verifying') {
        res.status(409).json({ error: `Challenge is ${status} and cannot be authorised.` });
        return;
      }

      const targetStaffId =
        challenge.requestedStaffId ||
        authority?.staff.id ||
        (typeof staffId === 'string' ? staffId.trim() : '');

      const targetStaff = STAFF_DIRECTORY.find((s) => s.id === targetStaffId);
      if (!targetStaff) {
        res.status(400).json({ error: 'Select a teacher profile before confirming with a passkey.' });
        return;
      }

      const activePasskeys = getActivePasskeysForStaff(targetStaff.id);
      if (activePasskeys.length === 0) {
        res.json({ required: false });
        return;
      }

      const { sessionId, clientSessionToken } = resolveOrCreateBrowserSession(req, res);
      const { rpID, expectedOrigin } = getRpContext(req);
      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: activePasskeys.map((cred) => ({
          id: cred.id,
          transports: cred.transports,
        })),
        userVerification: 'preferred',
        timeout: WEBAUTHN_CHALLENGE_TTL_MS,
      });

      const phoneSessionKey = sessionId || authority?.deviceId || 'mobile';
      webauthnChallenges.set(`qr-approve:${challenge.challengeId}:${phoneSessionKey}`, {
        challenge: options.challenge,
        type: 'qr-approve',
        browserSessionId: phoneSessionKey,
        staffId: targetStaff.id,
        rpId: rpID,
        expectedOrigin,
        qrChallengeId: challenge.challengeId,
        expiresAt: Date.now() + WEBAUTHN_CHALLENGE_TTL_MS,
      });

      // Notify laptop UI that phone is verifying
      challenge.status = 'verifying';
      notifyChallengeSubscribers(challenge);

      res.json({ required: true, options, clientSessionToken });
    } catch (err) {
      console.error('[webauthn] challenge/passkey-options error:', err);
      res.status(500).json({ error: 'Failed to prepare phone passkey check.' });
    }
  });

  // 13. Phone Explicit Confirmation to Authorise PC
  app.post('/api/auth/challenge/:id/respond', async (req, res) => {
    try {
      const challenge = challenges.get(req.params.id);
      const { nonce, decision, passkeyResponse, staffId, password } = req.body || {};

      if (!challenge || typeof nonce !== 'string' || !timingSafeStringMatch(nonce.trim(), challenge.publicNonce)) {
        res.status(404).json({ error: 'Challenge not found or security nonce mismatch.' });
        return;
      }

      if (decision && decision !== 'approve') {
        res.status(400).json({ error: 'Only device authorisation is supported.' });
        return;
      }

      const status = getEffectiveChallengeStatus(challenge);
      if (status === 'expired') {
        notifyChallengeSubscribers(challenge);
        res.status(410).json({ error: 'Challenge expired before authorisation completed.' });
        return;
      }

      if (status !== 'pending' && status !== 'scanned' && status !== 'verifying') {
        res.status(409).json({ error: `Challenge already ${status}. Replay prevented.` });
        return;
      }

      const authority = resolveAuthenticatedPhoneAuthority(req);
      let verifiedStaff: StaffRecord | undefined;
      let verifiedDeviceId: string | undefined;
      let verifiedDeviceName: string | undefined;

      // Case A: Phone already has an authenticated teacher session/device AND a passkey assertion wasn't solely relied on for switch
      if (passkeyResponse) {
        const sid = resolveExistingBrowserSession(req);
        const phoneSessionKey = sid || authority?.deviceId || 'mobile';
        const waKey = `qr-approve:${challenge.challengeId}:${phoneSessionKey}`;
        const waRecord = webauthnChallenges.get(waKey);
        webauthnChallenges.delete(waKey);

        if (!waRecord || Date.now() > waRecord.expiresAt) {
          res.status(401).json({ error: 'Biometric confirmation challenge expired. Try again.' });
          return;
        }

        if (challenge.requestedStaffId && waRecord.staffId !== challenge.requestedStaffId) {
          res.status(403).json({ error: 'Passkey does not belong to the requested teacher profile.' });
          return;
        }

        const staff = STAFF_DIRECTORY.find((s) => s.id === waRecord.staffId);
        const authResp = passkeyResponse as AuthenticationResponseJSON;
        const cred = authResp && authResp.id ? passkeyCredentials.get(authResp.id) : undefined;
        if (!staff || !cred || cred.revoked || cred.staffId !== staff.id) {
          res.status(403).json({ error: 'Passkey credential invalid or revoked.' });
          return;
        }

        const verification = await verifyAuthenticationResponse({
          response: authResp,
          expectedChallenge: waRecord.challenge,
          expectedOrigin: waRecord.expectedOrigin,
          expectedRPID: waRecord.rpId,
          credential: {
            id: cred.id,
            publicKey: new Uint8Array(Buffer.from(cred.publicKey, 'base64url')),
            counter: cred.counter,
            transports: cred.transports,
          },
          requireUserVerification: false,
        });

        if (!verification.verified) {
          res.status(401).json({ error: 'Biometric signature verification failed.' });
          return;
        }

        const now = Date.now();
        cred.counter = verification.authenticationInfo.newCounter;
        cred.lastUsedAt = now;

        // Also establish/refresh the phone's authenticated session
        const { sessionId } = resolveOrCreateBrowserSession(req, res);
        adminSessions.set(sessionId, {
          browserSessionId: sessionId,
          adminId: staff.id,
          deviceId: cred.id,
          deviceName: cred.deviceName,
          authMethod: 'passkey',
          grantedAt: now,
          expiresAt: now + ADMIN_SESSION_TTL_MS,
        });
        persistRuntimeState();

        verifiedStaff = staff;
        verifiedDeviceId = cred.id;
        verifiedDeviceName = cred.deviceName;
      } else if (typeof password === 'string' && password.length > 0) {
        // Case B: Inline password verification for the confirming teacher on the phone
        const ip = getClientIp(req);
        const rateKey = `qrpwd:${ip}`;
        const limit = checkRateLimit(rateKey);
        if (!limit.allowed) {
          res.status(429).json({
            error: `Too many verification attempts. Wait ${limit.retryAfterSeconds} seconds.`,
          });
          return;
        }

        const targetId =
          challenge.requestedStaffId ||
          (typeof staffId === 'string' ? staffId.trim() : '') ||
          authority?.staff.id ||
          '';
        const staff = STAFF_DIRECTORY.find((s) => s.id === targetId);
        const storedCred = staff ? passwordCredentials.get(staff.id) : undefined;
        const passwordOk = Boolean(staff && verifyPasswordScrypt(password, storedCred));

        if (!passwordOk || !staff) {
          recordFailedRateLimitAttempt(rateKey);
          res.status(401).json({ error: 'Incorrect password for the selected teacher profile.' });
          return;
        }

        clearRateLimit(rateKey);
        const now = Date.now();
        const { sessionId } = resolveOrCreateBrowserSession(req, res);
        const phoneLabel = `${summarizeUserAgent(req.headers['user-agent'])} · Mobile`;
        adminSessions.set(sessionId, {
          browserSessionId: sessionId,
          adminId: staff.id,
          deviceId: `mobile-pwd-${sessionId.slice(0, 8)}`,
          deviceName: phoneLabel,
          authMethod: 'password',
          grantedAt: now,
          expiresAt: now + ADMIN_SESSION_TTL_MS,
        });
        persistRuntimeState();

        verifiedStaff = staff;
        verifiedDeviceId = `mobile-pwd-${sessionId.slice(0, 8)}`;
        verifiedDeviceName = phoneLabel;
      } else if (authority) {
        // Case C: Phone already holds an active teacher session/device and user tapped AUTHORISE DEVICE
        if (challenge.requestedStaffId && authority.staff.id !== challenge.requestedStaffId) {
          const requestedStaff = STAFF_DIRECTORY.find((s) => s.id === challenge.requestedStaffId);
          res.status(403).json({
            error: `This QR request belongs to ${requestedStaff?.name || 'another profile'}, but this phone is signed in as ${authority.staff.name}.`,
          });
          return;
        }
        verifiedStaff = authority.staff;
        verifiedDeviceId = authority.deviceId;
        verifiedDeviceName = authority.deviceName;
      } else {
        res.status(401).json({
          error: 'Verify your teacher identity (Passkey or password) on this phone to authorise the computer.',
        });
        return;
      }

      challenge.status = 'verifying';
      notifyChallengeSubscribers(challenge);

      challenge.respondedAt = Date.now();
      challenge.approvedByAdminId = verifiedStaff.id;
      challenge.approvedByDeviceId = verifiedDeviceId;
      challenge.approvedByDeviceName = verifiedDeviceName;
      challenge.status = 'approved';

      recordAudit({
        type: 'challenge_approved',
        summary: `PC access authorised by ${verifiedStaff.name}`,
        staffName: verifiedStaff.name,
        deviceName: verifiedDeviceName,
      });

      notifyChallengeSubscribers(challenge);

      res.json({
        ok: true,
        challengeId: challenge.challengeId,
        status: challenge.status,
        approvedBy: verifiedStaff.name,
      });
    } catch (err) {
      console.error('[auth] challenge/respond error:', err);
      res.status(500).json({ error: 'Server error while confirming PC authorisation.' });
    }
  });

  // 14. Admin-Protected Audit Endpoint
  app.get('/api/admin/access-events', requireAdmin, (_req, res) => {
    res.json({ events: accessAuditTrail });
  });

  // 15. Classroom Appliance Simulated-Node State & Admin Command Endpoints
  app.get('/api/classrooms/appliances/state', (_req, res) => {
    const rooms: Record<
      string,
      {
        roomId: string;
        roomCode: string;
        commandSeq: number;
        updatedAt: number;
        totalPowerWatts: number;
        appliances: Appliance[];
      }
    > = {};

    for (const [roomId, st] of roomApplianceStore.entries()) {
      const totalPowerWatts = st.appliances.reduce((acc, a) => acc + a.currentPowerWatts, 0);
      rooms[roomId] = {
        roomId: st.roomId,
        roomCode: st.roomCode,
        commandSeq: st.commandSeq,
        updatedAt: st.updatedAt,
        totalPowerWatts,
        appliances: st.appliances,
      };
    }

    res.json({ ok: true, rooms });
  });

  app.post('/api/classrooms/:roomId/appliances/command', requireAdmin, (req, res) => {
    const adminSess = (req as Request & { adminSession: AdminSession }).adminSession;
    const roomId = typeof req.params.roomId === 'string' ? req.params.roomId.trim() : '';
    const roomState = roomApplianceStore.get(roomId);

    if (!roomState) {
      res.status(404).json({ error: `Classroom '${roomId}' not found.` });
      return;
    }

    const {
      action,
      applianceId,
      type,
      outputPercent,
      targetPercent,
      targetLightPercent,
      targetFanPercent,
      isVacant,
      clientId,
      clientSeq,
    } = req.body || {};

    // Out-of-order stale command guard per client instance
    if (typeof clientId === 'string' && clientId.trim() && typeof clientSeq === 'number' && Number.isFinite(clientSeq)) {
      const guardKey = `${roomId}:${clientId.trim()}`;
      const prevSeq = clientRoomSeqGuard.get(guardKey) || 0;
      if (clientSeq <= prevSeq) {
        res.status(409).json({
          error: 'Stale command superseded by a newer appliance update.',
          stale: true,
          commandSeq: roomState.commandSeq,
          appliances: roomState.appliances,
        });
        return;
      }
      clientRoomSeqGuard.set(guardKey, clientSeq);
    }

    const now = Date.now();
    const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
    const roomVacant = typeof isVacant === 'boolean' ? isVacant : roomState.isVacantDefault;
    const beforePowerWatts = roomState.appliances.reduce((acc, a) => acc + a.currentPowerWatts, 0);
    let auditSummary = '';

    if (action === 'set_unit') {
      if (typeof applianceId !== 'string' || !applianceId.trim()) {
        res.status(400).json({ error: 'applianceId is required for set_unit.' });
        return;
      }
      if (typeof outputPercent !== 'number' || !Number.isFinite(outputPercent)) {
        res.status(400).json({ error: 'Valid numeric outputPercent (0-100) is required.' });
        return;
      }

      const idx = roomState.appliances.findIndex((a) => a.id === applianceId.trim());
      if (idx === -1) {
        res.status(404).json({ error: `Appliance '${applianceId}' is not configured in ${roomState.roomCode}.` });
        return;
      }

      const pct = clampPercent(outputPercent);
      const updated = [...roomState.appliances];
      const targetApp = updated[idx];
      updated[idx] = applyApplianceState(targetApp, pct, 'MANUAL', {
        isVacant: roomVacant,
        timestamp: now,
        sourceNote: 'Simulated Node Confirmed',
      });
      roomState.appliances = updated;
      auditSummary = `${roomState.roomCode} ${targetApp.unitCode || targetApp.name} set to ${pct === 0 ? 'OFF' : `${pct}%`} (MANUAL)`;
    } else if (action === 'restore_unit_auto') {
      if (typeof applianceId !== 'string' || !applianceId.trim()) {
        res.status(400).json({ error: 'applianceId is required for restore_unit_auto.' });
        return;
      }

      const idx = roomState.appliances.findIndex((a) => a.id === applianceId.trim());
      if (idx === -1) {
        res.status(404).json({ error: `Appliance '${applianceId}' is not configured in ${roomState.roomCode}.` });
        return;
      }

      const updated = [...roomState.appliances];
      const targetApp = updated[idx];
      const autoPct = roomVacant
        ? 0
        : typeof targetPercent === 'number' && Number.isFinite(targetPercent)
        ? clampPercent(targetPercent)
        : targetApp.type === 'lights'
        ? 50
        : 60;

      updated[idx] = applyApplianceState(targetApp, autoPct, 'AUTO', {
        isVacant: roomVacant,
        timestamp: now,
        sourceNote: 'Simulated Node Confirmed',
      });
      roomState.appliances = updated;
      auditSummary = `${roomState.roomCode} ${targetApp.unitCode || targetApp.name} restored to AUTO (${autoPct}%)`;
    } else if (action === 'set_group') {
      if (type !== 'lights' && type !== 'fan' && type !== 'projector' && type !== 'ac') {
        res.status(400).json({ error: "Group type must be 'lights', 'fan', 'projector', or 'ac'." });
        return;
      }
      if (typeof outputPercent !== 'number' || !Number.isFinite(outputPercent)) {
        res.status(400).json({ error: 'Valid numeric outputPercent (0-100) is required.' });
        return;
      }

      const pct = clampPercent(outputPercent);
      let count = 0;
      roomState.appliances = roomState.appliances.map((app) => {
        if (app.type !== type) return app;
        count++;
        return applyApplianceState(app, pct, 'MANUAL', {
          isVacant: roomVacant,
          timestamp: now,
          sourceNote: 'Simulated Node Confirmed',
        });
      });

      if (count === 0) {
        res.status(404).json({ error: `No '${type}' units configured in ${roomState.roomCode}.` });
        return;
      }

      const typeLabel =
        type === 'lights'
          ? 'lights'
          : type === 'fan'
          ? 'fan sectors'
          : type === 'projector'
          ? 'projectors'
          : 'AC units';
      auditSummary = `${roomState.roomCode} all ${count} ${typeLabel} set to ${pct === 0 ? 'OFF' : `${pct}%`} (MANUAL)`;
    } else if (action === 'restore_room_auto') {
      const lightPct = roomVacant
        ? 0
        : typeof targetLightPercent === 'number' && Number.isFinite(targetLightPercent)
        ? clampPercent(targetLightPercent)
        : 50;
      const fanPct = roomVacant
        ? 0
        : typeof targetFanPercent === 'number' && Number.isFinite(targetFanPercent)
        ? clampPercent(targetFanPercent)
        : 60;

      roomState.appliances = roomState.appliances.map((app) => {
        let pct = app.outputPercent ?? 0;
        if (app.type === 'lights') pct = lightPct;
        else if (app.type === 'fan') pct = fanPct;
        else if (roomVacant) pct = 0;

        return applyApplianceState(app, pct, 'AUTO', {
          isVacant: roomVacant,
          timestamp: now,
          sourceNote: 'Simulated Node Confirmed',
        });
      });
      auditSummary = `${roomState.roomCode} all appliances restored to AUTO (${roomVacant ? 'Vacant 0W shed' : `L:${lightPct}% · F:${fanPct}%`})`;
    } else {
      res.status(400).json({ error: `Unsupported appliance command action '${String(action)}'.` });
      return;
    }

    roomState.commandSeq += 1;
    roomState.updatedAt = now;
    persistRuntimeState();

    recordAudit({
      type: 'appliance_command',
      summary: auditSummary,
      staffName: staff?.name || adminSess.adminId,
      deviceName: adminSess.deviceName,
    });

    const totalPowerWatts = roomState.appliances.reduce((acc, a) => acc + a.currentPowerWatts, 0);

    energyHistoryService.recordControlEvent({
      roomId: roomState.roomId,
      roomCode: roomState.roomCode,
      eventType: String(action || 'appliance_command'),
      summary: auditSummary,
      actor: staff?.name || adminSess.adminId,
      beforeWatts: beforePowerWatts,
      afterWatts: totalPowerWatts,
      tsMs: now,
    });
    if (beforePowerWatts > totalPowerWatts) {
      try {
        interventionLedgerService.recordIntervention({
          idempotencyKey: `live-cmd-${roomState.roomId}-${roomState.commandSeq}-${now}`,
          roomId: roomState.roomId,
          source: 'simulated',
          isDemonstrationData: false,
          triggerTsMs: now,
          startTsMs: now,
          endTsMs: null,
          triggerCategory: action === 'restore_auto' ? 'audit_remediation' : 'manual_override',
          triggerSummary: auditSummary,
          evidenceSummary: `Authorized administrator command (${String(action || 'appliance_command')}) reduced simulated room load from ${beforePowerWatts} W to ${totalPowerWatts} W.`,
          sensorSnapshot: {
            pirStatus: roomState.isVacantDefault ? 'No Motion Detected' : 'Motion Active',
            dataOrigin: 'simulated_node',
          },
          ruleLogic:
            action === 'restore_auto'
              ? 'Admin Restore Adaptive AUTO Rule'
              : 'Admin Direct Appliance Control',
          affectedCircuitId: `${roomState.roomId}-combined`,
          affectedCircuitName: `${roomState.roomCode} Controlled Load`,
          circuitType: 'room_combined',
          previousState: `${beforePowerWatts} W active`,
          newState: `${totalPowerWatts} W active`,
          actionPerformed: auditSummary,
          actionStatus: 'active',
          actor: staff?.name || adminSess.adminId,
          counterfactualBaselineWatts: beforePowerWatts,
          postInterventionWatts: totalPowerWatts,
          baselineMethod: 'previous_state_power',
          baselineExplanation:
            'Pre-command active power recorded immediately before curtailment; avoided kWh remains withheld until an explicit end timestamp closes the intervention.',
          assumptions: [
            'Live simulated web control action (physical Arduino node not connected).',
            'Open/active intervention is never assigned fabricated future duration.',
          ],
          loadRatingSource: `ROOM_APPLIANCE_SPECS (${roomState.roomId})`,
        });
      } catch (ledgerErr) {
        console.warn('[ledger] Failed to record live appliance command intervention:', ledgerErr);
      }
    }
    energyHistoryService.recordRoomControlSnapshot(roomState, now);

    res.json({
      ok: true,
      roomId: roomState.roomId,
      roomCode: roomState.roomCode,
      commandSeq: roomState.commandSeq,
      updatedAt: roomState.updatedAt,
      totalPowerWatts,
      appliances: roomState.appliances,
    });
  });

  // 15b. Energy History & Historical Intelligence API Routes
  const ensureHistoryReadSession = (req: Request, res: Response, next: NextFunction) => {
    resolveOrCreateBrowserSession(req, res);
    next();
  };

  const readHistoryQueryStrings = (req: Request) => ({
    preset: typeof req.query.preset === 'string' ? req.query.preset.trim() : undefined,
    startDate: typeof req.query.startDate === 'string' ? req.query.startDate.trim() : undefined,
    endDate: typeof req.query.endDate === 'string' ? req.query.endDate.trim() : undefined,
    naturalQuery: typeof req.query.naturalQuery === 'string' ? req.query.naturalQuery.trim() : undefined,
    building: typeof req.query.building === 'string' ? req.query.building.trim() : undefined,
    roomId: typeof req.query.roomId === 'string' ? req.query.roomId.trim() : undefined,
  });

  app.get('/api/history/overview', ensureHistoryReadSession, (req, res) => {
    try {
      energyHistoryService.recordLiveSnapshot(Array.from(roomApplianceStore.values()), Date.now(), 'snapshot');
      const q = readHistoryQueryStrings(req);
      const data = energyHistoryService.getOverview({
        preset: q.preset,
        startDate: q.startDate,
        endDate: q.endDate,
        building: q.building,
        roomId: q.roomId,
      });
      res.json(data);
    } catch (err) {
      console.error('[history] /api/history/overview error:', err);
      res.status(500).json({ error: 'Unable to aggregate campus historical energy records.' });
    }
  });

  app.get('/api/history/room/:roomId', ensureHistoryReadSession, (req, res) => {
    try {
      const q = readHistoryQueryStrings(req);
      const rawRoomId = typeof req.params.roomId === 'string' ? req.params.roomId.trim() : '';
      const data = energyHistoryService.getRoomHistory({
        roomId: rawRoomId,
        preset: q.preset,
        startDate: q.startDate,
        endDate: q.endDate,
      });
      if (!data) {
        res.status(404).json({ error: `Classroom '${rawRoomId}' not found.` });
        return;
      }
      res.json(data);
    } catch (err) {
      console.error('[history] /api/history/room error:', err);
      res.status(500).json({ error: 'Unable to retrieve classroom historical trend.' });
    }
  });

  app.get('/api/history/time-of-day', ensureHistoryReadSession, (req, res) => {
    try {
      const q = readHistoryQueryStrings(req);
      const data = energyHistoryService.getTimeOfDayProfile({
        preset: q.preset,
        startDate: q.startDate,
        endDate: q.endDate,
        building: q.building,
        roomId: q.roomId,
      });
      res.json(data);
    } catch (err) {
      console.error('[history] /api/history/time-of-day error:', err);
      res.status(500).json({ error: 'Unable to compute time-of-day demand profile.' });
    }
  });

  app.get('/api/history/anomalies', ensureHistoryReadSession, (req, res) => {
    try {
      const q = readHistoryQueryStrings(req);
      const data = energyHistoryService.getAnomalies({
        preset: q.preset,
        startDate: q.startDate,
        endDate: q.endDate,
        building: q.building,
        roomId: q.roomId,
      });
      res.json(data);
    } catch (err) {
      console.error('[history] /api/history/anomalies error:', err);
      res.status(500).json({ error: 'Unable to evaluate historical anomalies.' });
    }
  });

  app.get('/api/history/investigate', ensureHistoryReadSession, (req, res) => {
    try {
      const q = readHistoryQueryStrings(req);
      const data = energyHistoryService.investigatePeriod({
        preset: q.preset,
        startDate: q.startDate,
        endDate: q.endDate,
        naturalQuery: q.naturalQuery,
        building: q.building,
        roomId: q.roomId,
      });
      res.json(data);
    } catch (err) {
      console.error('[history] /api/history/investigate error:', err);
      res.status(500).json({ error: 'Unable to run historical investigation.' });
    }
  });

  app.get('/api/history/interventions', ensureHistoryReadSession, (req, res) => {
    try {
      const readStr = (v: unknown): string | undefined =>
        typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
      const sortByRaw = readStr(req.query.sortBy);
      const sortBy =
        sortByRaw === 'energy' || sortByRaw === 'duration' || sortByRaw === 'room'
          ? sortByRaw
          : 'timestamp';
      const sortDir = readStr(req.query.sortDir) === 'asc' ? 'asc' : 'desc';

      const data = interventionLedgerService.listInterventions({
        preset: readStr(req.query.preset),
        startDate: readStr(req.query.startDate),
        endDate: readStr(req.query.endDate),
        building: readStr(req.query.building),
        roomId: readStr(req.query.roomId),
        triggerCategory: readStr(req.query.triggerCategory),
        circuitType: readStr(req.query.circuitType),
        actionStatus: readStr(req.query.actionStatus),
        source: readStr(req.query.source),
        verificationStatus: readStr(req.query.verificationStatus),
        search: readStr(req.query.search),
        sortBy,
        sortDir,
      });
      res.json(data);
    } catch (err) {
      console.error('[ledger] /api/history/interventions error:', err);
      res.status(500).json({ error: 'Unable to retrieve energy intervention ledger.' });
    }
  });

  app.get('/api/history/interventions/:id', ensureHistoryReadSession, (req, res) => {
    try {
      const rawId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
      if (!rawId) {
        res.status(400).json({ error: 'Intervention ID is required.' });
        return;
      }
      const detail = interventionLedgerService.getInterventionDetail(rawId);
      if (!detail) {
        res.status(404).json({ error: `Intervention '${rawId}' not found.` });
        return;
      }
      res.json(detail);
    } catch (err) {
      console.error('[ledger] /api/history/interventions/:id error:', err);
      res.status(500).json({ error: 'Unable to retrieve intervention detail.' });
    }
  });

  app.post('/api/history/interventions', requireAdmin, (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? (req.body as Partial<CreateInterventionInput>) : null;
      if (
        !body ||
        typeof body.roomId !== 'string' ||
        typeof body.source !== 'string' ||
        typeof body.startTsMs !== 'number' ||
        typeof body.triggerTsMs !== 'number' ||
        typeof body.affectedCircuitId !== 'string' ||
        typeof body.affectedCircuitName !== 'string' ||
        typeof body.circuitType !== 'string' ||
        typeof body.actionStatus !== 'string' ||
        typeof body.triggerCategory !== 'string'
      ) {
        res.status(400).json({
          error:
            'Missing required intervention ledger fields (roomId, source, triggerTsMs, startTsMs, triggerCategory, affectedCircuitId, affectedCircuitName, circuitType, actionStatus).',
        });
        return;
      }

      const result = interventionLedgerService.recordIntervention({
        id: typeof body.id === 'string' ? body.id : undefined,
        idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
        eventGroupId: typeof body.eventGroupId === 'string' ? body.eventGroupId : undefined,
        parentEventId: typeof body.parentEventId === 'string' ? body.parentEventId : null,
        roomId: body.roomId,
        source: body.source,
        requestedVerificationStatus: body.requestedVerificationStatus,
        hasDocumentedBaselineVerification: Boolean(body.hasDocumentedBaselineVerification),
        isDemonstrationData: body.isDemonstrationData,
        triggerTsMs: body.triggerTsMs,
        startTsMs: body.startTsMs,
        endTsMs: typeof body.endTsMs === 'number' ? body.endTsMs : null,
        triggerCategory: body.triggerCategory,
        triggerSummary: String(body.triggerSummary || 'Recorded intervention'),
        evidenceSummary: String(body.evidenceSummary || 'Recorded via ROOMWISE intervention API'),
        sensorSnapshot: body.sensorSnapshot ?? { dataOrigin: 'unavailable' },
        ruleLogic: String(body.ruleLogic || 'Unspecified control rule'),
        affectedCircuitId: body.affectedCircuitId,
        affectedCircuitName: body.affectedCircuitName,
        circuitType: body.circuitType,
        previousState: String(body.previousState || 'Unknown'),
        newState: String(body.newState || 'Unknown'),
        actionPerformed: String(body.actionPerformed || 'Control state updated'),
        actionStatus: body.actionStatus,
        actor: String(body.actor || 'ROOMWISE Administrator'),
        counterfactualBaselineWatts:
          typeof body.counterfactualBaselineWatts === 'number' ? body.counterfactualBaselineWatts : null,
        postInterventionWatts:
          typeof body.postInterventionWatts === 'number' ? body.postInterventionWatts : null,
        baselineMethod: body.baselineMethod ?? 'unavailable',
        baselineExplanation: String(body.baselineExplanation || 'No baseline methodology supplied.'),
        assumptions: Array.isArray(body.assumptions) ? body.assumptions.map(String) : [],
        loadRatingSource: String(body.loadRatingSource || 'Unspecified'),
      });

      res.status(result.created ? 201 : 200).json({
        ok: true,
        created: result.created,
        duplicate: result.duplicate,
        record: result.record,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to record intervention.';
      res.status(400).json({ error: msg });
    }
  });

  // 15c. Space Intelligence — Attendance-Aware Classroom Allocation Routes
  app.get('/api/settings', ensureHistoryReadSession, (_req, res) => {
    res.json({ ok: true, settings: persistedSchoolSettings });
  });

  app.patch('/api/settings', requireAdmin, (req, res) => {
    const adminSess = (req as Request & { adminSession: AdminSession }).adminSession;
    const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const prevLat = persistedSchoolSettings.campusCoordinates?.latitude;
    const prevLng = persistedSchoolSettings.campusCoordinates?.longitude;
    persistedSchoolSettings = normalizeSchoolSettings({
      ...persistedSchoolSettings,
      ...body,
      campusCoordinates:
        body.campusCoordinates && typeof body.campusCoordinates === 'object'
          ? {
              ...persistedSchoolSettings.campusCoordinates,
              ...body.campusCoordinates,
            }
          : persistedSchoolSettings.campusCoordinates,
      schoolHours:
        body.schoolHours && typeof body.schoolHours === 'object'
          ? { ...persistedSchoolSettings.schoolHours, ...body.schoolHours }
          : persistedSchoolSettings.schoolHours,
    });
    if (
      prevLat !== persistedSchoolSettings.campusCoordinates?.latitude ||
      prevLng !== persistedSchoolSettings.campusCoordinates?.longitude
    ) {
      environmentalService.invalidateCache();
    }
    persistRuntimeState();
    recordAudit({
      type: 'appliance_command',
      summary: `System Settings updated (₹${persistedSchoolSettings.tariffPerKWhINR}/kWh · ${persistedSchoolSettings.learningMode})`,
      staffName: staff?.name || adminSess.adminId,
      deviceName: adminSess.deviceName,
    });
    res.json({ ok: true, settings: persistedSchoolSettings });
  });

  // 15d. Environmental Intelligence (Open-Meteo) & Solar Intelligence (EC JRC PVGIS 5.3)
  const buildLiveClassroomsSnapshot = (): Classroom[] => {
    return INITIAL_CLASSROOMS.map((room) => {
      const liveState = roomApplianceStore.get(room.id);
      if (!liveState) return room;
      const livePowerWatts = liveState.appliances.reduce(
        (sum, app) => sum + (Number.isFinite(app.currentPowerWatts) ? app.currentPowerWatts : 0),
        0
      );
      return {
        ...room,
        appliances: liveState.appliances,
        currentPowerWatts: Math.round(livePowerWatts),
      };
    });
  };

  app.get('/api/environment/overview', ensureHistoryReadSession, async (req, res) => {
    try {
      const rawTilt = req.query.tilt !== undefined ? Number(req.query.tilt) : undefined;
      const rawAzimuth = req.query.azimuth !== undefined ? Number(req.query.azimuth) : undefined;
      const overview = await environmentalService.getOverview({
        settings: persistedSchoolSettings,
        classrooms: buildLiveClassroomsSnapshot(),
        forceRefresh: false,
        tiltDeg: Number.isFinite(rawTilt) ? rawTilt : undefined,
        azimuthDeg: Number.isFinite(rawAzimuth) ? rawAzimuth : undefined,
      });
      res.json(overview);
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Failed to compute environmental intelligence overview.',
      });
    }
  });

  app.post('/api/environment/refresh', requireAdmin, async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const overview = await environmentalService.getOverview({
        settings: persistedSchoolSettings,
        classrooms: buildLiveClassroomsSnapshot(),
        forceRefresh: true,
        tiltDeg: typeof body.tiltDeg === 'number' ? body.tiltDeg : undefined,
        azimuthDeg: typeof body.azimuthDeg === 'number' ? body.azimuthDeg : undefined,
      });
      res.json(overview);
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Failed to refresh Open-Meteo environmental data.',
      });
    }
  });

  // Intelligent Rooftop Solar Assessment (OpenStreetMap Overpass API + EC JRC PVGIS 5.3)
  app.get('/api/solar/workspace', ensureHistoryReadSession, async (req, res) => {
    try {
      const subsetRaw = typeof req.query.subset === 'string' ? req.query.subset.trim() : '';
      const subsetBuildingIds = subsetRaw
        ? subsetRaw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      const allowLiveDiscovery = req.query.discover === 'true';
      const workspace = await solarService.getWorkspace(persistedSchoolSettings, {
        allowLiveDiscovery,
        subsetBuildingIds,
      });
      res.json(workspace);
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Failed to load rooftop solar workspace.',
      });
    }
  });

  app.post('/api/solar/discover', requireAdmin, async (req, res) => {
    try {
      const adminSess = (req as Request & { adminSession: AdminSession }).adminSession;
      const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
      const actor = staff?.name || adminSess.adminId;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const radius =
        typeof body.searchRadiusMeters === 'number' && Number.isFinite(body.searchRadiusMeters)
          ? body.searchRadiusMeters
          : undefined;

      const workspace = await solarService.refreshDiscovery(
        persistedSchoolSettings,
        radius,
        actor
      );

      recordAudit({
        type: 'appliance_command',
        summary: `OpenStreetMap Overpass building discovery refreshed (${workspace.buildings.length} buildings within ${workspace.assumptions.searchRadiusMeters} m)`,
        staffName: actor,
        deviceName: adminSess.deviceName,
      });

      res.json(workspace);
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Failed to refresh OpenStreetMap building discovery.',
      });
    }
  });

  app.patch('/api/solar/buildings/:id', requireAdmin, async (req, res) => {
    try {
      const adminSess = (req as Request & { adminSession: AdminSession }).adminSession;
      const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
      const actor = staff?.name || adminSess.adminId;
      const buildingId = decodeURIComponent(req.params.id);
      const body = req.body && typeof req.body === 'object' ? req.body : {};

      const override = solarService.upsertBuildingOverride(buildingId, body, actor);
      const workspace = await solarService.getWorkspace(persistedSchoolSettings, {
        allowLiveDiscovery: false,
      });

      recordAudit({
        type: 'appliance_command',
        summary: `Campus building ${override.customName || buildingId} updated (status: ${override.selectionStatus})`,
        staffName: actor,
        deviceName: adminSess.deviceName,
      });

      res.json({ ok: true, override, workspace });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Failed to update building solar configuration.',
      });
    }
  });

  app.post('/api/solar/buildings/manual', requireAdmin, async (req, res) => {
    try {
      const adminSess = (req as Request & { adminSession: AdminSession }).adminSession;
      const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
      const actor = staff?.name || adminSess.adminId;
      const body = req.body && typeof req.body === 'object' ? req.body : {};

      const campusRef = {
        lat: persistedSchoolSettings.campusCoordinates?.latitude ?? 22.3121,
        lon: persistedSchoolSettings.campusCoordinates?.longitude ?? 87.2994,
      };

      const created = solarService.createManualBuilding(
        {
          name: body.name,
          campusLabel: body.campusLabel,
          buildingType: body.buildingType,
          polygonPoints: Array.isArray(body.polygonPoints) ? body.polygonPoints : undefined,
          footprintAreaM2:
            typeof body.footprintAreaM2 === 'number' ? body.footprintAreaM2 : undefined,
          centroid:
            body.centroid &&
            typeof body.centroid.lat === 'number' &&
            typeof body.centroid.lon === 'number'
              ? body.centroid
              : undefined,
        },
        campusRef,
        actor
      );

      const workspace = await solarService.getWorkspace(persistedSchoolSettings, {
        allowLiveDiscovery: false,
      });

      recordAudit({
        type: 'appliance_command',
        summary: `Manual campus building footprint added (${body.name || created.id})`,
        staffName: actor,
        deviceName: adminSess.deviceName,
      });

      res.json({ ok: true, id: created.id, workspace });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Failed to create manual building footprint.',
      });
    }
  });

  app.delete('/api/solar/buildings/manual/:id', requireAdmin, async (req, res) => {
    try {
      const adminSess = (req as Request & { adminSession: AdminSession }).adminSession;
      const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
      const actor = staff?.name || adminSess.adminId;
      const buildingId = decodeURIComponent(req.params.id);

      const deleted = solarService.deleteManualBuilding(buildingId);
      if (!deleted) {
        res.status(404).json({ ok: false, error: 'Manual building footprint not found.' });
        return;
      }

      const workspace = await solarService.getWorkspace(persistedSchoolSettings, {
        allowLiveDiscovery: false,
      });

      recordAudit({
        type: 'appliance_command',
        summary: `Manual campus building footprint removed (${buildingId})`,
        staffName: actor,
        deviceName: adminSess.deviceName,
      });

      res.json({ ok: true, workspace });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Failed to delete manual building footprint.',
      });
    }
  });

  app.post('/api/solar/calculate/building', ensureHistoryReadSession, async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const buildingId = typeof body.buildingId === 'string' ? body.buildingId.trim() : '';
      if (!buildingId) {
        res.status(400).json({ ok: false, error: 'buildingId is required.' });
        return;
      }
      const { building, result, workspace } = await solarService.calculateSingleBuilding(
        persistedSchoolSettings,
        buildingId,
        { forceRefresh: Boolean(body.forceRefresh) }
      );
      res.json({ ok: true, building, result, workspace });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Failed to calculate PVGIS solar potential for building.',
      });
    }
  });

  app.post('/api/solar/calculate/campus', ensureHistoryReadSession, async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const buildingIds = Array.isArray(body.buildingIds)
        ? body.buildingIds.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
        : undefined;
      const workspace = await solarService.calculateCampusOrSubset(persistedSchoolSettings, {
        buildingIds,
        forceRefresh: Boolean(body.forceRefresh),
      });
      res.json(workspace);
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Failed to calculate campus PVGIS solar potential.',
      });
    }
  });

  app.get('/api/solar/assumptions', ensureHistoryReadSession, (_req, res) => {
    try {
      res.json({ ok: true, assumptions: solarService.getAssumptions() });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Failed to load solar assumptions.',
      });
    }
  });

  app.patch('/api/solar/assumptions', requireAdmin, async (req, res) => {
    try {
      const adminSess = (req as Request & { adminSession: AdminSession }).adminSession;
      const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
      const actor = staff?.name || adminSess.adminId;
      const body = req.body && typeof req.body === 'object' ? req.body : {};

      const assumptions = solarService.updateAssumptions(body, actor);
      const workspace = await solarService.getWorkspace(persistedSchoolSettings, {
        allowLiveDiscovery: false,
      });

      recordAudit({
        type: 'appliance_command',
        summary: `Solar assessment defaults updated (radius ${assumptions.searchRadiusMeters} m, usable ${assumptions.usableRoofFractionPercent}%, ${assumptions.panelRatedWatts} W panels, ${assumptions.systemLossesPercent}% loss)`,
        staffName: actor,
        deviceName: adminSess.deviceName,
      });

      res.json({ ok: true, assumptions, workspace });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Failed to save solar assumptions.',
      });
    }
  });

  app.post('/api/solar/assumptions/reset', requireAdmin, async (req, res) => {
    try {
      const adminSess = (req as Request & { adminSession: AdminSession }).adminSession;
      const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
      const actor = staff?.name || adminSess.adminId;

      const assumptions = solarService.resetAssumptions(actor);
      const workspace = await solarService.getWorkspace(persistedSchoolSettings, {
        allowLiveDiscovery: false,
      });

      recordAudit({
        type: 'appliance_command',
        summary: 'Solar assessment assumptions restored to ROOMWISE standard defaults',
        staffName: actor,
        deviceName: adminSess.deviceName,
      });

      res.json({ ok: true, assumptions, workspace });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Failed to reset solar assumptions.',
      });
    }
  });

  app.post('/api/solar/campus/restore', requireAdmin, async (req, res) => {
    try {
      const adminSess = (req as Request & { adminSession: AdminSession }).adminSession;
      const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
      const actor = staff?.name || adminSess.adminId;

      const restoredCount = solarService.restoreReconstructedCampus();
      const workspace = await solarService.getWorkspace(persistedSchoolSettings, {
        allowLiveDiscovery: false,
      });

      recordAudit({
        type: 'appliance_command',
        summary: `Restored image-reconstructed campus layout (${restoredCount} override record(s) reset)`,
        staffName: actor,
        deviceName: adminSess.deviceName,
      });

      res.json({ ok: true, restoredCount, workspace });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Failed to restore image-reconstructed campus layout.',
      });
    }
  });

  app.get('/api/solar/history', ensureHistoryReadSession, (_req, res) => {
    try {
      res.json({ ok: true, history: solarService.getHistory(30) });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Failed to load PVGIS solar assessment history.',
      });
    }
  });

  app.post('/api/demo/reset', ensureHistoryReadSession, (_req, res) => {
    try {
      const now = Date.now();
      for (const spec of ROOM_APPLIANCE_SPECS) {
        roomApplianceStore.set(spec.roomId, {
          roomId: spec.roomId,
          roomCode: spec.roomCode,
          isVacantDefault: spec.isVacant,
          commandSeq: 0,
          updatedAt: now,
          appliances: buildExpandedAppliancesFromSpec(spec),
        });
      }
      clientRoomSeqGuard.clear();
      persistRuntimeState();

      spaceIntelligenceService.resetTemporaryAllocationState({
        tariffPerKWhINR: persistedSchoolSettings.tariffPerKWhINR,
        gridCarbonFactorKgCO2PerKWh: persistedSchoolSettings.gridCarbonFactorKgCO2PerKWh,
      });

      res.json({ ok: true, resetAt: now });
    } catch (err) {
      console.error('[demo] /api/demo/reset error:', err);
      res.status(500).json({ error: 'Unable to restore exhibition baseline state.' });
    }
  });

  app.get('/api/space/bootstrap', ensureHistoryReadSession, (req, res) => {
    try {
      const selectedDate =
        typeof req.query.attendanceDate === 'string' ? req.query.attendanceDate.trim() : undefined;
      const payload = spaceIntelligenceService.getBootstrapPayload(selectedDate, {
        tariffPerKWhINR: persistedSchoolSettings.tariffPerKWhINR,
        gridCarbonFactorKgCO2PerKWh: persistedSchoolSettings.gridCarbonFactorKgCO2PerKWh,
      });
      res.json(payload);
    } catch (err) {
      console.error('[space] /api/space/bootstrap error:', err);
      res.status(500).json({ error: 'Unable to load Space Intelligence state.' });
    }
  });

  app.get('/api/space/template.csv', (_req, res) => {
    try {
      const csv = spaceIntelligenceService.buildTemplateCsv();
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="ROOMWISE_Attendance_Template.csv"'
      );
      res.send(csv);
    } catch (err) {
      console.error('[space] /api/space/template.csv error:', err);
      res.status(500).json({ error: 'Unable to generate attendance CSV template.' });
    }
  });

  app.post('/api/space/attendance/parse', ensureHistoryReadSession, (req, res) => {
    try {
      const { fileName, fileBase64, csvText, sheetName, columnMapping } = req.body || {};
      const result = spaceIntelligenceService.parseAttendanceSpreadsheet({
        fileName: typeof fileName === 'string' ? fileName : 'attendance_upload.csv',
        fileBase64: typeof fileBase64 === 'string' ? fileBase64 : undefined,
        csvText: typeof csvText === 'string' ? csvText : undefined,
        sheetName: typeof sheetName === 'string' ? sheetName : undefined,
        columnMapping:
          columnMapping && typeof columnMapping === 'object' ? columnMapping : undefined,
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to parse attendance spreadsheet.';
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/space/attendance/commit', requireAdmin, (req, res) => {
    const adminSess = (req as Request & { adminSession: AdminSession }).adminSession;
    const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
    try {
      const { rows, fileName } = req.body || {};
      const result = spaceIntelligenceService.commitValidatedAttendance({
        rows: Array.isArray(rows) ? rows : [],
        actorName: staff?.name || adminSess.adminId,
        fileName: typeof fileName === 'string' ? fileName : undefined,
      });
      recordAudit({
        type: 'appliance_command',
        summary: `Space Intelligence: committed ${result.committedCount} validated attendance rows (${result.datesAffected.join(', ')})`,
        staffName: staff?.name || adminSess.adminId,
        deviceName: adminSess.deviceName,
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Attendance commit failed.';
      res.status(400).json({ error: msg });
    }
  });

  app.patch('/api/space/sections/:sectionId', requireAdmin, (req, res) => {
    const adminSess = (req as Request & { adminSession: AdminSession }).adminSession;
    const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
    const sectionId = typeof req.params.sectionId === 'string' ? req.params.sectionId.trim() : '';
    try {
      const { enrolledStrength, policy, policyNotes } = req.body || {};
      const updated = spaceIntelligenceService.updateSectionConfig(sectionId, {
        enrolledStrength:
          typeof enrolledStrength === 'number' ? enrolledStrength : undefined,
        policy,
        policyNotes,
      });
      recordAudit({
        type: 'appliance_command',
        summary: `Space Intelligence: updated ${updated.sectionCode} (Strength ${updated.enrolledStrength}, Policy ${updated.policy})`,
        staffName: staff?.name || adminSess.adminId,
        deviceName: adminSess.deviceName,
      });
      res.json({ ok: true, section: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to update section configuration.';
      res.status(400).json({ error: msg });
    }
  });

  app.patch('/api/space/rooms/:roomId', requireAdmin, (req, res) => {
    const adminSess = (req as Request & { adminSession: AdminSession }).adminSession;
    const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
    const roomId = typeof req.params.roomId === 'string' ? req.params.roomId.trim() : '';
    try {
      const { maxOccupancy } = req.body || {};
      const updated = spaceIntelligenceService.updateRoomMaxOccupancy(roomId, Number(maxOccupancy));
      recordAudit({
        type: 'appliance_command',
        summary: `Space Intelligence: updated ${updated.roomCode} Max Occupancy to ${updated.maxOccupancy} seats`,
        staffName: staff?.name || adminSess.adminId,
        deviceName: adminSess.deviceName,
      });
      res.json({ ok: true, room: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to update classroom max occupancy.';
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/space/analyze', ensureHistoryReadSession, (req, res) => {
    try {
      const { attendanceDate, mode } = req.body || {};
      const cleanDate = typeof attendanceDate === 'string' ? attendanceDate.trim() : undefined;
      const cleanMode = mode === 'actual' || mode === 'projected' ? mode : undefined;
      const result = spaceIntelligenceService.runAllocationAnalysis({
        attendanceDate: cleanDate,
        mode: cleanMode,
        tariffPerKWhINR: persistedSchoolSettings.tariffPerKWhINR,
        gridCarbonFactorKgCO2PerKWh: persistedSchoolSettings.gridCarbonFactorKgCO2PerKWh,
      });
      res.json(result);
    } catch (err) {
      console.error('[space] /api/space/analyze error:', err);
      const msg = err instanceof Error ? err.message : 'Allocation analysis failed.';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/space/proposals/:proposalId/approve', requireAdmin, (req, res) => {
    const adminSess = (req as Request & { adminSession: AdminSession }).adminSession;
    const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
    const proposalId =
      typeof req.params.proposalId === 'string' ? req.params.proposalId.trim() : '';
    try {
      const { note } = req.body || {};
      const result = spaceIntelligenceService.reviewProposal({
        proposalId,
        decision: 'approved',
        actorName: staff?.name || adminSess.adminId,
        note: typeof note === 'string' ? note : undefined,
      });
      recordAudit({
        type: 'appliance_command',
        summary: `Space Intelligence APPROVED: ${result.proposal.sectionCode} (${result.proposal.existingRoomCode} → ${result.proposal.proposedRoomCode}, ${result.proposal.windowLabel}, +${result.proposal.netEnergySavingsKWh} kWh)`,
        staffName: staff?.name || adminSess.adminId,
        deviceName: adminSess.deviceName,
      });
      res.json(result);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode || 400;
      const msg = err instanceof Error ? err.message : 'Approval failed.';
      res.status(status).json({ error: msg });
    }
  });

  app.post('/api/space/proposals/:proposalId/reject', requireAdmin, (req, res) => {
    const adminSess = (req as Request & { adminSession: AdminSession }).adminSession;
    const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
    const proposalId =
      typeof req.params.proposalId === 'string' ? req.params.proposalId.trim() : '';
    try {
      const { note } = req.body || {};
      const result = spaceIntelligenceService.reviewProposal({
        proposalId,
        decision: 'rejected',
        actorName: staff?.name || adminSess.adminId,
        note: typeof note === 'string' ? note : undefined,
      });
      recordAudit({
        type: 'appliance_command',
        summary: `Space Intelligence REJECTED: ${result.proposal.sectionCode} (${result.proposal.existingRoomCode} → ${result.proposal.proposedRoomCode})`,
        staffName: staff?.name || adminSess.adminId,
        deviceName: adminSess.deviceName,
      });
      res.json(result);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode || 400;
      const msg = err instanceof Error ? err.message : 'Rejection failed.';
      res.status(status).json({ error: msg });
    }
  });

  app.get('/api/space/history', ensureHistoryReadSession, (req, res) => {
    try {
      const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
      const history = spaceIntelligenceService.listAllocationHistory(limit);
      res.json({ ok: true, history });
    } catch (err) {
      console.error('[space] /api/space/history error:', err);
      res.status(500).json({ error: 'Unable to fetch allocation history.' });
    }
  });

  // 16. Create HTTP Server & Mount Gemini Live Voice Assistant WebSocket Bridge
  const httpServer = http.createServer(app);

  const resolveAdminFromWs = (
    req: IncomingMessage,
    explicitToken?: string | null
  ): VoiceAdminIdentity | null => {
    let cookieSid: string | undefined;
    const rawCookie = req.headers.cookie;
    if (rawCookie) {
      for (const pair of rawCookie.split(';')) {
        const idx = pair.indexOf('=');
        if (idx === -1) continue;
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        if (k === 'roomwise_sid') {
          try {
            cookieSid = decodeURIComponent(v);
          } catch {
            cookieSid = v;
          }
          break;
        }
      }
    }

    const sid = verifyToken(explicitToken || undefined, 'sid') || verifyToken(cookieSid, 'sid');
    if (!sid) return null;

    const adminSess = adminSessions.get(sid);
    if (!adminSess || Date.now() > adminSess.expiresAt) {
      if (adminSess) adminSessions.delete(sid);
      return null;
    }

    const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
    if (!staff) return null;

    return {
      sessionId: sid,
      adminId: staff.id,
      adminName: staff.name,
      role: staff.role,
      deviceName: adminSess.deviceName,
    };
  };

  const executeVoiceApplianceCommand = (
    input: ServerApplianceCommandInput
  ): ServerApplianceCommandOutput => {
    const roomState = roomApplianceStore.get(input.roomId);
    if (!roomState) {
      return { ok: false, error: `Classroom '${input.roomId}' not found.` };
    }

    const now = Date.now();
    const roomVacant = typeof input.isVacant === 'boolean' ? input.isVacant : roomState.isVacantDefault;
    const beforePowerWatts = roomState.appliances.reduce((acc, a) => acc + a.currentPowerWatts, 0);
    let auditSummary = '';

    if (input.action === 'set_unit') {
      const idx = roomState.appliances.findIndex((a) => a.id === input.applianceId);
      if (idx === -1) {
        return { ok: false, error: `Appliance '${input.applianceId}' not found in ${roomState.roomCode}.` };
      }
      const pct = clampPercent(input.outputPercent ?? 0);
      const updated = [...roomState.appliances];
      const targetApp = updated[idx];
      updated[idx] = applyApplianceState(targetApp, pct, 'MANUAL', {
        isVacant: roomVacant,
        timestamp: now,
        sourceNote: 'Voice Assistant Confirmed',
      });
      roomState.appliances = updated;
      auditSummary = `${roomState.roomCode} ${targetApp.unitCode || targetApp.name} set to ${pct === 0 ? 'OFF' : `${pct}%`} (MANUAL via Voice)`;
    } else if (input.action === 'restore_unit_auto') {
      const idx = roomState.appliances.findIndex((a) => a.id === input.applianceId);
      if (idx === -1) {
        return { ok: false, error: `Appliance '${input.applianceId}' not found in ${roomState.roomCode}.` };
      }
      const updated = [...roomState.appliances];
      const targetApp = updated[idx];
      const autoPct = roomVacant
        ? 0
        : typeof input.targetPercent === 'number'
        ? clampPercent(input.targetPercent)
        : targetApp.type === 'lights'
        ? 50
        : targetApp.type === 'fan'
        ? 60
        : 0;
      updated[idx] = applyApplianceState(targetApp, autoPct, 'AUTO', {
        isVacant: roomVacant,
        timestamp: now,
        sourceNote: 'Voice Assistant Confirmed',
      });
      roomState.appliances = updated;
      auditSummary = `${roomState.roomCode} ${targetApp.unitCode || targetApp.name} restored to AUTO (${autoPct}%)`;
    } else if (input.action === 'set_group') {
      const targetType = input.type || 'lights';
      const pct = clampPercent(input.outputPercent ?? 0);
      let count = 0;
      roomState.appliances = roomState.appliances.map((app) => {
        if (targetType !== 'all' && app.type !== targetType) return app;
        count++;
        return applyApplianceState(app, pct, 'MANUAL', {
          isVacant: roomVacant,
          timestamp: now,
          sourceNote: 'Voice Assistant Confirmed',
        });
      });
      if (count === 0) {
        return { ok: false, error: `No '${targetType}' units found in ${roomState.roomCode}.` };
      }
      const label =
        targetType === 'all'
          ? 'appliances'
          : targetType === 'lights'
          ? 'lights'
          : targetType === 'fan'
          ? 'fan sectors'
          : targetType === 'projector'
          ? 'projectors'
          : 'AC units';
      auditSummary = `${roomState.roomCode} all ${count} ${label} set to ${pct === 0 ? 'OFF' : `${pct}%`} (MANUAL via Voice)`;
    } else if (input.action === 'restore_room_auto') {
      const targetType = input.type && input.type !== 'all' ? input.type : undefined;
      const lightPct = roomVacant
        ? 0
        : typeof input.targetLightPercent === 'number'
        ? clampPercent(input.targetLightPercent)
        : 50;
      const fanPct = roomVacant
        ? 0
        : typeof input.targetFanPercent === 'number'
        ? clampPercent(input.targetFanPercent)
        : 60;
      roomState.appliances = roomState.appliances.map((app) => {
        if (targetType && app.type !== targetType) return app;
        let pct = app.outputPercent ?? 0;
        if (app.type === 'lights') pct = lightPct;
        else if (app.type === 'fan') pct = fanPct;
        else if (roomVacant) pct = 0;
        return applyApplianceState(app, pct, 'AUTO', {
          isVacant: roomVacant,
          timestamp: now,
          sourceNote: 'Voice Assistant Confirmed',
        });
      });
      auditSummary = targetType
        ? `${roomState.roomCode} ${targetType === 'lights' ? 'lights' : targetType === 'fan' ? 'fan sectors' : targetType} restored to AUTO`
        : `${roomState.roomCode} all appliances restored to AUTO`;
    } else {
      return { ok: false, error: 'Unsupported appliance action.' };
    }

    roomState.commandSeq += 1;
    roomState.updatedAt = now;
    persistRuntimeState();

    // Explicit post-write state verification against authoritative store before returning ok
    const storedRoom = roomApplianceStore.get(roomState.roomId);
    if (!storedRoom) {
      return { ok: false, error: `State verification failed: classroom '${roomState.roomId}' missing after update.` };
    }

    let verifiedUnit: ServerApplianceCommandOutput['verifiedUnit'];
    if (input.action === 'set_unit' || input.action === 'restore_unit_auto') {
      const checkedUnit = storedRoom.appliances.find((a) => a.id === input.applianceId);
      const expectedMode = input.action === 'set_unit' ? 'MANUAL' : 'AUTO';
      const expectedPct =
        input.action === 'set_unit'
          ? clampPercent(input.outputPercent ?? 0)
          : checkedUnit?.outputPercent;
      if (
        !checkedUnit ||
        checkedUnit.operatingMode !== expectedMode ||
        (typeof expectedPct === 'number' && checkedUnit.outputPercent !== expectedPct)
      ) {
        return {
          ok: false,
          error: `State verification failed for unit '${input.applianceId}' in ${storedRoom.roomCode}.`,
        };
      }
      verifiedUnit = {
        id: checkedUnit.id,
        unitCode: checkedUnit.unitCode,
        name: checkedUnit.name,
        outputPercent: checkedUnit.outputPercent ?? 0,
        operatingMode: checkedUnit.operatingMode ?? expectedMode,
        currentPowerWatts: checkedUnit.currentPowerWatts,
      };
    } else if (input.action === 'set_group') {
      const targetType = input.type || 'lights';
      const expectedPct = clampPercent(input.outputPercent ?? 0);
      const mismatched = storedRoom.appliances.find(
        (a) =>
          (targetType === 'all' || a.type === targetType) &&
          (a.operatingMode !== 'MANUAL' || a.outputPercent !== expectedPct)
      );
      if (mismatched) {
        return {
          ok: false,
          error: `State verification failed for group '${targetType}' in ${storedRoom.roomCode}.`,
        };
      }
    }

    recordAudit({
      type: 'appliance_command',
      summary: auditSummary,
      staffName: input.admin.adminName,
      deviceName: `${input.admin.deviceName} · Voice`,
    });

    const totalPowerWatts = storedRoom.appliances.reduce((acc, a) => acc + a.currentPowerWatts, 0);
    energyHistoryService.recordControlEvent({
      roomId: storedRoom.roomId,
      roomCode: storedRoom.roomCode,
      eventType: `voice_${input.action}`,
      summary: auditSummary,
      actor: `${input.admin.adminName} (Voice)`,
      beforeWatts: beforePowerWatts,
      afterWatts: totalPowerWatts,
      tsMs: now,
    });
    energyHistoryService.recordRoomControlSnapshot(storedRoom, now);

    return {
      ok: true,
      verified: true,
      roomId: storedRoom.roomId,
      roomCode: storedRoom.roomCode,
      appliances: storedRoom.appliances,
      totalPowerWatts,
      summary: auditSummary,
      verifiedUnit,
    };
  };

  const baseClassroomById = new Map<string, Classroom>(
    INITIAL_CLASSROOMS.map((room) => [room.id, room])
  );

  const executeCampusOptimization = (input: CampusOptimizationInput): CampusOptimizationOutput => {
    const scope = input.scope || 'all';
    const now = Date.now();
    const optimizedRooms: CampusOptimizationOutput['optimizedRooms'] = [];
    let curtailedWatts = 0;

    const targetEntries: Array<[string, ServerRoomApplianceState]> =
      scope === 'room'
        ? (() => {
            if (!input.roomId) return [];
            const found = roomApplianceStore.get(input.roomId);
            return found ? [[input.roomId, found]] : [];
          })()
        : Array.from(roomApplianceStore.entries());

    if (scope === 'room' && targetEntries.length === 0) {
      return {
        ok: false,
        error: `Classroom '${input.roomId || ''}' not found for optimization.`,
        optimizedRooms: [],
        curtailedWatts: 0,
        summary: 'Target classroom not found.',
      };
    }

    for (const [roomId, roomState] of targetEntries) {
      const targetMeta = input.roomTargets?.[roomId];
      const baseRoom = baseClassroomById.get(roomId);
      const isVacant =
        typeof targetMeta?.isVacant === 'boolean'
          ? targetMeta.isVacant
          : roomState.isVacantDefault;

      if (scope === 'vacant_only' && !isVacant) {
        continue;
      }

      const targetLightPct = isVacant
        ? 0
        : typeof targetMeta?.targetLightPercent === 'number' && Number.isFinite(targetMeta.targetLightPercent)
        ? clampPercent(targetMeta.targetLightPercent)
        : baseRoom
        ? computeAdaptiveTargetLightPercent(baseRoom)
        : 50;

      const targetFanPct = isVacant
        ? 0
        : typeof targetMeta?.targetFanPercent === 'number' && Number.isFinite(targetMeta.targetFanPercent)
        ? clampPercent(targetMeta.targetFanPercent)
        : baseRoom
        ? computeAdaptiveTargetFanPercent(baseRoom)
        : 60;

      const beforeWatts = roomState.appliances.reduce((acc, a) => acc + a.currentPowerWatts, 0);
      let changed = false;

      const nextAppliances = roomState.appliances.map((app) => {
        let nextPct = clampPercent(app.outputPercent ?? 0);
        if (isVacant) {
          nextPct = 0;
        } else if (app.type === 'lights') {
          nextPct = targetLightPct;
        } else if (app.type === 'fan') {
          nextPct = targetFanPct;
        } else if (app.type === 'ac' && nextPct > 42 && app.powerRatingWatts >= 1500) {
          // Inverter eco-trim with solar shading buffer
          nextPct = 42;
        }

        const wasManual = app.operatingMode === 'MANUAL' || Boolean(app.isManualOverride);
        const currentPct = clampPercent(app.outputPercent ?? 0);
        if (wasManual || currentPct !== nextPct) {
          changed = true;
        }

        return applyApplianceState(app, nextPct, 'AUTO', {
          isVacant,
          timestamp: now,
          sourceNote: input.sourceLabel || 'Campus Optimization',
        });
      });

      const afterWatts = nextAppliances.reduce((acc, a) => acc + a.currentPowerWatts, 0);
      const roomSaved = Math.max(0, beforeWatts - afterWatts);

      if (changed || scope === 'room') {
        roomState.appliances = nextAppliances;
        roomState.commandSeq += 1;
        roomState.updatedAt = now;
        curtailedWatts += roomSaved;
        optimizedRooms.push({
          roomId: roomState.roomId,
          roomCode: roomState.roomCode,
          appliances: nextAppliances,
          totalPowerWatts: afterWatts,
        });
        if (roomSaved > 0) {
          try {
            interventionLedgerService.recordIntervention({
              idempotencyKey: `live-opt-${roomState.roomId}-${roomState.commandSeq}-${now}`,
              eventGroupId: `grp-live-opt-${now}`,
              roomId: roomState.roomId,
              source: 'simulated',
              isDemonstrationData: false,
              triggerTsMs: now,
              startTsMs: now,
              endTsMs: null,
              triggerCategory: isVacant ? 'pir_vacancy' : 'audit_remediation',
              triggerSummary: `${input.sourceLabel || 'Campus Optimization'} curtailed ${roomSaved} W in ${roomState.roomCode}`,
              evidenceSummary: `Adaptive AUTO synchronization reduced simulated load from ${beforeWatts} W to ${afterWatts} W (${isVacant ? 'vacant room shed' : 'occupied adaptive trim'}).`,
              sensorSnapshot: {
                pirStatus: isVacant ? 'No Motion Detected' : 'Motion Active',
                dataOrigin: 'simulated_node',
              },
              ruleLogic: `${input.sourceLabel || 'Campus Optimization'} (Adaptive AUTO Sync)`,
              affectedCircuitId: `${roomState.roomId}-combined`,
              affectedCircuitName: `${roomState.roomCode} Controlled Load`,
              circuitType: 'room_combined',
              previousState: `${beforeWatts} W active`,
              newState: `${afterWatts} W AUTO`,
              actionPerformed: `Synchronized ${roomState.roomCode} to adaptive AUTO (-${roomSaved} W)`,
              actionStatus: 'active',
              actor: input.admin.adminName,
              counterfactualBaselineWatts: beforeWatts,
              postInterventionWatts: afterWatts,
              baselineMethod: 'previous_state_power',
              baselineExplanation:
                'Pre-optimization active load recorded immediately before AUTO synchronization; avoided kWh remains withheld until completion timestamp is recorded.',
              assumptions: [
                'Live simulated campus optimization action (physical hardware not connected).',
                'Open/active intervention does not fabricate future duration.',
              ],
              loadRatingSource: `ROOM_APPLIANCE_SPECS (${roomState.roomId})`,
            });
          } catch (ledgerErr) {
            console.warn('[ledger] Failed to log campus optimization intervention:', ledgerErr);
          }
        }
      }
    }

    persistRuntimeState();

    const summary =
      scope === 'room' && optimizedRooms[0]
        ? `${optimizedRooms[0].roomCode} optimized to adaptive AUTO (-${curtailedWatts}W curtailed)`
        : `${optimizedRooms.length} classroom nodes synchronized to adaptive AUTO (-${curtailedWatts}W active waste curtailed)`;

    recordAudit({
      type: 'appliance_command',
      summary: `${input.sourceLabel || 'Campus Optimization'}: ${summary}`,
      staffName: input.admin.adminName,
      deviceName: input.admin.deviceName,
    });

    for (const optRoom of optimizedRooms.slice(0, 10)) {
      energyHistoryService.recordControlEvent({
        roomId: optRoom.roomId,
        roomCode: optRoom.roomCode,
        eventType: 'campus_optimization',
        summary: `${input.sourceLabel || 'Campus Optimization'}: synced to adaptive AUTO`,
        actor: input.admin.adminName,
        beforeWatts: optRoom.totalPowerWatts,
        afterWatts: optRoom.totalPowerWatts,
        tsMs: now,
      });
    }
    if (optimizedRooms.length > 0) {
      energyHistoryService.recordLiveSnapshot(Array.from(roomApplianceStore.values()), now, 'event');
    }

    return {
      ok: true,
      optimizedRooms,
      curtailedWatts,
      summary,
    };
  };

  const executeBatchApplianceControl = (
    input: BatchApplianceControlInput
  ): BatchApplianceControlOutput => {
    const now = Date.now();
    const optimizedRooms: BatchApplianceControlOutput['optimizedRooms'] = [];
    const affectedRoomCodes: string[] = [];
    let totalBeforeWatts = 0;
    let totalAfterWatts = 0;

    const buildingFilter = input.building ? input.building.toLowerCase().trim() : '';
    const floorFilter = input.floor ? input.floor.toLowerCase().trim() : '';

    for (const [roomId, roomState] of roomApplianceStore.entries()) {
      const baseRoom = baseClassroomById.get(roomId);
      const meta = input.roomMetaById?.[roomId];
      const building = meta?.building || baseRoom?.building || '';
      const floor = meta?.floor || baseRoom?.floor || '';
      const isVacant =
        typeof meta?.isVacant === 'boolean' ? meta.isVacant : roomState.isVacantDefault;

      if (input.scope === 'vacant_only' && !isVacant) continue;
      if (buildingFilter && !building.toLowerCase().includes(buildingFilter)) continue;
      if (floorFilter && !floor.toLowerCase().includes(floorFilter)) continue;

      const beforeWatts = roomState.appliances.reduce((acc, a) => acc + a.currentPowerWatts, 0);
      let roomTouched = false;

      const nextAppliances = roomState.appliances.map((app) => {
        if (input.targetType !== 'all' && app.type !== input.targetType) {
          return app;
        }
        roomTouched = true;
        if (input.mode === 'restore_auto') {
          const autoPct = isVacant
            ? 0
            : app.type === 'lights'
            ? typeof meta?.targetLightPercent === 'number'
              ? clampPercent(meta.targetLightPercent)
              : baseRoom
              ? computeAdaptiveTargetLightPercent(baseRoom)
              : 50
            : app.type === 'fan'
            ? typeof meta?.targetFanPercent === 'number'
              ? clampPercent(meta.targetFanPercent)
              : baseRoom
              ? computeAdaptiveTargetFanPercent(baseRoom)
              : 60
            : 0;
          return applyApplianceState(app, autoPct, 'AUTO', {
            isVacant,
            timestamp: now,
            sourceNote: 'Batch Voice Control',
          });
        }

        const pct = clampPercent(input.outputPercent ?? 0);
        return applyApplianceState(app, pct, 'MANUAL', {
          isVacant,
          timestamp: now,
          sourceNote: 'Batch Voice Control',
        });
      });

      if (!roomTouched) continue;

      const afterWatts = nextAppliances.reduce((acc, a) => acc + a.currentPowerWatts, 0);
      totalBeforeWatts += beforeWatts;
      totalAfterWatts += afterWatts;

      roomState.appliances = nextAppliances;
      roomState.commandSeq += 1;
      roomState.updatedAt = now;
      affectedRoomCodes.push(roomState.roomCode);
      optimizedRooms.push({
        roomId: roomState.roomId,
        roomCode: roomState.roomCode,
        appliances: nextAppliances,
        totalPowerWatts: afterWatts,
      });
    }

    if (optimizedRooms.length === 0) {
      return {
        ok: false,
        error: 'No classrooms matched the requested block, floor, or appliance filter.',
        optimizedRooms: [],
        affectedRoomCodes: [],
        curtailedWatts: 0,
        deltaWatts: 0,
        summary: 'No classrooms matched.',
      };
    }

    persistRuntimeState();
    const curtailedWatts = Math.max(0, totalBeforeWatts - totalAfterWatts);
    const deltaWatts = totalAfterWatts - totalBeforeWatts;
    const scopeLabel =
      [input.building, input.floor].filter(Boolean).join(' · ') ||
      (input.scope === 'vacant_only' ? 'Vacant Rooms' : 'All 25 Campus Nodes');
    const targetLabel =
      input.targetType === 'all'
        ? 'all appliances'
        : input.targetType === 'lights'
        ? 'lights'
        : input.targetType === 'fan'
        ? 'fan sectors'
        : input.targetType === 'projector'
        ? 'projectors'
        : 'AC units';
    const actionLabel =
      input.mode === 'restore_auto'
        ? 'restored to Adaptive AUTO'
        : `set to ${clampPercent(input.outputPercent ?? 0) === 0 ? 'OFF' : `${clampPercent(input.outputPercent ?? 0)}%`} (MANUAL)`;

    const summary = `${scopeLabel}: ${targetLabel} across ${optimizedRooms.length} rooms ${actionLabel} (${deltaWatts >= 0 ? `+${deltaWatts}W` : `${deltaWatts}W`})`;

    recordAudit({
      type: 'appliance_command',
      summary,
      staffName: input.admin.adminName,
      deviceName: `${input.admin.deviceName} · Voice`,
    });

    for (const r of optimizedRooms.slice(0, 10)) {
      energyHistoryService.recordControlEvent({
        roomId: r.roomId,
        roomCode: r.roomCode,
        eventType: 'batch_voice_control',
        summary,
        actor: `${input.admin.adminName} (Voice)`,
        beforeWatts: r.totalPowerWatts,
        afterWatts: r.totalPowerWatts,
        tsMs: now,
      });
    }
    if (optimizedRooms.length > 0) {
      energyHistoryService.recordLiveSnapshot(Array.from(roomApplianceStore.values()), now, 'event');
    }

    return {
      ok: true,
      optimizedRooms,
      affectedRoomCodes,
      curtailedWatts,
      deltaWatts,
      summary,
    };
  };

  const getSecurityAuditAndStaff = (includeAuditTrail: boolean): SecurityAuditStaffOutput => {
    const staffDirectory = STAFF_DIRECTORY.map((staff) => {
      const activePasskeys = getActivePasskeysForStaff(staff.id);
      return {
        id: staff.id,
        name: staff.name,
        role: staff.role,
        assignedBuilding: staff.assignedBuilding,
        hasPasskey: activePasskeys.length > 0,
        passkeyCount: activePasskeys.length,
      };
    });
    const now = Date.now();
    const activeAdminSessionsCount = Array.from(adminSessions.values()).filter(
      (s) => s.expiresAt > now
    ).length;

    return {
      staffDirectory,
      activeAdminSessionsCount: includeAuditTrail ? activeAdminSessionsCount : undefined,
      auditTrailRestricted: !includeAuditTrail,
      auditTrail: includeAuditTrail ? accessAuditTrail.slice(0, 20) : [],
    };
  };

  app.post('/api/campus/optimize', requireAdmin, (req, res) => {
    const adminSess = (req as Request & { adminSession: AdminSession }).adminSession;
    const staff = STAFF_DIRECTORY.find((s) => s.id === adminSess.adminId);
    const { scope, roomId, roomTargets, sourceLabel } = req.body || {};

    const cleanScope: CampusOptimizationInput['scope'] =
      scope === 'vacant_only' || scope === 'room' ? scope : 'all';

    const result = executeCampusOptimization({
      scope: cleanScope,
      roomId: typeof roomId === 'string' ? roomId.trim() : undefined,
      roomTargets:
        roomTargets && typeof roomTargets === 'object' ? roomTargets : undefined,
      sourceLabel:
        typeof sourceLabel === 'string' && sourceLabel.trim()
          ? sourceLabel.trim()
          : 'One-Click Campus Optimization',
      admin: {
        sessionId: adminSess.browserSessionId,
        adminId: adminSess.adminId,
        adminName: staff?.name || adminSess.adminId,
        role: staff?.role || 'Administrator',
        deviceName: adminSess.deviceName,
      },
    });

    if (!result.ok) {
      res.status(404).json({ error: result.error || 'Optimization failed.' });
      return;
    }

    res.json(result);
  });

  const voiceBridgeDeps = {
    resolveAdminFromWs,
    getServerRoomsMap: () => roomApplianceStore,
    executeApplianceCommand: executeVoiceApplianceCommand,
    executeCampusOptimization,
    executeBatchApplianceControl,
    getSecurityAuditAndStaff,
  };

  registerVoiceLiveWebSocket(httpServer, voiceBridgeDeps);

  const voiceCommandExecutor = createRoomwiseVoiceCommandExecutor(voiceBridgeDeps);

  app.get('/api/voice/capabilities', (_req, res) => {
    res.json({
      ok: true,
      capabilities: voiceCommandExecutor.getCapabilities(),
    });
  });

  app.post('/api/voice/command', async (req, res) => {
    try {
      const body = (req.body || {}) as {
        sessionId?: string;
        text?: string;
        activeTab?: string;
        selectedRoomId?: string | null;
        settings?: SchoolSettings;
        classrooms?: Classroom[];
        resolvedFindingIds?: string[];
      };

      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) {
        res.status(400).json({ ok: false, error: 'Command text is required.' });
        return;
      }

      const authHeader = req.headers.authorization;
      const bearer =
        typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : null;
      const adminIdentity = resolveAdminFromWs(req as unknown as IncomingMessage, bearer);
      const sessionId =
        typeof body.sessionId === 'string' && body.sessionId.trim()
          ? body.sessionId.trim()
          : `http_${req.ip || 'default'}`;

      const result = await voiceCommandExecutor.executeCommand({
        sessionId,
        text,
        activeTab: typeof body.activeTab === 'string' ? body.activeTab : 'dashboard',
        selectedRoomId: body.selectedRoomId ?? null,
        settings: body.settings || persistedSchoolSettings,
        classrooms: Array.isArray(body.classrooms) ? body.classrooms : undefined,
        resolvedFindingIds: Array.isArray(body.resolvedFindingIds)
          ? body.resolvedFindingIds
          : [],
        adminIdentity,
      });

      res.json(result);
    } catch (err) {
      console.error('[voice] /api/voice/command error:', err);
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to execute voice command.',
      });
    }
  });

  app.post('/api/voice/command/stream', async (req, res) => {
    const body = (req.body || {}) as {
      sessionId?: string;
      text?: string;
      activeTab?: string;
      selectedRoomId?: string | null;
      settings?: SchoolSettings;
      classrooms?: Classroom[];
      resolvedFindingIds?: string[];
    };

    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      res.status(400).json({ ok: false, error: 'Command text is required.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        closed = true;
      }
    });

    const writeEvent = (event: string, payload: unknown) => {
      if (closed || res.writableEnded) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {
        closed = true;
      }
    };

    try {
      const authHeader = req.headers.authorization;
      const bearer =
        typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : null;
      const adminIdentity = resolveAdminFromWs(req as unknown as IncomingMessage, bearer);
      const sessionId =
        typeof body.sessionId === 'string' && body.sessionId.trim()
          ? body.sessionId.trim()
          : `http_${req.ip || 'default'}`;

      const result = await voiceCommandExecutor.executeCommand({
        sessionId,
        text,
        activeTab: typeof body.activeTab === 'string' ? body.activeTab : 'dashboard',
        selectedRoomId: body.selectedRoomId ?? null,
        settings: body.settings || persistedSchoolSettings,
        classrooms: Array.isArray(body.classrooms) ? body.classrooms : undefined,
        resolvedFindingIds: Array.isArray(body.resolvedFindingIds)
          ? body.resolvedFindingIds
          : [],
        adminIdentity,
        geminiOptions: {
          sessionId,
          onToolStatus: (status) => writeEvent('tool_status', status),
          onClientMessage: (msg) => writeEvent('client_message', msg),
          onTextDelta: (delta) => writeEvent('text_delta', { delta }),
        },
      });

      writeEvent('done', result);
    } catch (err) {
      console.error('[voice] /api/voice/command/stream error:', err);
      writeEvent('error', {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to execute voice command.',
      });
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  // Serve local wake-word worker & model with cached gzip compression and immutable headers in dev & prod
  const modelsDir =
    process.env.NODE_ENV === 'production' && fs.existsSync(path.join(__dirname, 'dist', 'models'))
      ? path.join(__dirname, 'dist', 'models')
      : path.join(__dirname, 'public', 'models');
  if (fs.existsSync(modelsDir)) {
    const modelsGzipCache = new Map<string, Buffer>();
    app.get('/models/:fileName', (req, res, next) => {
      const safeName = path.basename(req.params.fileName || '');
      if (path.extname(safeName).toLowerCase() !== '.js') {
        next();
        return;
      }
      const acceptEncoding = String(req.headers['accept-encoding'] || '');
      if (!acceptEncoding.includes('gzip')) {
        next();
        return;
      }
      const absPath = path.join(modelsDir, safeName);
      if (!fs.existsSync(absPath)) {
        next();
        return;
      }
      let gz = modelsGzipCache.get(safeName);
      if (!gz) {
        try {
          gz = zlib.gzipSync(fs.readFileSync(absPath), { level: 6 });
          if (modelsGzipCache.size < 8) {
            modelsGzipCache.set(safeName, gz);
          }
        } catch {
          next();
          return;
        }
      }
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(gz);
    });

    app.use(
      '/models',
      express.static(modelsDir, {
        maxAge: '365d',
        immutable: true,
      })
    );
  }

  // Mount Vite dev server in development OR serve compressed cached static dist in production
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(__dirname, 'dist');
    const gzipCache = new Map<string, { buf: Buffer; mime: string }>();

    app.get('/assets/:fileName', (req, res, next) => {
      const safeName = path.basename(req.params.fileName || '');
      const ext = path.extname(safeName).toLowerCase();
      if (ext !== '.js' && ext !== '.css' && ext !== '.svg') {
        next();
        return;
      }
      const acceptEncoding = String(req.headers['accept-encoding'] || '');
      if (!acceptEncoding.includes('gzip')) {
        next();
        return;
      }
      const absPath = path.join(distDir, 'assets', safeName);
      if (!fs.existsSync(absPath)) {
        next();
        return;
      }

      let cached = gzipCache.get(safeName);
      if (!cached) {
        try {
          const raw = fs.readFileSync(absPath);
          const buf = zlib.gzipSync(raw, { level: 6 });
          const mime =
            ext === '.js'
              ? 'application/javascript; charset=utf-8'
              : ext === '.css'
              ? 'text/css; charset=utf-8'
              : 'image/svg+xml';
          cached = { buf, mime };
          if (gzipCache.size < 64) {
            gzipCache.set(safeName, cached);
          }
        } catch {
          next();
          return;
        }
      }

      res.setHeader('Content-Type', cached.mime);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(cached.buf);
    });

    app.use(
      '/assets',
      express.static(path.join(distDir, 'assets'), {
        maxAge: '365d',
        immutable: true,
      })
    );
    app.use(express.static(distDir, { maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[Roomwise] Full-stack server running on http://0.0.0.0:${PORT}`);

    // Non-blocking background warm-up for Open-Meteo environmental cache so first
    // weather/daylight queries hit warm memory instead of waiting on cold external fetch.
    const warmupTimer = setTimeout(() => {
      environmentalService
        .getOverview({
          settings: persistedSchoolSettings,
          classrooms: INITIAL_CLASSROOMS,
          forceRefresh: false,
        })
        .catch(() => {
          // Non-fatal: live requests will retry automatically on demand
        });
    }, 1200);
    if (typeof warmupTimer.unref === 'function') {
      warmupTimer.unref();
    }
  });
}

startServer().catch((err) => {
  console.error('[Roomwise] Failed to start server:', err);
  process.exit(1);
});
