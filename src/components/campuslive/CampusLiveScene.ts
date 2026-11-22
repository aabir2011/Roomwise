/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { BuildingName, Floor } from '../../types/energy';
import {
  CAMERA_PRESETS,
  CAMPUS_BUILDINGS_SCHEMA,
  CAMPUS_LANDMARK_LABELS,
  FLOOR_EXPLODE_GAP,
  getRoomWorldCenter,
  ROOM_GEOMETRY_MAP,
} from './campusLayoutSchema';
import { buildCampusModel, type CampusModelBundle } from './campusGeometry';
import { ARCHITECTURAL_PALETTE } from './sceneMaterials';
import {
  DEFAULT_CAMPUS_ATMOSPHERE,
  type CampusAtmospherePreset,
} from './campusAtmosphere';
import type { CameraPresetId, CampusRoomVisualState, CampusVisualMode } from './types';

export interface ProjectedLabelPos {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface CampusSceneCallbacks {
  onSelectRoom: (roomId: string | null) => void;
  onSelectBuilding?: (building: BuildingName) => void;
  onHoverRoom: (roomId: string | null) => void;
  onProjectLabels?: (positions: ProjectedLabelPos[]) => void;
  onWebGLContextLost?: () => void;
}

export interface CampusSceneConfigState {
  visualMode: CampusVisualMode;
  selectedFloor: Floor | 'All';
  selectedBuilding: BuildingName | null;
  selectedRoomId: string | null;
  exploded: boolean;
  cutaway: boolean;
  showEnergyFlow: boolean;
  reducedMotion: boolean;
}

const TEMP_COLOR = new THREE.Color();
const PROJ_VEC = new THREE.Vector3();

export class CampusLiveScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private pmremGenerator: THREE.PMREMGenerator;
  private envRenderTarget: THREE.WebGLRenderTarget;
  private model: CampusModelBundle;
  private callbacks: CampusSceneCallbacks;

  // Weather-responsive atmospheric lighting & optional rain streaks (zero per-frame allocations)
  private sceneBgColor: THREE.Color;
  private sceneFog: THREE.Fog;
  private hemiLight: THREE.HemisphereLight;
  private keySun: THREE.DirectionalLight;
  private skyFill: THREE.DirectionalLight;

  private targetAtmosphere: CampusAtmospherePreset = DEFAULT_CAMPUS_ATMOSPHERE;
  private targetSkyColor = new THREE.Color(DEFAULT_CAMPUS_ATMOSPHERE.skyColor);
  private targetHemiSkyColor = new THREE.Color(DEFAULT_CAMPUS_ATMOSPHERE.hemiSkyColor);
  private targetHemiGroundColor = new THREE.Color(DEFAULT_CAMPUS_ATMOSPHERE.hemiGroundColor);
  private targetSunColor = new THREE.Color(DEFAULT_CAMPUS_ATMOSPHERE.sunColor);
  private targetFillColor = new THREE.Color(DEFAULT_CAMPUS_ATMOSPHERE.fillColor);
  private targetSunPos = new THREE.Vector3(...DEFAULT_CAMPUS_ATMOSPHERE.sunPosition);
  private currentNightGlow = 1.0;
  private currentRainIntensity = 0;

  private rainSegments: THREE.LineSegments | null = null;
  private rainGeometry: THREE.BufferGeometry | null = null;
  private rainMaterial: THREE.LineBasicMaterial | null = null;
  private rainPositions: Float32Array | null = null;
  private rainSpeeds: Float32Array | null = null;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDownPos = { x: 0, y: 0 };
  private isSoftwareGl = false;

  private hoveredRoomId: string | null = null;
  private config: CampusSceneConfigState = {
    visualMode: 'architectural',
    selectedFloor: 'All',
    selectedBuilding: null,
    selectedRoomId: null,
    exploded: false,
    cutaway: false,
    showEnergyFlow: false,
    reducedMotion: false,
  };
  private roomStates = new Map<string, CampusRoomVisualState>();

  private isCameraFlying = false;
  private targetCamPos = new THREE.Vector3(...CAMERA_PRESETS.isometric.position);
  private targetControlsCenter = new THREE.Vector3(...CAMERA_PRESETS.isometric.target);

  private currentExplodeFactor = 0;
  private targetExplodeFactor = 0;
  private currentCutaway = 0;
  private targetCutaway = 0;

  private rafId: number | null = null;
  private softwareTimerId: number | null = null;
  private isLoopActive = false;
  private lastFrameTime = 0;
  private flowClock = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private lastHoverRaycastMs = 0;

  private projectedLabelsBuffer: ProjectedLabelPos[] = CAMPUS_LANDMARK_LABELS.map((l) => ({
    id: l.id,
    x: 0,
    y: 0,
    visible: false,
  }));

