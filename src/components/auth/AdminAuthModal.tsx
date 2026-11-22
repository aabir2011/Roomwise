/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { TeacherLoginPanel } from './TeacherLoginPanel';
import { backdropVariants, modalVariants } from '../../utils/motion';

export const AdminAuthModal: React.FC = () => {
  const { isAuthModalOpen, closeAuthModal } = useAuth();

  useEffect(() => {
    if (!isAuthModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeAuthModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAuthModalOpen, closeAuthModal]);

  return (
    <AnimatePresence>
      {isAuthModalOpen && (
        <motion.div
          key="admin-auth-backdrop"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAuthModal();
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#071e17]/40 backdrop-blur-xs select-none"
          role="dialog"
          aria-modal="true"
          aria-label="ROOMWISE Administrator Authentication"
        >
          <motion.div
            variants={modalVariants}
            className="relative w-full max-w-md rounded-3xl overflow-hidden rw-glass-float"
          >
            <button
              type="button"
              onClick={closeAuthModal}
              className="absolute top-3.5 right-3.5 z-20 p-2 text-neutral-400 hover:text-neutral-800 rounded-xl hover:bg-neutral-100 transition-colors cursor-pointer"
              aria-label="Close sign-in window"
            >
              <X className="w-4 h-4" />
            </button>

            <TeacherLoginPanel
              onSuccess={() => {
                closeAuthModal();
              }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
