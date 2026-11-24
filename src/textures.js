import * as THREE from 'three';
import { createCanvas2D, createRng } from './noise.js';

const TEXTURE_FILES = [
  'asphalt_02_diff_2k',
  'asphalt_02_nor_gl_2k',
  'leafy_grass_diff_2k',
  'leafy_grass_nor_gl_1k',
  'rock_face_03_diff_1k',
  'gravel_ground_01_diff_1k',
];

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

function makeFallbackCanvas(kind) {
  const [c, g] = createCanvas2D(256, 256);
  const rng = createRng(kind.length * 131);
  if (kind.includes('nor')) {
    g.fillStyle = '#8080ff';
    g.fillRect(0, 0, 256, 256);
  } else if (kind.includes('asphalt')) {
    g.fillStyle = '#383a3e';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4000; i++) {
      const v = 42 + ((rng() * 36) | 0);
      g.fillStyle = `rgb(${v},${v},${v + 2})`;
      g.fillRect(rng() * 256, rng() * 256, 2, 2);
    }
  } else if (kind.includes('grass')) {
    g.fillStyle = '#476128';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3000; i++) {
      const v = 50 + ((rng() * 55) | 0);
      g.fillStyle = `rgb(${(v * 0.72) | 0},${v + 18},${(v * 0.4) | 0})`;
      g.fillRect(rng() * 256, rng() * 256, 3, 3);
    }
  } else if (kind.includes('rock')) {
    g.fillStyle = '#6c6862';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2000; i++) {
      const v = 70 + ((rng() * 70) | 0);
      g.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
      g.fillRect(rng() * 256, rng() * 256, 4 + rng() * 8, 2 + rng() * 5);
    }
  } else {
    g.fillStyle = '#6d6659';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2500; i++) {
      const v = 80 + ((rng() * 60) | 0);
      g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      g.fillRect(rng() * 256, rng() * 256, 3, 3);
    }
  }
  return c;
}

export async function loadSurfaceImages() {
  const results = await Promise.all(
    TEXTURE_FILES.map((name) =>
      loadImage(`./assets/${name}.jpg`).catch(() => makeFallbackCanvas(name))
    )
  );
  const [asphalt, asphaltNormal, grass, grassNormal, rock, gravel] = results;
  return { asphalt, asphaltNormal, grass, grassNormal, rock, gravel };
}

