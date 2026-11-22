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
        className="rw-glass-float rounded-3xl w-full max-w-md overflow-hidden bg-white"
      >
        {/* Modal Top Bar */}
        <div className="p-4 border-b border-neutral-200/75 flex items-center justify-between bg-[#fafbfb]">
          <div className="text-xs font-semibold text-[#111815] flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-700" />
            <span>Classroom QR Door Placard</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#64726b] hover:text-[#111815] rounded-xl hover:bg-[#f3f5f4] transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Printable Placard Body */}
        <div className="p-6 text-center space-y-4 print:p-8" id="printable-placard">
          {/* Institutional Header & Roomwise Brand Mark */}
          <div className="border-b border-neutral-200 pb-3 flex items-center justify-between text-left">
            <div>
              <div className="text-[11px] font-semibold tracking-wider text-emerald-800 uppercase">
                {settings.institutionName}
              </div>
              <div className="text-[11px] text-[#64726b] font-medium">
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
            <div className="inline-block bg-[#0b2e22] text-emerald-100 font-mono font-bold text-base px-3 py-1 rounded-lg">
              {room.roomCode}
            </div>
            <h3 className="text-xl font-semibold text-[#111815] mt-1.5">{room.name}</h3>
            <div className="flex items-center justify-center gap-2 text-xs text-[#64726b] mt-0.5 tabular-nums">
              <span className="font-semibold text-[#111815]">{room.building}</span>
              <span aria-hidden="true">·</span>
              <span>{room.floor}</span>
              <span aria-hidden="true">·</span>
              <span>Capacity {room.capacity} seats</span>
            </div>
          </div>

          {/* High-Resolution Scannable QR Code */}
          <div className="flex justify-center my-2">
            <div className="p-3 bg-white border border-neutral-200/90 rounded-2xl shadow-xs inline-block">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`Scannable QR code for ${room.name} (${room.roomCode})`}
                  className="w-48 h-48 object-contain rounded-lg"
                />
              ) : (
                <div className="w-48 h-48 flex items-center justify-center text-xs text-[#64726b] font-mono">
                  Generating matrix...
                </div>
              )}
            </div>
          </div>

          <div className="text-[11px] text-[#4a5851] space-y-1">
            <p className="font-semibold text-[#111815]">
              Scan with phone camera to open live classroom telemetry
            </p>
            <div className="flex items-center justify-center gap-1.5 pt-1">
              <span className="text-[10px] text-[#64726b] font-mono bg-[#f3f5f4] px-2 py-0.5 rounded border border-neutral-200 truncate max-w-[240px]">
                {roomUrl}
              </span>
              <button
                type="button"
                onClick={handleCopyLink}
                className="p-1 text-[#64726b] hover:text-[#111815] rounded hover:bg-[#f3f5f4] cursor-pointer"
                title="Copy URL"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-neutral-200 flex items-center justify-between text-[11px] text-[#64726b] tabular-nums">
            <span>Target Desk Lux: <strong className="text-[#111815]">{room.calibration.manualParameters.targetLux} lx</strong></span>
            <span>Max Fan: <strong className="text-[#111815]">Speed {room.calibration.manualParameters.maxFanSpeed}</strong></span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="p-3.5 sm:p-4 bg-[#fafbfb] border-t border-neutral-200/75 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleOpenPage}
            className="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-emerald-950 bg-[#eef3f0] hover:bg-emerald-100/70 rounded-xl border border-emerald-700/20 transition-colors cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5 text-emerald-700" />
            <span>Open Page</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-[#111815] bg-white hover:bg-[#f3f5f4] rounded-xl border border-neutral-200 transition-colors cursor-pointer"
              title="Download QR code PNG"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save PNG</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#0b2e22] hover:bg-[#114231] rounded-xl transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-emerald-300" />
              <span>Print Placard</span>
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
