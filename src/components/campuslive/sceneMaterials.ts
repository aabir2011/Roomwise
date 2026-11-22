/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';

/**
 * Clean Architectural Daylight Palette for DAV Model School, IIT Kharagpur.
 * Smooth matte PBR architectural surfaces eliminate speckled texture noise and
 * moire flicker while preserving crisp building differentiation and high-contrast
 * ROOMWISE energy overlays.
 */
export const ARCHITECTURAL_PALETTE = {
  // Calm atmospheric sky-slate daylight backdrop & matching horizon fog
  studioBg: 0xcbd7de,
  horizonTerrain: 0x9ca89d,
  campusTurf: 0x7e9477,
  courtyardStone: 0xbbbeb8,
  roadAsphalt: 0x4f565b,
  roadCurb: 0xa7aba8,
  boundaryWall: 0xa29d94,

  // Differentiated matte institutional plaster & concrete finishes
  g3Facade: 0xd7c9b0,        // Warm cream-sandstone (G+3 flagship)
  mphFacade: 0xcfbe9f,       // Harmonized sandstone for compact MPH extension
  obFacade: 0xcab898,        // Heritage ochre-cream (Old Building)
  nbFacade: 0xc8cecc,        // Crisp cool architectural stone-grey (New Building)
  ppFacade: 0xd4ae93,        // Warm welcoming terracotta-sandstone (Pre-Primary Block)

  // Architectural trim, slabs & plinths
  plinthBase: 0x6c6c67,
  slabTop: 0xa6acab,
  slabEdge: 0xdfe4e2,
  corridorFloor: 0x9ca19e,
  heritageCornice: 0x9e7c64,
  concreteColumn: 0xd8dcd9,
  roofMembrane: 0x8e9597,
  roofCoping: 0xc2c7c5,
  connectorWall: 0xc2c8c6,

  // Structural & interior detailing
  charcoalMullion: 0x2c353a,
  windowGlass: 0x324b5a,
  charcoalBoard: 0x1e2b27,
  warmTimber: 0x7b634b,
  deskSurface: 0x9c8265,
  labBenchTop: 0x455357,
  treeTrunk: 0x625345,
  treeCanopyA: 0x4d6f54,
  treeCanopyB: 0x3f5e48,

  // Feeder plinth & gate piers
  feederBody: 0x323d3b,
  feederAccent: 0x10b981,
  gatePillar: 0xcbc2ae,
  gateCap: 0x5d6467,

  // Interior unlit baseline
  offInteriorWall: 0x676f73,
  offInteriorFloor: 0x596166,
  offLuminaire: 0x4d565b,

  // High-contrast Lighting Heatmap scale
  lightLowColor: 0xb37f32,
  lightMidColor: 0xeb9f2e,
  lightHighColor: 0xffdf78,
  lightEmissiveWarm: 0xffb733,

  // Energy Intensity Heatmap scale
  inactiveStone: 0x3d464b,
  sageEfficient: 0x26926a,
  tealModerate: 0x2d7f96,
  amberElevated: 0xd97d1e,

  // Environmental Thermal scale
  thermalCool: 0x3d88b3,
  thermalBalanced: 0x329671,
  thermalWarm: 0xd46a34,

  // Restrained selection & hover highlights
  selectionMint: 0x10b981,
  hoverSage: 0x34d399,
} as const;

export interface SharedSceneMaterials {
  plinthBase: THREE.MeshStandardMaterial;
  walkway: THREE.MeshStandardMaterial;
  road: THREE.MeshStandardMaterial;
  curb: THREE.MeshStandardMaterial;
  boundaryWall: THREE.MeshStandardMaterial;
  lawn: THREE.MeshStandardMaterial;
  concreteColumn: THREE.MeshStandardMaterial;
  mullion: THREE.MeshStandardMaterial;
  board: THREE.MeshStandardMaterial;
  timber: THREE.MeshStandardMaterial;
  desk: THREE.MeshStandardMaterial;
  labTop: THREE.MeshStandardMaterial;
  treeTrunk: THREE.MeshStandardMaterial;
  treeCanopyA: THREE.MeshStandardMaterial;
  treeCanopyB: THREE.MeshStandardMaterial;
  feederBody: THREE.MeshStandardMaterial;
  feederAccent: THREE.MeshStandardMaterial;
  gatePillar: THREE.MeshStandardMaterial;
  gateCap: THREE.MeshStandardMaterial;
  goalpostWhite: THREE.MeshStandardMaterial;
  selectionOutline: THREE.LineBasicMaterial;
  hoverOutline: THREE.LineBasicMaterial;
  dispose: () => void;
}

