import * as THREE from 'three'
import { applyExtensions, sharedUniforms } from '@/render/shaderExt'
import { getGradientMap } from '@/render/gradientMap'

/**
 * The traveller's cloth: cloak, lining, robe, capelet and scarf tail share one geometry and one
 * material, and all of their motion happens in the vertex shader, so posing the hero costs the
 * CPU a handful of uniform writes instead of a cloth simulation.
 *
 * Per vertex, in this order:
 *  1. flutter and wind: a travelling wave round and down the cloth, stronger at a run
 *  2. hang: everything below the layer's pivot is sheared back (speed) and sideways (turns) by
 *     an angle that grows toward the hem, so the cloth bends and trails instead of swinging as a board
 *  3. keep-out: the cloak never passes into the robe (which trails less) or through the arms and
 *     satchel, which are capsules posed by the CPU each frame
 *  4. drape: in world space, the lower cloth is moved so the hem lies on the ground under it plus a
 *     clearance, on whatever slope the hero stands; then nothing of the cloth is left under the
 *     ground (it is squashed onto it instead). The ground is a small polar height grid round the
 *     hero that Avatar fills each frame from the controller's own support function
 *     (sampleDrapeGround), never the terrain itself.
 * The shadow pass runs the same code (clothDepthMaterial), so the shadow drapes and sways too.
 * deformClothCPU below is the same maths in TypeScript for offline previews and checks: keep the
 * two in step.
 */

/**
 * Per-vertex cloth parameters: x = pivot height the layer hangs from, y = how far it trails
 * (multiplies the lag angles), z = how much it flutters, w = 1 where the layer keeps out of the
 * robe and the capsules (the cloak), 0 where it does not (the robe itself, the capelet).
 */
export const CLOTH_ATTR = 'aCloth'

/** Hang is measured as depth below the pivot over this length: the cloak's own drop, neck to hem. */
export const CLOTH_LEN = 1.5
/**
 * Cloth below DRAPE_TOP (bind height) is draped onto the ground, the weight fading out from
 * DRAPE_FULL up to it: the hems (bind heights 0.027-0.04) take the whole of it, so on the steepest
 * slopes they lie on the ground rather than a fraction of the drop above it.
 */
export const DRAPE_FULL = 0.05
export const DRAPE_TOP = 0.9
/**
 * The most the drape moves a vertex is DRAPE_REACH + DRAPE_GRADE x its horizontal distance from
 * the root. The grade is a little over the steepest walkable ground (MAX_SLOPE 1.9), so the hem
 * follows any slope the hero can stand on even where it trails a metre and more behind; past that
 * (a cliff, a drop beside a deck) it stops following rather than stretching down the face.
 */
export const DRAPE_REACH = 0.15
export const DRAPE_GRADE = 2.0
/**
 * The drape's ground grid: heights on DRAPE_ANGLES spokes (angle atan2(dz, dx), like the probe
 * ring) at these radii round the root, plus the root itself. The cloak's hem hangs at about
 * 0.5 m and the robe's at 0.3; trailing at a run, the back hem reaches about 1.5 m.
 */
export const DRAPE_ANGLES = 24
export const DRAPE_RADII = [0.3, 0.6, 1.0, 1.5] as const
/** Metres the hem keeps above the probed ground. */
export const DRAPE_CLEAR = 0.025
/** Capsules the cloak keeps out of: upper arms, forearms, the satchel and the lower staff. */
export const CLOTH_CAPS = 6

/**
 * The inner robe, which the cloak keeps out of. It hangs from the belt and trails a little, so the
 * cloak's keep-out follows the robe's own trailing centre rather than its bind pose.
 */
