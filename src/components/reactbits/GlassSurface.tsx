/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

export type GlassSurfaceChannel = 'R' | 'G' | 'B';
export type GlassSurfaceRenderer = 'auto' | 'webgl' | 'svg';
export type GlassSurfaceBackdrop = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

export interface GlassBackdropContextValue {
  canvas: HTMLCanvasElement | null;
  subscribeFrame: (listener: () => void) => () => void;
  isSoftwareGl?: boolean;
}

const GlassBackdropContext = createContext<GlassBackdropContextValue | null>(null);

export const GlassBackdropProvider: React.FC<{
  value: GlassBackdropContextValue;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <GlassBackdropContext.Provider value={value}>{children}</GlassBackdropContext.Provider>
);

export interface GlassSurfaceProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'div' | 'aside';
  children: React.ReactNode;
  className?: string;
  backdrop?: React.RefObject<GlassSurfaceBackdrop | null> | GlassSurfaceBackdrop | null;
  renderer?: GlassSurfaceRenderer;
  refraction?: boolean;
  borderRadius?: number;
  bevelWidth?: number;
  distortionScale?: number;
  redOffset?: number;
  greenOffset?: number;
  blueOffset?: number;
  spread?: number;
  saturation?: number;
  tintOpacity?: number;
}

const GLASS_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const GLASS_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uBackdrop;
uniform sampler2D uMap;
uniform vec2 uCanvas;
uniform vec2 uSize;
uniform vec2 uOrigin;
uniform vec2 uStep;
uniform vec3 uScale;
uniform float uSpread;
uniform float uSaturation;
uniform float uTintOpacity;

out vec4 outColor;