/**
 * Clean DAV Model School Football Ground texture:
 * Smooth Kharagpur sandy-olive pitch with crisp white chalk touchlines & penalty boxes.
 */
export function createFootballGroundTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#9fa27e');
    grad.addColorStop(0.5, '#a9a483');
    grad.addColorStop(1, '#989e7a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle mowed vertical bands
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let x = 0; x < w; x += 64) {
      ctx.fillRect(x, 0, 32, h);
    }

    const padX = 56;
    const padY = 44;
    const pw = w - padX * 2;
    const ph = h - padY * 2;

    ctx.strokeStyle = 'rgba(246, 248, 245, 0.85)';
    ctx.lineWidth = 4;
    ctx.strokeRect(padX, padY, pw, ph);

    ctx.beginPath();
    ctx.moveTo(w / 2, padY);
    ctx.lineTo(w / 2, padY + ph);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 58, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(246, 248, 245, 0.9)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 5, 0, Math.PI * 2);
    ctx.fill();

    const penW = 112;
    const penH = ph * 0.56;
    const boxW = 42;
    const boxH = ph * 0.28;
    ctx.strokeRect(padX, h / 2 - penH / 2, penW, penH);
    ctx.strokeRect(padX, h / 2 - boxH / 2, boxW, boxH);
    ctx.strokeRect(w - padX - penW, h / 2 - penH / 2, penW, penH);
    ctx.strokeRect(w - padX - boxW, h / 2 - boxH / 2, boxW, boxH);

    ctx.beginPath();
    ctx.arc(padX + 78, h / 2, 48, -0.68, 0.68);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w - padX - 78, h / 2, 48, Math.PI - 0.68, Math.PI + 0.68);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Clean Basketball Court (BB) texture:
 * Terracotta outer apron with slate-blue court, painted keys, and crisp white lines.
 */
