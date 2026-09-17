import * as THREE from 'three';
import { mulberry32 } from '../sim/rng';

/**
 * Everything the game draws is generated, not loaded. The spec's whole
 * feasibility argument is that the art direction is shader- and
 * procedure-driven, so there are no image files anywhere in this build.
 */

/** Dark archival mounting paper: warm ground, fibre grain, foxing, a vignette. */
export function makePaperTexture(size = 1024): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const rng = mulberry32(0x5eed1a7e);

  ctx.fillStyle = '#141110';
  ctx.fillRect(0, 0, size, size);

  // Fibre grain. Short strokes in both directions read as pressed rag paper.
  ctx.lineWidth = 1;
  for (let i = 0; i < 5200; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const len = 6 + rng() * 46;
    const horizontal = rng() < 0.62;
    const warm = rng() < 0.5;
    ctx.strokeStyle = warm
      ? `rgba(96, 78, 56, ${0.012 + rng() * 0.03})`
      : `rgba(20, 16, 13, ${0.02 + rng() * 0.05})`;
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y + (rng() - 0.5) * 1.6);
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 1.6, y + len);
    }
    ctx.stroke();
  }

  // Foxing: the dull brown spots that age puts on old paper.
  for (let i = 0; i < 26; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 24 + rng() * 120;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const alpha = 0.02 + rng() * 0.05;
    grad.addColorStop(0, `rgba(122, 88, 48, ${alpha})`);
    grad.addColorStop(0.55, `rgba(96, 68, 38, ${alpha * 0.5})`);
    grad.addColorStop(1, 'rgba(96, 68, 38, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fine speckle, so the sheet is never perfectly smooth at close zoom.
  for (let i = 0; i < 26000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const v = rng();
    ctx.fillStyle =
      v < 0.5
        ? `rgba(0, 0, 0, ${0.03 + rng() * 0.07})`
        : `rgba(150, 126, 92, ${0.012 + rng() * 0.03})`;
    ctx.fillRect(x, y, 1, 1);
  }

  // Outer vignette: the sheet falls away from the raking light.
  const vign = ctx.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size * 0.78);
  vign.addColorStop(0, 'rgba(0,0,0,0)');
  vign.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vign;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** Soft round sprite, used for motes, tip glow and drifting spores. */
export function makeGlowTexture(size = 64): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,238,205,0.85)');
  grad.addColorStop(0.45, 'rgba(255,190,110,0.28)');
  grad.addColorStop(1, 'rgba(255,160,60,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A single leaf-fragment silhouette for the litter layer. */
export function makeFragmentTexture(size = 64): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.06);
  ctx.bezierCurveTo(size * 0.95, size * 0.3, size * 0.92, size * 0.78, size * 0.5, size * 0.96);
  ctx.bezierCurveTo(size * 0.08, size * 0.78, size * 0.05, size * 0.3, size * 0.5, size * 0.06);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

/**
 * A soft vertical gradient used for the canopy light band — the only place in
 * the game where light arrives without the network having produced it.
 */
export function makeSkyTexture(width = 8, height = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, 'rgba(6, 5, 5, 1)');
  grad.addColorStop(0.42, 'rgba(26, 22, 18, 1)');
  grad.addColorStop(0.78, 'rgba(58, 46, 32, 0.85)');
  grad.addColorStop(1, 'rgba(20, 17, 14, 1)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
