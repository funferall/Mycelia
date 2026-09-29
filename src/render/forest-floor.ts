import * as THREE from 'three';
import type { SeasonId } from '../sim/content';

/**
 * The wildfire as the ground sees it, shared by every tile. The floor's UVs are
 * regional coordinates, so the same projection the simulation uses decides
 * what is burned: behind the front is char, the flaming band glows, and through
 * the aftermath the char greys to ash and a green flush comes up through it.
 */
export const FLOOR_FIRE = {
  dir: { value: new THREE.Vector2(1, 0) },
  front: { value: -1e6 },
  spotDir: { value: new THREE.Vector2(1, 0) },
  spotFront: { value: -1e6 },
  spotScorch: { value: 0 },
  band: { value: 24 },
  /** 0 idle, 1 while the burn is on the ground; eases out long after the fire. */
  scorch: { value: 0 },
  /** Active front light reaching the underground view, separate from char. */
  active: { value: 0 },
  /** 0..1 through the aftermath: char to ash and new growth. */
  regrowth: { value: 0 },
  time: { value: 0 },
};

/**
 * The drought as the ground sees it: baked, bleached earth breaking into
 * plates. Cracks open wider as severity grows and never reach the stream's
 * banks (the floor's wetness channel), where the simulation keeps soil damp.
 */
export const FLOOR_DROUGHT = {
  /** 0..1, eased from the simulation's severity by the game. */
  severity: { value: 0 },
};

/**
 * The flood as the ground sees it. The floor's wetness channel is a Gaussian
 * of distance to the stream's course (`forest-floor-field.ts`), so the shader
 * recovers that distance and puts murky water everywhere within the flood's
 * reach, foam at its edge, and a silt stain where it stood once it drains.
 */
export const FLOOR_FLOOD = {
  level: { value: 0 },
  /** Distance from the stream's course the water reaches now, region units. */
  reach: { value: 0 },
  /** 0..1 fading stain left after the water drains, and how far it reached. */
  silt: { value: 0 },
  siltReach: { value: 0 },
  time: { value: 0 },
};

