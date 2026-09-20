import * as THREE from 'three';
import type { SeasonId } from '../sim/content';

/** One shader recipe for every tile; UVs are immutable regional metres. */
export function makeForestFloorMaterial() {
  const litter = { value: new THREE.Color('#756044') };
  const moss = { value: new THREE.Color('#535b37') };
  const wetness = { value: 0 };
  const material = new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { floorLitter: litter, floorMoss: moss, floorRain: wetness });
    shader.vertexShader = 'attribute vec4 habitat; varying vec4 vHabitat; varying vec2 vGround;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHabitat = habitat; vGround = uv;');
    shader.fragmentShader = `
      uniform vec3 floorLitter; uniform vec3 floorMoss; uniform float floorRain;
      varying vec4 vHabitat; varying vec2 vGround;
      float floorHash(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * .1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }
      float floorNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(floorHash(i), floorHash(i+vec2(1,0)), f.x),
          mix(floorHash(i+vec2(0,1)), floorHash(i+vec2(1,1)), f.x), f.y);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float grain = floorNoise(vGround * 1.7);
      // Attenuate subpixel detail in the overview instead of sparkling.
      float detailFade = 1.0 - smoothstep(.3, 1.5, length(fwidth(vGround * 1.7)));
      vec3 earth = vec3(.075, .053, .034);
      vec3 floorColor = mix(earth, floorLitter, vHabitat.y);
      floorColor = mix(floorColor, floorMoss, vHabitat.x);
      floorColor = mix(floorColor, vec3(.17, .15, .115), vHabitat.z * .25);
      floorColor *= (1.0 - vHabitat.w * .28) * (1.0 - vHabitat.z * .24 - floorRain * .08);
      diffuseColor.rgb *= floorColor * (1.0 + (grain - .5) * .28 * detailFade);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(1.0 - vHabitat.z * .2 - floorRain * .08, .7, 1.0);');
  };
  material.customProgramCacheKey = () => 'regional-forest-floor-v1';
  const ids: SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];
  const leaves = ['#716047', '#756044', '#90603a', '#716451'];
  const greens = ['#617044', '#535f38', '#59593a', '#5c5d4c'];
  return {
    material,
    update(season: SeasonId, progress: number, rainfall: number) {
      const i = ids.indexOf(season), next = (i + 1) % 4;
      const fade = THREE.MathUtils.smoothstep(progress, .65, 1);
      litter.value.set(leaves[i]!).lerp(new THREE.Color(leaves[next]!), fade);
      moss.value.set(greens[i]!).lerp(new THREE.Color(greens[next]!), fade);
      wetness.value = THREE.MathUtils.clamp((rainfall - .6) * .8, 0, 1);
    },
  };
}
