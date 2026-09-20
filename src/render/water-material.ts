import * as THREE from 'three';
import { GRID } from '../sim/content';
import { WATER_FRINGE_CM } from '../sim/world';

/** Analytic currents: no textures, render targets, reflection pass or CPU deformation.
 * Keep BasicMaterial's opacity, fog and colour conversion, including OverlayFade.
 */
export function waterMaterial(kind: 'stream' | 'table' | 'channel') {
  const uniforms = {
    waterTime: { value: 0 },
    waterDepth: { value: 60 },
    waterDeep: { value: new THREE.Color(kind === 'stream' ? '#213d3d' : '#192f37') },
    waterShallow: { value: new THREE.Color(kind === 'stream' ? '#708c7f' : '#537b79') },
    waterLight: { value: new THREE.Color('#a3b8a2') },
  };
  const material = new THREE.MeshBasicMaterial({
    transparent: true, opacity: kind === 'table' ? 0.48 : kind === 'channel' ? 0.65 : 0.88,
    depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
  });
  material.name = `water-${kind}`;
  material.customProgramCacheKey = () => `water-${kind}-1`;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec2 waterUv; varying vec3 waterPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nwaterUv = uv; waterPosition = position;');
    shader.fragmentShader = `
      varying vec2 waterUv;
      varying vec3 waterPosition;
      uniform float waterTime;
      uniform float waterDepth;
      uniform vec3 waterDeep;
      uniform vec3 waterShallow;
      uniform vec3 waterLight;
    ` + shader.fragmentShader;
    const surface = kind === 'stream';
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec2 p = ${surface ? 'vec2(waterUv.x * 5.0, waterUv.y)' : 'vec2(waterPosition.y * 0.8, waterPosition.x)'};
      float t = waterTime;
      float drift = sin(p.x * 2.3 + sin(p.y * 0.31 - t * 0.18) * 1.3);
      float ripple = sin(p.y * 2.0 - t * 0.65 + drift * 1.4);
      float silk = smoothstep(0.84, 1.0, ripple) * (0.55 + 0.45 * sin(p.y * 0.22 + p.x));
      ${surface ? `
        float edge = abs(waterUv.x * 2.0 - 1.0);
        float shallows = smoothstep(0.25, 1.0, edge);
        diffuseColor.rgb = mix(waterDeep, waterShallow, shallows * 0.73 + drift * 0.05 + 0.08);
        // Quiet elliptical eddies repeat at the brook's instanced stones.
        vec2 eddy = vec2((waterUv.x - 0.65) * 7.0, mod(p.y, 22.0) - 11.0);
        float radius = length(eddy * vec2(1.0, 0.48));
        float wake = smoothstep(0.88, 1.0, sin(radius * 8.0 - t * 0.55))
          * (1.0 - smoothstep(0.6, 3.0, radius));
        diffuseColor.rgb = mix(diffuseColor.rgb, waterLight, silk * 0.16 + wake * 0.16);
        diffuseColor.a *= 1.0 - smoothstep(0.87, 1.0, edge);
      ` : `
        float depth = ${GRID_HALF_ROWS} - waterPosition.y;
        float saturation = smoothstep(waterDepth - ${WATER_FRINGE_CM.toFixed(1)}, waterDepth, depth);
        float deep = smoothstep(waterDepth, waterDepth + 24.0, depth);
        diffuseColor.rgb = mix(waterShallow, waterDeep, 0.35 + deep * 0.65);
        diffuseColor.rgb = mix(diffuseColor.rgb, waterLight, silk * ${kind === 'channel' ? '0.14' : '0.045'});
        diffuseColor.a *= saturation * ${kind === 'channel' ? '(1.0 - smoothstep(0.4, 1.0, abs(waterUv.x * 2.0 - 1.0))) * smoothstep(0.0, 0.06, waterUv.y)' : '(0.42 + deep * 0.35)'};
      `}
    `);
  };
  return { material, uniforms };
}

// The local transect uses y = rows/2 - depth in grid units.
const GRID_HALF_ROWS = (GRID.rows / 2).toFixed(1);
