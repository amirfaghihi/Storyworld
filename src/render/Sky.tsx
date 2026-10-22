import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'

const vert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`
const frag = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uGlowColor;
  uniform vec3 uMoonDir;
  uniform float uGlow;
  uniform float uStars;
  uniform float uSunUp;
  uniform float uTime;
  varying vec3 vDir;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  /**
   * One star per cell of a direction lattice. The disc is measured as the star's lateral offset
   * from the view ray *in lattice units*: a near-zero angle loses all precision in a float,
   * while this stays in the 0..1 range where floats are exact.
   */
  float starField(vec3 d) {
    vec3 cell = floor(d * 60.0);
    float h = hash31(cell);
    if (h < 0.88) return 0.0;
    vec3 off = vec3(hash31(cell + 1.7), hash31(cell + 9.3), hash31(cell + 4.1)) - 0.5;
    vec3 star = cell + 0.5 + off * 0.8;
    float dist = length(star - d * dot(star, d));
    float mag = (h - 0.88) / 0.12;
    float twinkle = 0.7 + 0.3 * sin(uTime * 2.2 + h * 90.0);
    return smoothstep(0.30, 0.03, dist) * (0.35 + mag * 0.75) * twinkle;
  }

  void main() {
    float h = clamp(vDir.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));

    // stars fade in above the horizon as the sun goes down
    if (uStars > 0.001 && vDir.y > -0.05) {
      col += vec3(0.85, 0.9, 1.0) * starField(vDir) * uStars * smoothstep(-0.05, 0.18, vDir.y);
    }

    // dawn / dusk band: strongest at the horizon, on the sun's side of the sky
    vec3 flatDir = normalize(vec3(vDir.x, 0.0, vDir.z) + 1e-5);
    vec3 flatSun = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-5);
    float az = max(0.0, dot(flatDir, flatSun));
    float band = pow(1.0 - abs(vDir.y), 3.5) * pow(az, 2.0);
    col = mix(col, uGlowColor, clamp(band * uGlow, 0.0, 1.0));

    // the moon: a pale disc with a soft halo, opposite the sun
    float moon = dot(normalize(vDir), normalize(uMoonDir));
    col += vec3(0.95, 0.96, 1.0) * smoothstep(0.99955, 0.99975, moon) * 0.95 * uStars;
    col += vec3(0.55, 0.62, 0.85) * 0.05 * smoothstep(0.9976, 1.0, moon) * uStars;

    // the sun, only while it is up
    float sun = dot(normalize(vDir), normalize(uSunDir));
    col += uSunColor * 3.0 * smoothstep(0.9985, 0.9995, sun) * uSunUp;
    col += uSunColor * 0.22 * smoothstep(0.90, 1.0, sun) * uSunUp;
    col += uSunColor * 0.07 * smoothstep(0.55, 1.0, sun) * uSunUp;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

/** World-space sun direction. Flat worlds copy it from the clock; the globe rotates it into the traveller's frame. */
export const SUN_DIR = new THREE.Vector3(0.55, 0.6, 0.35).normalize()
/** The clock's sun direction, before the globe's local-frame rotation. */
export const SUN_LOCAL = SUN_DIR.clone()
export const MOON_DIR = SUN_DIR.clone().negate()

/** Shared sky uniforms, written once per frame by DayNight. */
export const skyUniforms = {
  uZenith: { value: new THREE.Color('#9fd0f0') },
  uHorizon: { value: new THREE.Color('#e7f0f6') },
  uSunDir: { value: SUN_DIR },
  uSunColor: { value: new THREE.Color('#fff4dc') },
  uGlowColor: { value: new THREE.Color('#ffe9c4') },
  uMoonDir: { value: MOON_DIR },
  uGlow: { value: 0.15 },
  uStars: { value: 0 },
  uSunUp: { value: 1 },
  uTime: { value: 0 },
}

export function Sky() {
  const ref = useRef<THREE.Mesh>(null)
  // Built by hand rather than declaratively: three clones a `uniforms` object passed through
  // props, which copies number uniforms by value and silently freezes them.
  const material = useMemo(() => {
    const m = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, fog: false })
    m.uniforms = skyUniforms
    return m
  }, [])
  useEffect(() => () => material.dispose(), [material])
  useFrame(({ camera }) => {
    ref.current?.position.copy(camera.position)
  })
  return (
    <mesh ref={ref} frustumCulled={false} renderOrder={-10} material={material}>
      <sphereGeometry args={[1200, 32, 16]} />
    </mesh>
  )
}
