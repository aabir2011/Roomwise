/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'admin' | 'student' | 'viewer';

export interface UserProfile {
  id: string;
  role: UserRole;
  name: string;
  email: string;
  departmentOrClass?: string;
  avatarInitials: string;
}

export interface VerifiedAdminInfo {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  assignedBuilding: string;
  avatarInitials: string;
  hasPasskey?: boolean;
  passkeyCount?: number;
}

export interface PasskeyCredentialSummary {
  id: string;
  staffId: string;
  deviceName: string;
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  createdAt: number;
  lastUsedAt?: number;
  revoked: boolean;
  revokedAt?: number;
}

export const DEMO_STUDENT_USER: UserProfile = {
  id: 'student-1',
  role: 'student',
  name: 'Student',
  email: 'student@davmodeliitkgp.org',
  departmentOrClass: 'Classroom Telemetry Portal',
  avatarInitials: 'ST',
};

export const DEMO_VIEWER_USER: UserProfile = {
  id: 'viewer-1',
  role: 'viewer',
  name: 'Student',
  email: 'student@davmodeliitkgp.org',
  departmentOrClass: 'Institutional Energy Portal',
  avatarInitials: 'ST',
};
