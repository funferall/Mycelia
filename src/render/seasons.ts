import * as THREE from 'three';
import type { SeasonId } from '../sim/content';

const seasons: SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];
const palettes = {
  oak: ['#859453', '#566c3d', '#a76538', '#796a51'],
  birch: ['#a1ad60', '#71884b', '#c39b46', '#8a7e60'],
  hemlock: ['#526e4c', '#496448', '#4b6245', '#4b5b50'],
  understory: ['#72874b', '#5c7242', '#8a7949', '#716b51'],
};

export function foliageColour(species: string, season: SeasonId, progress: number, target = new THREE.Color()): THREE.Color {
  const key = species.includes('hemlock') ? 'hemlock' : species.includes('birch') ? 'birch' : species.includes('oak') ? 'oak' : 'understory';
  const palette = palettes[key];
  const i = seasons.indexOf(season);
  return target.set(palette[i]!).lerp(new THREE.Color(palette[(i + 1) % 4]!), THREE.MathUtils.smoothstep(progress, .65, 1));
}