/** One shader recipe for every tile; UVs are immutable regional metres. */
export function makeForestFloorMaterial() {
  const litter = { value: new THREE.Color('#756044') };
  const moss = { value: new THREE.Color('#535b37') };
  const wetness = { value: 0 };
  const material = new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      floorLitter: litter, floorMoss: moss, floorRain: wetness,
      fireDir: FLOOR_FIRE.dir, fireFront: FLOOR_FIRE.front, fireBand: FLOOR_FIRE.band,
      fireSpotDir: FLOOR_FIRE.spotDir, fireSpotFront: FLOOR_FIRE.spotFront, fireSpotScorch: FLOOR_FIRE.spotScorch,
      fireScorch: FLOOR_FIRE.scorch, fireRegrowth: FLOOR_FIRE.regrowth, fireTime: FLOOR_FIRE.time,
      droughtSeverity: FLOOR_DROUGHT.severity,
      floodLevel: FLOOR_FLOOD.level, floodReach: FLOOR_FLOOD.reach, floodSilt: FLOOR_FLOOD.silt,
      floodSiltReach: FLOOR_FLOOD.siltReach, floodTime: FLOOR_FLOOD.time,
    });
    shader.vertexShader = 'attribute vec4 habitat; varying vec4 vHabitat; varying vec2 vGround;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHabitat = habitat; vGround = uv;');
    shader.fragmentShader = `
      uniform vec3 floorLitter; uniform vec3 floorMoss; uniform float floorRain;
      uniform vec2 fireDir; uniform float fireFront; uniform float fireBand;
      uniform vec2 fireSpotDir; uniform float fireSpotFront; uniform float fireSpotScorch;
      uniform float fireScorch; uniform float fireRegrowth; uniform float fireTime;
      uniform float droughtSeverity;
      uniform float floodLevel; uniform float floodReach; uniform float floodSilt;
      uniform float floodSiltReach; uniform float floodTime;
      varying vec4 vHabitat; varying vec2 vGround;
      vec3 fireGlowColor = vec3(0.0);
      float floodWet = 0.0;
      // Distance to the nearest border between Voronoi plates: mud cracks.
      vec2 crackHash(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return fract(sin(p) * 43758.5453);
      }
      float crackEdge(vec2 x) {
        vec2 n = floor(x), f = fract(x), mg = vec2(0.0), mr = vec2(0.0);
        float md = 8.0;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 g = vec2(float(i), float(j));
          vec2 r = g + crackHash(n + g) - f;
          float d = dot(r, r);
          if (d < md) { md = d; mr = r; mg = g; }
        }
        md = 8.0;
        for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
          vec2 g = mg + vec2(float(i), float(j));
          vec2 r = g + crackHash(n + g) - f;
          if (dot(mr - r, mr - r) > 1e-5) md = min(md, dot(.5 * (mr + r), normalize(r - mr)));
        }
        return md;
      }
      // One crack network, antialiased: a line thinner than a pixel fades
      // instead of shimmering in the overview.
      float crackLines(vec2 p, float width) {
        float pixel = length(fwidth(p));
        float w = max(width, pixel);
        return (1.0 - smoothstep(w * .5, w, crackEdge(p))) * min(1.0, width / pixel);
      }
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
      if (fireScorch > 0.001) {
        // Distance behind the leading edge, with a ragged, noisy edge. Wet
        // ground (the stream banks) never takes the burn, as in the simulation.
        float behind = fireFront - dot(vGround, fireDir) + (floorNoise(vGround * .09) - .5) * 9.0;
        float spotBehind = fireSpotFront - dot(vGround, fireSpotDir) + (floorNoise(vGround * .11 + 8.0) - .5) * 13.0;
        float ordinaryBurn = smoothstep(-1.5, 2.5, behind) * (1.0 - smoothstep(.45, .7, vHabitat.z));
        float emberBurn = smoothstep(-2.0, 3.0, spotBehind) * fireSpotScorch;
        float burnt = max(ordinaryBurn, emberBurn) * fireScorch;
        float mottling = floorNoise(vGround * .45);
        vec3 charColor = mix(vec3(.018, .016, .014), vec3(.075, .07, .064), mottling * .6);
        vec3 ash = mix(vec3(.2, .19, .18), vec3(.11, .105, .1), mottling);
        vec3 flush = mix(ash, vec3(.11, .15, .06), smoothstep(.55, .85, floorNoise(vGround * .3 + 3.0)) * .8);
        vec3 burned = mix(charColor, flush, fireRegrowth);
        diffuseColor.rgb = mix(diffuseColor.rgb, burned, burnt);
        // Embers: brightest in the flaming band, a few still smouldering behind it.
        // A narrow line of fire at the edge, then patchy embers, not a lit sheet.
        float band = max(smoothstep(0.0, 2.0, behind) * (1.0 - smoothstep(fireBand * .15, fireBand * .7, behind)),
          smoothstep(0.0, 2.0, spotBehind) * (1.0 - smoothstep(fireBand * .15, fireBand * .7, spotBehind)) * fireSpotScorch);
        float flicker = floorNoise(vGround * .8 + vec2(fireTime * 1.7, -fireTime * 1.1));
        float patches = smoothstep(.45, .8, floorNoise(vGround * .6 + vec2(0.0, fireTime * .3)));
        float smoulder = step(.82, floorNoise(vGround * 1.3)) * smoothstep(fireBand * 4.0, fireBand, behind) * (1.0 - fireRegrowth);
        float glow = (band * (.25 + .75 * patches) * (.5 + .5 * flicker) + smoulder * .3 * flicker) * burnt;
        fireGlowColor = vec3(1.0, .34, .05) * glow * .75;
      }
      if (droughtSeverity > 0.001) {
        // Away from water the ground bakes pale; the banks stay dark and soft.
        float away = 1.0 - smoothstep(.12, .55, vHabitat.z);
        float parch = droughtSeverity * away;
        vec3 baked = mix(vec3(.34, .28, .19), vec3(.47, .4, .28), floorNoise(vGround * .18));
        diffuseColor.rgb = mix(diffuseColor.rgb, baked, parch * .85);
        // Large plates first, then a finer network inside them as it worsens.
        float cracks = crackLines(vGround * .32, .012 + .05 * parch)
          + crackLines(vGround * 1.1 + 7.0, .02 + .04 * parch) * .45 * smoothstep(.45, .85, parch);
        cracks *= smoothstep(.12, .45, parch);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.05, .036, .024), clamp(cracks, 0.0, 1.0) * .9);
      }
      if (floodLevel > 0.001 || floodSilt > 0.001) {
        float courseDistance = 8.0 * sqrt(-log(max(vHabitat.z, 1e-6)));
        float edge = floodReach + (floorNoise(vGround * .15) - .5) * 3.0;
        float under = (1.0 - smoothstep(edge - 1.0, edge + .5, courseDistance)) * step(.001, floodLevel);
        float ripple = floorNoise(vGround * 1.4 + vec2(floodTime * 1.3, floodTime * .6));
        vec3 murky = mix(vec3(.2, .27, .27), vec3(.32, .35, .3), floorNoise(vGround * .35 + vec2(floodTime * .4, 0.0)));
        diffuseColor.rgb = mix(diffuseColor.rgb, murky * (.8 + .45 * ripple), under * .92);
        float foam = exp(-pow((courseDistance - edge) / .9, 2.0)) * step(.001, floodLevel) * (.5 + .5 * ripple);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.52, .52, .47), foam * .55);
        floodWet = under;
        float silted = (1.0 - smoothstep(floodSiltReach - 1.0, floodSiltReach + 1.0, courseDistance)) * floodSilt * (1.0 - under);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.28, .23, .16), silted * .55);
      }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fireGlowColor;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(clamp(1.0 - vHabitat.z * .2 - floorRain * .08, .7, 1.0), .15, floodWet);');
  };
  material.customProgramCacheKey = () => 'regional-forest-floor-v5-fire-wind-spot';
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
