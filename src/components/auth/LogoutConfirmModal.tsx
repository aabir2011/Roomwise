/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LogOut, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { backdropVariants, modalVariants } from '../../utils/motion';

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
            className="relative w-full max-w-sm rounded-3xl rw-glass-float overflow-hidden"
          >
            <div className="h-1 gradient-rim-emerald" />

            <button
              type="button"
              onClick={cancelLogout}
              disabled={isLoggingOut}
              className="absolute top-3.5 right-3.5 p-1.5 text-[#64726b] hover:text-[#111815] rounded-lg hover:bg-[#f3f5f4] transition-colors cursor-pointer disabled:opacity-50"
              aria-label="Cancel logout"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200/80 text-emerald-700 flex items-center justify-center shrink-0">
                  <LogOut className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#111815]">
                    End Admin Session?
                  </h3>
                  <p className="text-[11px] text-[#64726b]">
                    ROOMWISE Digital Access Card
                  </p>
                </div>
              </div>

              <p className="text-xs text-[#4a5851] leading-relaxed">
                Logging out immediately revokes administrator access on this terminal and returns the portal to Student Mode. You will need passkey, password, or phone QR verification to sign back in.
              </p>

              {authenticatedAdmin && (
                <div className="rounded-xl rw-surface-muted px-3.5 py-2.5 text-[11px] space-y-0.5">
                  <div className="flex items-center gap-1.5 font-semibold text-[#111815]">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                    <span>{authenticatedAdmin.name}</span>
                  </div>
                  <div className="text-[#64726b] pl-5">
                    {authenticatedDeviceName || authenticatedAdmin.role}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={cancelLogout}
                  disabled={isLoggingOut}
                  className="flex-1 py-2.5 px-3 rounded-xl border border-neutral-200 bg-white hover:bg-[#f3f5f4] text-[#4a5851] text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <motion.button
                  type="button"
                  whileTap={isLoggingOut ? undefined : { scale: 0.985 }}
                  onClick={confirmLogout}
                  disabled={isLoggingOut}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-[#0b2e22] hover:bg-[#114231] text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{isLoggingOut ? 'Ending session...' : 'Logout'}</span>
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
