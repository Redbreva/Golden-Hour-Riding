// Converts GPX / FIT / TCX files into ready-to-ride Golden Hour Riding courses
// Uses free global AWS Terrain Tiles for surrounding DEM + OpenStreetMap Overpass for buildings, woods, hedges & junctions
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { parseRouteFile } = require('./route-parsers.cjs');

const USER_AGENT = 'GoldenHourRiding/0.5 (https://github.com/Redbreva/Golden-Hour-Riding)';

// Pure-Node PNG RGBA/RGB decoder for 8-bit non-interlaced Terrarium elevation tiles
function decodePng(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('Not a valid PNG');
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];
  let pos = 8;

  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const dataStart = pos + 8;
    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
    } else if (type === 'IDAT') {
      idatChunks.push(buf.subarray(dataStart, dataStart + len));
    } else if (type === 'IEND') {
      break;
    }
    pos = dataStart + len + 4;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`Unsupported PNG format (depth=${bitDepth}, colorType=${colorType})`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const out = new Uint8Array(width * height * bpp);

  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }

  let inOff = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[inOff++];
    const rowOff = y * stride;
    for (let x = 0; x < stride; x++) {
      const val = raw[inOff++];
      const a = x >= bpp ? out[rowOff + x - bpp] : 0;
      const b = y > 0 ? out[rowOff - stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[rowOff - stride + x - bpp] : 0;
      let recon = val;
      if (filter === 1) recon = (val + a) & 0xff;
      else if (filter === 2) recon = (val + b) & 0xff;
      else if (filter === 3) recon = (val + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) recon = (val + paeth(a, b, c)) & 0xff;
      out[rowOff + x] = recon;
    }
  }

  return { width, height, bpp, data: out };
}

function latLonToTileFrac(lat, lon, z) {
  const n = 1 << z;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return [x, y];
}

