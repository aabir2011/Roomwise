/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import jsQR from 'jsqr';
import {
  ArrowLeft,
  Camera,
  AlertTriangle,
  RefreshCw,
  Loader2,
  X,
  QrCode,
} from 'lucide-react';
import { extractChallengeParams, ParsedQRChallengeParams } from '../../utils/qrChallengeParser';
import { ROOMWISE_EASE } from '../../utils/motion';
import { ActionButton, IconButton } from '../common/DesignSystem';

interface BarcodeDetectorInstance {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
}

interface Props {
  onDetected: (params: ParsedQRChallengeParams) => void;
  onClose: () => void;
  onManualCodeSubmit?: (shortCode: string) => void;
  isProcessing?: boolean;
  externalError?: string | null;
  onClearError?: () => void;
  allowManualCode?: boolean;
}

type CameraStatus = 'requesting' | 'active' | 'denied' | 'unavailable' | 'error';

export const PhoneQRScanner: React.FC<Props> = ({
  onDetected,
  onClose,
  onManualCodeSubmit,
  isProcessing = false,
  externalError = null,
  onClearError,
  allowManualCode = false,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const detectedLockRef = useRef(false);
  const lastInvalidWarningAtRef = useRef(0);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('requesting');
  const [cameraErrorMsg, setCameraErrorMsg] = useState<string | null>(null);
  const [invalidQrBanner, setInvalidQrBanner] = useState<string | null>(null);
  const [decoderEngine, setDecoderEngine] = useState<'native' | 'jsqr'>('jsqr');
  const [manualCode, setManualCode] = useState('');

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {
        // ignore
      }
    }
  }, []);

  const handleDecodedPayload = useCallback(
    (rawValue: string) => {
      if (detectedLockRef.current || isProcessing) return;

      const params = extractChallengeParams(rawValue);
      if (params) {
        detectedLockRef.current = true;
        setInvalidQrBanner(null);
        stopCamera();
        onDetected(params);
        return;
      }

      const now = Date.now();
      if (now - lastInvalidWarningAtRef.current > 2200) {
        lastInvalidWarningAtRef.current = now;
        setInvalidQrBanner(
          'Unrecognized QR code. Point the camera at the ROOMWISE login QR code displayed on your computer.'
        );
      }
    },
    [isProcessing, onDetected, stopCamera]
  );

  const startScanner = useCallback(async () => {
    stopCamera();
    detectedLockRef.current = false;
    setInvalidQrBanner(null);
    setCameraErrorMsg(null);
    if (onClearError) onClearError();
    setCameraStatus('requesting');

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setCameraStatus('unavailable');
      setCameraErrorMsg(
        'Camera access is not supported in this browser. Open ROOMWISE in Safari or Chrome over HTTPS to scan QR codes.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 1280 },
        },
        audio: false,
      });

      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      setCameraStatus('active');

      // Attach video stream and begin real-time QR frame loop
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play().catch(() => {});
      }

      // Initialize BarcodeDetector if supported, otherwise fall back to jsQR
      let detector: BarcodeDetectorInstance | null = null;
      const DetectorCtor = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
        .BarcodeDetector;

      if (DetectorCtor) {
        try {
          const supportedFormats = DetectorCtor.getSupportedFormats
            ? await DetectorCtor.getSupportedFormats()
            : ['qr_code'];
          if (!supportedFormats || supportedFormats.includes('qr_code')) {
            detector = new DetectorCtor({ formats: ['qr_code'] });
            if (mountedRef.current) setDecoderEngine('native');
          }
        } catch {
          detector = null;
        }
      }

      if (!detector && mountedRef.current) {
        setDecoderEngine('jsqr');
      }

      let isDetectingFrame = false;

      const scanLoop = async () => {
        if (!mountedRef.current || !streamRef.current || detectedLockRef.current) return;
        const v = videoRef.current;

        if (v && v.readyState >= v.HAVE_CURRENT_DATA && v.videoWidth > 0 && v.videoHeight > 0 && !isDetectingFrame) {
          isDetectingFrame = true;
          try {
            let decodedText: string | null = null;

            if (detector) {
              try {
                const barcodes = await detector.detect(v);
                if (barcodes && barcodes.length > 0 && barcodes[0]?.rawValue) {
                  decodedText = barcodes[0].rawValue;
                }
              } catch {
                // Fall back seamlessly to jsQR if native detector throws on this frame
                detector = null;
                if (mountedRef.current) setDecoderEngine('jsqr');
              }
            }

            if (!decodedText) {
              const c = canvasRef.current;
              if (c) {
                const maxSide = 720;
                const scale = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
                c.width = Math.max(1, Math.floor(v.videoWidth * scale));
                c.height = Math.max(1, Math.floor(v.videoHeight * scale));
                const ctx = c.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                  ctx.drawImage(v, 0, 0, c.width, c.height);
                  const imageData = ctx.getImageData(0, 0, c.width, c.height);
                  const qrResult = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: 'attemptBoth',
                  });
                  if (qrResult?.data) {
                    decodedText = qrResult.data;
                  }
                }
              }
            }

            if (decodedText) {
              handleDecodedPayload(decodedText);
            }
          } finally {
            isDetectingFrame = false;
          }
        }

        if (mountedRef.current && streamRef.current && !detectedLockRef.current) {
          rafRef.current = requestAnimationFrame(scanLoop);
        }
      };

      rafRef.current = requestAnimationFrame(scanLoop);
    } catch (err) {
      if (!mountedRef.current) return;
      const errName = err instanceof Error ? err.name : '';

      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError' || errName === 'SecurityError') {
        setCameraStatus('denied');
        setCameraErrorMsg(
          'Camera permission was denied. Allow camera access in your browser site settings for this page, then tap Retry Camera.'
        );
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        setCameraStatus('unavailable');
        setCameraErrorMsg(
          'No camera was detected on this device. Connect or enable a camera to scan the computer QR code.'
        );
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
        setCameraStatus('error');
        setCameraErrorMsg(
          'Camera is currently in use by another app. Close other camera apps and tap Retry Camera.'
        );
      } else {
        setCameraStatus('error');
        setCameraErrorMsg('Could not open the camera on this device. Tap Retry Camera to try again.');
      }
      stopCamera();
    }
  }, [handleDecodedPayload, onClearError, stopCamera]);

  useEffect(() => {
    mountedRef.current = true;
    startScanner();

    return () => {
      mountedRef.current = false;
      stopCamera();
    };
  }, [startScanner, stopCamera]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopCamera();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, stopCamera]);

  const handleClose = () => {
    stopCamera();
    onClose();
  };

  const displayError = externalError || invalidQrBanner;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: ROOMWISE_EASE }}
      className="fixed inset-0 z-[70] bg-neutral-950 text-white flex flex-col justify-between select-none"
      role="dialog"
      aria-modal="true"
      aria-label="Scan Computer QR Code"
    >
      {/* Top Bar */}
      <header className="relative z-20 flex items-center justify-between px-4 py-3.5 bg-neutral-950/85 backdrop-blur-md border-b border-white/10">
        <ActionButton
          variant="dark-ghost"
          size="sm"
          onClick={handleClose}
          icon={<ArrowLeft className="w-4 h-4" />}
          className="min-h-[40px]"
        >
          Back
        </ActionButton>

        <div className="text-center">
          <div className="text-xs font-bold tracking-tight text-white">
            Scan Computer QR Code
          </div>
          <div className="text-[11px] text-emerald-300 font-medium">
            ROOMWISE Verification
          </div>
        </div>

        <IconButton
          variant="dark-ghost"
          size="md"
          label="Close QR scanner"
          onClick={handleClose}
        >
          <X className="w-4.5 h-4.5" />
        </IconButton>
      </header>

      {/* Primary Camera Viewport */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-neutral-950">
        {/* Live Camera Video */}
        <video
          ref={videoRef}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
            cameraStatus === 'active' ? 'opacity-100' : 'opacity-0'
          }`}
          muted
          playsInline
          autoPlay
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Square Viewfinder Overlay when Camera Active */}
        {cameraStatus === 'active' && (
          <div className="relative z-10 flex flex-col items-center justify-center px-6 w-full">
            <div className="relative w-64 h-64 sm:w-72 sm:h-72 rounded-2xl shadow-[0_0_0_9999px_rgba(9,9,11,0.58)]">
              {/* Sharp Emerald Corner Brackets */}
              <span className="absolute -top-0.5 -left-0.5 w-8 h-8 border-t-[3px] border-l-[3px] border-emerald-400 rounded-tl-xl" />
              <span className="absolute -top-0.5 -right-0.5 w-8 h-8 border-t-[3px] border-r-[3px] border-emerald-400 rounded-tr-xl" />
              <span className="absolute -bottom-0.5 -left-0.5 w-8 h-8 border-b-[3px] border-l-[3px] border-emerald-400 rounded-bl-xl" />
              <span className="absolute -bottom-0.5 -right-0.5 w-8 h-8 border-b-[3px] border-r-[3px] border-emerald-400 rounded-br-xl" />

              {/* Subtle Animated Scanning Beam (transform-only) */}
              {!isProcessing && (
                <motion.div
                  initial={{ y: 14 }}
                  animate={{ y: [14, 232, 14] }}
                  transition={{
                    duration: 2.4,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                  className="absolute inset-x-4 h-0.5 rounded-full bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_10px_rgba(52,211,153,0.75)]"
                />
              )}

              {/* Server Verification Busy State */}
              <AnimatePresence>
                {isProcessing && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 rounded-2xl bg-neutral-950/75 backdrop-blur-xs flex flex-col items-center justify-center gap-2.5 p-4 text-center"
                  >
                    <Loader2 className="w-7 h-7 animate-spin text-emerald-400" />
                    <span className="text-xs font-semibold text-white">
                      Validating QR session...
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <p className="mt-7 text-xs sm:text-sm font-medium text-white text-center drop-shadow-xs max-w-xs">
              Scan the QR code displayed on your computer.
            </p>
            <span className="mt-1 text-[11px] text-white/60">
              {decoderEngine === 'native' ? 'Hardware QR detection ready' : 'Live optical scanner ready'}
            </span>
          </div>
        )}

        {/* Requesting Camera State */}
        {cameraStatus === 'requesting' && (
          <div className="relative z-10 p-6 max-w-xs text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center mx-auto">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
            </div>
            <div className="text-sm font-bold text-white">Opening camera...</div>
            <p className="text-xs text-white/70 leading-relaxed">
              Allow camera access when prompted so you can scan the QR code displayed on your computer.
            </p>
          </div>
        )}

        {/* Camera Denied / Unavailable / Error State */}
        {(cameraStatus === 'denied' || cameraStatus === 'unavailable' || cameraStatus === 'error') && (
          <div className="relative z-10 p-6 max-w-sm w-full">
            <div className="rounded-2xl bg-white text-neutral-900 p-6 space-y-4 shadow-xl border border-neutral-200">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center">
                {cameraStatus === 'denied' ? (
                  <Camera className="w-6 h-6" />
                ) : (
                  <AlertTriangle className="w-6 h-6" />
                )}
              </div>

              <div className="space-y-1.5">
                <h3 className="text-sm font-extrabold text-neutral-900">
                  {cameraStatus === 'denied'
                    ? 'Camera Permission Required'
                    : cameraStatus === 'unavailable'
                    ? 'Camera Unavailable'
                    : 'Camera Could Not Start'}
                </h3>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {cameraErrorMsg}
                </p>
              </div>

              {cameraStatus === 'denied' && (
                <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200/80 text-[11px] text-neutral-600 space-y-1">
                  <div className="font-semibold text-neutral-800">How to enable camera access:</div>
                  <div>1. Open browser Settings / Site Permissions for this page.</div>
                  <div>2. Change Camera from Block/Ask to Allow.</div>
                  <div>3. Tap Retry Camera below.</div>
                </div>
              )}

              <div className="flex items-center gap-2.5">
                <ActionButton
                  variant="forest"
                  size="lg"
                  onClick={startScanner}
                  icon={<RefreshCw className="w-3.5 h-3.5" />}
                  className="flex-1 min-h-[44px]"
                >
                  Retry Camera
                </ActionButton>
                <ActionButton
                  variant="secondary"
                  size="lg"
                  onClick={handleClose}
                  className="min-h-[44px]"
                >
                  Close
                </ActionButton>
              </div>

              {allowManualCode && onManualCodeSubmit && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (manualCode.trim()) {
                      stopCamera();
                      onManualCodeSubmit(manualCode.trim());
                    }
                  }}
                  className="pt-3 border-t border-neutral-200 space-y-2"
                >
                  <label className="block text-[11px] font-semibold text-neutral-600">
                    Or enter the 6-character pairing code shown below the computer QR
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      maxLength={8}
                      value={manualCode}
                      onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                      placeholder="A7K9M2"
                      className="flex-1 min-h-[42px] px-3 py-2 border border-neutral-300 rounded-xl font-mono text-xs uppercase tracking-widest text-neutral-900 focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                    />
                    <ActionButton
                      type="submit"
                      variant="primary"
                      size="lg"
                      disabled={!manualCode.trim() || isProcessing}
                      className="min-h-[42px]"
                    >
                      Verify
                    </ActionButton>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Error / Guidance Toast inside Scanner */}
      <div className="relative z-20 px-4 py-3.5 bg-neutral-950/90 backdrop-blur-md border-t border-white/10 min-h-[64px] flex items-center justify-center">
        <AnimatePresence mode="wait">
          {displayError ? (
            <motion.div
              key="scanner-err"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.16, ease: ROOMWISE_EASE }}
              className="max-w-md w-full rounded-xl bg-rose-950/90 border border-rose-500/40 px-3.5 py-2.5 flex items-center justify-between gap-2.5 text-xs text-rose-100"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{displayError}</span>
              </div>
              <ActionButton
                variant="dark-ghost"
                size="xs"
                onClick={() => {
                  detectedLockRef.current = false;
                  setInvalidQrBanner(null);
                  if (onClearError) onClearError();
                  if (!streamRef.current || cameraStatus !== 'active') {
                    startScanner();
                  }
                }}
              >
                Retry
              </ActionButton>
            </motion.div>
          ) : (
            <motion.div
              key="scanner-hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 text-xs text-white/75"
            >
              <QrCode className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Hold your phone steady over the computer screen QR code</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
