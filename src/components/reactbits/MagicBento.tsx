/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

interface MagicBentoContextValue {
  registerCard: (id: string, el: HTMLElement | null) => void;
  triggerWave: (clientX: number, clientY: number) => void;
}

const MagicBentoContext = createContext<MagicBentoContextValue | null>(null);

export interface MagicBentoProps {
  children: React.ReactNode;
  className?: string;
  spotlightRadius?: number;
  glowRgb?: string;
  enableTilt?: boolean;
  disableAnimations?: boolean;
}

interface CardRuntime {
  el: HTMLElement;
  rect: DOMRect;
  hot: number;
  near: number;
  rx: number;
  ry: number;
  vrx: number;
  vry: number;
  press: number;
  vpress: number;
  px: number;
  py: number;
}

const FALLOFF = [1, 0.88, 0.65, 0.4, 0.18, 0.04];

function buildRadialStops(alphaExpr: string): string {
  const stops = FALLOFF.map(
    (f, i) => `rgba(var(--mb-glow-rgb), calc(${alphaExpr} * ${f})) ${i * 18}%`
  ).join(', ');
  return `${stops}, rgba(var(--mb-glow-rgb), 0) 100%`;
}

/**
 * React Bits-inspired MagicBento grid container tuned for ROOMWISE's architectural porcelain aesthetic.
 * Uses a single rAF-throttled pointer proximity & spring engine across all tiles (zero React re-renders).
 */