export const ROBE = {
  pivot: 1.0,
  trail: 0.35,
  /** depth (z) over width (x) of the robe's cross-section below the belt */
  zs: 0.88,
  /** how far outside the robe the cloak's keep-out holds it */
  gap: 0.035,
  /** robe radius at bind height y below the belt: 0.34 at the hem narrowing to 0.18 at the waist */
  radius: (y: number) => 0.34 - 0.16 * Math.pow(THREE.MathUtils.clamp((y - 0.03) / 0.97, 0, 1), 0.8),
}
const ROBE_RADIUS_GLSL = `0.34 - 0.16 * pow(clamp((y - 0.03) / 0.97, 0.0, 1.0), 0.8)`

export interface ClothUniforms {
  uClTime: { value: number }
  uClWind: { value: THREE.Vector2 }
  /** radians: x = hem trails back (+) or swings forward (-), y = hem swings toward +X (+) */
  uClLag: { value: THREE.Vector2 }
  /** 0..1 how hard the cloth flaps (running) */
  uClFlap: { value: number }
  /** 0..1 how far the hem opens out with speed */
  uClFlare: { value: number }
  /** flutter wave phase, radians, advanced by the pose faster with speed */
  uClPhase: { value: number }
  /** capsules in the cloth's own frame: A = (start, radius), B = (end, unused); see CLOTH_CAPS */
  uClCapA: { value: THREE.Vector4[] }
  uClCapB: { value: THREE.Vector4[] }
  /** world position of the avatar root */
  uClRoot: { value: THREE.Vector3 }
  /** per spoke, the ground heights at DRAPE_RADII (x..w), world y; see sampleDrapeGround */
  uClGrid: { value: THREE.Vector4[] }
  /** ground height at the root itself, world y */
  uClSupport: { value: number }
  /** 0..1 drape weight: 0 on the globe, afloat or in the air */
  uClDrape: { value: number }
  /** metres the hem keeps above the ground */
  uClClear: { value: number }
}

export function createClothUniforms(): ClothUniforms {
  return {
    uClTime: sharedUniforms.uTime,
    uClWind: sharedUniforms.uWind,
    uClLag: { value: new THREE.Vector2() },
    uClFlap: { value: 0 },
    uClFlare: { value: 0 },
    uClPhase: { value: 0 },
    // parked far below the figure until the pose writes them
    uClCapA: { value: Array.from({ length: CLOTH_CAPS }, () => new THREE.Vector4(0, -10, 0, 0)) },
    uClCapB: { value: Array.from({ length: CLOTH_CAPS }, () => new THREE.Vector4(0, -10, 0, 0)) },
    uClRoot: { value: new THREE.Vector3() },
    uClGrid: { value: Array.from({ length: DRAPE_ANGLES }, () => new THREE.Vector4()) },
    uClSupport: { value: 0 },
    uClDrape: { value: 0 },
    uClClear: { value: DRAPE_CLEAR },
  }
}

const [R1, R2, R3, R4] = DRAPE_RADII

function clothPars(): string {
  return `
attribute vec4 ${CLOTH_ATTR};
uniform float uClTime;
uniform vec2 uClWind;
uniform vec2 uClLag;
uniform float uClFlap;
uniform float uClFlare;
uniform float uClPhase;
uniform vec4 uClCapA[${CLOTH_CAPS}];
uniform vec4 uClCapB[${CLOTH_CAPS}];
uniform vec3 uClRoot;
uniform vec4 uClGrid[${DRAPE_ANGLES}];
uniform float uClSupport;
uniform float uClDrape;
uniform float uClClear;
#define CL_GRID_N ${DRAPE_ANGLES}
#define CL_GRID_NF ${DRAPE_ANGLES.toFixed(1)}
float clHangOf(float depth) { return pow(clamp(depth / ${CLOTH_LEN.toFixed(2)}, 0.0, 1.0), 1.2); }
float clRobeR(float y) { return ${ROBE_RADIUS_GLSL}; }
// ground height at world offset d from the root: linear between spokes, then along the spoke
// between the root and the grid radii (past the last radius it carries on along the last stretch)
float clGround(vec2 d) {
  float r = length(d);
  float f = mod(atan(d.y, d.x) * (CL_GRID_NF / 6.2831853) + CL_GRID_NF, CL_GRID_NF);
  int i0 = int(floor(f));
  float fa = f - float(i0);
  if (i0 >= CL_GRID_N) { i0 = 0; fa = 0.0; }
  int i1 = i0 + 1;
  if (i1 >= CL_GRID_N) i1 = 0;
  vec4 g = mix(uClGrid[i0], uClGrid[i1], fa);
  if (r < ${R1.toFixed(2)}) return mix(uClSupport, g.x, r / ${R1.toFixed(2)});
  if (r < ${R2.toFixed(2)}) return mix(g.x, g.y, (r - ${R1.toFixed(2)}) / ${(R2 - R1).toFixed(2)});
  if (r < ${R3.toFixed(2)}) return mix(g.y, g.z, (r - ${R2.toFixed(2)}) / ${(R3 - R2).toFixed(2)});
  return mix(g.z, g.w, min((r - ${R3.toFixed(2)}) / ${(R4 - R3).toFixed(2)}, 2.0));
}`
}