vec4 sampleRefracted(vec2 p, out float edgeWeight) {
  vec2 uv = clamp(p / max(uSize, vec2(1.0)), 0.0, 1.0);
  vec4 map = texture(uMap, uv);
  vec2 shift = map.rg - 0.5;
  edgeWeight = clamp((map.b - 0.5) * 2.2, 0.0, 1.0);

  vec2 base = uOrigin + p * uStep;
  vec2 uvR = clamp(base + shift * uScale.r * uStep, 0.001, 0.999);
  vec2 uvG = clamp(base + shift * uScale.g * uStep, 0.001, 0.999);
  vec2 uvB = clamp(base + shift * uScale.b * uStep, 0.001, 0.999);

  float r = texture(uBackdrop, uvR).r;
  float g = texture(uBackdrop, uvG).g;
  float b = texture(uBackdrop, uvB).b;
  float a = max(texture(uBackdrop, uvG).a, 0.99);
  return vec4(r, g, b, a);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y) / max(uCanvas, vec2(1.0)) * uSize;
  float centerEdge = 0.0;
  vec4 color = vec4(0.0);

  if (uSpread < 0.05) {
    color = sampleRefracted(p, centerEdge);
  } else {
    float total = 0.0;
    float sigma = max(0.35, uSpread);
    for (int j = -2; j <= 2; j++) {
      for (int i = -2; i <= 2; i++) {
        vec2 offset = vec2(float(i), float(j)) * sigma * 0.85;
        float w = exp(-dot(offset, offset) / (2.0 * sigma * sigma));
        float ew = 0.0;
        color += sampleRefracted(p + offset, ew) * w;
        if (i == 0 && j == 0) centerEdge = ew;
        total += w;
      }
    }
    color /= max(total, 0.0001);
  }

  vec3 rgb = color.rgb;
  float s = uSaturation;
  mat3 satMat = mat3(
    0.213 + 0.787 * s, 0.213 - 0.213 * s, 0.213 - 0.213 * s,
    0.715 - 0.715 * s, 0.715 + 0.285 * s, 0.715 - 0.715 * s,
    0.072 - 0.072 * s, 0.072 - 0.072 * s, 0.072 + 0.928 * s
  );
  rgb = clamp(satMat * rgb, 0.0, 1.0);

  // Smoked obsidian-emerald optical tint: preserves vivid bevel refraction while anchoring high text contrast
  vec3 emeraldGlassTint = vec3(0.018, 0.052, 0.042);
  float interiorMask = mix(clamp(uTintOpacity, 0.25, 0.86), max(0.28, uTintOpacity - 0.14), centerEdge);
  rgb = mix(rgb, emeraldGlassTint, interiorMask);

  // Subtle static Fresnel edge brightening + vertical optical depth
  vec2 normUv = clamp(p / max(uSize, vec2(1.0)), 0.0, 1.0);
  vec3 emeraldRim = vec3(0.48, 0.88, 0.72);
  rgb += emeraldRim * (centerEdge * 0.075);

  float verticalDepth = mix(0.008, -0.045, normUv.y);
  rgb = clamp(rgb + verticalDepth, 0.0, 1.0);

  outColor = vec4(rgb, 0.99);
}`;

function compileGlassProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const compile = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  };
  const vert = compile(gl.VERTEX_SHADER, GLASS_VERTEX);
  const frag = compile(gl.FRAGMENT_SHADER, GLASS_FRAGMENT);
  const program = gl.createProgram();
  if (!vert || !frag || !program) return null;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.bindAttribLocation(program, 0, 'aPosition');
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return null;
}

function sdRoundedBox(
  px: number,
  py: number,
  halfW: number,
  halfH: number,
  radius: number
): number {
  const r = Math.min(radius, halfW, halfH);
  const qx = Math.abs(px) - (halfW - r);
  const qy = Math.abs(py) - (halfH - r);
  const outDist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inDist = Math.min(Math.max(qx, qy), 0);
  return outDist + inDist - r;
}

/**
 * Generates an analytical rounded-rectangle SDF displacement map on a compact 2D canvas.
 * R encodes horizontal lens slope, G encodes vertical lens slope, B encodes bevel curvature height.
 */
function buildLiquidGlassDisplacementMap(
  layoutWidth: number,
  layoutHeight: number,
  radius: number,
  bevelPx: number
): { canvas: HTMLCanvasElement; dataUrl: string } {
  const maxDim = 224;
  const scale = Math.min(1, maxDim / Math.max(layoutWidth, layoutHeight, 1));
  const w = Math.max(16, Math.round(layoutWidth * scale));
  const h = Math.max(16, Math.round(layoutHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, dataUrl: '' };

  const img = ctx.createImageData(w, h);
  const data = img.data;
  const halfW = layoutWidth * 0.5;
  const halfH = layoutHeight * 0.5;
  const bevel = Math.max(8, Math.min(bevelPx, Math.min(halfW, halfH) * 0.65));
  const eps = 0.75;

  for (let y = 0; y < h; y++) {
    const py = ((y + 0.5) / h) * layoutHeight - halfH;
    for (let x = 0; x < w; x++) {
      const px = ((x + 0.5) / w) * layoutWidth - halfW;
      const dist = sdRoundedBox(px, py, halfW, halfH, radius);
      const insideDepth = Math.max(0, -dist);

      // Rounded-box SDF gradient pointing outward toward nearest edge
      const gx =
        (sdRoundedBox(px + eps, py, halfW, halfH, radius) -
          sdRoundedBox(px - eps, py, halfW, halfH, radius)) /
        (2 * eps);
      const gy =
        (sdRoundedBox(px, py + eps, halfW, halfH, radius) -
          sdRoundedBox(px, py - eps, halfW, halfH, radius)) /
        (2 * eps);

      // Strong convex optical lens refraction around the glass bevel + subtle inner meniscus curve
      const edgeT = Math.max(0, 1 - insideDepth / bevel);
      const bevelCurve = Math.pow(edgeT, 1.45);
      const meniscusX = (px / Math.max(halfW, 1)) * 0.1;
      const meniscusY = (py / Math.max(halfH, 1)) * 0.1;

      const shiftX = gx * bevelCurve * 0.92 + meniscusX;
      const shiftY = gy * bevelCurve * 0.92 + meniscusY;

      const idx = (y * w + x) * 4;
      data[idx] = Math.max(0, Math.min(255, Math.round((0.5 + shiftX * 0.48) * 255)));
      data[idx + 1] = Math.max(0, Math.min(255, Math.round((0.5 + shiftY * 0.48) * 255)));
      data[idx + 2] = Math.max(0, Math.min(255, Math.round((0.5 + bevelCurve * 0.45) * 255)));
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  let dataUrl = '';
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch {
    dataUrl = '';
  }
  return { canvas, dataUrl };
}

function resolveBackdropNode(
  explicit: GlassSurfaceProps['backdrop'],
  contextCanvas: HTMLCanvasElement | null | undefined
): GlassSurfaceBackdrop | null {
  if (explicit) {
    const node =
      typeof explicit === 'object' && 'current' in explicit ? explicit.current : explicit;
    if (
      node instanceof HTMLCanvasElement ||
      node instanceof HTMLImageElement ||
      node instanceof HTMLVideoElement
    ) {
      return node;
    }
  }
  return contextCanvas ?? null;
}

function getBackdropDimensions(node: GlassSurfaceBackdrop): [number, number] {
  if (node instanceof HTMLImageElement) return [node.naturalWidth, node.naturalHeight];
  if (node instanceof HTMLVideoElement) return [node.videoWidth, node.videoHeight];
  return [node.width, node.height];
}

function supportsSvgBackdropFilter(filterId: string): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const isWebkit = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
  const isFirefox = /Firefox/.test(navigator.userAgent);
  if (isWebkit || isFirefox) return false;
  const probe = document.createElement('div');
  probe.style.backdropFilter = `url(#${filterId})`;
  return probe.style.backdropFilter !== '';
}