async function fetchTerrariumDem(minLat, maxLat, minLon, maxLon, cLat, cLon, size, cells, onProgress) {
  // Choose zoom level so total tiles stay fast (<= 25 tiles)
  let zoom = 13;
  while (zoom > 9) {
    const [tx0, ty1] = latLonToTileFrac(minLat, minLon, zoom);
    const [tx1, ty0] = latLonToTileFrac(maxLat, maxLon, zoom);
    const count = (Math.floor(tx1) - Math.floor(tx0) + 1) * (Math.floor(ty1) - Math.floor(ty0) + 1);
    if (count <= 25) break;
    zoom--;
  }

  const [fx0, fy1] = latLonToTileFrac(minLat, minLon, zoom);
  const [fx1, fy0] = latLonToTileFrac(maxLat, maxLon, zoom);
  const xStart = Math.floor(fx0);
  const xEnd = Math.floor(fx1);
  const yStart = Math.floor(fy0);
  const yEnd = Math.floor(fy1);

  const tiles = new Map();
  const jobs = [];
  for (let ty = yStart; ty <= yEnd; ty++) {
    for (let tx = xStart; tx <= xEnd; tx++) {
      jobs.push([tx, ty]);
    }
  }

  let done = 0;
  const CONCURRENCY = 6;
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const batch = jobs.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ([tx, ty]) => {
        const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`;
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 12000);
          const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT } });
          clearTimeout(timer);
          if (res.ok) {
            const png = decodePng(Buffer.from(await res.arrayBuffer()));
            tiles.set(`${tx},${ty}`, png);
          }
        } catch {
          // ignore individual tile failures
        } finally {
          done++;
          if (onProgress) onProgress(`Fetching terrain elevation (${done}/${jobs.length} tiles)…`);
        }
      })
    );
  }

  if (tiles.size === 0) return null;

  function sampleLatLon(lat, lon) {
    const [fx, fy] = latLonToTileFrac(lat, lon, zoom);
    const tx = Math.floor(fx);
    const ty = Math.floor(fy);
    const tile = tiles.get(`${tx},${ty}`);
    if (!tile) return null;
    const px = Math.min(tile.width - 1, Math.max(0, Math.floor((fx - tx) * tile.width)));
    const py = Math.min(tile.height - 1, Math.max(0, Math.floor((fy - ty) * tile.height)));
    const off = (py * tile.width + px) * tile.bpp;
    const r = tile.data[off];
    const g = tile.data[off + 1];
    const b = tile.data[off + 2];
    return r * 256 + g + b / 256 - 32768;
  }

  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((cLat * Math.PI) / 180);
  const w = cells + 1;
  const step = size / cells;
  const heights = new Float32Array(w * w);

  for (let iz = 0; iz < w; iz++) {
    const z = -size / 2 + iz * step;
    const lat = cLat - z / mPerDegLat;
    for (let ix = 0; ix < w; ix++) {
      const x = -size / 2 + ix * step;
      const lon = cLon + x / mPerDegLon;
      const h = sampleLatLon(lat, lon);
      heights[iz * w + ix] = h !== null ? h : 0;
    }
  }

  return { heights, sampleLatLon };
}

function synthesizeOfflineDem(roadPts, size, cells) {
  const w = cells + 1;
  const step = size / cells;
  const heights = new Float32Array(w * w);
  // Subsample road points for fast IDW fallback
  const stride = Math.max(1, Math.floor(roadPts.length / 180));
  const samples = [];
  for (let i = 0; i < roadPts.length; i += stride) samples.push(roadPts[i]);

  for (let iz = 0; iz < w; iz++) {
    const z = -size / 2 + iz * step;
    for (let ix = 0; ix < w; ix++) {
      const x = -size / 2 + ix * step;
      let num = 0;
      let den = 0;
      for (let k = 0; k < samples.length; k++) {
        const [rx, ry, rz] = samples[k];
        const d2 = (x - rx) * (x - rx) + (z - rz) * (z - rz) + 400;
        const wt = 1 / d2;
        num += ry * wt;
        den += wt;
      }
      heights[iz * w + ix] = den > 0 ? num / den : 50;
    }
  }
  return heights;
}

function pointInPolygon(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

async function runOverpassQuery(query, timeoutMs = 30000) {
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ];
  for (const ep of endpoints) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(ep, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
      });
      clearTimeout(timer);
      if (res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.elements)) return json;
      }
    } catch {
      // try next mirror
    }
  }
  return null;
}

// Build a compact lat,lon polyline string for Overpass `around:R,lat1,lon1,...` corridor queries
function buildAroundPoly(gpsPts, maxPts = 60) {
  const stride = Math.max(1, Math.floor(gpsPts.length / maxPts));
  const coords = [];
  for (let i = 0; i < gpsPts.length; i += stride) {
    coords.push(gpsPts[i].lat.toFixed(5), gpsPts[i].lon.toFixed(5));
  }
  const last = gpsPts[gpsPts.length - 1];
  coords.push(last.lat.toFixed(5), last.lon.toFixed(5));
  return coords.join(',');
}

async function fetchOsmScenery(gpsPts, cLat, cLon, road, size, cells, onProgress) {
  const empty = { buildings: [], trees: [], lines: [], woods: '', sideRoads: [], credit: '' };
  const polyStr = buildAroundPoly(gpsPts, 55);

  // Query 1: Roads, slip lanes & roundabouts within 85m of the route corridor (fast, small payload)
  if (onProgress) onProgress('Fetching OpenStreetMap junctions & roundabouts…');
  const roadQuery = `[out:json][timeout:25];
(
  way["highway"~"^(trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|track)$"](around:85,${polyStr});
  way["junction"="roundabout"](around:85,${polyStr});
);
out body;
>;
out skel qt;`;
  const roadData = await runOverpassQuery(roadQuery, 28000);

  // Query 2: Buildings, woodland, trees & hedges within a compact corridor (fast even in urban areas)
  if (onProgress) onProgress('Fetching OpenStreetMap buildings, hedges & woodland…');
  const bldgPolyStr = buildAroundPoly(gpsPts, 28);
  const sceneryQuery = `[out:json][timeout:25];
(
  way["building"](around:90,${bldgPolyStr});
  way["natural"="wood"](around:180,${bldgPolyStr});
  way["landuse"="forest"](around:180,${bldgPolyStr});
  node["natural"="tree"](around:80,${bldgPolyStr});
  way["barrier"~"^(hedge|wall|retaining_wall)$"](around:80,${bldgPolyStr});
);
out body;
>;
out skel qt;`;
  const sceneryData = await runOverpassQuery(sceneryQuery, 28000);

  const elements = [
    ...(roadData?.elements || []),
    ...(sceneryData?.elements || []),
  ];
  if (!elements.length) return empty;
  const data = { elements };

  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((cLat * Math.PI) / 180);
  const toLocal = (lat, lon) => [(lon - cLon) * mPerDegLon, -(lat - cLat) * mPerDegLat];

  const nodes = new Map();
  const trees = [];
  for (const el of data.elements) {
    if (el.type === 'node') {
      const pt = toLocal(el.lat, el.lon);
      nodes.set(el.id, pt);
      if (el.tags?.natural === 'tree') {
        trees.push([+pt[0].toFixed(1), +pt[1].toFixed(1)]);
      }
    }
  }

  // Fast spatial grid for distance to ridden road
  const cellSz = 64;
  const roadGrid = new Map();
  for (let i = 0; i < road.length; i++) {
    const cx = Math.floor(road[i][0] / cellSz);
    const cz = Math.floor(road[i][2] / cellSz);
    const key = cx * 8192 + cz;
    let bucket = roadGrid.get(key);
    if (!bucket) {
      bucket = [];
      roadGrid.set(key, bucket);
    }
    bucket.push(i);
  }

  function distToMainRoad(x, z) {
    const cx = Math.floor(x / cellSz);
    const cz = Math.floor(z / cellSz);
    let best = Infinity;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const arr = roadGrid.get((cx + dx) * 8192 + (cz + dz));
        if (!arr) continue;
        for (const i of arr) {
          const d = Math.hypot(x - road[i][0], z - road[i][2]);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }

  const WIDTHS = {
    trunk: 7.2,
    trunk_link: 5.4,
    primary: 6.6,
    primary_link: 5.2,
    secondary: 6.2,
    secondary_link: 5.0,
    tertiary: 5.6,
    tertiary_link: 4.8,
    unclassified: 5.0,
    residential: 4.8,
    living_street: 4.4,
    service: 3.6,
    track: 3.2,
  };

  function clipOutward(pts, maxLen = 95) {
    const out = [pts[0]];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, z0] = pts[i - 1];
      const [x1, z1] = pts[i];
      const seg = Math.hypot(x1 - x0, z1 - z0);
      if (acc + seg >= maxLen) {
        const t = (maxLen - acc) / (seg || 1);
        out.push([+(x0 + (x1 - x0) * t).toFixed(1), +(z0 + (z1 - z0) * t).toFixed(1)]);
        break;
      }
      acc += seg;
      out.push([+x1.toFixed(1), +z1.toFixed(1)]);
    }
    return out;
  }

  const buildings = [];
  const lines = [];
  const woodPolys = [];
  const rawSideRoads = [];

  for (const el of data.elements) {
    if (el.type !== 'way' || !el.nodes || el.nodes.length < 2) continue;
    const tags = el.tags || {};
    const pts = el.nodes.map((id) => nodes.get(id)).filter(Boolean);
    if (pts.length < 2) continue;

    // 1. Buildings (within 450 m of route)
    if (tags.building && pts.length >= 3) {
      let cx = 0, cz = 0;
      for (const [x, z] of pts) { cx += x; cz += z; }
      cx /= pts.length;
      cz /= pts.length;
      if (distToMainRoad(cx, cz) < 450) {
        // Orientation from longest edge
        let bestLen = 0, ang = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          const dx = pts[i + 1][0] - pts[i][0];
          const dz = pts[i + 1][1] - pts[i][1];
          const l = Math.hypot(dx, dz);
          if (l > bestLen) { bestLen = l; ang = Math.atan2(dz, dx); }
        }
        const ca = Math.cos(-ang), sa = Math.sin(-ang);
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        for (const [x, z] of pts) {
          const u = (x - cx) * ca - (z - cz) * sa;
          const v = (x - cx) * sa + (z - cz) * ca;
          if (u < minU) minU = u; if (u > maxU) maxU = u;
          if (v < minV) minV = v; if (v > maxV) maxV = v;
        }
        const w = Math.max(3, Math.min(80, maxU - minU));
        const d = Math.max(3, Math.min(60, maxV - minV));
        const levels = parseFloat(tags['building:levels']) || 0;
        const h = parseFloat(tags.height) || (levels ? levels * 3.0 : (w * d > 350 ? 8.5 : 5.6));
        const pitched = w * d < 320 && h < 11 ? 1 : 0;
        buildings.push([+cx.toFixed(1), +cz.toFixed(1), +w.toFixed(1), +d.toFixed(1), +ang.toFixed(3), +h.toFixed(1), pitched]);
      }
      continue;
    }

    // 2. Woodland polygons
    if ((tags.natural === 'wood' || tags.landuse === 'forest') && pts.length >= 3) {
      woodPolys.push(pts);
      continue;
    }

    // 3. Hedges & dry-stone walls
    if (tags.barrier === 'hedge' || tags.barrier === 'wall' || tags.barrier === 'retaining_wall') {
      const kind = tags.barrier === 'hedge' ? 0 : 1;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, z1] = pts[i];
        const [x2, z2] = pts[i + 1];
        if (distToMainRoad((x1 + x2) / 2, (z1 + z2) / 2) < 180) {
          lines.push([+x1.toFixed(1), +z1.toFixed(1), +x2.toFixed(1), +z2.toFixed(1), kind]);
        }
      }
      continue;
    }

    // 4. Roundabouts & intersecting side roads / junctions
    const hw = tags.highway;
    if (tags.junction === 'roundabout' && pts.length >= 4) {
      const minD = Math.min(...pts.map(([x, z]) => distToMainRoad(x, z)));
      if (minD <= 35) {
        const ring = pts.map(([x, z]) => [+x.toFixed(1), +z.toFixed(1)]);
        if (Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) > 1) {
          ring.push(ring[0]);
        }
        rawSideRoads.push({
          points: ring,
          width: 7.2,
          name: tags.name || '',
          kind: 'roundabout',
        });
      }
      continue;
    }

    if (hw && WIDTHS[hw]) {
      const dArr = pts.map(([x, z]) => distToMainRoad(x, z));
      const minD = Math.min(...dArr);
      const maxD = Math.max(...dArr);
      if (minD > 20 || maxD < 15) continue;

      for (let i = 0; i < pts.length; i++) {
        if (dArr[i] > 20) continue;
        if (i + 1 < pts.length && dArr[i + 1] > dArr[i] + 1.5) {
          const branch = [[+pts[i][0].toFixed(1), +pts[i][1].toFixed(1)]];
          for (let j = i + 1; j < pts.length; j++) {
            branch.push([+pts[j][0].toFixed(1), +pts[j][1].toFixed(1)]);
            if (dArr[j] < 8 && branch.length > 2) break;
          }
          if (Math.max(...branch.map(([x, z]) => distToMainRoad(x, z))) >= 16) {
            rawSideRoads.push({
              points: clipOutward(branch, 95),
              width: WIDTHS[hw],
              name: tags.name || '',
              kind: hw === 'track' ? 'track' : 'road',
            });
          }
        }
        if (i - 1 >= 0 && dArr[i - 1] > dArr[i] + 1.5) {
          const branch = [[+pts[i][0].toFixed(1), +pts[i][1].toFixed(1)]];
          for (let j = i - 1; j >= 0; j--) {
            branch.push([+pts[j][0].toFixed(1), +pts[j][1].toFixed(1)]);
            if (dArr[j] < 8 && branch.length > 2) break;
          }
          if (Math.max(...branch.map(([x, z]) => distToMainRoad(x, z))) >= 16) {
            rawSideRoads.push({
              points: clipOutward(branch, 95),
              width: WIDTHS[hw],
              name: tags.name || '',
              kind: hw === 'track' ? 'track' : 'road',
            });
          }
        }
      }
    }
  }

  // Deduplicate side-road branches (always keep full roundabout rings intact)
  const sideRoads = [];
  const seenWayRings = new Set();
  for (const sr of rawSideRoads) {
    if (sr.kind === 'roundabout') {
      const key = `${Math.round(sr.points[0][0] / 5)},${Math.round(sr.points[0][1] / 5)}`;
      if (!seenWayRings.has(key)) {
        seenWayRings.add(key);
        sideRoads.push(sr);
      }
      continue;
    }
    const [x0, z0] = sr.points[0];
    const [x1, z1] = sr.points[Math.min(1, sr.points.length - 1)];
    const a1 = Math.atan2(z1 - z0, x1 - x0);
    const dup = sideRoads.some((o) => {
      if (o.kind === 'roundabout') return false;
      const [ox0, oz0] = o.points[0];
      if (Math.hypot(ox0 - x0, oz0 - z0) > 10) return false;
      const [ox1, oz1] = o.points[Math.min(1, o.points.length - 1)];
      const da = Math.abs(Math.atan2(Math.sin(a1 - Math.atan2(oz1 - oz0, ox1 - ox0)), Math.cos(a1 - Math.atan2(oz1 - oz0, ox1 - ox0))));
      return da < 0.45;
    });
    if (!dup) sideRoads.push(sr);
  }

  // Rasterize woodland polygons into compact bitmask matching course.js
  const wGrid = cells + 1;
  const woodBytes = new Uint8Array(Math.ceil((wGrid * wGrid) / 8));
  const step = size / cells;
  for (const poly of woodPolys) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of poly) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const ix0 = Math.max(0, Math.floor((minX + size / 2) / step));
    const ix1 = Math.min(cells, Math.ceil((maxX + size / 2) / step));
    const iz0 = Math.max(0, Math.floor((minZ + size / 2) / step));
    const iz1 = Math.min(cells, Math.ceil((maxZ + size / 2) / step));
    for (let iz = iz0; iz <= iz1; iz++) {
      const z = -size / 2 + iz * step;
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = -size / 2 + ix * step;
        if (pointInPolygon(x, z, poly)) {
          const idx = iz * wGrid + ix;
          woodBytes[idx >> 3] |= 1 << (idx & 7);
        }
      }
    }
  }

  return {
    buildings: buildings.slice(0, 2500),
    trees: trees.slice(0, 1500),
    lines: lines.slice(0, 2500),
    woods: Buffer.from(woodBytes).toString('base64'),
    sideRoads,
    credit: 'Scenery & roads © OpenStreetMap contributors.',
  };
}

function resampleAndSmoothRoad(rawPts, spacing = 14) {
  const resampled = [rawPts[0]];
  let carry = 0;
  for (let i = 1; i < rawPts.length; i++) {
    const a = rawPts[i - 1];
    const b = rawPts[i];
    const seg = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (seg < 0.2) continue;
    let d = spacing - carry;
    while (d <= seg) {
      const t = d / seg;
      resampled.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      d += spacing;
    }
    carry = seg - (d - spacing);
  }
  const last = rawPts[rawPts.length - 1];
  const prev = resampled[resampled.length - 1];
  if (Math.hypot(last[0] - prev[0], last[2] - prev[2]) > 3) resampled.push(last);

  // Gaussian elevation smoothing (radius 3) to eliminate GPS vertical jitter
  const weights = [0.06, 0.12, 0.2, 0.24, 0.2, 0.12, 0.06];
  const n = resampled.length;
  const smoothed = resampled.map((p, i) => {
    let y = 0;
    for (let k = -3; k <= 3; k++) {
      const idx = Math.min(n - 1, Math.max(0, i + k));
      y += resampled[idx][1] * weights[k + 3];
    }
    return [+p[0].toFixed(2), +y.toFixed(2), +p[2].toFixed(2)];
  });
  return smoothed;
}

function slugify(str) {
  return String(str || 'route')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'route';
}

function listPersonalCourses(coursesDir) {
  const manifestPath = path.join(coursesDir, 'index.json');
  if (!fs.existsSync(manifestPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveManifest(coursesDir, list) {
  fs.mkdirSync(coursesDir, { recursive: true });
  fs.writeFileSync(path.join(coursesDir, 'index.json'), JSON.stringify(list, null, 2), 'utf8');
}

function loadPersonalCourseData(coursesDir, courseId) {
  const safeId = path.basename(courseId);
  const filePath = path.join(coursesDir, `${safeId}.json`);
  if (!fs.existsSync(filePath)) throw new Error(`Personal course "${safeId}" not found.`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function deletePersonalCourse(coursesDir, courseId) {
  const safeId = path.basename(courseId);
  const filePath = path.join(coursesDir, `${safeId}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  const next = listPersonalCourses(coursesDir).filter((c) => c.id !== safeId);
  saveManifest(coursesDir, next);
  return next;
}

async function importRouteFile(filePath, coursesDir, onProgress) {
  if (onProgress) onProgress('Reading route file…');
  const parsed = parseRouteFile(filePath);
  const pts = parsed.points;

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of pts) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  const cLat = (minLat + maxLat) / 2;
  const cLon = (minLon + maxLon) / 2;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((cLat * Math.PI) / 180);

  const spanX = (maxLon - minLon) * mPerDegLon;
  const spanZ = (maxLat - minLat) * mPerDegLat;
  const size = Math.max(2400, Math.ceil((Math.max(spanX, spanZ) + 1200) / 100) * 100);
  const cells = size > 7000 ? 320 : 280;

  const padLat = (size / 2) / mPerDegLat;
  const padLon = (size / 2) / mPerDegLon;
  const demMinLat = cLat - padLat;
  const demMaxLat = cLat + padLat;
  const demMinLon = cLon - padLon;
  const demMaxLon = cLon + padLon;

  if (onProgress) onProgress('Fetching surrounding terrain elevation…');
  const demResult = await fetchTerrariumDem(
    demMinLat, demMaxLat, demMinLon, demMaxLon, cLat, cLon, size, cells, onProgress
  );

  // Project track points to local metres; fill any missing GPS elevations from DEM
  const localRaw = pts.map((p) => {
    const x = (p.lon - cLon) * mPerDegLon;
    const z = -(p.lat - cLat) * mPerDegLat;
    let y = p.ele;
    if (y === null && demResult) y = demResult.sampleLatLon(p.lat, p.lon);
    if (y === null || !Number.isFinite(y)) y = 50;
    return [x, y, z];
  });

  const road = resampleAndSmoothRoad(localRaw, 14);
  if (road.length < 4) throw new Error('Route is too short to import (need at least ~60 m).');

  // Detect closed loop vs point-to-point
  const first = road[0];
  const last = road[road.length - 1];
  const closed = Math.hypot(last[0] - first[0], last[2] - first[2]) < 120;

  // Distance & elevation gain stats
  let totalDistM = 0;
  let elevGainM = 0;
  for (let i = 1; i < road.length; i++) {
    totalDistM += Math.hypot(road[i][0] - road[i - 1][0], road[i][2] - road[i - 1][2]);
    const dy = road[i][1] - road[i - 1][1];
    if (dy > 0) elevGainM += dy;
  }

  // Finalize DEM height grid (or offline fallback)
  const heights = demResult ? demResult.heights : synthesizeOfflineDem(road, size, cells);
  let demMin = Infinity;
  let demMax = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    if (heights[i] < demMin) demMin = heights[i];
    if (heights[i] > demMax) demMax = heights[i];
  }
  if (demMax - demMin < 1) demMax = demMin + 1;

  const quant = new Uint16Array(heights.length);
  const invRange = 65535 / (demMax - demMin);
  for (let i = 0; i < heights.length; i++) {
    quant[i] = Math.max(0, Math.min(65535, Math.round((heights[i] - demMin) * invRange)));
  }
  const demBase64 = Buffer.from(quant.buffer).toString('base64');

  // Fetch OSM scenery along the route corridor (fast even in dense urban areas!)
  const osm = await fetchOsmScenery(pts, cLat, cLon, road, size, cells, onProgress);

  if (onProgress) onProgress('Saving course to library…');
  const existing = listPersonalCourses(coursesDir);
  const baseSlug = slugify(parsed.name);
  let id = `user-${baseSlug}`;
  let suffix = 2;
  while (existing.some((c) => c.id === id)) {
    id = `user-${baseSlug}-${suffix++}`;
  }

  const distanceKm = +(totalDistM / 1000).toFixed(1);
  const gainRounded = Math.round(elevGainM);
  const shortName = parsed.name.length > 18 ? `${parsed.name.slice(0, 17)}…` : parsed.name;

  const courseData = {
    name: parsed.name,
    size,
    cells,
    closed,
    startDistance: 0,
    demMin,
    demMax,
    road,
    dem: demBase64,
    credit: demResult ? 'Terrain: Mapzen/AWS Terrain Tiles.' : 'Terrain: Derived from route elevation.',
    osm,
  };

  fs.mkdirSync(coursesDir, { recursive: true });
  fs.writeFileSync(path.join(coursesDir, `${id}.json`), JSON.stringify(courseData), 'utf8');

  const meta = {
    id,
    name: parsed.name,
    shortName,
    subtitle: `${distanceKm} km · ${gainRounded} m climb · ${osm.sideRoads.length} junctions · ${osm.buildings.length} buildings${closed ? '' : ' · Point-to-point'}`,
    badge: 'Imported',
    type: 'personal',
    winter: false,
    startDistance: 0,
    loadingText: `Building ${parsed.name}…`,
    distanceKm,
    elevGainM: gainRounded,
    closed,
    createdAt: new Date().toISOString(),
  };

  existing.push(meta);
  saveManifest(coursesDir, existing);
  return meta;
}

module.exports = {
  importRouteFile,
  listPersonalCourses,
  loadPersonalCourseData,
  deletePersonalCourse,
};