/** Runs right after three's begin_vertex, so everything downstream (shadows, weather, fog) sees it. */
const CLOTH_VERTEX = /* glsl */ `
{
  vec4 clA = ${CLOTH_ATTR};
  float clDepth = max(clA.x - position.y, 0.0);
  float clHang = clHangOf(clDepth);
  float clR = length(position.xz);
  vec2 clRad = clR > 1e-4 ? position.xz / clR : vec2(0.0, -1.0);
  vec2 clTan = vec2(clRad.y, -clRad.x);
  float clTh = atan(position.x, position.z);

  // 1. flutter, wind and flare (the wind is a world vector: bring it into the cloth's frame)
  float clW = clHang * clA.z;
  float clWave = sin(uClPhase - clDepth * 6.0 + clTh * 2.0);
  float clWave2 = sin(uClPhase * 0.73 + clDepth * 4.0 - clTh * 3.0 + 1.3);
  float clIdle = sin(uClTime * 1.3 + clTh * 3.0 + clDepth * 2.0);
  vec3 clWindL = transpose(mat3(modelMatrix)) * vec3(uClWind.x, 0.0, uClWind.y);
  float clGust = 0.7 + 0.3 * sin(uClTime * 1.9 + clTh);
  transformed.xz += clRad * ((uClFlap * 0.035 * clWave + 0.006 * clIdle) * clW + uClFlare * 0.12 * clHang * clR * clA.y);
  transformed.xz += clTan * (uClFlap * 0.025 * clWave2 * clW);
  transformed.xz += clWindL.xz * (0.018 * clGust * clW);
  transformed.y += uClFlap * 0.02 * clWave2 * clW;

  // 2. hang: shear about the pivot by an angle that grows toward the hem (keeps the cloth's length)
  float clAx = clamp(uClLag.x * clHang * clA.y, -1.2, 1.2);
  float clAz = clamp(uClLag.y * clHang * clA.y, -1.2, 1.2);
  transformed.z -= clDepth * sin(clAx);
  transformed.x += clDepth * sin(clAz);
  transformed.y += clDepth * ((1.0 - cos(clAx)) + (1.0 - cos(clAz)));

  // 3. keep-out: outside the robe (at its own trailed centre) and the arm/satchel capsules
  if (clA.w > 0.0 && transformed.y < ${ROBE.pivot.toFixed(2)}) {
    float clRd = ${ROBE.pivot.toFixed(2)} - transformed.y;
    float clRh = clHangOf(clRd) * ${ROBE.trail.toFixed(2)};
    vec2 clRc = vec2(clRd * sin(clamp(uClLag.y * clRh, -1.2, 1.2)), -clRd * sin(clamp(uClLag.x * clRh, -1.2, 1.2)));
    vec2 clQ = transformed.xz - clRc;
    clQ.y /= ${ROBE.zs.toFixed(3)};
    float clQl = length(clQ);
    float clRr = clRobeR(transformed.y) + ${ROBE.gap.toFixed(3)};
    if (clQl < clRr && clQl > 1e-4) {
      clQ *= clRr / clQl;
      clQ.y *= ${ROBE.zs.toFixed(3)};
      transformed.xz = mix(transformed.xz, clRc + clQ, clA.w);
    }
  }
  if (clA.w > 0.0) {
    for (int i = 0; i < ${CLOTH_CAPS}; i++) {
      vec3 clCa = uClCapA[i].xyz;
      vec3 clAb = uClCapB[i].xyz - clCa;
      float clCt = clamp(dot(transformed - clCa, clAb) / max(dot(clAb, clAb), 1e-6), 0.0, 1.0);
      vec3 clCc = clCa + clAb * clCt;
      vec3 clCd = transformed - clCc;
      float clCl = length(clCd);
      float clCr = uClCapA[i].w;
      if (clCl < clCr && clCl > 1e-4) transformed = mix(transformed, clCc + clCd * (clCr / clCl), clA.w);
    }
  }

  // 4. drape: the lower cloth sits on the ground plus its own height above the hem (flutter,
  //    trailing), within a reach that grows with the distance from the root; then, whatever its
  //    weight, no cloth stays under the ground: a trailing back on a steep slope is squashed onto
  //    it rather than buried. The grid is an upper envelope of the ground (see sampleDrapeGround),
  //    so the hem keeps its clearance over crests and domes too.
  if (uClDrape > 0.0) {
    float clDw = (1.0 - smoothstep(${DRAPE_FULL.toFixed(2)}, ${DRAPE_TOP.toFixed(2)}, position.y)) * uClDrape;
    vec3 clWp = (modelMatrix * vec4(transformed, 1.0)).xyz;
    vec2 clD = clWp.xz - uClRoot.xz;
    float clG = clGround(clD);
    float clLim = ${DRAPE_REACH.toFixed(2)} + ${DRAPE_GRADE.toFixed(2)} * length(clD);
    float clLift = max(uClClear, transformed.y);
    float clDy = clamp(clG + clLift - clWp.y, -clLim, clLim) * clDw;
    clDy = max(clDy, min(clG + uClClear - clWp.y, clLim) * uClDrape);
    // world +Y into the cloth's frame (the hero's transforms are rotations and translations)
    transformed += transpose(mat3(modelMatrix)) * vec3(0.0, clDy, 0.0);
  }
}`

