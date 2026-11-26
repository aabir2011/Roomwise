/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, Printer, ExternalLink, Shield, Download, Copy, Check } from 'lucide-react';
import QRCode from 'qrcode';
import { Classroom } from '../../types/energy';
import { useEnergy } from '../../context/EnergyContext';
import { useToast } from '../../context/ToastContext';
import { ActionButton, IconButton } from '../common/DesignSystem';
import { backdropVariants, modalVariants } from '../../utils/motion';

interface Props {
  room: Classroom;
  onClose: () => void;
  onOpenClassroomPage?: (roomCode: string) => void;
}

export const ClassroomQRModal: React.FC<Props> = ({ room, onClose, onOpenClassroomPage }) => {
  const { settings } = useEnergy();
  const toast = useToast();
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // Classroom specific URL
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const roomUrl = `${origin}/classroom/${room.roomCode}`;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let isMounted = true;
    QRCode.toDataURL(roomUrl, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (isMounted) setQrDataUrl(url);
      })
      .catch((err) => {
        console.error('Failed to generate high-res QR code', err);
      });

    return () => {
      isMounted = false;
    };
  }, [roomUrl]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.download = `QR_${room.roomCode}_${room.name.replace(/\s+/g, '_')}.png`;
    link.href = qrDataUrl;
    link.click();
    toast.success('Placard QR downloaded', `${room.roomCode} PNG matrix saved.`);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(roomUrl).then(() => {
      setCopied(true);
      toast.success('Classroom link copied', roomUrl);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleOpenPage = () => {
    onClose();
    if (onOpenClassroomPage) {
      onOpenClassroomPage(room.roomCode);
    } else {
      window.history.pushState({}, '', `/classroom/${room.roomCode}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  return (
    <motion.div
      variants={backdropVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#071e17]/45 backdrop-blur-xs select-none"
      role="dialog"
      aria-modal="true"
      aria-label={`QR Door Placard for ${room.name}`}
    >
      <motion.div
        variants={modalVariants}
        className="glass-modal rounded-xl w-full max-w-md overflow-hidden bg-white"
      >
        {/* Obsidian-Pine Modal Top Bar */}
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-[#0b1713] text-white">
          <div className="text-xs font-semibold flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-[#34d399]" />
            <span>Classroom QR Door Placard</span>
          </div>
          <IconButton
            variant="dark-ghost"
            size="sm"
            label="Close dialog"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </IconButton>
        </div>

        {/* Printable Placard Body */}
        <div className="p-6 text-center space-y-4 print:p-8" id="printable-placard">
          {/* Institutional Header & Roomwise Brand Mark */}
          <div className="border-b border-[rgba(17,25,22,0.12)] pb-3 flex items-center justify-between text-left">
            <div>
              <div className="text-[10px] font-semibold tracking-[0.1em] text-[#0b6e4f] uppercase">
                {settings.institutionName}
              </div>
              <div className="text-[11px] text-[#5c6a64] font-medium">
                Autonomous Adaptive Energy &amp; Environmental Node
              </div>
            </div>
            <img
              src="/assets/aistudio/logo__transparent__55b16555.png"
              alt="Roomwise Logo"
              className="w-8 h-8 object-contain shrink-0"
            />
          </div>

          {/* Room Identification */}
          <div className="py-1">
            <div className="inline-block bg-[#0b1713] text-[#34d399] font-mono font-semibold text-base px-3 py-1 rounded-md">
              {room.roomCode}
            </div>
            <h3 className="font-display text-xl font-semibold text-[#111916] mt-2 tracking-tight">
              {room.name}
            </h3>
            <div className="flex items-center justify-center gap-2 text-xs text-[#5c6a64] mt-0.5 tabular-nums">
              <span className="font-semibold text-[#111916]">{room.building}</span>
              <span aria-hidden="true">·</span>
              <span>{room.floor}</span>
              <span aria-hidden="true">·</span>
              <span>Capacity {room.capacity} seats</span>
            </div>
          </div>

          {/* High-Resolution Scannable QR Code */}
          <div className="flex justify-center my-2">
            <div className="p-3 bg-white border border-[rgba(17,25,22,0.14)] rounded-xl inline-block">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`Scannable QR code for ${room.name} (${room.roomCode})`}
                  className="w-48 h-48 object-contain rounded"
                />
              ) : (
                <div className="w-48 h-48 flex items-center justify-center text-xs text-[#5c6a64] font-mono">
                  Generating matrix...
                </div>
              )}
            </div>
          </div>

          <div className="text-[11px] text-[#4a5851] space-y-1">
            <p className="font-semibold text-[#111916]">
              Scan with phone camera to open live classroom telemetry
            </p>
            <div className="flex items-center justify-center gap-1.5 pt-1">
              <span className="text-[10px] text-[#5c6a64] font-mono bg-[#f4f5f3] px-2 py-0.5 rounded border border-[rgba(17,25,22,0.1)] truncate max-w-[240px]">
                {roomUrl}
              </span>
              <IconButton
                variant="secondary"
                size="xs"
                label="Copy classroom URL"
                title="Copy URL"
                onClick={handleCopyLink}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-[#0b6e4f]" /> : <Copy className="w-3.5 h-3.5" />}
              </IconButton>
            </div>
          </div>

          <div className="pt-3 border-t border-[rgba(17,25,22,0.1)] flex items-center justify-between text-[11px] text-[#5c6a64] font-mono tabular-nums">
            <span>Target Desk Lux: <strong className="text-[#111916]">{room.calibration.manualParameters.targetLux} lx</strong></span>
            <span>Max Fan: <strong className="text-[#111916]">Speed {room.calibration.manualParameters.maxFanSpeed}</strong></span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="p-3.5 sm:p-4 bg-[#fafbf9] border-t border-[rgba(17,25,22,0.1)] flex flex-wrap items-center justify-between gap-2">
          <ActionButton
            variant="soft"
            size="md"
            onClick={handleOpenPage}
            icon={<ExternalLink className="w-3.5 h-3.5" />}
          >
            Open Page
          </ActionButton>

          <div className="flex items-center gap-2">
            <ActionButton
              variant="secondary"
              size="md"
              onClick={handleDownload}
              icon={<Download className="w-3.5 h-3.5" />}
              title="Download QR code PNG"
            >
              Save PNG
            </ActionButton>

            <ActionButton
              variant="forest"
              size="md"
              onClick={handlePrint}
              icon={<Printer className="w-3.5 h-3.5 text-[#34d399]" />}
            >
              Print Placard
            </ActionButton>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
