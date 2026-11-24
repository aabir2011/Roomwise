/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import type { BuildingName, Floor } from '../../types/energy';
import {
  CAMPUS_BUILDINGS_SCHEMA,
  CAMPUS_FEEDER_WORLD_POS,
  CAMPUS_SITE_DEPTH,
  CAMPUS_SITE_WIDTH,
  CAMPUS_TREE_POSITIONS,
  OB_NB_CONNECTOR_SPEC,
} from './campusLayoutSchema';
import {
  ARCHITECTURAL_PALETTE,
  createBasketballCourtTexture,
  createEnergyFlowShaderMaterial,
  createFootballGroundTexture,
  createSharedMaterials,
  type SharedSceneMaterials,
} from './sceneMaterials';
import type {
  ArchitecturalStyleKind,
  BuildingSchemaSpec,
  RoomGeometrySpec,
} from './types';

export interface RoomRenderHandle {
  roomId: string;
  roomCode: string;
  building: BuildingName;
  floor: Floor;
  floorIndex: number;
  group: THREE.Group;
  /** Interior walls, floor plate, furniture & luminaires — hidden in opaque Model view to prevent bleed */
  interiorGroup: THREE.Group;
  hitMesh: THREE.Mesh;
  wallMat: THREE.MeshStandardMaterial;
  floorMat: THREE.MeshStandardMaterial;
  luminaireMat: THREE.MeshStandardMaterial;
  glassMat: THREE.MeshStandardMaterial;
  selectionFrame: THREE.LineSegments;
  hoverFrame: THREE.LineSegments;
  fanBlades: THREE.Object3D[];
  currentGlow: number;
  targetGlow: number;
  currentWallColor: THREE.Color;
  targetWallColor: THREE.Color;
  currentFloorColor: THREE.Color;
  targetFloorColor: THREE.Color;
  currentLuminaireColor: THREE.Color;
  targetLuminaireColor: THREE.Color;
  currentLuminaireEmissive: THREE.Color;
  targetLuminaireEmissive: THREE.Color;
  currentFanSpeedRad: number;
  targetFanSpeedRad: number;
  worldAnchorLocal: THREE.Vector3;
}

export interface FloorRenderHandle {
  building: BuildingName;
  floor: Floor;
  floorIndex: number;
  baseY: number;
  group: THREE.Group;
  shellMaterials: THREE.MeshStandardMaterial[];
  slabMaterials: THREE.MeshStandardMaterial[];
  rooms: RoomRenderHandle[];
  currentY: number;
  targetY: number;
}

export interface BuildingRenderHandle {
  id: BuildingName;
  spec: BuildingSchemaSpec;
  group: THREE.Group;
  roofGroup: THREE.Group;
  roofBaseY: number;
  roofCurrentY: number;
  roofTargetY: number;
  roofMaterials: THREE.MeshStandardMaterial[];
  selectionHalo: THREE.LineSegments;
  floors: FloorRenderHandle[];
  feederFlowMat: THREE.ShaderMaterial;
  riserFlowMat: THREE.ShaderMaterial;
}

export interface CampusModelBundle {
  root: THREE.Group;
  buildings: Map<BuildingName, BuildingRenderHandle>;
  rooms: Map<string, RoomRenderHandle>;
  hitTargets: THREE.Object3D[];
  buildingHitTargets: THREE.Object3D[];
  energyFlowGroup: THREE.Group;
  flowMaterials: THREE.ShaderMaterial[];
  dispose: () => void;
}

function getBuildingFacadeColor(style: ArchitecturalStyleKind): number {
  switch (style) {
    case 'g3-notched':
      return ARCHITECTURAL_PALETTE.g3Facade;
    case 'mph-extension':
      return ARCHITECTURAL_PALETTE.mphFacade;
    case 'ob-heritage':
      return ARCHITECTURAL_PALETTE.obFacade;
    case 'nb-courtyard':
      return ARCHITECTURAL_PALETTE.nbFacade;
    case 'pp-l-wing':
      return ARCHITECTURAL_PALETTE.ppFacade;
  }
}

// =============================================================================
// WATERTIGHT 2D POLYGON EXTRUSION & MITER-OFFSET HELPERS (ZERO WING OVERLAP)
// =============================================================================

type Vec2 = [number, number];

/** Converts building-local [x, z] footprint to CCW 2D shape coordinates [sx, sy] = [x, -z]. */
function toCcwShapePts(xzPts: Vec2[]): Vec2[] {
  const pts: Vec2[] = xzPts.map(([x, z]) => [x, -z]);
  let signedArea2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    signedArea2 += x0 * y1 - x1 * y0;
  }
  if (signedArea2 < 0) pts.reverse();
  return pts;
}

/**
 * Computes an exact mitered parallel offset of a CCW 2D polygon.
 * Positive `inset` moves edges inward; negative `inset` expands outward.
 */
function offsetCcwPolygon(ccwPts: Vec2[], inset: number): Vec2[] {
  const n = ccwPts.length;
  const result: Vec2[] = [];

  for (let i = 0; i < n; i++) {
    const pPrev = ccwPts[(i - 1 + n) % n];
    const pCurr = ccwPts[i];
    const pNext = ccwPts[(i + 1) % n];

    const e1x = pCurr[0] - pPrev[0];
    const e1y = pCurr[1] - pPrev[1];
    const l1 = Math.hypot(e1x, e1y) || 1;
    const d1x = e1x / l1;
    const d1y = e1y / l1;
    const n1x = -d1y; // Inward normal for CCW polygon
    const n1y = d1x;

    const e2x = pNext[0] - pCurr[0];
    const e2y = pNext[1] - pCurr[1];
    const l2 = Math.hypot(e2x, e2y) || 1;
    const d2x = e2x / l2;
    const d2y = e2y / l2;
    const n2x = -d2y;
    const n2y = d2x;

    // Offset line 1: (pCurr + n1 * inset) + t * d1
    // Offset line 2: (pCurr + n2 * inset) + s * d2
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-4) {
      result.push([pCurr[0] + n1x * inset, pCurr[1] + n1y * inset]);
    } else {
      const bx = (n2x - n1x) * inset;
      const by = (n2y - n1y) * inset;
      const t = (bx * d2y - by * d2x) / cross;
      let ox = n1x * inset + t * d1x;
      let oy = n1y * inset + t * d1y;
      const mag = Math.hypot(ox, oy);
      const maxMiter = Math.abs(inset) * 2.4;
      if (mag > maxMiter && mag > 1e-6) {
        const s = maxMiter / mag;
        ox *= s;
        oy *= s;
      }
      result.push([pCurr[0] + ox, pCurr[1] + oy]);
    }
  }

  return result;
}

/**
 * Extrudes a solid 2D CCW polygon vertically from y=0 to y=height.
 */