function injectCloth(shader: THREE.WebGLProgramParametersWithUniforms, u: ClothUniforms) {
  Object.assign(shader.uniforms, u)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${clothPars()}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${CLOTH_VERTEX}`)
}

/**
 * The lit cloth material: the world's toon ramp with cloud shadows and weather (rain darkens it,
 * snow and ash settle on the shoulders and hood), plus the cloth motion, in one onBeforeCompile.
 * The cloth block is inserted right after begin_vertex, ahead of the extension's world-position
 * code, so cloud shadows and weather are read where the cloth actually is. Flat shading takes the
 * normals from the deformed surface, so the folds light correctly however the cloth has moved.
 */
export function clothMaterial(u: ClothUniforms): THREE.MeshToonMaterial {
  const m = applyExtensions(new THREE.MeshToonMaterial({ color: '#ffffff', vertexColors: true, gradientMap: getGradientMap() }), {
    cloudShadow: true,
    weather: true,
  })
  // three's toon shader supports FLAT_SHADED (WebGLPrograms reads it off any material); only the
  // typings leave it out of MeshToonMaterial
  Object.assign(m, { flatShading: true })
  const ext = m.onBeforeCompile.bind(m)
  const extKey = m.customProgramCacheKey()
  m.onBeforeCompile = (shader, renderer) => {
    ext(shader, renderer)
    injectCloth(shader, u)
  }
  m.customProgramCacheKey = () => `${extKey}:hero-cloth:${DRAPE_ANGLES}:${CLOTH_CAPS}`
  return m
}

/** Shadow-pass twin of clothMaterial (Mesh.customDepthMaterial), so the shadow follows the cloth. */
export function clothDepthMaterial(u: ClothUniforms): THREE.MeshDepthMaterial {
  // default packing, like the shadow map's own depth material
  const m = new THREE.MeshDepthMaterial()
  m.onBeforeCompile = (shader) => injectCloth(shader, u)
  m.customProgramCacheKey = () => `hero-cloth-depth:${DRAPE_ANGLES}:${CLOTH_CAPS}`
  return m
}

/** The rigid parts' material: the same toon ramp, cloud shadows and weather, vertex colours. */
export function heroMaterial(): THREE.MeshToonMaterial {
  return applyExtensions(new THREE.MeshToonMaterial({ color: '#ffffff', vertexColors: true, gradientMap: getGradientMap() }), {
    cloudShadow: true,
    weather: true,
  })
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
const hangOf = (depth: number) => Math.pow(Math.min(1, Math.max(0, depth / CLOTH_LEN)), 1.2)
const clampA = (a: number) => Math.min(1.2, Math.max(-1.2, a))

/**
 * CPU twin of CLOTH_VERTEX, for offline previews and checks (not called in the app): writes the
 * deformed cloth-local positions of `geo` into `out`. `model` is the cloth mesh's world matrix.
 */
export function deformClothCPU(geo: THREE.BufferGeometry, u: ClothUniforms, model: THREE.Matrix4, out: Float32Array): void {
  const pos = geo.attributes.position
  const cl = geo.attributes[CLOTH_ATTR]
  const e = model.elements
  const t = u.uClTime.value
  // world wind into the cloth frame: transpose of the rotation part
  const wlx = e[0] * u.uClWind.value.x + e[2] * u.uClWind.value.y
  const wlz = e[8] * u.uClWind.value.x + e[10] * u.uClWind.value.y
  const lag = u.uClLag.value
  const flap = u.uClFlap.value, flare = u.uClFlare.value, ph = u.uClPhase.value
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i)
    const ax = cl.getX(i), ay = cl.getY(i), az = cl.getZ(i), aw = cl.getW(i)
    let x = px, y = py, z = pz
    const depth = Math.max(ax - py, 0)
    const hang = hangOf(depth)
    const r = Math.hypot(px, pz)
    const rx = r > 1e-4 ? px / r : 0, rz = r > 1e-4 ? pz / r : -1
    const tx = rz, tz = -rx
    const th = Math.atan2(px, pz)
    const w = hang * az
    const wave = Math.sin(ph - depth * 6 + th * 2)
    const wave2 = Math.sin(ph * 0.73 + depth * 4 - th * 3 + 1.3)
    const idle = Math.sin(t * 1.3 + th * 3 + depth * 2)
    const gust = 0.7 + 0.3 * Math.sin(t * 1.9 + th)
    const radial = (flap * 0.035 * wave + 0.006 * idle) * w + flare * 0.12 * hang * r * ay
    x += rx * radial + tx * flap * 0.025 * wave2 * w + wlx * 0.018 * gust * w
    z += rz * radial + tz * flap * 0.025 * wave2 * w + wlz * 0.018 * gust * w
    y += flap * 0.02 * wave2 * w
    const aX = clampA(lag.x * hang * ay), aZ = clampA(lag.y * hang * ay)
    z -= depth * Math.sin(aX)
    x += depth * Math.sin(aZ)
    y += depth * (1 - Math.cos(aX) + (1 - Math.cos(aZ)))
    if (aw > 0 && y < ROBE.pivot) {
      const rd = ROBE.pivot - y
      const rh = hangOf(rd) * ROBE.trail
      const cx = rd * Math.sin(clampA(lag.y * rh)), cz = -rd * Math.sin(clampA(lag.x * rh))
      let qx = x - cx, qz = (z - cz) / ROBE.zs
      const ql = Math.hypot(qx, qz)
      const rr = ROBE.radius(y) + ROBE.gap
      if (ql < rr && ql > 1e-4) {
        qx *= rr / ql
        qz *= (rr / ql) * ROBE.zs
        x += (cx + qx - x) * aw
        z += (cz + qz - z) * aw
      }
    }
    if (aw > 0) {
      for (let k = 0; k < CLOTH_CAPS; k++) {
        const A = u.uClCapA.value[k], B = u.uClCapB.value[k]
        const abx = B.x - A.x, aby = B.y - A.y, abz = B.z - A.z
        const ab2 = Math.max(abx * abx + aby * aby + abz * abz, 1e-6)
        const ct = Math.min(1, Math.max(0, ((x - A.x) * abx + (y - A.y) * aby + (z - A.z) * abz) / ab2))
        const ccx = A.x + abx * ct, ccy = A.y + aby * ct, ccz = A.z + abz * ct
        const dx = x - ccx, dy = y - ccy, dz = z - ccz
        const dl = Math.hypot(dx, dy, dz)
        if (dl < A.w && dl > 1e-4) {
          const s = A.w / dl
          x += (ccx + dx * s - x) * aw
          y += (ccy + dy * s - y) * aw
          z += (ccz + dz * s - z) * aw
        }
      }
    }
    const drape = u.uClDrape.value
    if (drape > 0) {
      const dw = (1 - smooth(DRAPE_FULL, DRAPE_TOP, py)) * drape
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12]
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13]
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14]
      const dX = wx - u.uClRoot.value.x, dZ = wz - u.uClRoot.value.z
      const G = groundAt(u, dX, dZ)
      const lim = DRAPE_REACH + DRAPE_GRADE * Math.hypot(dX, dZ)
      const lift = Math.max(u.uClClear.value, y)
      let d = Math.min(lim, Math.max(-lim, G + lift - wy)) * dw
      d = Math.max(d, Math.min(G + u.uClClear.value - wy, lim) * drape)
      // world +Y into the cloth frame: the second row of the rotation (transpose)
      x += e[1] * d
      y += e[5] * d
      z += e[9] * d
    }
    out[i * 3] = x
    out[i * 3 + 1] = y
    out[i * 3 + 2] = z
  }
}

/** CPU twin of the shader's clGround. */
function groundAt(u: ClothUniforms, dX: number, dZ: number): number {
  const N = DRAPE_ANGLES
  const r = Math.hypot(dX, dZ)
  let f = (Math.atan2(dZ, dX) * N) / (Math.PI * 2) + N
  f = f - Math.floor(f / N) * N
  let i0 = Math.floor(f)
  let fa = f - i0
  if (i0 >= N) {
    i0 = 0
    fa = 0
  }
  const i1 = i0 + 1 >= N ? 0 : i0 + 1
  const A = u.uClGrid.value[i0], B = u.uClGrid.value[i1]
  const gx = A.x + (B.x - A.x) * fa, gy = A.y + (B.y - A.y) * fa
  const gz = A.z + (B.z - A.z) * fa, gw = A.w + (B.w - A.w) * fa
  const S = u.uClSupport.value
  if (r < R1) return S + (gx - S) * (r / R1)
  if (r < R2) return gx + (gy - gx) * ((r - R1) / (R2 - R1))
  if (r < R3) return gy + (gz - gy) * ((r - R2) / (R3 - R2))
  return gz + (gw - gz) * Math.min((r - R3) / (R4 - R3), 2)
}

// The sampling lattice: every grid cell split DRAPE_SUB ways round and out, so each cell is
// checked at the lattice points inside and along it besides its corners. Radii: the root, then
// DRAPE_SUB steps up to each grid radius.
const DRAPE_SUB = 3
const LAT_R: number[] = [0]
for (let j = 0; j < 4; j++) {
  const r0 = j === 0 ? 0 : DRAPE_RADII[j - 1]
  for (let k = 1; k <= DRAPE_SUB; k++) LAT_R.push(r0 + ((DRAPE_RADII[j] - r0) * k) / DRAPE_SUB)
}
const LAT_NR = LAT_R.length
const LAT_NA = DRAPE_ANGLES * DRAPE_SUB
const LAT_COS = Array.from({ length: LAT_NA }, (_, i) => Math.cos((i * Math.PI * 2) / LAT_NA))
const LAT_SIN = Array.from({ length: LAT_NA }, (_, i) => Math.sin((i * Math.PI * 2) / LAT_NA))
const LAT = new Float32Array(LAT_NA * LAT_NR)
const RAISE = new Float32Array(DRAPE_ANGLES * 4)

/**
 * Fill the drape's ground grid round (x, z) from `sample` (the controller's support function, so a
 * deck counts where the player could stand on it). The grid is interpolated linearly, and a straight
 * line across a crest, a dome or a terrain fold runs under the real ground there: so each cell is
 * sampled on a finer lattice as well, and where the real ground stands above the interpolation the
 * cell's corners are raised by the most it does. That makes the grid an upper envelope of the
 * ground, to within the lattice's own spacing, while on an even slope (where the interpolation is
 * exact) nothing is raised and the hem lies on it. About 900 support samples, a few hundredths of
 * a millisecond.
 */
export function sampleDrapeGround(u: ClothUniforms, sample: (x: number, z: number) => number, x: number, z: number): void {
  const NR = LAT_NR, SUB = DRAPE_SUB
  const s0 = sample(x, z)
  for (let a = 0; a < LAT_NA; a++) {
    LAT[a * NR] = s0
    for (let r = 1; r < NR; r++) LAT[a * NR + r] = sample(x + LAT_R[r] * LAT_COS[a], z + LAT_R[r] * LAT_SIN[a])
  }
  RAISE.fill(0)
  let raise0 = 0
  for (let k = 0; k < DRAPE_ANGLES; k++) {
    const k1 = k + 1 < DRAPE_ANGLES ? k + 1 : 0
    const a0 = SUB * k * NR, a1 = SUB * k1 * NR
    for (let j = 1; j <= 4; j++) {
      const lo = SUB * (j - 1)
      const c00 = LAT[a0 + lo], c10 = LAT[a1 + lo], c01 = LAT[a0 + lo + SUB], c11 = LAT[a1 + lo + SUB]
      let e = 0
      for (let da = 0; da <= SUB; da++) {
        const fa = da / SUB
        const a = (SUB * k + da) % LAT_NA
        const in0 = c00 + (c10 - c00) * fa, in1 = c01 + (c11 - c01) * fa
        for (let dr = 0; dr <= SUB; dr++) {
          const d = LAT[a * NR + lo + dr] - (in0 + ((in1 - in0) * dr) / SUB)
          if (d > e) e = d
        }
      }
      if (e <= 0) continue
      if (j === 1) raise0 = Math.max(raise0, e)
      else {
        RAISE[k * 4 + j - 2] = Math.max(RAISE[k * 4 + j - 2], e)
        RAISE[k1 * 4 + j - 2] = Math.max(RAISE[k1 * 4 + j - 2], e)
      }
      RAISE[k * 4 + j - 1] = Math.max(RAISE[k * 4 + j - 1], e)
      RAISE[k1 * 4 + j - 1] = Math.max(RAISE[k1 * 4 + j - 1], e)
    }
  }
  for (let k = 0; k < DRAPE_ANGLES; k++) {
    const a = SUB * k * NR
    u.uClGrid.value[k].set(LAT[a + SUB] + RAISE[k * 4], LAT[a + 2 * SUB] + RAISE[k * 4 + 1], LAT[a + 3 * SUB] + RAISE[k * 4 + 2], LAT[a + 4 * SUB] + RAISE[k * 4 + 3])
  }
  u.uClSupport.value = s0 + raise0
  u.uClRoot.value.x = x
  u.uClRoot.value.z = z
}