export function makeRepeatingTexture(source, maxAniso, isSrgb = false) {
  const tex = new THREE.Texture(source);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  if (isSrgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.needsUpdate = true;
  return tex;
}

export function buildRoadAlbedoTexture(asphaltImg, maxAniso, winterMode) {
  const rng = createRng(101);
  const W = 1024;
  const H = 2048;
  const [canvas, g] = createCanvas2D(W * 2, H * 2);
  g.scale(2, 2);

  for (let x = 0; x < W; x += 439) {
    for (let y = 0; y < H; y += 512) {
      g.drawImage(asphaltImg, x, y, 439, 512);
    }
  }

  // Slight dampness
  g.fillStyle = 'rgba(8, 10, 14, 0.22)';
  g.fillRect(0, 0, W, H);

  // Subtle dark wheel tracks
  for (const xFrac of [0.2, 0.36, 0.64, 0.8]) {
    const gr = g.createLinearGradient((xFrac - 0.06) * W, 0, (xFrac + 0.06) * W, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(0.5, 'rgba(0,0,0,0.17)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect((xFrac - 0.06) * W, 0, 0.12 * W, H);
  }

  // Patch repairs
  for (let i = 0; i < 3; i++) {
    const pw = 120 + rng() * 190;
    const ph = 200 + rng() * 380;
    g.fillStyle = 'rgba(18, 18, 22, 0.14)';
    g.fillRect(rng() * (W - pw), rng() * (H - ph), pw, ph);
  }

  // Hairline tarmac cracks
  g.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    let x = rng() * W;
    let y = rng() * H;
    let angle = rng() * Math.PI * 2;
    g.strokeStyle = 'rgba(10, 10, 12, 0.72)';
    g.lineWidth = 1 + rng() * 1.8;
    g.beginPath();
    g.moveTo(x, y);
    const steps = 20 + rng() * 45;
    for (let k = 0; k < steps; k++) {
      angle += (rng() - 0.5) * 1.1;
      x += Math.cos(angle) * 9;
      y += Math.sin(angle) * 9;
      g.lineTo(x, y);
    }
    g.stroke();
  }

  // Edge lines and dashed centre line
  g.fillStyle = 'rgba(224, 220, 206, 0.92)';
  g.fillRect(36, 0, 16, H);
  g.fillRect(972, 0, 16, H);
  g.fillRect(505, 0, 14, H / 3);

  // Scuffed paint wear
  const stripeX = [36, 972, 505];
  for (let i = 0; i < 5500; i++) {
    const sz = 1 + rng() * 3;
    g.fillStyle = 'rgba(72, 72, 76, 0.68)';
    g.fillRect(stripeX[i % 3] + rng() * 16, rng() * H, sz, sz * (1 + rng() * 3));
  }

  if (winterMode) {
    for (const [x0, x1] of [[0, 150], [W, W - 150]]) {
      const gr = g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, 'rgba(226, 232, 242, 1)');
      gr.addColorStop(0.45, 'rgba(214, 222, 234, 0.85)');
      gr.addColorStop(1, 'rgba(214, 222, 234, 0)');
      g.fillStyle = gr;
      g.fillRect(Math.min(x0, x1), 0, 150, H);
    }
    for (let i = 0; i < 2400; i++) {
      const edge = rng() < 0.7;
      const x = edge ? (rng() < 0.5 ? rng() * 190 : W - rng() * 190) : 440 + rng() * 150;
      const r = 3 + rng() * (edge ? 16 : 9);
      g.fillStyle = `rgba(222, 229, 240, ${edge ? 0.5 : 0.22})`;
      g.beginPath();
      g.ellipse(x, rng() * H, r, r * (1.5 + rng() * 2.5), 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

export function buildWetRoughnessTexture(roadTiles, maxAniso) {
  const rng = createRng(202);
  const S = 512;
  const [canvas, g] = createCanvas2D(S, S);
  g.fillStyle = '#bdbdbd';
  g.fillRect(0, 0, S, S);

  for (let i = 0; i < 26; i++) {
    const edge = rng() < 0.7;
    const x = (edge ? (rng() < 0.5 ? 0.04 + rng() * 0.2 : 0.76 + rng() * 0.2) : rng()) * S;
    const y = 70 + rng() * (S - 140);
    const r = 8 + rng() * 20;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(70,70,70,0.9)');
    gr.addColorStop(0.4, 'rgba(70,70,70,0.6)');
    gr.addColorStop(1, 'rgba(70,70,70,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  tex.repeat.set(1, Math.round(roadTiles / 3) / roadTiles);
  return tex;
}

export function buildShoulderTexture(gravelImg, maxAniso, winterMode) {
  const rng = createRng(303);
  const [canvas, g] = createCanvas2D(512, 512);
  g.drawImage(gravelImg, 0, 0, 512, 512);
  const gr = g.createLinearGradient(0, 0, 512, 0);
  gr.addColorStop(0, 'rgba(40, 38, 28, 0.35)');
  gr.addColorStop(0.3, 'rgba(46, 58, 24, 0.8)');
  gr.addColorStop(1, 'rgba(44, 62, 22, 1)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 512, 512);

  if (winterMode) {
    g.fillStyle = '#b4bccb';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1500; i++) {
      const l = 168 + ((rng() * 40) | 0);
      g.fillStyle = `rgba(${l},${l + 5},${l + 16},0.5)`;
      g.fillRect(rng() * 512, rng() * 512, 2 + rng() * 10, 2 + rng() * 6);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

export function buildGrassTuftTexture() {
  const rng = createRng(404);
  const [canvas, g] = createCanvas2D(256, 256);
  for (let i = 0; i < 36; i++) {
    const x = 20 + rng() * 216;
    const h = 110 + rng() * 140;
    const lean = (rng() - 0.5) * 90;
    const w = 5 + rng() * 5;
    const gr = g.createLinearGradient(0, 256, 0, 256 - h);
    gr.addColorStop(0, '#23360f');
    gr.addColorStop(0.6, '#5b7824');
    gr.addColorStop(1, rng() < 0.45 ? '#cdb968' : '#90a43c');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x - w / 2, 256);
    g.quadraticCurveTo(x + lean * 0.3, 256 - h * 0.6, x + lean, 256 - h);
    g.quadraticCurveTo(x + lean * 0.3 + w * 0.4, 256 - h * 0.6, x + w / 2, 256);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildPineBoughTexture(winterMode) {
  const rng = createRng(505);
  const [canvas, g] = createCanvas2D(256, 256);
  g.lineCap = 'round';
  g.strokeStyle = '#2a1d12';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(0, 128);
  g.lineTo(240, 128);
  g.stroke();

  for (let x = 4; x < 250; x += 2.2) {
    const reach = Math.pow(1 - x / 262, 0.55) * 112 * (0.55 + rng() * 0.45);
    for (const sgn of [-1, 1]) {
      const l = 18 + ((rng() * 30) | 0);
      g.strokeStyle = `rgb(${(l * 0.75) | 0},${l + 22},${(l * 0.5) | 0})`;
      g.lineWidth = 1.6 + rng() * 2.2;
      g.beginPath();
      g.moveTo(x, 128);
      g.quadraticCurveTo(x + reach * 0.25, 128 + sgn * reach * 0.6, x + reach * 0.5 + rng() * 8, 128 + sgn * reach);
      g.stroke();
    }
  }

  if (winterMode) {
    const edge = (x, k) => Math.pow(1 - x / 262, 0.55) * 112 * k;
    for (const [k, alpha] of [[0.62, 0.5], [0.46, 0.6], [0.3, 0.8]]) {
      g.fillStyle = `rgba(232, 238, 250, ${alpha})`;
      g.beginPath();
      g.moveTo(0, 128);
      for (let x = 0; x <= 250; x += 5) g.lineTo(x, 128 - edge(x, k) * (0.85 + rng() * 0.3));
      for (let x = 250; x >= 0; x -= 5) g.lineTo(x, 128 + edge(x, k * 0.6) * (0.8 + rng() * 0.4));
      g.fill();
    }
    for (let i = 0; i < 240; i++) {
      const x = rng() * 246;
      g.fillStyle = 'rgba(236, 241, 252, 0.7)';
      g.beginPath();
      g.ellipse(x, 128 + (rng() - 0.62) * edge(x, 1.5), 2 + rng() * 5, 2 + rng() * 4, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
