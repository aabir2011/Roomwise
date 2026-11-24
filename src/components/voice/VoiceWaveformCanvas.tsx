/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import type { VoiceAssistantPhase } from '../../types/voice';

interface VoiceWaveformCanvasProps {
  amplitudeRef: React.MutableRefObject<number>;
  phase: VoiceAssistantPhase;
  isMuted: boolean;
}

const BAR_COUNT = 28;

export const VoiceWaveformCanvas: React.FC<VoiceWaveformCanvasProps> = ({
  amplitudeRef,
  phase,
  isMuted,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const isStaticPhase =
      isMuted ||
      phase === 'error' ||
      phase === 'disabled' ||
      phase === 'unavailable' ||
      phase === 'permission_required' ||
      phase === 'muted' ||
      phase === 'audio_suspended';

    let rafId = 0;
    const smoothedBars = new Float32Array(BAR_COUNT);
    let tick = 0;

    const drawFrame = () => {
      tick += 0.06;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssWidth = canvas.clientWidth || 280;
      const cssHeight = canvas.clientHeight || 36;
      const targetW = Math.round(cssWidth * dpr);
      const targetH = Math.round(cssHeight * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const rawAmp = isMuted ? 0 : Math.max(0, Math.min(1, amplitudeRef.current));
      const barWidth = 3;
      const totalGap = cssWidth - BAR_COUNT * barWidth;
      const gap = Math.max(2, totalGap / (BAR_COUNT - 1));
      const midY = cssHeight / 2;

      for (let i = 0; i < BAR_COUNT; i++) {
        const distFromCenter = Math.abs(i - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2);
        const envelope = Math.max(0.22, 1 - distFromCenter * 0.72);

        let targetHeightRatio = 0.08;
        if (!isStaticPhase) {
          if (prefersReducedMotion) {
            // Reduced motion: reflect real audio amplitude steadily without sinusoidal oscillation
            targetHeightRatio =
              phase === 'listening' || phase === 'speaking'
                ? Math.max(0.12, Math.min(0.85, (0.12 + rawAmp * 0.78) * envelope))
                : 0.16 * envelope;
          } else if (phase === 'speaking') {
            const harmonic = 0.45 + 0.55 * Math.abs(Math.sin(tick * 1.9 + i * 0.42));
            targetHeightRatio = Math.max(
              0.14,
              Math.min(0.96, (0.18 + rawAmp * 0.85) * harmonic * envelope)
            );
          } else if (
            phase === 'processing' ||
            phase === 'executing' ||
            phase === 'connecting' ||
            phase === 'wake_detected'
          ) {
            const sweep = 0.35 + 0.65 * Math.max(0, Math.sin(tick * 2.2 - i * 0.28));
            targetHeightRatio = 0.14 + sweep * 0.32 * envelope;
          } else if (phase === 'listening') {
            const voiceShape = 0.6 + 0.4 * Math.sin(tick * 1.4 + i * 0.55);
            targetHeightRatio = Math.max(
              0.1,
              Math.min(0.95, (0.09 + rawAmp * 0.92 * voiceShape) * envelope)
            );
          } else if (phase === 'standby') {
            targetHeightRatio = (0.08 + rawAmp * 0.35) * envelope;
          }
        }

        smoothedBars[i] = isStaticPhase
          ? targetHeightRatio
          : smoothedBars[i] + (targetHeightRatio - smoothedBars[i]) * 0.24;
        const barH = Math.max(3, smoothedBars[i] * (cssHeight - 6));
        const x = i * (barWidth + gap);
        const y = midY - barH / 2;

        if (isStaticPhase) {
          ctx.fillStyle = '#cbd5e1';
        } else if (phase === 'speaking') {
          ctx.fillStyle = '#0d9488';
        } else {
          ctx.fillStyle = rawAmp > 0.08 ? '#059669' : '#34d399';
        }

        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, barWidth, barH, 1.5);
        } else {
          ctx.rect(x, y, barWidth, barH);
        }
        ctx.fill();
      }

      ctx.restore();
    };

    const renderLoop = () => {
      drawFrame();
      if (!isStaticPhase) {
        rafId = requestAnimationFrame(renderLoop);
      }
    };

    drawFrame();
    if (!isStaticPhase) {
      rafId = requestAnimationFrame(renderLoop);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [amplitudeRef, phase, isMuted]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-9 block"
      aria-hidden="true"
    />
  );
};