function createSolidExtrudeGeo(ccwPts: Vec2[], height: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(ccwPts[0][0], ccwPts[0][1]);
  for (let i = 1; i < ccwPts.length; i++) {
    shape.lineTo(ccwPts[i][0], ccwPts[i][1]);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Extrudes a seamless hollow perimeter ring (outer CCW contour minus inner CW hole)
 * vertically from y=0 to y=height — zero overlapping boxes, zero corner clipping.
 */
function createRingExtrudeGeo(
  outerCcw: Vec2[],
  innerCcw: Vec2[],
  height: number
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(outerCcw[0][0], outerCcw[0][1]);
  for (let i = 1; i < outerCcw.length; i++) {
    shape.lineTo(outerCcw[i][0], outerCcw[i][1]);
  }
  shape.closePath();

  const hole = new THREE.Path();
  // Reversed order (CW) for Three.js hole convention
  const last = innerCcw.length - 1;
  hole.moveTo(innerCcw[last][0], innerCcw[last][1]);
  for (let i = last - 1; i >= 0; i--) {
    hole.lineTo(innerCcw[i][0], innerCcw[i][1]);
  }
  hole.closePath();
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

export function buildCampusModel(
  enableShadows: boolean,
  maxAnisotropy = 4
): CampusModelBundle {
  const root = new THREE.Group();
  root.name = 'DavModelSchoolCampusReplica';

  const shared = createSharedMaterials();
  const ownedGeometries: THREE.BufferGeometry[] = [];
  const ownedMaterials: THREE.Material[] = [];
  const ownedTextures: THREE.Texture[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    ownedGeometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    ownedMaterials.push(m);
    return m;
  };
  const trackTex = <T extends THREE.Texture>(t: T): T => {
    ownedTextures.push(t);
    return t;
  };

  // =========================================================================
  // 1. LAYERED NON-OVERLAPPING TERRAIN, PLAZA, ROADS, GATES & SPORTS APRON
  // =========================================================================
  // Strict Y-stack eliminates 100% of ground/road/walkway Z-fighting:
  //   y = -0.26 : Outer extended horizon ground
  //   y =  0.00 : Campus parcel turf top
  //   y =  0.03 : Single unified paved courtyard plaza top
  //   y =  0.06 : Strictly abutting non-overlapping roads top
  //   y =  0.05 : Football Ground surface (south of internal driveway)
  //   y =  0.06 : Basketball Court surface (east of Football Ground)

  const outerGroundMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: ARCHITECTURAL_PALETTE.horizonTerrain,
      roughness: 0.96,
      metalness: 0.0,
    })
  );
  const outerGround = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(340, 340)), outerGroundMat);
  outerGround.rotation.x = -Math.PI / 2;
  outerGround.position.y = -0.26;
  outerGround.receiveShadow = enableShadows;
  root.add(outerGround);

  const campusGround = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(CAMPUS_SITE_WIDTH, 0.24, CAMPUS_SITE_DEPTH)),
    shared.lawn
  );
  campusGround.position.set(-1.0, -0.12, 2.5);
  campusGround.receiveShadow = enableShadows;
  root.add(campusGround);

  // Single unified paved courtyard apron polygon (zero overlapping walkway rectangles!)
  const plazaPts = toCcwShapePts([
    [-21.2, -9.2],  // West edge at MPH / G+3
    [-21.2, -1.6],  // Runs cleanly through the MPH–PP open gap walkway
    [-19.5, -1.6],
    [-19.5, 12.2],  // Along PP east / south edge to driveway
    [13.8, 12.2],   // Along south of NB
    [13.8, -1.2],   // East of OB/NB
    [6.5, -14.2],   // North-central quad toward Gate 1
    [-10.2, -14.2], // West edge near G+3 NE wing
  ]);
  const plazaMesh = new THREE.Mesh(trackGeo(createSolidExtrudeGeo(plazaPts, 0.03)), shared.walkway);
  plazaMesh.position.y = 0.0;
  plazaMesh.receiveShadow = enableShadows;
  root.add(plazaMesh);

  // Unified +0.14 rad campus grid frame for strictly abutting Roads, Gates, Divider Wall & Sports
  const campusGridGroup = new THREE.Group();
  campusGridGroup.name = 'CampusSiteGrid';
  campusGridGroup.rotation.y = 0.14;
  root.add(campusGridGroup);

  const addAbuttingRoad = (xMin: number, xMax: number, zMin: number, zMax: number) => {
    const w = xMax - xMin;
    const d = zMax - zMin;
    const roadMesh = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, 0.03, d)), shared.road);
    roadMesh.position.set((xMin + xMax) / 2, 0.045, (zMin + zMax) / 2);
    roadMesh.receiveShadow = enableShadows;
    campusGridGroup.add(roadMesh);
  };

  // Strictly non-overlapping road segments (each abuts cleanly with 0.00 overlap!)
  addAbuttingRoad(-28.8, -25.4, -25.6, 28.5); // Western Perimeter Road (full N-S)
  addAbuttingRoad(-25.4, 27.5, -25.6, -22.4); // Northern Perimeter Road (starts flush at x=-25.4)
  addAbuttingRoad(-25.4, 27.5, 14.2, 17.0);   // Internal Campus Driveway (starts flush at x=-25.4)
  addAbuttingRoad(-9.0, -6.0, -22.4, -16.8);  // Gate 1 Entry Spur (starts flush at z=-22.4)

  // Low masonry divider wall along south edge of Internal Campus Driveway
  const dividerWall = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(46.0, 0.56, 0.24)),
    shared.boundaryWall
  );
  dividerWall.position.set(-0.5, 0.28, 17.32);
  dividerWall.castShadow = enableShadows;
  dividerWall.receiveShadow = enableShadows;
  campusGridGroup.add(dividerWall);

  // Restrained Masonry Gate Pillars for Gate 1 (North) & Gate 2 (Southwest)
  const addCampusGate = (x: number, z: number, rotY: number, span: number) => {
    const gateGroup = new THREE.Group();
    gateGroup.position.set(x, 0, z);
    gateGroup.rotation.y = rotY;
    for (const s of [-1, 1]) {
      const pillar = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(0.5, 1.45, 0.5)),
        shared.gatePillar
      );
      pillar.position.set(s * (span / 2), 0.725, 0);
      pillar.castShadow = enableShadows;
      pillar.receiveShadow = enableShadows;
      gateGroup.add(pillar);

      const cap = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(0.62, 0.14, 0.62)),
        shared.gateCap
      );
      cap.position.set(s * (span / 2), 1.52, 0);
      gateGroup.add(cap);
    }
    campusGridGroup.add(gateGroup);
  };

  addCampusGate(-7.5, -21.8, 0, 3.6);       // Gate 1 (North)
  addCampusGate(-24.8, 15.6, Math.PI / 2, 3.4); // Gate 2 (Southwest)

  // Football Ground (south of divider wall — zero overlap)
  const fbTex = trackTex(createFootballGroundTexture(maxAnisotropy));
  const fbMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: fbTex,
      roughness: 0.94,
      metalness: 0.0,
    })
  );
  const fbGroup = new THREE.Group();
  fbGroup.name = 'Sports_FootballGround';
  fbGroup.position.set(-5.5, 0, 22.9);

  const fbW = 29.2;
  const fbD = 8.9;
  const fbBorder = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(fbW + 0.5, 0.04, fbD + 0.5)),
    shared.curb
  );
  fbBorder.position.y = 0.02;
  fbBorder.receiveShadow = enableShadows;
  fbGroup.add(fbBorder);

  const fbPitch = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(fbW, fbD)), fbMat);
  fbPitch.rotation.x = -Math.PI / 2;
  fbPitch.position.y = 0.055;
  fbPitch.receiveShadow = enableShadows;
  fbGroup.add(fbPitch);

  const postGeo = trackGeo(new THREE.CylinderGeometry(0.05, 0.05, 1.25, 8));
  const barGeo = trackGeo(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8));
  for (const endSign of [-1, 1]) {
    const gx = endSign * (fbW / 2 - 1.4);
    for (const ps of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, shared.goalpostWhite);
      post.position.set(gx, 0.65, ps * 1.3);
      post.castShadow = enableShadows;
      fbGroup.add(post);
    }
    const crossbar = new THREE.Mesh(barGeo, shared.goalpostWhite);
    crossbar.rotation.x = Math.PI / 2;
    crossbar.position.set(gx, 1.26, 0);
    crossbar.castShadow = enableShadows;
    fbGroup.add(crossbar);
  }
  campusGridGroup.add(fbGroup);

  // Basketball Court (BB — immediately east of Football Ground, zero overlap, 1:1.87 aspect)
  const bbTex = trackTex(createBasketballCourtTexture(maxAnisotropy));
  const bbMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: bbTex,
      roughness: 0.78,
      metalness: 0.04,
    })
  );
  const bbGroup = new THREE.Group();
  bbGroup.name = 'Sports_BasketballCourt';
  bbGroup.position.set(15.6, 0, 23.2);

  const bbW = 6.2;
  const bbD = 11.5;
  const bbBase = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(bbW + 0.44, 0.06, bbD + 0.44)),
    shared.curb
  );
  bbBase.position.y = 0.03;
  bbBase.receiveShadow = enableShadows;
  bbGroup.add(bbBase);

  const bbSurface = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(bbW, bbD)), bbMat);
  bbSurface.rotation.x = -Math.PI / 2;
  bbSurface.position.y = 0.075;
  bbSurface.receiveShadow = enableShadows;
  bbGroup.add(bbSurface);

  const stanchionPoleGeo = trackGeo(new THREE.CylinderGeometry(0.06, 0.075, 2.1, 8));
  const backboardGeo = trackGeo(new THREE.BoxGeometry(1.1, 0.68, 0.06));
  const rimGeo = trackGeo(new THREE.TorusGeometry(0.17, 0.024, 6, 14));
  const rimMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xc2543a, roughness: 0.4, metalness: 0.5 })
  );
  for (const endSign of [-1, 1]) {
    const pole = new THREE.Mesh(stanchionPoleGeo, shared.mullion);
    pole.position.set(0, 1.08, endSign * (bbD / 2 - 0.52));
    pole.castShadow = enableShadows;
    bbGroup.add(pole);

    const boom = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.08, 0.08, 0.58)),
      shared.mullion
    );
    boom.position.set(0, 2.02, endSign * (bbD / 2 - 0.8));
    bbGroup.add(boom);

    const board = new THREE.Mesh(backboardGeo, shared.goalpostWhite);
    board.position.set(0, 2.06, endSign * (bbD / 2 - 1.1));
    board.castShadow = enableShadows;
    bbGroup.add(board);

    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 1.86, endSign * (bbD / 2 - 1.3));
    bbGroup.add(rim);
  }
  campusGridGroup.add(bbGroup);

  // Central shaded tree planter ring inside NB's calibrated inner courtyard pocket
  const planterRing = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(1.15, 1.25, 0.24, 18)),
    shared.curb
  );
  planterRing.position.set(1.33, 0.15, 2.59);
  planterRing.receiveShadow = enableShadows;
  root.add(planterRing);

  const planterSoil = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.98, 0.98, 0.26, 18)),
    shared.lawn
  );
  planterSoil.position.set(1.33, 0.16, 2.59);
  root.add(planterSoil);

  // =========================================================================
  // 2. PHYSICAL COVERED OB ↔ NB CONNECTING CORRIDOR (FROM VECTOR OUTLINE)
  // =========================================================================
  buildObNbConnectingCorridor(root, shared, trackGeo, trackMat, enableShadows);

  // =========================================================================
  // 3. CENTRAL CAMPUS ELECTRICAL FEEDER PLINTH (Conceptual Energy Flow Origin)
  // =========================================================================
  const feederGroup = new THREE.Group();
  feederGroup.position.set(CAMPUS_FEEDER_WORLD_POS[0], 0, CAMPUS_FEEDER_WORLD_POS[2]);
  const feederPad = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.35, 0.12, 0.95)), shared.curb);
  feederPad.position.y = 0.09;
  feederPad.receiveShadow = enableShadows;
  feederGroup.add(feederPad);

  const feederCab = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.84, 0.68, 0.5)),
    shared.feederBody
  );
  feederCab.position.y = 0.49;
  feederCab.castShadow = enableShadows;
  feederCab.receiveShadow = enableShadows;
  feederGroup.add(feederCab);

  const feederBand = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.88, 0.055, 0.54)),
    shared.feederAccent
  );
  feederBand.position.y = 0.74;
  feederGroup.add(feederBand);
  root.add(feederGroup);

  // =========================================================================
  // 4. RESTRAINED SCULPTURAL CAMPUS TREES (Instanced, Zero Facade Obstruction)
  // =========================================================================
  const trunkGeo = trackGeo(new THREE.CylinderGeometry(0.085, 0.14, 1.35, 7));
  const canopyMainGeo = trackGeo(new THREE.IcosahedronGeometry(0.98, 1));
  const canopyCrownGeo = trackGeo(new THREE.DodecahedronGeometry(0.7, 1));

  const treeCount = CAMPUS_TREE_POSITIONS.length;
  const trunksInst = new THREE.InstancedMesh(trunkGeo, shared.treeTrunk, treeCount);
  const canopyMainInst = new THREE.InstancedMesh(canopyMainGeo, shared.treeCanopyA, treeCount);
  const canopyCrownInst = new THREE.InstancedMesh(canopyCrownGeo, shared.treeCanopyB, treeCount);

  trunksInst.castShadow = enableShadows;
  canopyMainInst.castShadow = enableShadows;
  canopyMainInst.receiveShadow = enableShadows;
  canopyCrownInst.castShadow = enableShadows;
  canopyCrownInst.receiveShadow = enableShadows;

  const dummy = new THREE.Object3D();
  const tintColor = new THREE.Color();
  const paletteTints = [0x4c6e53, 0x567859, 0x43634b, 0x5b7a58];

  CAMPUS_TREE_POSITIONS.forEach((t, idx) => {
    const s = t.scale;
    dummy.position.set(t.x, 0.68 * s, t.z);
    dummy.rotation.set(0, idx * 0.9, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    trunksInst.setMatrixAt(idx, dummy.matrix);

    dummy.position.set(t.x, 1.82 * s, t.z);
    dummy.rotation.set(0.08 * (idx % 3), idx * 1.15, 0.05 * (idx % 2));
    dummy.scale.set(s * 1.1, s * 0.86, s * 1.04);
    dummy.updateMatrix();
    canopyMainInst.setMatrixAt(idx, dummy.matrix);
    tintColor.setHex(paletteTints[idx % paletteTints.length]);
    canopyMainInst.setColorAt(idx, tintColor);

    const ox = Math.cos(idx * 2.1) * 0.36 * s;
    const oz = Math.sin(idx * 2.1) * 0.32 * s;
    dummy.position.set(t.x + ox, 2.34 * s, t.z + oz);
    dummy.rotation.set(0, idx * 0.7, 0);
    dummy.scale.set(s * 0.9, s * 0.8, s * 0.9);
    dummy.updateMatrix();
    canopyCrownInst.setMatrixAt(idx, dummy.matrix);
    tintColor.setHex(paletteTints[(idx + 2) % paletteTints.length]);
    canopyCrownInst.setColorAt(idx, tintColor);
  });

  trunksInst.instanceMatrix.needsUpdate = true;
  canopyMainInst.instanceMatrix.needsUpdate = true;
  canopyCrownInst.instanceMatrix.needsUpdate = true;
  if (canopyMainInst.instanceColor) canopyMainInst.instanceColor.needsUpdate = true;
  if (canopyCrownInst.instanceColor) canopyCrownInst.instanceColor.needsUpdate = true;
  trunksInst.computeBoundingSphere();
  canopyMainInst.computeBoundingSphere();
  canopyCrownInst.computeBoundingSphere();
  root.add(trunksInst, canopyMainInst, canopyCrownInst);

  // =========================================================================
  // 5. ALL 5 SINGLE-PIECE EXTRUDED BUILDINGS & 25 CANONICAL CLASSROOMS
  // =========================================================================
  const buildings = new Map<BuildingName, BuildingRenderHandle>();
  const rooms = new Map<string, RoomRenderHandle>();
  const hitTargets: THREE.Object3D[] = [];
  const buildingHitTargets: THREE.Object3D[] = [];
  const energyFlowGroup = new THREE.Group();
  energyFlowGroup.name = 'ConceptualEnergyFlows';
  energyFlowGroup.visible = false;
  const flowMaterials: THREE.ShaderMaterial[] = [];

  const deskGeo = trackGeo(new THREE.BoxGeometry(0.56, 0.3, 0.34));
  const labBenchGeo = trackGeo(new THREE.BoxGeometry(0.96, 0.38, 0.48));
  const roundTableGeo = trackGeo(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12));
  const bookshelfGeo = trackGeo(new THREE.BoxGeometry(0.24, 0.86, 1.2));
  const fanStemGeo = trackGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 6));
  const fanHubGeo = trackGeo(new THREE.CylinderGeometry(0.07, 0.07, 0.045, 8));
  const fanBladeGeo = trackGeo(new THREE.BoxGeometry(0.56, 0.016, 0.07));

  for (const bSpec of CAMPUS_BUILDINGS_SCHEMA) {
    const bGroup = new THREE.Group();
    bGroup.name = `Building_${bSpec.id}`;
    bGroup.position.set(bSpec.worldX, 0, bSpec.worldZ);
    bGroup.rotation.y = bSpec.rotationY;
    root.add(bGroup);

    const facadeColor = getBuildingFacadeColor(bSpec.architecturalStyle);
    const outerCcw = toCcwShapePts(bSpec.footprintPts);
    const plinthOuterCcw = offsetCcwPolygon(outerCcw, -0.14);
    const wallInnerCcw = offsetCcwPolygon(outerCcw, 0.16);
    const glassOuterCcw = offsetCcwPolygon(outerCcw, 0.05);
    const glassInnerCcw = offsetCcwPolygon(outerCcw, 0.11);
    const parapetInnerCcw = offsetCcwPolygon(outerCcw, 0.2);

    // Unified single-piece masonry plinth (y = 0.00 .. 0.28) — zero wing overlap!
    const plinthMesh = new THREE.Mesh(
      trackGeo(createSolidExtrudeGeo(plinthOuterCcw, 0.28)),
      shared.plinthBase
    );
    plinthMesh.position.y = 0;
    plinthMesh.castShadow = enableShadows;
    plinthMesh.receiveShadow = enableShadows;
    bGroup.add(plinthMesh);

    const floorHandles: FloorRenderHandle[] = [];

    for (const fSpec of bSpec.floors) {
      const fGroup = new THREE.Group();
      fGroup.name = `${bSpec.id}_${fSpec.floor}`;
      fGroup.position.y = fSpec.baseY;
      bGroup.add(fGroup);

      const floorSlabMat = trackMat(
        new THREE.MeshStandardMaterial({
          color: ARCHITECTURAL_PALETTE.slabTop,
          roughness: 0.86,
          metalness: 0.03,
          transparent: true,
          opacity: 1,
        })
      );
      const floorEdgeMat = trackMat(
        new THREE.MeshStandardMaterial({
          color:
            bSpec.architecturalStyle === 'ob-heritage'
              ? ARCHITECTURAL_PALETTE.heritageCornice
              : ARCHITECTURAL_PALETTE.slabEdge,
          roughness: 0.74,
          metalness: 0.05,
          transparent: true,
          opacity: 1,
        })
      );
      const exteriorFacadeMat = trackMat(
        new THREE.MeshStandardMaterial({
          color: facadeColor,
          roughness: 0.84,
          metalness: 0.03,
          transparent: true,
          opacity: 1,
        })
      );
      const glazingMat = trackMat(
        new THREE.MeshStandardMaterial({
          color: ARCHITECTURAL_PALETTE.windowGlass,
          roughness: 0.18,
          metalness: 0.28,
          transparent: true,
          opacity: 0.82,
          depthWrite: true,
        })
      );

      const slabH = 0.18;
      const clearH = fSpec.storeyHeight - slabH;

      // MPH gets high double-height clerestory windows; standard blocks get balanced academic bays
      const sillFrac = bSpec.architecturalStyle === 'mph-extension' ? 0.56 : 0.34;
      const headerFrac = bSpec.architecturalStyle === 'mph-extension' ? 0.14 : 0.22;
      const sillH = clearH * sillFrac;
      const headerH = clearH * headerFrac;
      const winH = Math.max(0.42, clearH - sillH - headerH);

      // 1. Unified Floor Slab (y = 0 .. slabH) — slightly projecting concrete floor band
      const slabBandOuter = offsetCcwPolygon(outerCcw, -0.04);
      const slabMesh = new THREE.Mesh(
        trackGeo(createSolidExtrudeGeo(slabBandOuter, slabH)),
        [floorSlabMat, floorEdgeMat]
      );
      slabMesh.position.y = 0;
      slabMesh.castShadow = enableShadows;
      slabMesh.receiveShadow = enableShadows;
      fGroup.add(slabMesh);

      // 2. Unified Perimeter Sill Wall Band (y = slabH .. slabH + sillH)
      const sillMesh = new THREE.Mesh(
        trackGeo(createRingExtrudeGeo(outerCcw, wallInnerCcw, sillH)),
        exteriorFacadeMat
      );
      sillMesh.position.y = slabH;
      sillMesh.castShadow = enableShadows;
      sillMesh.receiveShadow = enableShadows;
      fGroup.add(sillMesh);

      // 3. Unified Recessed Window Glazing Band (inset 0.05 inside wall face — zero Z-fighting!)
      const glassMesh = new THREE.Mesh(
        trackGeo(createRingExtrudeGeo(glassOuterCcw, glassInnerCcw, winH)),
        glazingMat
      );
      glassMesh.position.y = slabH + sillH;
      fGroup.add(glassMesh);

      // 4. Unified Perimeter Header/Lintel Wall Band (y = slabH + sillH + winH .. storeyHeight)
      const headerMesh = new THREE.Mesh(
        trackGeo(createRingExtrudeGeo(outerCcw, wallInnerCcw, headerH)),
        exteriorFacadeMat
      );
      headerMesh.position.y = slabH + sillH + winH;
      headerMesh.castShadow = enableShadows;
      headerMesh.receiveShadow = enableShadows;
      fGroup.add(headerMesh);

      // 5. Restrained architectural vertical piers along long facade segments (clean rhythm, zero clutter)
      addCleanFacadePiers(
        fGroup,
        outerCcw,
        slabH + sillH,
        winH,
        exteriorFacadeMat,
        shared.mullion,
        trackGeo,
        enableShadows
      );

      // 6. Individual Canonical Classrooms cleanly nested inside the building footprint
      const roomHandles: RoomRenderHandle[] = [];
      for (const rSpec of fSpec.rooms) {
        const roomHandle = buildClassroomModule(
          fGroup,
          rSpec,
          slabH,
          shared,
          {
            deskGeo,
            labBenchGeo,
            roundTableGeo,
            bookshelfGeo,
            fanStemGeo,
            fanHubGeo,
            fanBladeGeo,
          },
          trackGeo,
          trackMat,
          enableShadows
        );
        roomHandles.push(roomHandle);
        rooms.set(rSpec.roomId, roomHandle);
        hitTargets.push(roomHandle.hitMesh);
      }

      floorHandles.push({
        building: bSpec.id,
        floor: fSpec.floor,
        floorIndex: fSpec.floorIndex,
        baseY: fSpec.baseY,
        group: fGroup,
        shellMaterials: [exteriorFacadeMat, glazingMat],
        slabMaterials: [floorSlabMat, floorEdgeMat],
        rooms: roomHandles,
        currentY: fSpec.baseY,
        targetY: fSpec.baseY,
      });
    }

    // Unified Single-Piece Architectural Roof Deck + Parapet Rim (zero wing overlap!)
    const topFloor = bSpec.floors[bSpec.floors.length - 1];
    const roofBaseY = topFloor.baseY + topFloor.storeyHeight;
    const roofGroup = new THREE.Group();
    roofGroup.name = `${bSpec.id}_Roof`;
    roofGroup.position.y = roofBaseY;
    bGroup.add(roofGroup);

    const roofMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: ARCHITECTURAL_PALETTE.roofMembrane,
        roughness: 0.88,
        metalness: 0.04,
        transparent: true,
        opacity: 1,
      })
    );
    const roofCopingMat = trackMat(
      new THREE.MeshStandardMaterial({
        color:
          bSpec.architecturalStyle === 'ob-heritage'
            ? ARCHITECTURAL_PALETTE.heritageCornice
            : ARCHITECTURAL_PALETTE.roofCoping,
        roughness: 0.74,
        metalness: 0.06,
        transparent: true,
        opacity: 1,
      })
    );

    const roofDeckGeo = trackGeo(createSolidExtrudeGeo(outerCcw, 0.14));
    const roofDeck = new THREE.Mesh(roofDeckGeo, [roofMat, roofCopingMat]);
    roofDeck.position.y = 0;
    roofDeck.castShadow = enableShadows;
    roofDeck.receiveShadow = enableShadows;
    roofGroup.add(roofDeck);

    const parapetH = bSpec.architecturalStyle === 'mph-extension' ? 0.42 : 0.38;
    const parapetMesh = new THREE.Mesh(
      trackGeo(createRingExtrudeGeo(outerCcw, parapetInnerCcw, parapetH)),
      roofCopingMat
    );
    parapetMesh.position.y = 0.14;
    parapetMesh.castShadow = enableShadows;
    parapetMesh.receiveShadow = enableShadows;
    roofGroup.add(parapetMesh);

    // Subtle stairwell mumty strictly on G+3 Block for architectural authenticity
    if (bSpec.architecturalStyle === 'g3-notched') {
      const mumty = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.9, 1.35, 1.7)), roofCopingMat);
      mumty.position.set(-1.6, 0.14 + 0.675, -1.9);
      mumty.castShadow = enableShadows;
      roofGroup.add(mumty);
    }

    // Building-level clickable roof proxy using the exact unified footprint
    const bHit = new THREE.Mesh(
      trackGeo(createSolidExtrudeGeo(outerCcw, 0.52)),
      trackMat(new THREE.MeshBasicMaterial({ visible: false }))
    );
    bHit.position.y = 0.02;
    bHit.userData = {
      kind: 'building',
      building: bSpec.id,
    };
    roofGroup.add(bHit);
    buildingHitTargets.push(bHit);

    // Exact polygon perimeter selection halo (emerald mint when building is focused)
    const haloOuter = offsetCcwPolygon(outerCcw, -0.32);
    const haloGeo = trackGeo(new THREE.EdgesGeometry(createSolidExtrudeGeo(haloOuter, 0.12)));
    const selectionHalo = new THREE.LineSegments(haloGeo, shared.selectionOutline);
    selectionHalo.position.y = 0.08;
    selectionHalo.visible = false;
    bGroup.add(selectionHalo);

    // Conceptual Energy-Flow Filaments
    const feederFlowMat = trackMat(createEnergyFlowShaderMaterial(0x16654c, 0x34d399));
    const riserFlowMat = trackMat(createEnergyFlowShaderMaterial(0x145a44, 0x6ee7b7));
    flowMaterials.push(feederFlowMat, riserFlowMat);

    const p0 = new THREE.Vector3(...CAMPUS_FEEDER_WORLD_POS);
    const pMid = new THREE.Vector3(
      (CAMPUS_FEEDER_WORLD_POS[0] + bSpec.riserWorldPos[0]) * 0.5,
      0.2,
      (CAMPUS_FEEDER_WORLD_POS[2] + bSpec.riserWorldPos[2]) * 0.5
    );
    const pRiserBase = new THREE.Vector3(bSpec.riserWorldPos[0], 0.2, bSpec.riserWorldPos[2]);
    const feederCurve = new THREE.CatmullRomCurve3([p0, pMid, pRiserBase]);
    const feederTube = new THREE.Mesh(
      trackGeo(new THREE.TubeGeometry(feederCurve, 24, 0.06, 6, false)),
      feederFlowMat
    );
    energyFlowGroup.add(feederTube);

    const riserTopY = Math.max(1.4, roofBaseY - 0.45);
    const riserCurve = new THREE.CatmullRomCurve3([
      pRiserBase,
      new THREE.Vector3(bSpec.riserWorldPos[0], riserTopY * 0.5, bSpec.riserWorldPos[2]),
      new THREE.Vector3(bSpec.riserWorldPos[0], riserTopY, bSpec.riserWorldPos[2]),
    ]);
    const riserTube = new THREE.Mesh(
      trackGeo(new THREE.TubeGeometry(riserCurve, 14, 0.048, 6, false)),
      riserFlowMat
    );
    energyFlowGroup.add(riserTube);

    const cosB = Math.cos(bSpec.rotationY);
    const sinB = Math.sin(bSpec.rotationY);
    for (const fSpec of bSpec.floors) {
      const fy = fSpec.baseY + 0.35;
      for (const rSpec of fSpec.rooms) {
        const startPt = new THREE.Vector3(bSpec.riserWorldPos[0], fy, bSpec.riserWorldPos[2]);
        const endX = bSpec.worldX + rSpec.localX * cosB + rSpec.localZ * sinB;
        const endZ = bSpec.worldZ - rSpec.localX * sinB + rSpec.localZ * cosB;
        const endPt = new THREE.Vector3(endX, fy, endZ);
        const midPt = startPt.clone().lerp(endPt, 0.5);
        midPt.y = fy + 0.05;
        const branchCurve = new THREE.CatmullRomCurve3([startPt, midPt, endPt]);
        const branchMesh = new THREE.Mesh(
          trackGeo(new THREE.TubeGeometry(branchCurve, 10, 0.026, 5, false)),
          riserFlowMat
        );
        energyFlowGroup.add(branchMesh);
      }
    }

    buildings.set(bSpec.id, {
      id: bSpec.id,
      spec: bSpec,
      group: bGroup,
      roofGroup,
      roofBaseY,
      roofCurrentY: roofBaseY,
      roofTargetY: roofBaseY,
      roofMaterials: [roofMat, roofCopingMat],
      selectionHalo,
      floors: floorHandles,
      feederFlowMat,
      riserFlowMat,
    });
  }

  root.add(energyFlowGroup);

  return {
    root,
    buildings,
    rooms,
    hitTargets,
    buildingHitTargets,
    energyFlowGroup,
    flowMaterials,
    dispose: () => {
      shared.dispose();
      for (const g of ownedGeometries) g.dispose();
      for (const m of ownedMaterials) m.dispose();
      for (const t of ownedTextures) t.dispose();
    },
  };
}

