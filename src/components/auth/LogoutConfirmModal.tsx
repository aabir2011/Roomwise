/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LogOut, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { backdropVariants, modalVariants } from '../../utils/motion';
import { ActionButton, IconButton } from '../common/DesignSystem';

export const LogoutConfirmModal: React.FC = () => {
  const {
    isLogoutConfirmOpen,
    isLoggingOut,
    authenticatedAdmin,
    authenticatedDeviceName,
    cancelLogout,
    confirmLogout,
  } = useAuth();

  useEffect(() => {
    if (!isLogoutConfirmOpen || isLoggingOut) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelLogout();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLogoutConfirmOpen, isLoggingOut, cancelLogout]);

  return (
    <AnimatePresence>
      {isLogoutConfirmOpen && (
        <motion.div
          key="logout-confirm-backdrop"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isLoggingOut) {
              cancelLogout();
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#071e17]/40 backdrop-blur-xs select-none"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm Administrator Logout"
        >
          <motion.div
            variants={modalVariants}
            className="relative w-full max-w-sm rounded-xl bg-white border border-[#111916]/15 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 rw-obsidian-panel border-none rounded-none shadow-none text-white flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-white/10 border border-white/15 text-[#34d399] flex items-center justify-center shrink-0">
                  <LogOut className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-display text-sm font-semibold text-white">
                    End Admin Session?
                  </h3>
                  <p className="text-[11px] font-mono text-white/60">
                    ROOMWISE Digital Access Card
                  </p>
                </div>
              </div>
              <IconButton
                variant="dark-ghost"
                size="xs"
                label="Cancel logout"
                onClick={cancelLogout}
                disabled={isLoggingOut}
              >
                <X className="w-4 h-4" />
              </IconButton>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-[#47534d] leading-relaxed">
                Logging out immediately revokes administrator access on this terminal and returns the portal to Student Mode. You will need passkey, password, or phone QR verification to sign back in.
              </p>

              {authenticatedAdmin && (
                <div className="rounded-lg bg-[#f4f5f3] border border-[#111916]/10 px-3.5 py-2.5 text-[11px] space-y-0.5">
                  <div className="flex items-center gap-1.5 font-semibold text-[#111916]">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#0b6e4f]" />
                    <span>{authenticatedAdmin.name}</span>
                  </div>
                  <div className="text-[#5c6862] pl-5">
                    {authenticatedDeviceName || authenticatedAdmin.role}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2.5 pt-1">
                <ActionButton
                  variant="secondary"
                  size="md"
                  onClick={cancelLogout}
                  disabled={isLoggingOut}
                  className="flex-1"
                >
                  Cancel
                </ActionButton>
                <ActionButton
                  variant="primary"
                  size="md"
                  onClick={confirmLogout}
                  loading={isLoggingOut}
                  icon={!isLoggingOut ? <LogOut className="w-3.5 h-3.5 text-[#34d399]" /> : undefined}
                  className="flex-1"
                >
                  {isLoggingOut ? 'Ending session...' : 'Logout'}
                </ActionButton>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