  constructor(container: HTMLElement, callbacks: CampusSceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    const probeCanvas = document.createElement('canvas');
    const probeGl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!probeGl) {
      throw new Error('WebGL context unavailable');
    }
    const debugExt = probeGl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = debugExt
      ? String(probeGl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) || '')
      : '';
    probeGl.getExtension('WEBGL_lose_context')?.loseContext();
    this.isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererStr);

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);

    // Calm atmospheric daylight slate sky + horizon fog matching extended terrain
    this.scene = new THREE.Scene();
    this.sceneBgColor = new THREE.Color(ARCHITECTURAL_PALETTE.studioBg);
    this.scene.background = this.sceneBgColor;
    this.sceneFog = new THREE.Fog(ARCHITECTURAL_PALETTE.studioBg, 86, 195);
    this.scene.fog = this.sceneFog;

    this.camera = new THREE.PerspectiveCamera(35, width / height, 0.5, 320);
    this.camera.position.set(...CAMERA_PRESETS.isometric.position);

    // Procedural architectural IBL so window glass & mullions reflect softly
    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    this.envRenderTarget = this.pmremGenerator.fromScene(roomEnv, 0.04);
    this.scene.environment = this.envRenderTarget.texture;
    this.scene.environmentIntensity = 0.42;
    roomEnv.dispose();

    // Realistic balanced architectural daylight lighting rig (Warm Sun + Cool Sky Bounce + Rim)
    this.hemiLight = new THREE.HemisphereLight(0xedf4f8, 0x6f7c6b, 0.92);
    this.hemiLight.position.set(0, 60, 0);
    this.scene.add(this.hemiLight);

    this.keySun = new THREE.DirectionalLight(0xfff5e2, 1.82);
    this.keySun.position.set(34, 48, 28);
    if (!this.isSoftwareGl) {
      this.keySun.castShadow = true;
      this.keySun.shadow.mapSize.set(2048, 2048);
      this.keySun.shadow.camera.near = 8;
      this.keySun.shadow.camera.far = 140;
      const d = 42;
      this.keySun.shadow.camera.left = -d;
      this.keySun.shadow.camera.right = d;
      this.keySun.shadow.camera.top = d;
      this.keySun.shadow.camera.bottom = -d;
      this.keySun.shadow.bias = -0.0004;
      this.keySun.shadow.normalBias = 0.032;
      this.keySun.shadow.radius = 2.5;
    }
    this.scene.add(this.keySun);

    // Subtle cool sky fill light from the opposite azimuth to keep shaded corridors readable
    this.skyFill = new THREE.DirectionalLight(0xaec6d9, 0.48);
    this.skyFill.position.set(-34, 24, -26);
    this.scene.add(this.skyFill);

    // Lightweight reusable subtle rain streak layer (invisible unless weather is rainy)
    if (!this.isSoftwareGl) {
      this.initRainLayer();
    }

    const maxAnisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy() || 1);
    this.model = buildCampusModel(!this.isSoftwareGl, maxAnisotropy);
    this.scene.add(this.model.root);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(...CAMERA_PRESETS.isometric.target);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 0.85;
    this.controls.panSpeed = 0.78;
    this.controls.minDistance = 7.5;
    this.controls.maxDistance = 98;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.minPolarAngle = 0.06;
    this.controls.screenSpacePanning = false;
    this.controls.update();

    this.controls.addEventListener('start', this.handleControlsStart);
    this.controls.addEventListener('change', this.handleControlsChange);

    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    canvas.addEventListener('webglcontextlost', this.handleContextLost, false);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.requestRender();
  }

  public isSoftwareRenderer(): boolean {
    return this.isSoftwareGl;
  }

  private initRainLayer(): void {
    const dropCount = 260;
    const positions = new Float32Array(dropCount * 2 * 3);
    const speeds = new Float32Array(dropCount);
    for (let i = 0; i < dropCount; i++) {
      const x = (Math.random() - 0.5) * 90;
      const y = Math.random() * 34 + 1;
      const z = (Math.random() - 0.5) * 84;
      const idx = i * 6;
      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;
      positions[idx + 3] = x - 0.16;
      positions[idx + 4] = y - 1.15;
      positions[idx + 5] = z + 0.08;
      speeds[i] = 18 + Math.random() * 10;
    }
    this.rainPositions = positions;
    this.rainSpeeds = speeds;
    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rainMaterial = new THREE.LineBasicMaterial({
      color: 0xdbe7f0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.rainSegments = new THREE.LineSegments(this.rainGeometry, this.rainMaterial);
    this.rainSegments.visible = false;
    this.rainSegments.frustumCulled = false;
    this.scene.add(this.rainSegments);
  }

  public setAtmosphere(preset: CampusAtmospherePreset): void {
    this.targetAtmosphere = preset;
    this.targetSkyColor.setHex(preset.skyColor);
    this.targetHemiSkyColor.setHex(preset.hemiSkyColor);
    this.targetHemiGroundColor.setHex(preset.hemiGroundColor);
    this.targetSunColor.setHex(preset.sunColor);
    this.targetFillColor.setHex(preset.fillColor);
    this.targetSunPos.set(...preset.sunPosition);
    this.requestRender();
  }

  public updateRoomData(rooms: CampusRoomVisualState[]): void {
    this.roomStates.clear();
    for (const r of rooms) {
      this.roomStates.set(r.roomId, r);
    }
    this.recomputeRoomVisualTargets();
    this.requestRender();
  }

  public updateConfig(next: CampusSceneConfigState): void {
    const prevExploded = this.config.exploded;
    const prevFloor = this.config.selectedFloor;
    const prevCutaway = this.config.cutaway;
    const prevRoomId = this.config.selectedRoomId;
    const prevBuilding = this.config.selectedBuilding;

    this.config = { ...next };

    const autoExplodeForFloor =
      next.selectedFloor !== 'All' && next.selectedFloor !== 'Ground Floor';
    this.targetExplodeFactor = next.exploded || autoExplodeForFloor ? 1 : 0;
    this.targetCutaway = next.cutaway ? 1 : 0;
    this.model.energyFlowGroup.visible = next.showEnergyFlow;

    for (const [id, handle] of this.model.rooms.entries()) {
      handle.selectionFrame.visible = id === next.selectedRoomId;
    }

    for (const [bId, bHandle] of this.model.buildings.entries()) {
      bHandle.selectionHalo.visible =
        Boolean(next.selectedBuilding) &&
        next.selectedBuilding === bId &&
        !next.selectedRoomId;
    }

    this.recomputeRoomVisualTargets();

    if (next.selectedRoomId && next.selectedRoomId !== prevRoomId) {
      this.focusRoom(next.selectedRoomId);
    } else if (
      !next.selectedRoomId &&
      next.selectedBuilding &&
      next.selectedBuilding !== prevBuilding
    ) {
      this.focusBuilding(next.selectedBuilding);
    } else if (
      next.selectedFloor !== prevFloor &&
      next.selectedFloor !== 'All' &&
      !next.selectedRoomId
    ) {
      const floorIdx = ['Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'].indexOf(
        next.selectedFloor
      );
      const yLift = Math.max(0, floorIdx) * (2.45 + FLOOR_EXPLODE_GAP * this.targetExplodeFactor);
      this.flyTo([-22, 18 + yLift * 0.85, 31], [-3.5, 2.0 + yLift * 0.72, -2.5]);
    } else if (prevExploded !== next.exploded || prevCutaway !== next.cutaway) {
      this.requestRender();
    }

    this.requestRender();
  }

  public applyCameraPreset(preset: CameraPresetId): void {
    const vp = CAMERA_PRESETS[preset];
    if (!vp) return;
    this.flyTo(vp.position, vp.target);
  }

  public focusBuilding(buildingId: BuildingName): void {
    const bSpec = CAMPUS_BUILDINGS_SCHEMA.find((b) => b.id === buildingId);
    if (!bSpec) return;
    const topIdx = bSpec.floors.length - 1;
    const midY =
      (bSpec.floors[topIdx].baseY + bSpec.storeyHeight) * 0.45 +
      topIdx * FLOOR_EXPLODE_GAP * 0.42 * this.targetExplodeFactor;
    const target: [number, number, number] = [bSpec.worldX, midY, bSpec.worldZ];
    const pos: [number, number, number] = [
      bSpec.worldX + bSpec.focusCameraOffset[0],
      midY + bSpec.focusCameraOffset[1],
      bSpec.worldZ + bSpec.focusCameraOffset[2],
    ];
    this.flyTo(pos, target);
  }

  public focusRoom(roomId: string): void {
    const entry = ROOM_GEOMETRY_MAP.get(roomId);
    if (!entry) return;
    const center = getRoomWorldCenter(roomId, this.targetExplodeFactor);
    if (!center) return;

    const { building, room } = entry;
    // Rotate standard inspection offset along the building's true orientation
    let lx = 7.2;
    let ly = 6.2;
    let lz = 8.8;
    if (room.corridorSide === 'west') {
      lx = -8.8;
      lz = 7.2;
    } else if (room.corridorSide === 'east') {
      lx = 8.8;
      lz = 7.2;
    } else if (room.corridorSide === 'north') {
      lx = 6.8;
      lz = 9.0;
    }
    const cosR = Math.cos(building.rotationY);
    const sinR = Math.sin(building.rotationY);
    const wx = lx * cosR + lz * sinR;
    const wz = -lx * sinR + lz * cosR;

    this.flyTo([center[0] + wx, center[1] + ly, center[2] + wz], center);
  }

  private flyTo(pos: [number, number, number], target: [number, number, number]): void {
    this.targetCamPos.set(...pos);
    this.targetControlsCenter.set(...target);
    if (this.config.reducedMotion) {
      this.camera.position.copy(this.targetCamPos);
      this.controls.target.copy(this.targetControlsCenter);
      this.controls.update();
      this.isCameraFlying = false;
      this.renderOnce();
      return;
    }
    this.isCameraFlying = true;
    this.requestRender();
  }

  private recomputeRoomVisualTargets(): void {
    const mode = this.config.visualMode;
    const buildingLoadTotals = new Map<BuildingName, { watts: number; rated: number }>();

    for (const [roomId, handle] of this.model.rooms.entries()) {
      const st = this.roomStates.get(roomId);
      const power = st?.powerWatts ?? 0;
      const rated = st?.ratedPowerWatts ?? 380;
      const bEntry = buildingLoadTotals.get(handle.building) || { watts: 0, rated: 0 };
      bEntry.watts += power;
      bEntry.rated += rated;
      buildingLoadTotals.set(handle.building, bEntry);

      const lightNorm = Math.max(0, Math.min(1, (st?.lightingLevel ?? 0) / 100));
      const fanNorm = Math.max(0, Math.min(1, (st?.fanLevel ?? 0) / 100));
      handle.targetFanSpeedRad =
        st && !st.isHistoricalAggregate && fanNorm > 0.02 ? 1.8 + fanNorm * 5.2 : 0;

      if (mode === 'architectural') {
        handle.targetGlow = lightNorm;
        handle.targetWallColor
          .setHex(ARCHITECTURAL_PALETTE.offInteriorWall)
          .lerp(TEMP_COLOR.setHex(0xe2c794), lightNorm * 0.72);
        handle.targetFloorColor
          .setHex(ARCHITECTURAL_PALETTE.offInteriorFloor)
          .lerp(TEMP_COLOR.setHex(0xdcb87c), lightNorm * 0.72);
        handle.targetLuminaireColor
          .setHex(ARCHITECTURAL_PALETTE.offLuminaire)
          .lerp(TEMP_COLOR.setHex(ARCHITECTURAL_PALETTE.lightHighColor), lightNorm);
        handle.targetLuminaireEmissive.setHex(
          lightNorm > 0.02 ? ARCHITECTURAL_PALETTE.lightEmissiveWarm : 0x000000
        );
      } else if (mode === 'lighting') {
        if (lightNorm <= 0.02) {
          handle.targetGlow = 0;
          handle.targetWallColor.setHex(0x2d363b);
          handle.targetFloorColor.setHex(0x262f34);
          handle.targetLuminaireColor.setHex(0x3f494f);
          handle.targetLuminaireEmissive.setHex(0x000000);
        } else if (lightNorm <= 0.45) {
          const t = lightNorm / 0.45;
          handle.targetGlow = 0.45 + t * 0.35;
          handle.targetWallColor
            .setHex(0x805a22)
            .lerp(TEMP_COLOR.setHex(ARCHITECTURAL_PALETTE.lightLowColor), t);
          handle.targetFloorColor
            .setHex(0x946825)
            .lerp(TEMP_COLOR.setHex(0xc98f32), t);
          handle.targetLuminaireColor.setHex(0xf5c462);
          handle.targetLuminaireEmissive.setHex(0xd98f26);
        } else if (lightNorm <= 0.78) {
          const t = (lightNorm - 0.45) / 0.33;
          handle.targetGlow = 0.85 + t * 0.35;
          handle.targetWallColor
            .setHex(ARCHITECTURAL_PALETTE.lightLowColor)
            .lerp(TEMP_COLOR.setHex(ARCHITECTURAL_PALETTE.lightMidColor), t);
          handle.targetFloorColor
            .setHex(0xd19234)
            .lerp(TEMP_COLOR.setHex(0xf2b03d), t);
          handle.targetLuminaireColor.setHex(0xffe08a);
          handle.targetLuminaireEmissive.setHex(0xf5a623);
        } else {
          const t = (lightNorm - 0.78) / 0.22;
          handle.targetGlow = 1.25 + t * 0.35;
          handle.targetWallColor
            .setHex(ARCHITECTURAL_PALETTE.lightMidColor)
            .lerp(TEMP_COLOR.setHex(ARCHITECTURAL_PALETTE.lightHighColor), t);
          handle.targetFloorColor
            .setHex(0xf2b546)
            .lerp(TEMP_COLOR.setHex(0xffe178), t);
          handle.targetLuminaireColor.setHex(0xfff2be);
          handle.targetLuminaireEmissive.setHex(0xffc94d);
        }
      } else if (mode === 'intensity') {
        const tier = st?.intensityTier ?? 'inactive';
        if (tier === 'inactive') {
          handle.targetWallColor.setHex(ARCHITECTURAL_PALETTE.inactiveStone);
          handle.targetFloorColor.setHex(0x313a40);
          handle.targetLuminaireColor.setHex(0x475258);
          handle.targetLuminaireEmissive.setHex(0x000000);
          handle.targetGlow = 0;
        } else if (tier === 'efficient') {
          handle.targetWallColor.setHex(0x217a59);
          handle.targetFloorColor.setHex(ARCHITECTURAL_PALETTE.sageEfficient);
          handle.targetLuminaireColor.setHex(0x6ee7b7);
          handle.targetLuminaireEmissive.setHex(0x1b875f);
          handle.targetGlow = 0.65;
        } else if (tier === 'moderate') {
          handle.targetWallColor.setHex(0x286e82);
          handle.targetFloorColor.setHex(ARCHITECTURAL_PALETTE.tealModerate);
          handle.targetLuminaireColor.setHex(0x7fd1e3);
          handle.targetLuminaireEmissive.setHex(0x27758a);
          handle.targetGlow = 0.72;
        } else {
          handle.targetWallColor.setHex(0xb56516);
          handle.targetFloorColor.setHex(ARCHITECTURAL_PALETTE.amberElevated);
          handle.targetLuminaireColor.setHex(0xffcb80);
          handle.targetLuminaireEmissive.setHex(0xd97a1e);
          handle.targetGlow = 0.95;
        }
      } else {
        const temp = st?.temperatureC ?? 26.2;
        const luxNorm = Math.max(0, Math.min(1, ((st?.ambientLux ?? 250) - 100) / 380));
        let baseHex: number = ARCHITECTURAL_PALETTE.thermalBalanced;
        if (temp < 25.5) baseHex = ARCHITECTURAL_PALETTE.thermalCool;
        else if (temp > 27.4) baseHex = ARCHITECTURAL_PALETTE.thermalWarm;

        handle.targetFloorColor.setHex(baseHex);
        handle.targetWallColor.setHex(0x465156).lerp(TEMP_COLOR.setHex(baseHex), 0.64);
        handle.targetLuminaireColor.setHex(0xe4ece9);
        handle.targetLuminaireEmissive.setHex(baseHex);
        handle.targetGlow = 0.42 + luxNorm * 0.45;
      }
    }

    for (const [bId, bHandle] of this.model.buildings.entries()) {
      const totals = buildingLoadTotals.get(bId) || { watts: 0, rated: 1 };
      const ratio = totals.rated > 0 ? Math.min(1, totals.watts / totals.rated) : 0;
      const isFocused = !this.config.selectedBuilding || this.config.selectedBuilding === bId;
      const opacity = isFocused ? 0.92 : 0.25;

      bHandle.feederFlowMat.uniforms.uIntensity.value =
        totals.watts > 0 ? Math.max(0.28, ratio) : 0;
      bHandle.feederFlowMat.uniforms.uSpeed.value = 0.18 + ratio * 0.42;
      bHandle.feederFlowMat.uniforms.uOpacity.value = opacity;

      bHandle.riserFlowMat.uniforms.uIntensity.value =
        totals.watts > 0 ? Math.max(0.24, ratio) : 0;
      bHandle.riserFlowMat.uniforms.uSpeed.value = 0.22 + ratio * 0.46;
      bHandle.riserFlowMat.uniforms.uOpacity.value = opacity * 0.9;
    }
  }

  private handleControlsStart = () => {
    this.isCameraFlying = false;
  };

  private handleControlsChange = () => {
    this.requestRender();
  };

  private handlePointerDown = (ev: PointerEvent) => {
    this.pointerDownPos = { x: ev.clientX, y: ev.clientY };
  };

  private handlePointerMove = (ev: PointerEvent) => {
    const now = performance.now();
    if (now - this.lastHoverRaycastMs < 48) return;
    this.lastHoverRaycastMs = now;

    const hitId = this.pickRoomAt(ev.clientX, ev.clientY);
    if (hitId !== this.hoveredRoomId) {
      if (this.hoveredRoomId) {
        const prev = this.model.rooms.get(this.hoveredRoomId);
        if (prev) prev.hoverFrame.visible = false;
      }
      this.hoveredRoomId = hitId;
      if (hitId) {
        const next = this.model.rooms.get(hitId);
        if (next && hitId !== this.config.selectedRoomId) {
          next.hoverFrame.visible = true;
        }
        this.renderer.domElement.style.cursor = 'pointer';
      } else {
        this.renderer.domElement.style.cursor = 'grab';
      }
      this.callbacks.onHoverRoom(hitId);
      this.requestRender();
    }
  };

  private handlePointerUp = (ev: PointerEvent) => {
    const dx = ev.clientX - this.pointerDownPos.x;
    const dy = ev.clientY - this.pointerDownPos.y;
    if (dx * dx + dy * dy > 25) return;

    const hitRoomId = this.pickRoomAt(ev.clientX, ev.clientY);
    if (hitRoomId) {
      this.callbacks.onSelectRoom(hitRoomId);
      return;
    }

    const hitBuilding = this.pickBuildingAt(ev.clientX, ev.clientY);
    if (hitBuilding) {
      this.callbacks.onSelectBuilding?.(hitBuilding);
    }
  };

  private handlePointerLeave = () => {
    if (this.hoveredRoomId) {
      const prev = this.model.rooms.get(this.hoveredRoomId);
      if (prev) prev.hoverFrame.visible = false;
      this.hoveredRoomId = null;
      this.callbacks.onHoverRoom(null);
      this.renderer.domElement.style.cursor = 'grab';
      this.requestRender();
    }
  };

  private handleContextLost = (ev: Event) => {
    ev.preventDefault();
    this.callbacks.onWebGLContextLost?.();
  };

  private pickRoomAt(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.model.hitTargets, false);
    if (hits.length === 0) return null;

    for (const hit of hits) {
      const data = hit.object.userData as {
        roomId?: string;
        building?: BuildingName;
        floor?: Floor;
      };
      if (!data.roomId) continue;
      if (this.config.selectedBuilding && data.building !== this.config.selectedBuilding) {
        continue;
      }
      if (this.config.selectedFloor !== 'All' && data.floor !== this.config.selectedFloor) {
        continue;
      }
      return data.roomId;
    }

    return (hits[0].object.userData as { roomId?: string }).roomId ?? null;
  }

  private pickBuildingAt(clientX: number, clientY: number): BuildingName | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.model.buildingHitTargets, false);
    if (hits.length === 0) return null;
    return (hits[0].object.userData as { building?: BuildingName }).building ?? null;
  }

  private projectLandmarkLabels(): void {
    if (!this.callbacks.onProjectLabels) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width <= 0 || height <= 0) return;

    const explodeLift = this.currentExplodeFactor;
    for (let i = 0; i < CAMPUS_LANDMARK_LABELS.length; i++) {
      const spec = CAMPUS_LANDMARK_LABELS[i];
      const out = this.projectedLabelsBuffer[i];

      let extraY = 0;
      if (spec.buildingId) {
        const bHandle = this.model.buildings.get(spec.buildingId);
        if (bHandle) {
          const topIdx = bHandle.floors.length - 1;
          extraY = topIdx * FLOOR_EXPLODE_GAP * explodeLift;
        }
      }

      PROJ_VEC.set(spec.worldPos[0], spec.worldPos[1] + extraY, spec.worldPos[2]);
      PROJ_VEC.project(this.camera);

      const inFront = PROJ_VEC.z >= -1 && PROJ_VEC.z <= 1;
      const sx = (PROJ_VEC.x * 0.5 + 0.5) * width;
      const sy = (-PROJ_VEC.y * 0.5 + 0.5) * height;
      const onScreen = inFront && sx > 24 && sx < width - 24 && sy > 48 && sy < height - 64;

      out.x = sx;
      out.y = sy;
      out.visible = onScreen;
    }

    this.callbacks.onProjectLabels(this.projectedLabelsBuffer);
  }

  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.requestRender();
  }

  public requestRender(): void {
    if (this.disposed || this.isLoopActive) return;
    this.isLoopActive = true;
    this.lastFrameTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private renderOnce(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
    this.projectLandmarkLabels();
  }

  private scheduleNextFrame(): void {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      if (typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (this.disposed) {
            if (sync) gl.deleteSync(sync);
            return;
          }
          const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
          if (state === gl.UNSIGNALED) {
            this.softwareTimerId = window.setTimeout(poll, 6);
          } else {
            if (sync) gl.deleteSync(sync);
            this.softwareTimerId = window.setTimeout(() => {
              this.rafId = requestAnimationFrame(this.tick);
            }, 80);
          }
        };
        this.softwareTimerId = window.setTimeout(poll, 6);
      } else {
        this.softwareTimerId = window.setTimeout(() => {
          this.rafId = requestAnimationFrame(this.tick);
        }, 80);
      }
    } else {
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number) => {
    if (this.disposed) return;

    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;

    let needsMoreFrames = false;
    const dampLambda = this.config.reducedMotion ? 60 : 6.8;

    // 1. Camera smooth flight
    if (this.isCameraFlying) {
      this.camera.position.x = THREE.MathUtils.damp(
        this.camera.position.x,
        this.targetCamPos.x,
        5.5,
        dt
      );
      this.camera.position.y = THREE.MathUtils.damp(
        this.camera.position.y,
        this.targetCamPos.y,
        5.5,
        dt
      );
      this.camera.position.z = THREE.MathUtils.damp(
        this.camera.position.z,
        this.targetCamPos.z,
        5.5,
        dt
      );

      this.controls.target.x = THREE.MathUtils.damp(
        this.controls.target.x,
        this.targetControlsCenter.x,
        5.5,
        dt
      );
      this.controls.target.y = THREE.MathUtils.damp(
        this.controls.target.y,
        this.targetControlsCenter.y,
        5.5,
        dt
      );
      this.controls.target.z = THREE.MathUtils.damp(
        this.controls.target.z,
        this.targetControlsCenter.z,
        5.5,
        dt
      );

      if (
        this.camera.position.distanceToSquared(this.targetCamPos) < 0.004 &&
        this.controls.target.distanceToSquared(this.targetControlsCenter) < 0.004
      ) {
        this.camera.position.copy(this.targetCamPos);
        this.controls.target.copy(this.targetControlsCenter);
        this.isCameraFlying = false;
      } else {
        needsMoreFrames = true;
      }
    }

    if (this.controls.update()) {
      needsMoreFrames = true;
    }

    // 2. Smooth global floor explosion & cutaway
    const prevExplode = this.currentExplodeFactor;
    this.currentExplodeFactor = THREE.MathUtils.damp(
      this.currentExplodeFactor,
      this.targetExplodeFactor,
      dampLambda,
      dt
    );
    if (Math.abs(this.currentExplodeFactor - this.targetExplodeFactor) > 0.0015) {
      needsMoreFrames = true;
    } else if (prevExplode !== this.targetExplodeFactor) {
      this.currentExplodeFactor = this.targetExplodeFactor;
    }

    const prevCut = this.currentCutaway;
    this.currentCutaway = THREE.MathUtils.damp(
      this.currentCutaway,
      this.targetCutaway,
      dampLambda,
      dt
    );
    if (Math.abs(this.currentCutaway - this.targetCutaway) > 0.0015) {
      needsMoreFrames = true;
    } else if (prevCut !== this.targetCutaway) {
      this.currentCutaway = this.targetCutaway;
    }

    // 2b. Subtle weather-responsive atmospheric lighting, sky, fog & rain damping
    const atmosLambda = this.config.reducedMotion ? 60 : 3.2;
    const atmosAlpha = 1 - Math.exp(-atmosLambda * dt);
    const skyDiff =
      Math.abs(this.sceneBgColor.r - this.targetSkyColor.r) +
      Math.abs(this.sceneBgColor.g - this.targetSkyColor.g) +
      Math.abs(this.sceneBgColor.b - this.targetSkyColor.b);
    const lightDiff =
      Math.abs(this.hemiLight.intensity - this.targetAtmosphere.hemiIntensity) +
      Math.abs(this.keySun.intensity - this.targetAtmosphere.sunIntensity) +
      Math.abs(this.skyFill.intensity - this.targetAtmosphere.fillIntensity) +
      Math.abs(this.renderer.toneMappingExposure - this.targetAtmosphere.exposure) +
      Math.abs(this.currentNightGlow - this.targetAtmosphere.nightGlowMultiplier) +
      Math.abs(this.currentRainIntensity - this.targetAtmosphere.rainIntensity);

    if (skyDiff > 0.003 || lightDiff > 0.004 || this.keySun.position.distanceToSquared(this.targetSunPos) > 0.02) {
      this.sceneBgColor.lerp(this.targetSkyColor, atmosAlpha);
      this.sceneFog.color.copy(this.sceneBgColor);
      this.sceneFog.near = THREE.MathUtils.damp(
        this.sceneFog.near,
        this.targetAtmosphere.fogNear,
        atmosLambda,
        dt
      );
      this.sceneFog.far = THREE.MathUtils.damp(
        this.sceneFog.far,
        this.targetAtmosphere.fogFar,
        atmosLambda,
        dt
      );
      this.hemiLight.color.lerp(this.targetHemiSkyColor, atmosAlpha);
      this.hemiLight.groundColor.lerp(this.targetHemiGroundColor, atmosAlpha);
      this.hemiLight.intensity = THREE.MathUtils.damp(
        this.hemiLight.intensity,
        this.targetAtmosphere.hemiIntensity,
        atmosLambda,
        dt
      );
      this.keySun.color.lerp(this.targetSunColor, atmosAlpha);
      this.keySun.intensity = THREE.MathUtils.damp(
        this.keySun.intensity,
        this.targetAtmosphere.sunIntensity,
        atmosLambda,
        dt
      );
      this.keySun.position.lerp(this.targetSunPos, atmosAlpha);
      this.skyFill.color.lerp(this.targetFillColor, atmosAlpha);
      this.skyFill.intensity = THREE.MathUtils.damp(
        this.skyFill.intensity,
        this.targetAtmosphere.fillIntensity,
        atmosLambda,
        dt
      );
      this.renderer.toneMappingExposure = THREE.MathUtils.damp(
        this.renderer.toneMappingExposure,
        this.targetAtmosphere.exposure,
        atmosLambda,
        dt
      );
      this.scene.environmentIntensity = THREE.MathUtils.damp(
        this.scene.environmentIntensity,
        this.targetAtmosphere.envIntensity,
        atmosLambda,
        dt
      );
      this.currentNightGlow = THREE.MathUtils.damp(
        this.currentNightGlow,
        this.targetAtmosphere.nightGlowMultiplier,
        atmosLambda,
        dt
      );
      this.currentRainIntensity = THREE.MathUtils.damp(
        this.currentRainIntensity,
        this.targetAtmosphere.rainIntensity,
        atmosLambda,
        dt
      );
      needsMoreFrames = true;
    }

    if (this.rainSegments && this.rainMaterial && this.rainGeometry && this.rainPositions && this.rainSpeeds) {
      const showRain = this.currentRainIntensity > 0.03 && !this.config.reducedMotion;
      this.rainSegments.visible = showRain;
      if (showRain) {
        this.rainMaterial.opacity = Math.min(0.28, this.currentRainIntensity * 0.34);
        const pos = this.rainPositions;
        const speeds = this.rainSpeeds;
        const dropCount = speeds.length;
        for (let i = 0; i < dropCount; i++) {
          const idx = i * 6;
          const dy = speeds[i] * dt;
          let y = pos[idx + 1] - dy;
          if (y < 0.2) {
            y = 33 + Math.random() * 4;
            const x = (Math.random() - 0.5) * 90;
            const z = (Math.random() - 0.5) * 84;
            pos[idx] = x;
            pos[idx + 2] = z;
            pos[idx + 3] = x - 0.16;
            pos[idx + 5] = z + 0.08;
          }
          pos[idx + 1] = y;
          pos[idx + 4] = y - 1.15;
        }
        (this.rainGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        needsMoreFrames = true;
      }
    }

    // 3. Apply building floor elevations, focus dimming & heatmap visibility
    const hasFloorFilter = this.config.selectedFloor !== 'All';
    const hasBuildingFilter = Boolean(this.config.selectedBuilding);
    const isHeatmapMode = this.config.visualMode !== 'architectural';
    const selectedRoomEntry = this.config.selectedRoomId
      ? ROOM_GEOMETRY_MAP.get(this.config.selectedRoomId)
      : undefined;

    for (const bHandle of this.model.buildings.values()) {
      const buildingMatches =
        !hasBuildingFilter || this.config.selectedBuilding === bHandle.id;
      const roomBuildingMatches =
        !selectedRoomEntry || selectedRoomEntry.building.id === bHandle.id;
      const bExplode = this.currentExplodeFactor;

      for (const fHandle of bHandle.floors) {
        const floorMatches =
          !hasFloorFilter || this.config.selectedFloor === fHandle.floor;
        const isFocusedFloor = buildingMatches && floorMatches && roomBuildingMatches;

        fHandle.targetY = fHandle.baseY + fHandle.floorIndex * FLOOR_EXPLODE_GAP * bExplode;
        fHandle.currentY = fHandle.targetY;
        fHandle.group.position.y = fHandle.currentY;

        const showInteriors =
          isHeatmapMode ||
          this.currentCutaway > 0.04 ||
          this.currentExplodeFactor > 0.04 ||
          hasFloorFilter ||
          Boolean(selectedRoomEntry && selectedRoomEntry.building.id === bHandle.id);

        const heatmapShellAlpha = isHeatmapMode ? 0.36 : 1.0;
        const targetShellOpacity = !isFocusedFloor
          ? 0.2
          : this.currentCutaway > 0.02
          ? THREE.MathUtils.lerp(heatmapShellAlpha, 0.14, this.currentCutaway)
          : heatmapShellAlpha;

        const targetSlabOpacity = isFocusedFloor ? 1.0 : 0.26;

        for (let idx = 0; idx < fHandle.shellMaterials.length; idx++) {
          const mat = fHandle.shellMaterials[idx];
          const isGlazing = idx === 1;
          const desired = isGlazing
            ? targetShellOpacity * (showInteriors ? 0.38 : 0.84)
            : targetShellOpacity;
          if (Math.abs(mat.opacity - desired) > 0.004) {
            mat.opacity = THREE.MathUtils.damp(mat.opacity, desired, dampLambda, dt);
            mat.depthWrite = mat.opacity > 0.72;
            needsMoreFrames = true;
          }
        }

        for (const mat of fHandle.slabMaterials) {
          if (Math.abs(mat.opacity - targetSlabOpacity) > 0.004) {
            mat.opacity = THREE.MathUtils.damp(mat.opacity, targetSlabOpacity, dampLambda, dt);
            mat.depthWrite = mat.opacity > 0.72;
            needsMoreFrames = true;
          }
        }

        for (const rHandle of fHandle.rooms) {
          rHandle.interiorGroup.visible = showInteriors;
          const isSelectedRoom = this.config.selectedRoomId === rHandle.roomId;
          const isRoomFocused =
            isFocusedFloor && (!this.config.selectedRoomId || isSelectedRoom);
          const roomOpacity = isRoomFocused ? 1.0 : isFocusedFloor ? 0.36 : 0.2;

          if (Math.abs(rHandle.wallMat.opacity - roomOpacity) > 0.005) {
            rHandle.wallMat.opacity = THREE.MathUtils.damp(
              rHandle.wallMat.opacity,
              roomOpacity,
              dampLambda,
              dt
            );
            rHandle.floorMat.opacity = rHandle.wallMat.opacity;
            rHandle.wallMat.depthWrite = rHandle.wallMat.opacity > 0.65;
            rHandle.floorMat.depthWrite = rHandle.floorMat.opacity > 0.65;
            needsMoreFrames = true;
          }

          if (Math.abs(rHandle.currentGlow - rHandle.targetGlow) > 0.004) {
            rHandle.currentGlow = THREE.MathUtils.damp(
              rHandle.currentGlow,
              rHandle.targetGlow,
              dampLambda,
              dt
            );
            needsMoreFrames = true;
          }

          const colorAlpha = 1 - Math.exp(-dampLambda * dt);
          const wallDiff =
            Math.abs(rHandle.currentWallColor.r - rHandle.targetWallColor.r) +
            Math.abs(rHandle.currentWallColor.g - rHandle.targetWallColor.g) +
            Math.abs(rHandle.currentWallColor.b - rHandle.targetWallColor.b);
          if (wallDiff > 0.005) {
            rHandle.currentWallColor.lerp(rHandle.targetWallColor, colorAlpha);
            rHandle.currentFloorColor.lerp(rHandle.targetFloorColor, colorAlpha);
            rHandle.currentLuminaireColor.lerp(rHandle.targetLuminaireColor, colorAlpha);
            rHandle.currentLuminaireEmissive.lerp(rHandle.targetLuminaireEmissive, colorAlpha);
            needsMoreFrames = true;
          }

          const focusBoost = isSelectedRoom ? 1.2 : isRoomFocused ? 1.0 : 0.35;
          const ambientGlowBoost =
            this.config.visualMode === 'architectural' ? this.currentNightGlow : 1.0;

          rHandle.wallMat.color.copy(rHandle.currentWallColor);
          rHandle.wallMat.emissive.copy(rHandle.currentLuminaireEmissive);
          rHandle.wallMat.emissiveIntensity =
            (this.config.visualMode === 'lighting'
              ? rHandle.currentGlow * 0.62
              : isHeatmapMode
              ? rHandle.currentGlow * 0.44
              : rHandle.currentGlow * 0.28 * ambientGlowBoost) * focusBoost;

          rHandle.floorMat.color.copy(rHandle.currentFloorColor);
          rHandle.floorMat.emissive.copy(rHandle.currentLuminaireEmissive);
          rHandle.floorMat.emissiveIntensity =
            (this.config.visualMode === 'lighting'
              ? rHandle.currentGlow * 0.72
              : isHeatmapMode
              ? rHandle.currentGlow * 0.54
              : rHandle.currentGlow * 0.32 * ambientGlowBoost) * focusBoost;

          rHandle.luminaireMat.color.copy(rHandle.currentLuminaireColor);
          rHandle.luminaireMat.emissive.copy(rHandle.currentLuminaireEmissive);
          rHandle.luminaireMat.emissiveIntensity =
            rHandle.currentGlow * 1.45 * focusBoost * ambientGlowBoost;

          if (
            !this.config.reducedMotion &&
            !this.isSoftwareGl &&
            rHandle.targetFanSpeedRad > 0.05 &&
            (this.currentCutaway > 0.15 || this.currentExplodeFactor > 0.15)
          ) {
            const deltaAngle = rHandle.targetFanSpeedRad * dt;
            for (const spinner of rHandle.fanBlades) {
              spinner.rotation.y += deltaAngle;
            }
            needsMoreFrames = true;
          }
        }
      }

      const topFloorIdx = bHandle.floors.length - 1;
      bHandle.roofTargetY =
        bHandle.roofBaseY + topFloorIdx * FLOOR_EXPLODE_GAP * bExplode + bExplode * 0.85;
      bHandle.roofCurrentY = bHandle.roofTargetY;
      bHandle.roofGroup.position.y = bHandle.roofCurrentY;

      const hideRoofForFocus =
        this.currentCutaway > 0.05 ||
        hasFloorFilter ||
        Boolean(selectedRoomEntry && selectedRoomEntry.building.id === bHandle.id);
      const baseRoofAlpha = isHeatmapMode ? 0.18 : 1.0;
      const targetRoofOpacity = !buildingMatches
        ? 0.18
        : hideRoofForFocus
        ? Math.max(
            0.0,
            baseRoofAlpha *
              (1 - Math.max(this.currentCutaway, hasFloorFilter || selectedRoomEntry ? 1 : 0))
          )
        : baseRoofAlpha;

      for (const rMat of bHandle.roofMaterials) {
        if (Math.abs(rMat.opacity - targetRoofOpacity) > 0.006) {
          rMat.opacity = THREE.MathUtils.damp(rMat.opacity, targetRoofOpacity, dampLambda, dt);
          rMat.depthWrite = rMat.opacity > 0.65;
          needsMoreFrames = true;
        }
      }
      bHandle.roofGroup.visible = bHandle.roofMaterials[0].opacity > 0.03;
    }

    if (this.config.showEnergyFlow && !this.config.reducedMotion) {
      this.flowClock += dt;
      for (const mat of this.model.flowMaterials) {
        mat.uniforms.uTime.value = this.flowClock;
      }
      needsMoreFrames = true;
    }

    this.renderer.render(this.scene, this.camera);
    this.projectLandmarkLabels();

    if (needsMoreFrames) {
      this.scheduleNextFrame();
    } else {
      this.isLoopActive = false;
      this.rafId = null;
    }
  };

  public dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.softwareTimerId !== null) {
      clearTimeout(this.softwareTimerId);
      this.softwareTimerId = null;
    }
    this.resizeObserver.disconnect();
    this.controls.removeEventListener('start', this.handleControlsStart);
    this.controls.removeEventListener('change', this.handleControlsChange);
    this.controls.dispose();

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerup', this.handlePointerUp);
    canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    canvas.removeEventListener('webglcontextlost', this.handleContextLost);

    this.rainGeometry?.dispose();
    this.rainMaterial?.dispose();
    this.model.dispose();
    this.envRenderTarget.dispose();
    this.pmremGenerator.dispose();
    this.renderer.dispose();

    if (canvas.parentElement === this.container) {
      this.container.removeChild(canvas);
    }
  }
}