// =============================================================================
// ARCHITECTURAL SUB-BUILDERS (ZERO OVERLAP / ZERO CLIPPING)
// =============================================================================

/**
 * Builds the physical covered connecting corridor linking NB's North-Central Arm
 * eastern knuckle cleanly into OB's southwestern flank (matching the vector outline).
 */
function buildObNbConnectingCorridor(
  root: THREE.Group,
  shared: SharedSceneMaterials,
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T,
  trackMat: <T extends THREE.Material>(m: T) => T,
  enableShadows: boolean
) {
  const { startWorld, endWorld, width, height } = OB_NB_CONNECTOR_SPEC;
  const dx = endWorld[0] - startWorld[0];
  const dz = endWorld[1] - startWorld[1];
  const len = Math.hypot(dx, dz);
  const midX = (startWorld[0] + endWorld[0]) / 2;
  const midZ = (startWorld[1] + endWorld[1]) / 2;
  const rotY = Math.atan2(-dz, dx);

  const g = new THREE.Group();
  g.name = 'OB_NB_ConnectingCorridor';
  g.position.set(midX, 0, midZ);
  g.rotation.y = rotY;

  const wallMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: ARCHITECTURAL_PALETTE.connectorWall,
      roughness: 0.84,
      metalness: 0.03,
    })
  );
  const roofMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: ARCHITECTURAL_PALETTE.roofCoping,
      roughness: 0.78,
      metalness: 0.05,
    })
  );
  const glassMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: ARCHITECTURAL_PALETTE.windowGlass,
      roughness: 0.18,
      metalness: 0.28,
      transparent: true,
      opacity: 0.78,
    })
  );

  // Trim ends slightly by 0.12 so corridor abuts NB & OB exterior shells cleanly without Z-fighting
  const spanLen = Math.max(1.2, len - 0.12);

  // Plinth base
  const plinth = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(spanLen, 0.28, width + 0.16)),
    shared.plinthBase
  );
  plinth.position.y = 0.14;
  plinth.receiveShadow = enableShadows;
  g.add(plinth);

  // Two clean storeys matching OB & NB floor rhythms
  const floorH = (height - 0.28) / 2;
  for (let f = 0; f < 2; f++) {
    const baseY = 0.28 + f * floorH;
    // Floor slab
    const slab = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(spanLen, 0.16, width + 0.06)),
      roofMat
    );
    slab.position.y = baseY + 0.08;
    slab.castShadow = enableShadows;
    slab.receiveShadow = enableShadows;
    g.add(slab);

    // Side parapet + recessed corridor glazing on both N and S flanks
    const sideClear = floorH - 0.16;
    const sillH = sideClear * 0.36;
    const winH = sideClear * 0.44;
    const headH = sideClear - sillH - winH;

    for (const side of [-1, 1]) {
      const zFace = side * (width / 2 - 0.08);
      const sill = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(spanLen, sillH, 0.14)),
        wallMat
      );
      sill.position.set(0, baseY + 0.16 + sillH / 2, zFace);
      sill.castShadow = enableShadows;
      g.add(sill);

      const glass = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(spanLen - 0.16, winH, 0.06)),
        glassMat
      );
      glass.position.set(0, baseY + 0.16 + sillH + winH / 2, zFace - side * 0.02);
      g.add(glass);

      const head = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(spanLen, headH, 0.14)),
        wallMat
      );
      head.position.set(0, baseY + 0.16 + sillH + winH + headH / 2, zFace);
      head.castShadow = enableShadows;
      g.add(head);
    }
  }

  // Flat roof slab with parapet lip
  const topRoof = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(spanLen, 0.24, width + 0.08)),
    roofMat
  );
  topRoof.position.y = height + 0.12;
  topRoof.castShadow = enableShadows;
  topRoof.receiveShadow = enableShadows;
  g.add(topRoof);

  root.add(g);
}