const LIQUID_GLASS_SHADOW =
  '0 22px 46px -14px rgba(3, 14, 10, 0.62), 0 4px 14px -2px rgba(2, 10, 8, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 0 0 1px rgba(2, 14, 10, 0.55), inset 0 -2px 8px rgba(2, 10, 8, 0.45)';

const SPECULAR_RIM_BG =
  'linear-gradient(142deg, rgba(236, 253, 245, 0.42) 0%, rgba(167, 243, 208, 0.16) 22%, rgba(255, 255, 255, 0.04) 52%, rgba(110, 231, 183, 0.18) 84%, rgba(236, 253, 245, 0.34) 100%)';

const RIM_MASK = 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)';

/**
 * Genuine React Bits-inspired Liquid GlassSurface for the 3D Campus Live HUD.
 * Combines:
 * 1. Real WebGL2 optical refraction & chromatic dispersion over the live Three.js <canvas>
 * 2. Analytical rounded-rect SDF displacement map (shared with SVG feDisplacementMap fallback)
 * 3. Crisp double-rim bevel thickness
 * 4. Controlled blur + deep-emerald smoked tint preserving high text contrast & 3D bevel refraction
 */
export const GlassSurface: React.FC<GlassSurfaceProps> = ({
  as = 'div',
  children,
  className = '',
  style,
  backdrop,
  renderer = 'auto',
  refraction = true,
  borderRadius,
  bevelWidth = 22,
  distortionScale = -38,
  redOffset = -5,
  greenOffset = 0,
  blueOffset = 6,
  spread = 1.2,
  saturation = 1.24,
  tintOpacity = 0.72,
  ...rest
}) => {
  const uniqueId = useId().replace(/:/g, '-');
  const filterId = `rw-glass-filter-${uniqueId}`;

  const backdropCtx = useContext(GlassBackdropContext);
  const containerRef = useRef<HTMLElement | null>(null);
  const glassCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const feImageRef = useRef<SVGFEImageElement | null>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [svgSupported, setSvgSupported] = useState(false);
  const [webglFailed, setWebglFailed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [layoutTick, setLayoutTick] = useState(0);

  const mapDirtyRef = useRef(true);
  const triggerRedrawRef = useRef<() => void>(() => {});

  const resolvedBackdrop = resolveBackdropNode(backdrop, backdropCtx?.canvas);

  useEffect(() => {
    setSvgSupported(supportsSvgBackdropFilter(filterId));
    setChecked(true);
  }, [filterId]);

  const useWebgl =
    checked &&
    refraction &&
    Boolean(resolvedBackdrop) &&
    !webglFailed &&
    renderer !== 'svg';

  const useSvg = !useWebgl && checked && refraction && svgSupported;

  // Track element resize & regenerate analytical SDF displacement map
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const rebuildMap = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w <= 0 || h <= 0) return;

      const computed = getComputedStyle(el);
      const parsedRadius =
        borderRadius !== undefined
          ? borderRadius
          : parseFloat(computed.borderTopLeftRadius || '16') || 16;

      const { canvas, dataUrl } = buildLiquidGlassDisplacementMap(w, h, parsedRadius, bevelWidth);
      mapCanvasRef.current = canvas;
      mapDirtyRef.current = true;
      if (feImageRef.current && dataUrl) {
        feImageRef.current.setAttribute('href', dataUrl);
      }
      setLayoutTick((t) => t + 1);
      triggerRedrawRef.current();
    };

    rebuildMap();
    const ro = new ResizeObserver(rebuildMap);
    ro.observe(el);
    return () => ro.disconnect();
  }, [borderRadius, bevelWidth]);

  // Hardware WebGL2 live-canvas refraction pipeline (on-demand — 0 idle GPU cost)
  useEffect(() => {
    if (!useWebgl) return;
    const canvas = glassCanvasRef.current;
    const element = containerRef.current;
    if (!canvas || !element) return;

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    const program = gl ? compileGlassProgram(gl) : null;
    if (!gl || !program) {
      setWebglFailed(true);
      return;
    }

    const uniforms = {
      uBackdrop: gl.getUniformLocation(program, 'uBackdrop'),
      uMap: gl.getUniformLocation(program, 'uMap'),
      uCanvas: gl.getUniformLocation(program, 'uCanvas'),
      uSize: gl.getUniformLocation(program, 'uSize'),
      uOrigin: gl.getUniformLocation(program, 'uOrigin'),
      uStep: gl.getUniformLocation(program, 'uStep'),
      uScale: gl.getUniformLocation(program, 'uScale'),
      uSpread: gl.getUniformLocation(program, 'uSpread'),
      uSaturation: gl.getUniformLocation(program, 'uSaturation'),
      uTintOpacity: gl.getUniformLocation(program, 'uTintOpacity'),
    };

    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const makeTex = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return tex;
    };

    const backdropTex = makeTex();
    const mapTex = makeTex();

    let backdropDirty = true;
    let visible = true;
    let rafId = 0;

    const drawFrame = () => {
      rafId = 0;
      if (!visible || document.hidden) return;

      const node = resolveBackdropNode(backdrop, backdropCtx?.canvas);
      const mapCanvas = mapCanvasRef.current;
      if (!node || !mapCanvas) return;

      const [srcW, srcH] = getBackdropDimensions(node);
      if (srcW <= 0 || srcH <= 0) return;

      const box = element.getBoundingClientRect();
      const backdropRect = node.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0 || backdropRect.width <= 0 || backdropRect.height <= 0) {
        return;
      }

      const dpr = backdropCtx?.isSoftwareGl ? 1 : Math.min(1.5, window.devicePixelRatio || 1);
      const targetW = Math.max(1, Math.round(box.width * dpr));
      const targetH = Math.max(1, Math.round(box.height * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      if (mapDirtyRef.current) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, mapTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mapCanvas);
        mapDirtyRef.current = false;
      }

      if (backdropDirty) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, backdropTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, node);
        backdropDirty = false;
      }

      gl.viewport(0, 0, targetW, targetH);
      gl.useProgram(program);
      gl.bindVertexArray(vao);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, backdropTex);
      gl.uniform1i(uniforms.uBackdrop, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, mapTex);
      gl.uniform1i(uniforms.uMap, 1);

      gl.uniform2f(uniforms.uCanvas, targetW, targetH);
      gl.uniform2f(uniforms.uSize, box.width, box.height);
      gl.uniform2f(
        uniforms.uOrigin,
        (box.left - backdropRect.left) / backdropRect.width,
        (box.top - backdropRect.top) / backdropRect.height
      );
      gl.uniform2f(uniforms.uStep, 1 / backdropRect.width, 1 / backdropRect.height);
      gl.uniform3f(
        uniforms.uScale,
        distortionScale + redOffset,
        distortionScale + greenOffset,
        distortionScale + blueOffset
      );
      gl.uniform1f(uniforms.uSpread, Math.max(0, spread));
      gl.uniform1f(uniforms.uSaturation, saturation);
      gl.uniform1f(uniforms.uTintOpacity, tintOpacity);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const scheduleDraw = (markBackdrop = false) => {
      if (markBackdrop) backdropDirty = true;
      if (!rafId && visible && !document.hidden) {
        rafId = requestAnimationFrame(drawFrame);
      }
    };

    triggerRedrawRef.current = () => scheduleDraw(false);

    const unsubscribe = backdropCtx?.subscribeFrame(() => scheduleDraw(true));
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) scheduleDraw(true);
    });
    io.observe(element);

    const onTransitionEnd = () => scheduleDraw(false);
    const onResize = () => scheduleDraw(true);
    const onContextLost = (ev: Event) => {
      ev.preventDefault();
      setWebglFailed(true);
    };

    element.addEventListener('transitionend', onTransitionEnd);
    window.addEventListener('resize', onResize, { passive: true });
    canvas.addEventListener('webglcontextlost', onContextLost);

    // Draw initial frame + staggered settle passes so animated trays stay aligned with the 3D scene
    scheduleDraw(true);
    const settleTimers = [60, 140, 260].map((delayMs) =>
      window.setTimeout(() => scheduleDraw(true), delayMs)
    );

    return () => {
      triggerRedrawRef.current = () => {};
      unsubscribe?.();
      io.disconnect();
      cancelAnimationFrame(rafId);
      settleTimers.forEach((id) => clearTimeout(id));
      element.removeEventListener('transitionend', onTransitionEnd);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      gl.deleteTexture(backdropTex);
      gl.deleteTexture(mapTex);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    };
  }, [
    useWebgl,
    backdrop,
    backdropCtx,
    distortionScale,
    redOffset,
    greenOffset,
    blueOffset,
    spread,
    saturation,
    tintOpacity,
    layoutTick,
  ]);

  const Component = as;
  const hasExplicitPosition = /\b(absolute|fixed|sticky)\b/.test(className);
  const positionClass = hasExplicitPosition ? '' : 'relative';

  const containerModeStyle: CSSProperties = useWebgl
    ? {
        background: 'rgba(6, 18, 14, 0.24)',
        boxShadow: LIQUID_GLASS_SHADOW,
      }
    : useSvg
    ? {
        background: `rgba(6, 18, 14, ${Math.min(0.82, tintOpacity + 0.08)})`,
        backdropFilter: `url(#${filterId}) blur(4px) saturate(${saturation})`,
        WebkitBackdropFilter: `url(#${filterId}) blur(4px) saturate(${saturation})`,
        boxShadow: LIQUID_GLASS_SHADOW,
      }
    : {
        background: `rgba(7, 20, 16, ${Math.min(0.88, tintOpacity + 0.14)})`,
        backdropFilter: `blur(11px) saturate(${(saturation * 1.2).toFixed(2)})`,
        WebkitBackdropFilter: `blur(11px) saturate(${(saturation * 1.2).toFixed(2)})`,
        boxShadow: LIQUID_GLASS_SHADOW,
      };

  const setRef = (node: HTMLElement | null) => {
    containerRef.current = node;
  };

  return (
    <Component
      ref={setRef as React.Ref<never>}
      data-glass-mode={useWebgl ? 'webgl' : useSvg ? 'svg' : 'frosted'}
      className={`${positionClass} isolate overflow-hidden ${className}`.trim()}
      style={{
        ...containerModeStyle,
        ...style,
      }}
      {...rest}
    >
      {/* Hidden SVG displacement filter definition for Chromium SVG fallback / 2D mode */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-30 h-0 w-0 opacity-0"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter
            id={filterId}
            colorInterpolationFilters="sRGB"
            x="0%"
            y="0%"
            width="100%"
            height="100%"
          >
            <feImage
              ref={feImageRef}
              x="0"
              y="0"
              width="100%"
              height="100%"
              preserveAspectRatio="none"
              result="map"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={distortionScale + redOffset}
              xChannelSelector="R"
              yChannelSelector="G"
              result="dispRed"
            />
            <feColorMatrix
              in="dispRed"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="red"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={distortionScale + greenOffset}
              xChannelSelector="R"
              yChannelSelector="G"
              result="dispGreen"
            />
            <feColorMatrix
              in="dispGreen"
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="green"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={distortionScale + blueOffset}
              xChannelSelector="R"
              yChannelSelector="G"
              result="dispBlue"
            />
            <feColorMatrix
              in="dispBlue"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
              result="blue"
            />
            <feBlend in="red" in2="green" mode="screen" result="rg" />
            <feBlend in="rg" in2="blue" mode="screen" result="dispersed" />
            <feGaussianBlur in="dispersed" stdDeviation={Math.max(0.4, spread * 0.65)} />
          </filter>
        </defs>
      </svg>

      {/* Live WebGL2 optical refraction canvas (behind panel content, pointer-events-none) */}
      {useWebgl && (
        <canvas
          ref={glassCanvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-20 h-full w-full rounded-[inherit]"
        />
      )}

      {/* Static directional architectural glass sheen (no cursor spotlight) */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
        style={{
          background:
            'linear-gradient(158deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.015) 36%, rgba(3, 12, 9, 0.24) 100%)',
        }}
      />

      {/* Crisp bright outer specular rim + inner bezel contrast */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] p-[1.5px]"
        style={{
          background: SPECULAR_RIM_BG,
          WebkitMask: RIM_MASK,
          WebkitMaskComposite: 'xor',
          mask: RIM_MASK,
          maskComposite: 'exclude',
        }}
      />

      {children}
    </Component>
  );
};

export default GlassSurface;