export function createBasketballCourtTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const w = 512;
  const h = 768;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#9c5e56';
    ctx.fillRect(0, 0, w, h);

    const padX = 48;
    const padY = 58;
    const cw = w - padX * 2;
    const ch = h - padY * 2;
    ctx.fillStyle = '#4a647d';
    ctx.fillRect(padX, padY, cw, ch);

    const keyW = cw * 0.34;
    const keyH = ch * 0.19;
    ctx.fillStyle = '#9b5a52';
    ctx.fillRect(w / 2 - keyW / 2, padY, keyW, keyH);
    ctx.fillRect(w / 2 - keyW / 2, padY + ch - keyH, keyW, keyH);

    ctx.strokeStyle = 'rgba(244, 247, 248, 0.9)';
    ctx.lineWidth = 4;
    ctx.strokeRect(padX, padY, cw, ch);

    ctx.beginPath();
    ctx.moveTo(padX, h / 2);
    ctx.lineTo(padX + cw, h / 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(w / 2, h / 2, cw * 0.14, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeRect(w / 2 - keyW / 2, padY, keyW, keyH);
    ctx.strokeRect(w / 2 - keyW / 2, padY + ch - keyH, keyW, keyH);

    ctx.beginPath();
    ctx.arc(w / 2, padY + keyH, keyW / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w / 2, padY + ch - keyH, keyW / 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(w / 2, padY + 46, cw * 0.42, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w / 2, padY + ch - 46, cw * 0.42, 1.12 * Math.PI, 1.88 * Math.PI);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createSharedMaterials(): SharedSceneMaterials {
  const mats: THREE.Material[] = [];
  const trackMat = <T extends THREE.Material>(m: T): T => {
    mats.push(m);
    return m;
  };

  return {
    plinthBase: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.plinthBase,
        roughness: 0.9,
        metalness: 0.04,
      })
    ),
    walkway: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.courtyardStone,
        roughness: 0.88,
        metalness: 0.03,
      })
    ),
    road: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.roadAsphalt,
        roughness: 0.92,
        metalness: 0.03,
      })
    ),
    curb: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.roadCurb,
        roughness: 0.84,
        metalness: 0.04,
      })
    ),
    boundaryWall: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.boundaryWall,
        roughness: 0.88,
        metalness: 0.02,
      })
    ),
    lawn: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.campusTurf,
        roughness: 0.96,
        metalness: 0.0,
      })
    ),
    concreteColumn: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.concreteColumn,
        roughness: 0.78,
        metalness: 0.04,
      })
    ),
    mullion: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.charcoalMullion,
        roughness: 0.38,
        metalness: 0.5,
      })
    ),
    board: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.charcoalBoard,
        roughness: 0.85,
        metalness: 0.04,
      })
    ),
    timber: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.warmTimber,
        roughness: 0.78,
        metalness: 0.04,
      })
    ),
    desk: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.deskSurface,
        roughness: 0.76,
        metalness: 0.04,
      })
    ),
    labTop: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.labBenchTop,
        roughness: 0.52,
        metalness: 0.2,
      })
    ),
    treeTrunk: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.treeTrunk,
        roughness: 0.94,
        metalness: 0.0,
      })
    ),
    treeCanopyA: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.treeCanopyA,
        roughness: 0.9,
        metalness: 0.0,
        flatShading: true,
      })
    ),
    treeCanopyB: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.treeCanopyB,
        roughness: 0.9,
        metalness: 0.0,
        flatShading: true,
      })
    ),
    feederBody: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.feederBody,
        roughness: 0.45,
        metalness: 0.42,
      })
    ),
    feederAccent: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.feederAccent,
        emissive: new THREE.Color(0x059669),
        emissiveIntensity: 0.5,
        roughness: 0.3,
        metalness: 0.25,
      })
    ),
    gatePillar: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.gatePillar,
        roughness: 0.84,
        metalness: 0.03,
      })
    ),
    gateCap: trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.gateCap,
        roughness: 0.62,
        metalness: 0.22,
      })
    ),
    goalpostWhite: trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xeff2f0,
        roughness: 0.4,
        metalness: 0.35,
      })
    ),
    selectionOutline: trackMat(
      new THREE.LineBasicMaterial({
        color: ARCHITECTURAL_PALETTE.selectionMint,
        transparent: true,
        opacity: 0.98,
      })
    ),
    hoverOutline: trackMat(
      new THREE.LineBasicMaterial({
        color: ARCHITECTURAL_PALETTE.hoverSage,
        transparent: true,
        opacity: 0.85,
      })
    ),
    dispose: () => {
      for (const m of mats) m.dispose();
    },
  };
}

/**
 * Restrained architectural filament shader for conceptual energy-flow lines.
 */
export function createEnergyFlowShaderMaterial(
  baseColorHex: number,
  pulseColorHex: number
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0.5 },
      uSpeed: { value: 0.35 },
      uOpacity: { value: 0.88 },
      uBaseColor: { value: new THREE.Color(baseColorHex) },
      uPulseColor: { value: new THREE.Color(pulseColorHex) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uIntensity;
      uniform float uSpeed;
      uniform float uOpacity;
      uniform vec3 uBaseColor;
      uniform vec3 uPulseColor;

      void main() {
        float phase = fract(vUv.x * 2.5 - uTime * uSpeed);
        float pulse = smoothstep(0.0, 0.14, phase) * (1.0 - smoothstep(0.14, 0.40, phase));
        vec3 col = mix(uBaseColor, uPulseColor, pulse * clamp(uIntensity, 0.25, 1.0));
        float alpha = uOpacity * (0.34 + 0.66 * pulse * clamp(uIntensity, 0.25, 1.0));
        if (uIntensity < 0.02) {
          col = uBaseColor;
          alpha = uOpacity * 0.18;
        }
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}