/**
 * Adds restrained vertical masonry piers strictly along straight exterior segments > 2.6 units
 * so glazing ribbons read as crisp institutional window bays without busy visual clutter.
 */
function addCleanFacadePiers(
  fGroup: THREE.Group,
  outerCcw: Vec2[],
  winBaseY: number,
  winH: number,
  facadeMat: THREE.MeshStandardMaterial,
  mullionMat: THREE.MeshStandardMaterial,
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T,
  enableShadows: boolean
) {
  const pierGeo = trackGeo(new THREE.BoxGeometry(0.18, winH + 0.02, 0.14));
  const mulGeo = trackGeo(new THREE.BoxGeometry(0.06, winH, 0.08));
  const n = outerCcw.length;

  for (let i = 0; i < n; i++) {
    const p0 = outerCcw[i];
    const p1 = outerCcw[(i + 1) % n];
    const ex = p1[0] - p0[0];
    const ey = p1[1] - p0[1];
    const len = Math.hypot(ex, ey);
    if (len < 2.2) continue;

    // Edge direction in XZ: (ex, -ey)
    const dirX = ex / len;
    const dirZ = -ey / len;
    const rotY = Math.atan2(-dirZ, dirX);

    // Inward normal in XZ: (-ey/len, -ex/len)
    const inX = -ey / len;
    const inZ = -ex / len;

    const bays = Math.max(2, Math.round(len / 2.6));
    for (let b = 1; b < bays; b++) {
      const t = b / bays;
      const sx = p0[0] + ex * t;
      const sy = p0[1] + ey * t;
      const isMajor = b % 2 === 0;
      const inset = isMajor ? 0.07 : 0.08;
      const mesh = new THREE.Mesh(isMajor ? pierGeo : mulGeo, isMajor ? facadeMat : mullionMat);
      mesh.position.set(sx + inX * inset, winBaseY + winH / 2, -sy + inZ * inset);
      mesh.rotation.y = rotY;
      if (isMajor) mesh.castShadow = enableShadows;
      fGroup.add(mesh);
    }
  }
}

