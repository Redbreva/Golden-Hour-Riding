import * as THREE from 'three';
import { fbm, ridgedNoise, smoothstep } from './noise.js';

const V3 = THREE.Vector3;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Missing course data: ${src}`));
    document.head.append(script);
  });
}

export async function loadRealCourseData(courseId) {
  if (!window.RIDE_COURSES?.[courseId]) {
    await loadScript(`./assets/${courseId}.js`);
    await loadScript(`./assets/${courseId}_osm.js`).catch(() => {});
  }

  const data = window.RIDE_COURSES?.[courseId];
  if (!data) throw new Error(`Course "${courseId}" did not register on window.RIDE_COURSES`);
  if (data._prepared) return data;

  data.osm = data.osm || { buildings: [], trees: [], lines: [], woods: '', credit: '' };

  const woodBytes = data.osm.woods
    ? Uint8Array.from(atob(data.osm.woods), (c) => c.charCodeAt(0))
    : new Uint8Array(0);

  data.isWoodland = (x, z) => {
    if (!woodBytes.length) return false;
    const g = data.cells;
    const ix = Math.round((x + data.size / 2) / (data.size / g));
    const iz = Math.round((z + data.size / 2) / (data.size / g));
    if (ix < 0 || iz < 0 || ix > g || iz > g) return false;
    const idx = iz * (g + 1) + ix;
    return ((woodBytes[idx >> 3] >> (idx & 7)) & 1) === 1;
  };

  const rawBytes = Uint8Array.from(atob(data.dem), (c) => c.charCodeAt(0));
  const quantized = new Uint16Array(rawBytes.buffer);
  data.heights = Float32Array.from(
    quantized,
    (v) => data.demMin + (v / 65535) * (data.demMax - data.demMin)
  );
  data.creditText = [data.credit, data.osm.credit].filter(Boolean).join(' ').trim();
  data._prepared = true;

  return data;
}

export function createCourse(sunFlat, real = null) {
  const controlPoints = [];
  if (real) {
    for (const p of real.road) controlPoints.push(new V3(p[0], p[1], p[2]));
  } else {
    const numCtrl = 22;
    for (let i = 0; i < numCtrl; i++) {
      const angle = (i / numCtrl) * Math.PI * 2;
      const radius = 430 + 110 * Math.sin(angle * 3 + 0.6) + 60 * Math.sin(angle * 5 + 2.1);
      const height = 40 + 16 * Math.sin(angle * 2 + 1) + 4 * Math.sin(angle * 5);
      controlPoints.push(new V3(Math.cos(angle) * radius, height, Math.sin(angle) * radius));
    }
  }

  const curve = new THREE.CatmullRomCurve3(controlPoints, true, 'centripetal');
  curve.arcLengthDivisions = Math.max(4000, controlPoints.length * 12);
  const length = curve.getLength();
  const sampleCount = Math.floor(length / 1.5);
  const points = curve.getSpacedPoints(sampleCount).slice(0, sampleCount);
  const tangents = points.map((_, i) =>
    new V3()
      .subVectors(points[(i + 1) % sampleCount], points[(i - 1 + sampleCount) % sampleCount])
      .normalize()
  );
  const rights = tangents.map((t) => new V3(-t.z, 0, t.x).normalize());

  function samplePose(s, out) {
    const f = ((((s % length) + length) % length) / length) * sampleCount;
    const i = Math.floor(f) % sampleCount;
    const j = (i + 1) % sampleCount;
    const k = f - Math.floor(f);
    out.p.lerpVectors(points[i], points[j], k);
    out.t.lerpVectors(tangents[i], tangents[j], k).normalize();
    out.r.set(-out.t.z, 0, out.t.x).normalize();
    return out;
  }

  // Spatial hash for fast road-distance queries
  const cellSize = 64;
  const grid = new Map();
  const cellKey = (cx, cz) => cx * 4096 + cz;
  points.forEach((p, idx) => {
    const key = cellKey(Math.floor(p.x / cellSize), Math.floor(p.z / cellSize));
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(idx);
  });

  const nearScratch = { d: 0, y: 0, i: 0, side: 0 };
  function nearestRoad(x, z) {
    const cx = Math.floor(x / cellSize);
    const cz = Math.floor(z / cellSize);
    let bestDistSq = 1e12;
    let bestIdx = -1;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = grid.get(cellKey(cx + dx, cz + dz));
        if (!arr) continue;
        for (const i of arr) {
          const ex = x - points[i].x;
          const ez = z - points[i].z;
          const d2 = ex * ex + ez * ez;
          if (d2 < bestDistSq) {
            bestDistSq = d2;
            bestIdx = i;
          }
        }
      }
    }
    if (bestIdx < 0) return null;
    const ex = x - points[bestIdx].x;
    const ez = z - points[bestIdx].z;
    nearScratch.d = Math.sqrt(bestDistSq);
    nearScratch.i = bestIdx;
    nearScratch.y = points[bestIdx].y + tangents[bestIdx].y * (ex * tangents[bestIdx].x + ez * tangents[bestIdx].z);
    nearScratch.side = ex * rights[bestIdx].x + ez * rights[bestIdx].z;
    return nearScratch;
  }

  function demElevation(x, z) {
    const g = real.cells;
    const w = g + 1;
    const norm = (val) => Math.min(g - 1e-6, Math.max(0, (val + real.size / 2) / (real.size / g)));
    const fx = norm(x);
    const fz = norm(z);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const u = fx - ix;
    const v = fz - iz;
    const h = real.heights;
    return (
      (h[iz * w + ix] * (1 - u) + h[iz * w + ix + 1] * u) * (1 - v) +
      (h[(iz + 1) * w + ix] * (1 - u) + h[(iz + 1) * w + ix + 1] * u) * v
    );
  }

  function baseElevation(x, z) {
    if (real) return demElevation(x, z);
    const r = Math.hypot(x, z) || 1;
    let h = 40 + (fbm(x / 300 + 5, z / 300 + 9) - 0.5) * 110 + (fbm(x / 60, z / 60, 4) - 0.5) * 14;
    const sunGap = smoothstep(0.55, 0.95, (x * sunFlat.x + z * sunFlat.z) / r);
    h += (ridgedNoise(x / 120 + 7, z / 120 + 3, 3) - 0.25) * 14;
    const mountainRing = smoothstep(720, 1500, r) * (1 - 0.92 * sunGap);
    h +=
      mountainRing *
      (90 +
        fbm(x / 420 + 40, z / 420, 5) * 400 +
        ridgedNoise(x / 300 + 11, z / 300 + 5) * 300 +
        ridgedNoise(x / 75, z / 75, 3) * 55);
    return h;
  }

  function terrainElevation(x, z) {
    const base = baseElevation(x, z);
    const nr = nearestRoad(x, z);
    if (!nr) return base;
    const blend = real ? smoothstep(6, 34, nr.d) : smoothstep(9, 62, nr.d);
    return (nr.y - 0.6) * (1 - blend) + base * blend;
  }

  const terrainSize = real ? real.size : 3200;
  const terrainCells = real ? real.cells : 400;
  const cellStep = terrainSize / terrainCells;
  const gridWidth = terrainCells + 1;
  const heights = new Float32Array(gridWidth * gridWidth);

  for (let iz = 0; iz < gridWidth; iz++) {
    for (let ix = 0; ix < gridWidth; ix++) {
      const x = -terrainSize / 2 + ix * cellStep;
      const z = -terrainSize / 2 + iz * cellStep;
      heights[iz * gridWidth + ix] = terrainElevation(x, z);
    }
  }

  function meshElevation(x, z) {
    const fx = (x + terrainSize / 2) / cellStep;
    const fz = (z + terrainSize / 2) / cellStep;
    const ix = Math.min(terrainCells - 1, Math.max(0, Math.floor(fx)));
    const iz = Math.min(terrainCells - 1, Math.max(0, Math.floor(fz)));
    const u = fx - ix;
    const v = fz - iz;
    const a = heights[iz * gridWidth + ix];
    const b = heights[(iz + 1) * gridWidth + ix];
    const c = heights[(iz + 1) * gridWidth + ix + 1];
    const d = heights[iz * gridWidth + ix + 1];
    return u + v <= 1
      ? a + (d - a) * u + (b - a) * v
      : c + (b - c) * (1 - u) + (d - c) * (1 - v);
  }

  return {
    real,
    startDistance: real ? 850 : 0,
    length,
    sampleCount,
    points,
    tangents,
    rights,
    terrainSize,
    terrainCells,
    cellStep,
    gridWidth,
    heights,
    samplePose,
    nearestRoad,
    demElevation,
    meshElevation,
  };
}