export const MagicBento: React.FC<MagicBentoProps> = ({
  children,
  className = '',
  spotlightRadius = 260,
  glowRgb = '5, 150, 105',
  enableTilt = true,
  disableAnimations = false,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cardsRef = useRef<Map<string, CardRuntime>>(new Map());
  const pointerRef = useRef<{ x: number; y: number; inside: boolean; downId: string | null }>({
    x: -9999,
    y: -9999,
    inside: false,
    downId: null,
  });
  const waveRef = useRef<{ x: number; y: number; r: number; a: number; active: boolean }>({
    x: 0,
    y: 0,
    r: 0,
    a: 0,
    active: false,
  });
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const dirtyRectsRef = useRef<boolean>(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [coarsePointer, setCoarsePointer] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mqCoarse = window.matchMedia('(pointer: coarse)');
    setReducedMotion(mqMotion.matches);
    setCoarsePointer(mqCoarse.matches);
    const onM = () => setReducedMotion(mqMotion.matches);
    const onC = () => setCoarsePointer(mqCoarse.matches);
    mqMotion.addEventListener('change', onM);
    mqCoarse.addEventListener('change', onC);
    return () => {
      mqMotion.removeEventListener('change', onM);
      mqCoarse.removeEventListener('change', onC);
    };
  }, []);

  const animationsOff = disableAnimations || reducedMotion || coarsePointer;

  const scheduleTick = useCallback(() => {
    if (animationsOff || rafRef.current) return;
    lastFrameRef.current = performance.now();
    rafRef.current = requestAnimationFrame(stepEngine);
  }, [animationsOff]);

  const stepEngine = useCallback(
    (now: number) => {
      rafRef.current = 0;
      if (animationsOff) return;

      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameRef.current) / 1000));
      lastFrameRef.current = now;

      if (dirtyRectsRef.current) {
        cardsRef.current.forEach((card) => {
          card.rect = card.el.getBoundingClientRect();
        });
        dirtyRectsRef.current = false;
      }

      const ptr = pointerRef.current;
      const wave = waveRef.current;
      let keepRunning = false;

      if (wave.active) {
        wave.r += 760 * dt;
        wave.a = Math.max(0, wave.a - 2.35 * dt);
        if (wave.a <= 0.005) {
          wave.active = false;
          wave.a = 0;
        } else {
          keepRunning = true;
        }
      }

      const stiffness = 240;
      const damping = 21;

      cardsRef.current.forEach((card, id) => {
        const r = card.rect;
        if (r.width <= 0 || r.height <= 0) return;

        const insideCard =
          ptr.inside &&
          ptr.x >= r.left &&
          ptr.x <= r.right &&
          ptr.y >= r.top &&
          ptr.y <= r.bottom;

        // Distance from pointer to nearest point on card bounds
        const cx = Math.max(r.left, Math.min(ptr.x, r.right));
        const cy = Math.max(r.top, Math.min(ptr.y, r.bottom));
        const distToCard = ptr.inside ? Math.hypot(ptr.x - cx, ptr.y - cy) : 9999;

        const targetHot = insideCard ? 1 : 0;
        const proxReach = spotlightRadius * 0.85;
        const targetNear = ptr.inside ? Math.max(0, 1 - distToCard / proxReach) : 0;

        card.hot += (targetHot - card.hot) * Math.min(1, 16 * dt);
        card.near += (targetNear - card.near) * Math.min(1, 16 * dt);

        if (insideCard || targetNear > 0.01) {
          card.px = ptr.x - r.left;
          card.py = ptr.y - r.top;
        }

        // Tactile architectural 3D tilt (±2.2 deg)
        const nx = insideCard ? ((ptr.x - r.left) / r.width - 0.5) * 2 : 0;
        const ny = insideCard ? ((ptr.y - r.top) / r.height - 0.5) * 2 : 0;
        const targetRx = enableTilt && insideCard ? -ny * 2.2 : 0;
        const targetRy = enableTilt && insideCard ? nx * 2.2 : 0;
        const targetPress = ptr.downId === id ? 0.99 : 1;

        const arx = (targetRx - card.rx) * stiffness - card.vrx * damping;
        const ary = (targetRy - card.ry) * stiffness - card.vry * damping;
        const ap = (targetPress - card.press) * 320 - card.vpress * 26;

        card.vrx += arx * dt;
        card.vry += ary * dt;
        card.vpress += ap * dt;
        card.rx += card.vrx * dt;
        card.ry += card.vry * dt;
        card.press += card.vpress * dt;

        const style = card.el.style;
        style.setProperty('--mb-x', `${card.px.toFixed(1)}px`);
        style.setProperty('--mb-y', `${card.py.toFixed(1)}px`);
        style.setProperty('--mb-hot', card.hot.toFixed(3));
        style.setProperty('--mb-near', card.near.toFixed(3));
        style.setProperty('--mb-rx', `${card.rx.toFixed(3)}deg`);
        style.setProperty('--mb-ry', `${card.ry.toFixed(3)}deg`);
        style.setProperty('--mb-press', card.press.toFixed(4));

        if (wave.active) {
          style.setProperty('--mb-wx', `${(wave.x - r.left).toFixed(1)}px`);
          style.setProperty('--mb-wy', `${(wave.y - r.top).toFixed(1)}px`);
          style.setProperty('--mb-wr', `${wave.r.toFixed(1)}px`);
          style.setProperty('--mb-wa', wave.a.toFixed(3));
        } else if (style.getPropertyValue('--mb-wa') !== '0') {
          style.setProperty('--mb-wa', '0');
        }

        const settled =
          Math.abs(targetHot - card.hot) < 0.004 &&
          Math.abs(targetNear - card.near) < 0.004 &&
          Math.abs(targetRx - card.rx) < 0.01 &&
          Math.abs(targetRy - card.ry) < 0.01 &&
          Math.abs(targetPress - card.press) < 0.001 &&
          Math.abs(card.vrx) < 0.05 &&
          Math.abs(card.vry) < 0.05 &&
          Math.abs(card.vpress) < 0.01;

        if (!settled) keepRunning = true;
      });

      if (keepRunning) {
        rafRef.current = requestAnimationFrame(stepEngine);
      }
    },
    [animationsOff, enableTilt, spotlightRadius]
  );

  useEffect(() => {
    if (animationsOff) {
      cardsRef.current.forEach((card) => {
        card.el.style.setProperty('--mb-hot', '0');
        card.el.style.setProperty('--mb-near', '0');
        card.el.style.setProperty('--mb-rx', '0deg');
        card.el.style.setProperty('--mb-ry', '0deg');
        card.el.style.setProperty('--mb-press', '1');
        card.el.style.setProperty('--mb-wa', '0');
      });
      return;
    }

    const onPointerMove = (ev: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const pad = spotlightRadius * 0.6;
      const inside =
        ev.clientX >= rootRect.left - pad &&
        ev.clientX <= rootRect.right + pad &&
        ev.clientY >= rootRect.top - pad &&
        ev.clientY <= rootRect.bottom + pad;

      pointerRef.current.x = ev.clientX;
      pointerRef.current.y = ev.clientY;
      pointerRef.current.inside = inside;
      dirtyRectsRef.current = true;
      scheduleTick();
    };

    const onPointerLeave = () => {
      pointerRef.current.inside = false;
      pointerRef.current.downId = null;
      scheduleTick();
    };

    const onScrollOrResize = () => {
      dirtyRectsRef.current = true;
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('scroll', onScrollOrResize, { passive: true, capture: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('scroll', onScrollOrResize, { capture: true });
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [animationsOff, scheduleTick, spotlightRadius]);

  const registerCard = useCallback((id: string, el: HTMLElement | null) => {
    if (!el) {
      cardsRef.current.delete(id);
      return;
    }
    cardsRef.current.set(id, {
      el,
      rect: el.getBoundingClientRect(),
      hot: 0,
      near: 0,
      rx: 0,
      ry: 0,
      vrx: 0,
      vry: 0,
      press: 1,
      vpress: 0,
      px: -999,
      py: -999,
    });
    dirtyRectsRef.current = true;
  }, []);

  const triggerWave = useCallback(
    (clientX: number, clientY: number) => {
      if (animationsOff) return;
      waveRef.current = { x: clientX, y: clientY, r: 16, a: 0.95, active: true };
      dirtyRectsRef.current = true;
      scheduleTick();
    },
    [animationsOff, scheduleTick]
  );

  const contextValue = useMemo<MagicBentoContextValue>(
    () => ({ registerCard, triggerWave }),
    [registerCard, triggerWave]
  );

  return (
    <MagicBentoContext.Provider value={contextValue}>
      <div
        ref={rootRef}
        className={className}
        style={
          {
            ['--mb-glow-rgb' as string]: glowRgb,
            ['--mb-spot-size' as string]: `${spotlightRadius}px`,
            ['--mb-border-size' as string]: `${Math.round(spotlightRadius * 0.85)}px`,
            ['--mb-spot-alpha' as string]: '0.165',
            ['--mb-glow-alpha' as string]: '0.62',
          } as CSSProperties
        }
      >
        {children}
      </div>
    </MagicBentoContext.Provider>
  );
};

export interface MagicBentoCardProps extends React.HTMLAttributes<HTMLElement> {
  cardId: string;
  as?: 'div' | 'button';
  tone?: 'light' | 'obsidian';
  children: React.ReactNode;
  className?: string;
  accentRimClassName?: string;
  onClick?: React.MouseEventHandler<HTMLElement>;
}

const CARD_SPOTLIGHT_STYLE: CSSProperties = {
  background: `radial-gradient(var(--mb-spot-size, 280px) circle at var(--mb-x, -999px) var(--mb-y, -999px), ${buildRadialStops(
    'calc(var(--mb-spot-alpha, 0.165) * max(var(--mb-hot, 0), calc(var(--mb-near, 0) * 0.35)))'
  )})`,
};

const CARD_SPOTLIGHT_DARK_STYLE: CSSProperties = {
  background: `radial-gradient(var(--mb-spot-size, 280px) circle at var(--mb-x, -999px) var(--mb-y, -999px), ${buildRadialStops(
    'calc(0.18 * max(var(--mb-hot, 0), calc(var(--mb-near, 0) * 0.25)))'
  )})`,
};

const CARD_BORDER_STYLE: CSSProperties = {
  background: `radial-gradient(var(--mb-border-size, 230px) circle at var(--mb-x, -999px) var(--mb-y, -999px), ${buildRadialStops(
    'var(--mb-glow-alpha, 0.62) * var(--mb-near, 0)'
  )}), radial-gradient(circle at var(--mb-wx, -999px) var(--mb-wy, -999px), rgba(var(--mb-glow-rgb), 0) calc(var(--mb-wr, 0px) - 84px), rgba(var(--mb-glow-rgb), calc(var(--mb-glow-alpha, 0.62) * var(--mb-wa, 0))) calc(var(--mb-wr, 0px) - 22px), rgba(var(--mb-glow-rgb), 0) var(--mb-wr, 0px))`,
  WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
  WebkitMaskComposite: 'xor',
  mask: 'linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)',
};

export const MagicBentoCard: React.FC<MagicBentoCardProps> = ({
  cardId,
  as = 'div',
  tone = 'light',
  children,
  className = '',
  accentRimClassName,
  onClick,
  style,
  ...rest
}) => {
  const ctx = useContext(MagicBentoContext);
  const elRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    ctx?.registerCard(cardId, elRef.current);
    return () => ctx?.registerCard(cardId, null);
  }, [ctx, cardId]);

  const handleClick: React.MouseEventHandler<HTMLElement> = (ev) => {
    ctx?.triggerWave(ev.clientX, ev.clientY);
    onClick?.(ev);
  };

  const Component = as;
  const setRef = (node: HTMLElement | null) => {
    elRef.current = node;
  };

  const surfaceClasses =
    tone === 'obsidian'
      ? 'rw-obsidian-panel text-white rounded-xl transition-[border-color] duration-200 hover:border-emerald-400/30'
      : 'rounded-xl bg-gradient-to-b from-white to-[#fbfcfa] border border-[#111916]/10 shadow-[0_1px_2px_rgba(11,23,19,0.03)] transition-[box-shadow,border-color] duration-200 hover:border-[#0b6e4f]/32 hover:shadow-[0_8px_20px_-14px_rgba(11,23,19,0.16)]';

  return (
    <Component
      ref={setRef as React.Ref<never>}
      type={as === 'button' ? 'button' : undefined}
      onClick={handleClick}
      className={`relative isolate overflow-hidden ${surfaceClasses} ${
        onClick ? 'cursor-pointer text-left' : ''
      } ${className}`.trim()}
      style={{
        transform:
          'perspective(900px) rotateX(var(--mb-rx, 0deg)) rotateY(var(--mb-ry, 0deg)) scale(var(--mb-press, 1))',
        ...style,
      }}
      {...rest}
    >
      {accentRimClassName && (
        <div className={`absolute top-0 left-0 right-0 h-[2px] z-20 ${accentRimClassName}`} />
      )}

      <div className="relative z-10 h-full w-full flex flex-col">{children}</div>

      {/* Cursor-following radial illumination above translucent/tinted card rows so white cards illuminate clearly */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[15] rounded-[inherit]"
        style={tone === 'obsidian' ? CARD_SPOTLIGHT_DARK_STYLE : CARD_SPOTLIGHT_STYLE}
      />

      {/* Crisp pointer-proximity border highlight & click ripple */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] p-[1.5px]"
        style={CARD_BORDER_STYLE}
      />
    </Component>
  );
};

export default MagicBento;