/**
 * Builds an individual canonical classroom module neatly nested inside its building.
 * Interior geometry lives in `interiorGroup` so assembled Model mode keeps facades crisp
 * with zero interior bleed, while Cutaway / Explode / Floor / Heatmap modes reveal full rooms.
 */
function buildClassroomModule(
  floorGroup: THREE.Group,
  spec: RoomGeometrySpec,
  slabThickness: number,
  shared: SharedSceneMaterials,
  geoms: {
    deskGeo: THREE.BufferGeometry;
    labBenchGeo: THREE.BufferGeometry;
    roundTableGeo: THREE.BufferGeometry;
    bookshelfGeo: THREE.BufferGeometry;
    fanStemGeo: THREE.BufferGeometry;
    fanHubGeo: THREE.BufferGeometry;
    fanBladeGeo: THREE.BufferGeometry;
  },
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T,
  trackMat: <T extends THREE.Material>(m: T) => T,
  enableShadows: boolean
): RoomRenderHandle {
  const roomGroup = new THREE.Group();
  roomGroup.name = `Room_${spec.roomCode}`;
  roomGroup.position.set(spec.localX, slabThickness, spec.localZ);
  if (spec.localRotationY) {
    roomGroup.rotation.y = spec.localRotationY;
  }
  floorGroup.add(roomGroup);

  const interiorGroup = new THREE.Group();
  interiorGroup.name = `Interior_${spec.roomCode}`;
  interiorGroup.visible = false; // Revealed smoothly in Cutaway, Explode, Floor Filter, or Heatmap
  roomGroup.add(interiorGroup);

  const clearH = spec.height - slabThickness - 0.14;
  const w = spec.width;
  const d = spec.depth;

  const wallMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: ARCHITECTURAL_PALETTE.offInteriorWall,
      roughness: 0.86,
      metalness: 0.02,
      transparent: true,
      opacity: 1,
    })
  );
  const floorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: ARCHITECTURAL_PALETTE.offInteriorFloor,
      roughness: 0.84,
      metalness: 0.03,
      transparent: true,
      opacity: 1,
    })
  );
  const luminaireMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: ARCHITECTURAL_PALETTE.offLuminaire,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0,
      roughness: 0.32,
      metalness: 0.12,
    })
  );
  const glassMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: ARCHITECTURAL_PALETTE.windowGlass,
      roughness: 0.16,
      metalness: 0.24,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
    })
  );

  // Illuminated classroom interior floor plate
  const floorTile = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(w - 0.12, 0.05, d - 0.12)),
    floorMat
  );
  floorTile.position.y = 0.035;
  floorTile.receiveShadow = enableShadows;
  interiorGroup.add(floorTile);

  // Low-profile interior partition walls
  const partH = Math.min(clearH * 0.72, 1.55);
  const pThick = 0.08;
  const leftWall = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(pThick, partH, d - 0.14)),
    wallMat
  );
  leftWall.position.set(-w / 2 + 0.06, partH / 2 + 0.06, 0);
  interiorGroup.add(leftWall);

  const rightWall = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(pThick, partH, d - 0.14)),
    wallMat
  );
  rightWall.position.set(w / 2 - 0.06, partH / 2 + 0.06, 0);
  interiorGroup.add(rightWall);

  const backSign = spec.corridorSide === 'south' ? -1 : 1;
  const backWall = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(w - 0.16, partH, pThick)),
    wallMat
  );
  backWall.position.set(0, partH / 2 + 0.06, backSign * (d / 2 - 0.06));
  interiorGroup.add(backWall);

  // Restrained interior desks / benches / auditorium stage
  populateRoomInterior(interiorGroup, spec, w, d, shared, geoms, trackGeo);

  // Overhead LED luminaires & ceiling fans
  const ceilY = clearH - 0.08;
  const fanBlades: THREE.Object3D[] = [];
  const lampCount = w > 5.0 ? 3 : 2;
  const lampGeo = trackGeo(new THREE.BoxGeometry(Math.min(1.05, w / (lampCount + 1.2)), 0.05, 0.18));

  for (let i = 0; i < lampCount; i++) {
    const lx = -w * 0.28 + (i / (lampCount - 1)) * w * 0.56;
    const lamp = new THREE.Mesh(lampGeo, luminaireMat);
    lamp.position.set(lx, ceilY, 0);
    interiorGroup.add(lamp);
  }

  const fanCount = w > 5.5 ? 2 : 1;
  for (let f = 0; f < fanCount; f++) {
    const fx = fanCount === 1 ? 0 : f === 0 ? -w * 0.2 : w * 0.2;
    const fanGroup = new THREE.Group();
    fanGroup.position.set(fx, ceilY - 0.12, 0);

    const stem = new THREE.Mesh(geoms.fanStemGeo, shared.mullion);
    stem.position.y = 0.08;
    fanGroup.add(stem);

    const spinner = new THREE.Group();
    const hub = new THREE.Mesh(geoms.fanHubGeo, shared.mullion);
    spinner.add(hub);

    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(geoms.fanBladeGeo, shared.concreteColumn);
      const angle = (b * Math.PI * 2) / 3;
      blade.rotation.y = angle;
      blade.position.set(Math.cos(angle) * 0.28, 0, -Math.sin(angle) * 0.28);
      spinner.add(blade);
    }

    fanGroup.add(spinner);
    interiorGroup.add(fanGroup);
    fanBlades.push(spinner);
  }

  // Always-pickable invisible raycast volume (kept active even when interiorGroup is hidden!)
  const hitMesh = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(w, clearH, d)),
    trackMat(new THREE.MeshBasicMaterial({ visible: false }))
  );
  hitMesh.position.y = clearH / 2;
  hitMesh.userData = {
    roomId: spec.roomId,
    roomCode: spec.roomCode,
    building: spec.building,
    floor: spec.floor,
  };
  roomGroup.add(hitMesh);

  // Restrained selection & hover frames
  const frameGeo = trackGeo(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.08, clearH + 0.06, d + 0.08))
  );
  const selectionFrame = new THREE.LineSegments(frameGeo, shared.selectionOutline);
  selectionFrame.position.y = clearH / 2;
  selectionFrame.visible = false;
  roomGroup.add(selectionFrame);

  const hoverFrame = new THREE.LineSegments(frameGeo, shared.hoverOutline);
  hoverFrame.position.y = clearH / 2;
  hoverFrame.visible = false;
  roomGroup.add(hoverFrame);

  return {
    roomId: spec.roomId,
    roomCode: spec.roomCode,
    building: spec.building,
    floor: spec.floor,
    floorIndex: spec.floorIndex,
    group: roomGroup,
    interiorGroup,
    hitMesh,
    wallMat,
    floorMat,
    luminaireMat,
    glassMat,
    selectionFrame,
    hoverFrame,
    fanBlades,
    currentGlow: 0,
    targetGlow: 0,
    currentWallColor: new THREE.Color(ARCHITECTURAL_PALETTE.offInteriorWall),
    targetWallColor: new THREE.Color(ARCHITECTURAL_PALETTE.offInteriorWall),
    currentFloorColor: new THREE.Color(ARCHITECTURAL_PALETTE.offInteriorFloor),
    targetFloorColor: new THREE.Color(ARCHITECTURAL_PALETTE.offInteriorFloor),
    currentLuminaireColor: new THREE.Color(ARCHITECTURAL_PALETTE.offLuminaire),
    targetLuminaireColor: new THREE.Color(ARCHITECTURAL_PALETTE.offLuminaire),
    currentLuminaireEmissive: new THREE.Color(0x000000),
    targetLuminaireEmissive: new THREE.Color(0x000000),
    currentFanSpeedRad: 0,
    targetFanSpeedRad: 0,
    worldAnchorLocal: new THREE.Vector3(spec.localX, slabThickness + clearH * 0.5, spec.localZ),
  };
}

