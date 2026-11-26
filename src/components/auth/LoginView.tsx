/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Shield, GraduationCap, ArrowRight, QrCode } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { RoomwiseLogo } from '../common/RoomwiseLogo';
import { UserRole } from '../../types/auth';
import { TeacherLoginPanel } from './TeacherLoginPanel';
import { ActionButton, SegmentedControl } from '../common/DesignSystem';

interface Props {
  targetRoomCode?: string | null;
  onLoginSuccess?: () => void;
}

export const LoginView: React.FC<Props> = ({ targetRoomCode, onLoginSuccess }) => {
  const { lockAdmin } = useAuth();
  const [selectedRole, setSelectedRole] = useState<UserRole>('admin');

  const handleRoleSelect = (role: UserRole) => {
    setSelectedRole(role);
  };

  const handleEnterStudentMode = async () => {
    await lockAdmin();
    if (onLoginSuccess) {
      onLoginSuccess();
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-app-ambient relative overflow-hidden select-none">
      {/* Subtle static architectural emerald grid */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #065f46 1px, transparent 1px), linear-gradient(to bottom, #065f46 1px, transparent 1px)',
          backgroundSize: '36px 36px',
        }}
      />

      <div className="w-full max-w-lg rounded-3xl border border-neutral-200/90 shadow-xl overflow-hidden relative z-10 bg-white/95 backdrop-blur-sm">
        {/* Role Selector Bar */}
        <div className="px-6 pt-5 pb-3 border-b border-neutral-100 flex items-center justify-between gap-4 bg-neutral-50/70">
          <RoomwiseLogo size="sm" showSubtitle={false} />
          <SegmentedControl<UserRole>
            tone="light"
            size="sm"
            layoutId="login-role-selector"
            ariaLabel="Access mode"
            value={selectedRole}
            onChange={handleRoleSelect}
            options={[
              { id: 'student', label: 'Student', icon: GraduationCap },
              { id: 'admin', label: 'Admin Card', icon: Shield },
            ]}
          />
        </div>

        {/* Scanned Classroom QR Banner */}
        {targetRoomCode && (
          <div className="mx-6 mt-4 p-3 rounded-2xl bg-emerald-50/80 border border-emerald-200 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-900">
                Classroom Placard Scanned
              </div>
              <div className="text-xs font-bold text-neutral-900 truncate">
                Target Node: <span className="font-mono text-emerald-800">{targetRoomCode}</span>
              </div>
            </div>
          </div>
        )}

        {selectedRole === 'admin' ? (
          <TeacherLoginPanel
            onSuccess={() => {
              if (onLoginSuccess) onLoginSuccess();
            }}
          />
        ) : (
          <div className="p-7 space-y-5 text-center">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center mx-auto">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-extrabold text-neutral-900">Student Telemetry Access</h2>
              <p className="text-xs text-neutral-600 leading-relaxed max-w-sm mx-auto">
                View real-time classroom desk lux, thermal heat index, occupancy, and campus energy savings in read-only Student Mode. Administrative controls remain locked.
              </p>
            </div>
            <ActionButton
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleEnterStudentMode}
              trailingIcon={<ArrowRight className="w-4 h-4" />}
            >
              Continue in Student Mode
            </ActionButton>
          </div>
        )}
      </div>
    </div>
  );
};
