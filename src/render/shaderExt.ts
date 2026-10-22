import * as THREE from 'three'
import { SUN_DIR } from './Sky'

/**
 * Shared shader extensions injected into three's built-in materials:
 *  - wind: vertex sway driven by world position + time (grass and canopies)
 *  - cloud shadows: darken fragments that lie in the sun-projected shadow of a drifting cloud
 *  - weather: wet darkening, lying snow on upward faces, ash dust and overcast gloom
 * All materials share the same uniform objects, so updating them once per frame is enough.
 */
export const MAX_CLOUDS = 16

export const sharedUniforms = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0.9, 0.35) },
  uCloudCount: { value: 0 },
  uClouds: { value: Array.from({ length: MAX_CLOUDS }, () => new THREE.Vector4(0, 0, 1, 150)) }, // x, z, radius, height
  uSunDir: { value: SUN_DIR },
  uCloudStrength: { value: 0.4 },
  /** traveller position; grass fades out toward the edge of its window */
  uPlayer: { value: new THREE.Vector3() },
  uGrassFar: { value: 60 },
  /** weather, written once per frame by DayNight (see render/weather.ts) */
  uWet: { value: 0 },
  uSnowCover: { value: 0 },
  uAshCover: { value: 0 },
  uGloom: { value: 0 },
  uGloomColor: { value: new THREE.Color('#b6c1cd') },
  /** 1 on a globe, where "up" is radial rather than +Y */
  uRadialUp: { value: 0 },
}

export interface ExtOptions {
  /** sway amplitude multiplier; 0 disables */
  wind?: number
  windMode?: 'canopy' | 'grass'
  cloudShadow?: boolean
  /** metres: fragments closer than this to the camera dissolve (dithered), so trees never block the view */
  nearFade?: number
  /** rain, snow and ash settle on this surface */
  weather?: boolean
}

export function applyExtensions<M extends THREE.Material>(mat: M, opts: ExtOptions): M {
  const key = `ext:${opts.wind ?? 0}:${opts.windMode ?? 'canopy'}:${opts.cloudShadow ? 1 : 0}:${opts.nearFade ?? 0}:${opts.weather ? 1 : 0}`
  mat.customProgramCacheKey = () => key
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sharedUniforms)
    const windCode = opts.wind
      ? `{
          float ph = extW.x * 0.17 + extW.z * 0.12 + uTime * 1.6;
          float g = sin(ph) * 0.6 + sin(ph * 2.3 + 1.3) * 0.3 + sin(ph * 0.5) * 0.4;
          ${
            opts.windMode === 'grass'
              ? `float amt = position.y * position.y * ${opts.wind.toFixed(3)};
                 float fade = 1.0 - smoothstep(uGrassFar * 0.7, uGrassFar, distance(extW.xyz, uPlayer));
                 transformed.y *= fade;`
              : `float amt = max(0.0, position.y - 1.2) * 0.05 * ${opts.wind.toFixed(3)};`
          }
          transformed.x += g * amt * uWind.x;
          transformed.z += g * amt * uWind.y;
        }`
      : ''
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uTime;\nuniform vec2 uWind;\nuniform vec3 uPlayer;\nuniform float uGrassFar;\nvarying vec3 vExtWorld;\nvarying vec3 vExtNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        ${
          opts.nearFade
            ? `#ifdef USE_INSTANCING
          {
            vec3 extOrigin = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
            // bigger trees reach further, so they start shrinking from further away
            float extScale = max(1.0, length(instanceMatrix[0].xyz));
            float extNear = smoothstep(1.0, ${opts.nearFade.toFixed(2)} * extScale, distance(extOrigin, cameraPosition));
            transformed *= extNear;
          }
          #endif`
            : ''
        }
        vec4 extW = vec4(transformed, 1.0);
        vec3 extN = objectNormal;
        #ifdef USE_INSTANCING
          extW = instanceMatrix * extW;
          extN = mat3(instanceMatrix) * extN;
        #endif
        extW = modelMatrix * extW;
        ${windCode}
        vExtWorld = extW.xyz;
        vExtNormal = normalize(mat3(modelMatrix) * extN);`,
      )

    const pars: string[] = ['#ifndef EXT_VWORLD', '#define EXT_VWORLD', 'varying vec3 vExtWorld;', 'varying vec3 vExtNormal;', '#endif']
    const body: string[] = []
    if (opts.cloudShadow) {
      pars.push(
        `uniform int uCloudCount;
        uniform vec4 uClouds[${MAX_CLOUDS}];
        uniform vec3 uSunDir;
        uniform float uCloudStrength;
        float cloudShade(vec3 p) {
          float s = 1.0;
          for (int i = 0; i < ${MAX_CLOUDS}; i++) {
            if (i >= uCloudCount) break;
            vec4 c = uClouds[i];
            float t = (c.w - p.y) / max(0.05, uSunDir.y);
            vec2 q = p.xz + uSunDir.xz * t;
            float d = length(q - c.xy) / c.z;
            s *= 1.0 - uCloudStrength * (1.0 - smoothstep(0.5, 1.05, d));
          }
          return s;
        }`,
      )
      body.push('gl_FragColor.rgb *= cloudShade(vExtWorld);')
    }
    if (opts.weather) {
      pars.push(
        `uniform float uWet;
        uniform float uSnowCover;
        uniform float uAshCover;
        uniform float uGloom;
        uniform vec3 uGloomColor;
        uniform float uRadialUp;
        /**
         * Rain, snow and ash land on what faces the sky; overcast light flattens everything.
         * On a globe the sky is radially outward, not +Y, so a face's tilt is measured against
         * its own position instead — otherwise it would only ever snow at the north pole.
         */
        vec3 weatherCoat(vec3 c, vec3 n, vec3 wp) {
          float sky = mix(n.y, dot(n, normalize(wp)), uRadialUp);
          float up = smoothstep(0.15, 0.7, sky);
          // overcast: less contrast, cooler, a touch darker
          float lum = dot(c, vec3(0.3, 0.55, 0.15));
          c = mix(c, mix(vec3(lum), uGloomColor * lum * 1.9, 0.45), uGloom * 0.42);
          // wet ground goes dark and slightly blue; flat surfaces hold the most water
          c *= mix(1.0, mix(0.84, 0.66, up), uWet);
          c = mix(c, c * vec3(0.9, 0.96, 1.08), uWet * 0.7);
          // snow settles on whatever points up (colours here are linear, not sRGB)
          c = mix(c, vec3(0.83, 0.87, 0.94), uSnowCover * up * 0.92);
          // ash dusts everything, upward faces most; a dusting, not a coat of paint
          c = mix(c, vec3(0.09, 0.078, 0.072), uAshCover * (0.3 + 0.6 * up));
          return c;
        }`,
      )
      body.push('gl_FragColor.rgb = weatherCoat(gl_FragColor.rgb, normalize(vExtNormal), vExtWorld);')
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${pars.join('\n')}`)
      .replace('#include <dithering_fragment>', `${body.join('\n')}\n#include <dithering_fragment>`)
  }
  return mat
}