function populateRoomInterior(
  interiorGroup: THREE.Group,
  spec: RoomGeometrySpec,
  w: number,
  d: number,
  shared: SharedSceneMaterials,
  geoms: {
    deskGeo: THREE.BufferGeometry;
    labBenchGeo: THREE.BufferGeometry;
    roundTableGeo: THREE.BufferGeometry;
    bookshelfGeo: THREE.BufferGeometry;
  },
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T
) {
  if (spec.interiorStyle === 'auditorium') {
    const stage = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(w * 0.72, 0.28, d * 0.26)),
      shared.timber
    );
    stage.position.set(0, 0.18, -d * 0.3);
    interiorGroup.add(stage);

    for (let r = 0; r < 3; r++) {
      const bench = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(w * 0.66, 0.24, 0.26)),
        shared.desk
      );
      bench.position.set(0, 0.16, -0.15 + r * 0.68);
      interiorGroup.add(bench);
    }
    return;
  }

  if (spec.interiorStyle === 'library') {
    const shelfCols = Math.max(2, Math.floor(w / 2.2));
    for (let i = 0; i < shelfCols; i++) {
      const sx = -w * 0.34 + (shelfCols === 1 ? 0 : (i / (shelfCols - 1)) * w * 0.68);
      const shelf = new THREE.Mesh(geoms.bookshelfGeo, shared.timber);
      shelf.position.set(sx, 0.48, -d * 0.22);
      interiorGroup.add(shelf);
    }
    return;
  }

  if (spec.interiorStyle === 'lab' || spec.interiorStyle === 'computer-lab') {
    const cols = Math.max(2, Math.floor(w / 1.8));
    for (let c = 0; c < cols; c++) {
      const bx = -w * 0.3 + (cols === 1 ? 0 : (c / (cols - 1)) * w * 0.6);
      const bench = new THREE.Mesh(geoms.labBenchGeo, shared.labTop);
      bench.position.set(bx, 0.24, 0);
      interiorGroup.add(bench);
    }
    return;
  }

  if (spec.interiorStyle === 'pre-primary') {
    const count = Math.max(2, Math.floor(w / 1.5));
    for (let i = 0; i < count; i++) {
      const tx = -w * 0.24 + (count === 1 ? 0 : (i / (count - 1)) * w * 0.48);
      const table = new THREE.Mesh(geoms.roundTableGeo, shared.desk);
      table.position.set(tx, 0.18, 0);
      interiorGroup.add(table);
    }
    return;
  }

  // Standard classroom / staff desks (compact grid strictly inside w × d)
  const cols = Math.max(2, Math.min(4, Math.floor((w - 0.8) / 1.1)));
  const rows = Math.max(1, Math.min(2, Math.floor((d - 0.9) / 1.0)));
  for (let c = 0; c < cols; c++) {
    const dx = -w * 0.3 + (cols === 1 ? 0 : (c / (cols - 1)) * w * 0.6);
    for (let r = 0; r < rows; r++) {
      const dz = rows === 1 ? 0 : -d * 0.18 + (r / (rows - 1)) * d * 0.36;
      const desk = new THREE.Mesh(geoms.deskGeo, shared.desk);
      desk.position.set(dx, 0.2, dz);
      interiorGroup.add(desk);
    }
  }
}
