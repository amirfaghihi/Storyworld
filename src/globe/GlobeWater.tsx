import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useWorld } from '@/world/WorldContext'
import { FOG_COLOR, fogRange, timeState } from '@/render/timeOfDay'
import { weatherLook } from '@/render/weather'
import { auraFilter, auraMix } from '@/render/auras'

const vert = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const frag = /* glsl */ `
  uniform sampler2D uHeight;
  uniform float uSeaLevel;
  uniform float uTime;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uFoam;
  uniform vec3 uFogColor;
  uniform float uLight;
  uniform float uRain;
  uniform float uGloom;
  uniform vec3 uGloomColor;
  uniform vec3 uAura;
  uniform float uAuraAmt;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vWorld;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec3 d = normalize(vWorld);
    // equirectangular lookup: x = lon + 180, z = 90 - lat
    vec2 uv = vec2(atan(d.x, d.z) / 6.2831853 + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.14159265);
    float ground = texture2D(uHeight, uv).r;
    float depth = uSeaLevel - ground;
    float t = smoothstep(0.0, 14.0, depth);
    t = floor(t * 3.0 + 0.5) / 3.0;
    vec3 col = mix(uShallow, uDeep, t);
    vec3 pn = vWorld * 0.9;
    float n = noise(pn.xz + pn.yy * 0.7 + vec2(uTime * 0.25, -uTime * 0.18));
    float shore = smoothstep(0.7, 0.05, depth);
    float foam = step(0.62, n * shore + shore * 0.35 * (0.5 + 0.5 * sin(uTime * 1.5 + vWorld.x * 0.4 + vWorld.z * 0.3)));
    col = mix(col, uFoam, foam * 0.9);
    float sp = step(0.985, noise(pn.xz * 1.7 + pn.yy + vec2(uTime * 0.6)));
    col += sp * 1.4 * (1.0 - uRain);
    float drops = noise(pn.xz * 2.4 + pn.yy + vec2(uTime * 5.0, uTime * 3.7));
    col = mix(col, uFoam, uRain * step(0.9, drops) * 0.35);
    col = mix(col, uGloomColor * 0.55, uGloom * 0.3);
    // the air of a place colours the water in it too
    col = mix(col, col * uAura, uAuraAmt);
    col *= uLight;
    float alpha = mix(0.82, 0.96, t);
    float dist = length(vWorld - cameraPosition);
    float fogF = smoothstep(uFogNear, uFogFar, dist);
    col = mix(col, uFogColor, fogF);
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`

/** Sea-level sphere with the same stylised water look, sampling the height grid by latitude/longitude. */
export function GlobeWater() {
  const { meta, heightfield, globe } = useWorld()
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const heightTex = useMemo(() => {
    const tex = new THREE.DataTexture(heightfield.data, heightfield.width, heightfield.height, THREE.RedFormat, THREE.FloatType)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.wrapS = THREE.RepeatWrapping
    tex.generateMipmaps = false
    tex.needsUpdate = true
    return tex
  }, [heightfield])
  const uniforms = useMemo(
    () => ({
      uHeight: { value: heightTex },
      uSeaLevel: { value: meta.seaLevel },
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(meta.palette.water ?? '#4d8fd6') },
      uDeep: { value: new THREE.Color(meta.palette.waterDeep ?? '#2c5fa8') },
      uFoam: { value: new THREE.Color('#f2fbff') },
      uFogColor: { value: new THREE.Color(meta.palette.horizon ?? '#e7f0f6') },
      uLight: { value: 1 },
      uRain: { value: 0 },
      uGloom: { value: 0 },
      uGloomColor: { value: new THREE.Color('#b6c1cd') },
      uAura: { value: new THREE.Color(1, 1, 1) },
      uAuraAmt: { value: 0 },
      uFogNear: { value: meta.fog?.[0] ?? 320 },
      uFogFar: { value: meta.fog?.[1] ?? 900 },
    }),
    [heightTex, meta],
  )
  useFrame((_, dt) => {
    const m = matRef.current
    if (!m) return
    const w = weatherLook()
    m.uniforms.uTime.value += Math.min(dt, 0.05)
    m.uniforms.uLight.value = timeState.lightMul
    m.uniforms.uFogColor.value.copy(FOG_COLOR)
    m.uniforms.uRain.value = w.rain
    m.uniforms.uGloom.value = w.gloom
    m.uniforms.uGloomColor.value.copy(w.tint)
    m.uniforms.uAura.value.copy(auraFilter())
    m.uniforms.uAuraAmt.value = auraMix.haze()
    m.uniforms.uFogNear.value = fogRange.near
    m.uniforms.uFogFar.value = fogRange.far
  })
  if (!globe) return null
  return (
    <mesh name="water" renderOrder={1}>
      <sphereGeometry args={[globe.radius + meta.seaLevel, 128, 64]} />
      <shaderMaterial ref={matRef} vertexShader={vert} fragmentShader={frag} uniforms={uniforms} transparent depthWrite={false} />
    </mesh>
  )
}
