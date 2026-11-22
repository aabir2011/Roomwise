/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PhoneQRScanner } from './PhoneQRScanner';
import {
  InspectedChallenge,
  PhoneComputerApprovalCard,
  phoneChallengeFetch,
} from './PhoneComputerApprovalCard';
import { backdropVariants, modalVariants } from '../../utils/motion';

export const PhoneComputerAuthorizerModal: React.FC = () => {
  const {
    isPhoneQrModalOpen,
    closePhoneQrModal,
    authenticatedAdmin,
  } = useAuth();

  const [inspectedChallenge, setInspectedChallenge] = useState<InspectedChallenge | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPhoneQrModalOpen) {
      setInspectedChallenge(null);
      setIsInspecting(false);
      setScanError(null);
    }
  }, [isPhoneQrModalOpen]);

  useEffect(() => {
    if (!isPhoneQrModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePhoneQrModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPhoneQrModalOpen, closePhoneQrModal]);

  const inspectChallengePayload = useCallback(
    async (payload: { challengeId?: string; nonce?: string; shortCode?: string }) => {
      setIsInspecting(true);
      setScanError(null);

      try {
        const res = await phoneChallengeFetch('/api/auth/challenge/inspect', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (!res.ok) {
          setScanError(
            data.error || 'This computer QR code is invalid or expired. Scan a fresh QR code.'
          );
          return;
        }

        setInspectedChallenge(data as InspectedChallenge);
      } catch {
        setScanError('Network error communicating with ROOMWISE server.');
      } finally {
        setIsInspecting(false);
      }
    },
    []
  );

  return (
    <AnimatePresence>
      {isPhoneQrModalOpen && !inspectedChallenge && (
        <PhoneQRScanner
          key="global-phone-qr-scanner"
          onDetected={inspectChallengePayload}
          onClose={closePhoneQrModal}
          onManualCodeSubmit={(shortCode) => inspectChallengePayload({ shortCode })}
          allowManualCode
          isProcessing={isInspecting}
          externalError={scanError}
          onClearError={() => setScanError(null)}
        />
      )}

      {isPhoneQrModalOpen && inspectedChallenge && (
        <motion.div
          key="global-phone-qr-confirm-backdrop"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePhoneQrModal();
          }}
          className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-xs select-none"
          role="dialog"
          aria-modal="true"
          aria-label="Authorise Computer Session"
        >
          <motion.div
            variants={modalVariants}
            className="relative w-full max-w-md rounded-2xl overflow-hidden bg-transparent"
          >
            <button
              type="button"
              onClick={closePhoneQrModal}
              className="sr-only"
              aria-label="Close computer authorisation dialog"
            >
              <X className="w-4 h-4" />
            </button>

            <PhoneComputerApprovalCard
              challenge={inspectedChallenge}
              fallbackStaff={authenticatedAdmin || undefined}
              onDone={closePhoneQrModal}
              onCancelScan={() => {
                setInspectedChallenge(null);
                setScanError(null);
              }}
              onExpired={(expiredMsg) => {
                setInspectedChallenge(null);
                setScanError(expiredMsg);
              }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
