import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCanvas2D, smoothstep } from './noise.js';
import { makeRepeatingTexture } from './textures.js';

function resamplePolyline(pts, step = 3.0) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1];
    const [x1, z1] = pts[i];
    const segLen = Math.hypot(x1 - x0, z1 - z0);
    if (segLen < 0.05) continue;
    let d = step - carry;
    while (d <= segLen) {
      const t = d / segLen;
      out.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]);
      d += step;
    }
    carry = segLen - (d - step);
  }
  const last = pts[pts.length - 1];
  const prev = out[out.length - 1];
  if (Math.hypot(last[0] - prev[0], last[1] - prev[1]) > 0.5) out.push(last);
  return out;
}

// Trim a side-road polyline so it starts cleanly at the main road's outer edge (d ≈ edgeDist)
function trimToMainRoadEdge(pts, course, edgeDist = 3.45) {
  // If the OSM branch starts slightly outside the main road edge (e.g. rounded T-junction bend),
  // bridge it back to the main road centerline so it connects cleanly with no gap
  const nr0 = course.nearestRoad(pts[0][0], pts[0][1]);
  const bridged =
    nr0 && nr0.d > edgeDist && nr0.d < 24.0
      ? [[course.points[nr0.i].x, course.points[nr0.i].z], ...pts]
      : pts;

  const dense = resamplePolyline(bridged, 1.0);
  if (dense.length < 2) return null;

  // Find the last point inside edgeDist before the road heads outward
  let startIdx = 0;
  for (let i = 0; i < dense.length - 1; i++) {
    const nr = course.nearestRoad(dense[i][0], dense[i][1]);
    if (nr && nr.d < edgeDist) {
      startIdx = i;
    } else if (i > 0) {
      break;
    }
  }

  // Interpolate exact crossing point at d = edgeDist
  const out = [];
  if (startIdx + 1 < dense.length) {
    const a = dense[startIdx];
    const b = dense[startIdx + 1];
    const da = course.nearestRoad(a[0], a[1])?.d ?? edgeDist;
    const db = course.nearestRoad(b[0], b[1])?.d ?? edgeDist;
    if (da < edgeDist && db > da + 0.01) {
      const t = Math.max(0, Math.min(1, (edgeDist - da) / (db - da)));
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      for (let i = startIdx + 1; i < dense.length; i++) out.push(dense[i]);
    } else {
      for (let i = startIdx; i < dense.length; i++) out.push(dense[i]);
    }
  }

  return out.length >= 2 ? resamplePolyline(out, 3.0) : null;
}

// Compute exact per-vertex elevation so the junction mouth matches the main road's longitudinal slope
function sideRoadVertexY(vx, vz, course) {
  const nr = course.nearestRoad(vx, vz);
  const terrainY = course.meshElevation(vx, vz) + 0.05;
  if (!nr) return terrainY;
  if (nr.d <= 3.55) {
    // Sit flush (2 cm below) right at the main road edge so it never pokes through
    return nr.y - 0.02;
  }
  const k = smoothstep(3.55, 14.0, nr.d);
  // Smoothly transition from main road edge height to terrain height
  return (nr.y - 0.02) * (1 - k) + terrainY * k;
}

function buildSideRoadGeometry(trimmed, width, course, isPaved) {
  if (!trimmed || trimmed.length < 2) return null;

  const dists = [0];
  for (let i = 1; i < trimmed.length; i++) {
    dists.push(dists[i - 1] + Math.hypot(trimmed[i][0] - trimmed[i - 1][0], trimmed[i][1] - trimmed[i - 1][1]));
  }

  const n = trimmed.length;
  const pos = new Float32Array(n * 6);
  const uv = new Float32Array(n * 4);
  const idx = new Uint32Array((n - 1) * 6);

  for (let i = 0; i < n; i++) {
    const [x, z] = trimmed[i];
    const [px, pz] = trimmed[Math.max(0, i - 1)];
    const [nx, nz] = trimmed[Math.min(n - 1, i + 1)];
    let tx = nx - px;
    let tz = nz - pz;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const rx = -tz;
    const rz = tx;

    const s = dists[i];
    // Subtle curved bellmouth flare over the first 8 m outside the main road edge
    const flare = isPaved ? 1 + 0.48 * Math.pow(Math.max(0, 1 - s / 8), 2) : 1 + 0.25 * Math.max(0, 1 - s / 6);
    const hw = width * 0.5 * flare;

    const lx = x - rx * hw;
    const lz = z - rz * hw;
    const rxp = x + rx * hw;
    const rzp = z + rz * hw;

    // Each left/right edge samples its own nearestRoad/terrain Y so steep climbs stay perfectly flush!
    const yL = sideRoadVertexY(lx, lz, course);
    const yR = sideRoadVertexY(rxp, rzp, course);

    pos.set([lx, yL, lz, rxp, yR, rzp], i * 6);
    uv.set([0, s / 7, 1, s / 7], i * 4);
    if (i < n - 1) {
      idx.set([2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2], i * 6);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

function buildGiveWayTexture(maxAniso) {
  const [c, g] = createCanvas2D(256, 256);
  g.clearRect(0, 0, 256, 256);

  // Authentic UK Highway Code junction mouth markings:
  // - Single thin dashed line across the entering lane (left half when looking into the side road)
  // - Double dashed Give Way bar on the exiting lane (right half when looking into the side road = driver's LHS)
  g.fillStyle = 'rgba(244, 240, 232, 0.85)';
  const pad = 14;
  const mid = 128;

  // Entering lane: single dashed line
  for (let i = 0; i < 3; i++) {
    const step = (mid - pad - 6) / 3;
    const x = pad + i * step + step * 0.18;
    g.fillRect(x, 22, step * 0.62, 7);
  }

  // Exiting lane (LHS for exiting UK traffic): double dashed Give Way bar
  for (let i = 0; i < 3; i++) {
    const step = (256 - pad - (mid + 6)) / 3;
    const x = mid + 6 + i * step + step * 0.16;
    g.fillRect(x, 18, step * 0.64, 7);
    g.fillRect(x, 32, step * 0.64, 7);
  }

  // Slim centre dashed line leading into the side road
  g.fillStyle = 'rgba(240, 236, 228, 0.65)';
  g.fillRect(125, 62, 6, 44);
  g.fillRect(125, 134, 6, 44);
  g.fillRect(125, 206, 6, 38);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = maxAniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildSignpostTexture(label, arrowLeft, maxAniso) {
  const [c, g] = createCanvas2D(512, 144);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 144);
  g.strokeStyle = '#181a1d';
  g.lineWidth = 12;
  g.strokeRect(8, 8, 496, 128);

  const text = arrowLeft ? `← ${label}` : `${label} →`;
  g.fillStyle = '#111214';
  g.font = '800 48px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const maxW = 452;
  const measured = g.measureText(text).width;
  if (measured > maxW) {
    const px = Math.max(28, Math.floor((48 * maxW) / measured));
    g.font = `800 ${px}px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`;
  }
  g.fillText(text, 256, 74);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = maxAniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildSideRoads(scene, course, images, maxAniso, winterMode) {
  const sideRoads = course.sideRoads;
  if (!sideRoads || !sideRoads.length) return;

  const pavedGeos = [];
  const edgeMaskGeos = [];
  const trackGeos = [];
  const giveWayGeos = [];
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.75, metalness: 0.3 });
  const postGeo = new THREE.CylinderGeometry(0.04, 0.046, 1.78, 7);
  postGeo.translate(0, 0.89, 0);
  const placedSigns = [];

  for (const sr of sideRoads) {
    const pts = sr.points;
    if (!pts || pts.length < 2) continue;
    const isRoundabout = sr.kind === 'roundabout';
    const isPaved = sr.kind !== 'track';
    const width = sr.width || (isRoundabout ? 7.0 : isPaved ? 5.2 : 3.2);

    // Full roundabout rings are kept intact (not trimmed to main road edge) so the full traffic island closes cleanly
    if (isRoundabout) {
      const ringPts = resamplePolyline(pts, 2.5);
      const geo = buildSideRoadGeometry(ringPts, width, course, false);
      if (geo) pavedGeos.push(geo);
      continue;
    }

    const trimmed = trimToMainRoadEdge(pts, course, 3.45);
    if (!trimmed) continue;

    const geo = buildSideRoadGeometry(trimmed, width, course, isPaved);
    if (geo) (isPaved ? pavedGeos : trackGeos).push(geo);

    // Outward direction right at the trimmed mouth
    const [x0, z0] = trimmed[0];
    const [x1, z1] = trimmed[1];
    let dx = x1 - x0;
    let dz = z1 - z0;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    const rx = -dz;
    const rz = dx;

    // Give-way markings aligned parallel to the main road's edge, spanning the full flared mouth,
    // and masking out the main road's solid white edge line across the junction opening.
    if (isPaved) {
      const nrM = course.nearestRoad(x0, z0);
      const mainT = nrM ? course.tangents[nrM.i] : null;
      const mainR = nrM ? course.rights[nrM.i] : null;
      let ex = mainT ? mainT.x : rx;
      let ez = mainT ? mainT.z : rz;
      const el = Math.hypot(ex, ez) || 1;
      ex /= el;
      ez /= el;
      if (ex * rx + ez * rz < 0) {
        ex = -ex;
        ez = -ez;
      }
      const sinTheta = Math.max(0.45, Math.abs(dx * ez - dz * ex));
      // Span the full flared bellmouth width (1.46x) along the main road edge
      const hw = (width * 0.5 * 1.46) / sinTheta;

      // 1. Narrow asphalt cover strip over the main road's solid white edge line across the junction opening
      if (nrM && mainR) {
        const sideSign = dx * mainR.x + dz * mainR.z >= 0 ? 1 : -1;
        const cPt = course.points[nrM.i];
        const innerOff = sideSign * 2.95;
        const outerOff = sideSign * 3.55;
        const a0x = cPt.x + mainR.x * innerOff - ex * hw;
        const a0z = cPt.z + mainR.z * innerOff - ez * hw;
        const a1x = cPt.x + mainR.x * innerOff + ex * hw;
        const a1z = cPt.z + mainR.z * innerOff + ez * hw;
        const a2x = cPt.x + mainR.x * outerOff - ex * hw;
        const a2z = cPt.z + mainR.z * outerOff - ez * hw;
        const a3x = cPt.x + mainR.x * outerOff + ex * hw;
        const a3z = cPt.z + mainR.z * outerOff + ez * hw;
        const maskLift = 0.012;
        const yA = (x, z) => (course.nearestRoad(x, z)?.y ?? nrM.y) + maskLift;
        const mPos = new Float32Array([
          a0x, yA(a0x, a0z), a0z,
          a1x, yA(a1x, a1z), a1z,
          a2x, yA(a2x, a2z), a2z,
          a3x, yA(a3x, a3z), a3z,
        ]);
        const mUv = new Float32Array([0, 0, hw * 0.28, 0, 0, 0.2, hw * 0.28, 0.2]);
        const mGeo = new THREE.BufferGeometry();
        mGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
        mGeo.setAttribute('uv', new THREE.BufferAttribute(mUv, 2));
        mGeo.setIndex(sideSign > 0 ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 1, 3, 2]);
        mGeo.computeVertexNormals();
        edgeMaskGeos.push(mGeo);
      }

      // 2. Give-way line sitting right along the main road edge (replacing the masked solid white line)
      const mx = x0 - dx * 0.12;
      const mz = z0 - dz * 0.12;
      const len = 4.6;
      const p0x = mx - ex * hw, p0z = mz - ez * hw;
      const p1x = mx + ex * hw, p1z = mz + ez * hw;
      const p2x = p0x + dx * len, p2z = p0z + dz * len;
      const p3x = p1x + dx * len, p3z = p1z + dz * len;

      const lift = 0.032;
      const yQ = (x, z) => {
        const nq = course.nearestRoad(x, z);
        if (nq && nq.d <= 3.65) return nq.y + lift;
        return sideRoadVertexY(x, z, course) + lift;
      };
      const qPos = new Float32Array([
        p0x, yQ(p0x, p0z), p0z,
        p1x, yQ(p1x, p1z), p1z,
        p2x, yQ(p2x, p2z), p2z,
        p3x, yQ(p3x, p3z), p3z,
      ]);
      const qUv = new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]);
      const qGeo = new THREE.BufferGeometry();
      qGeo.setAttribute('position', new THREE.BufferAttribute(qPos, 3));
      qGeo.setAttribute('uv', new THREE.BufferAttribute(qUv, 2));
      qGeo.setIndex([0, 1, 2, 1, 3, 2]);
      qGeo.computeVertexNormals();
      giveWayGeos.push(qGeo);
    }

    // Named junction signpost (avoid duplicates within 25 m)
    if (sr.name && sr.name.trim()) {
      const nr = course.nearestRoad(x0, z0);
      if (nr && !placedSigns.some(([sx, sz]) => Math.hypot(sx - x0, sz - z0) < 25)) {
        placedSigns.push([x0, z0]);
        const mainT = course.tangents[nr.i];
        const mainR = course.rights[nr.i];
        const sideSign = dx * mainR.x + dz * mainR.z >= 0 ? 1 : -1;
        const sx = course.points[nr.i].x + mainR.x * sideSign * 4.8 + mainT.x * (width * 0.5 + 3.4);
        const sz = course.points[nr.i].z + mainR.z * sideSign * 4.8 + mainT.z * (width * 0.5 + 3.4);
        const sy = Math.max(nr.y - 0.25, course.meshElevation(sx, sz) - 0.05);

        const group = new THREE.Group();
        group.position.set(sx, sy, sz);
        // Face oncoming rider along main road
        group.rotation.y = Math.atan2(-mainT.x, -mainT.z);

        const post = new THREE.Mesh(postGeo, postMat);
        post.castShadow = true;
        group.add(post);

        // Mount double-sided sign plate on top of the post so it's readable from either approach with zero pole clipping
        const plateTex = buildSignpostTexture(sr.name.trim(), sideSign < 0, maxAniso);
        const plateMat = new THREE.MeshStandardMaterial({
          map: plateTex,
          roughness: 0.55,
          metalness: 0.02,
          emissive: 0x24221e,
        });
        const plateEdge = new THREE.MeshStandardMaterial({ color: 0x3b3e42, roughness: 0.8 });
        const plate = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 0.035), [
          plateEdge, plateEdge, plateEdge, plateEdge, plateMat, plateMat,
        ]);
        plate.position.set(0, 2.02, 0);
        plate.castShadow = true;
        group.add(plate);
        scene.add(group);
      }
    }
  }

  if (pavedGeos.length) {
    const mergedPaved = mergeGeometries(pavedGeos, false);
    pavedGeos.forEach((g) => g.dispose());
    const sideAsphalt = makeRepeatingTexture(images.asphalt, maxAniso, true);
    sideAsphalt.repeat.set(1.6, 1.6);
    const sideNorm = makeRepeatingTexture(images.asphaltNormal, maxAniso, false);
    sideNorm.repeat.set(1.6, 1.6);
    const pavedMat = new THREE.MeshStandardMaterial({
      map: sideAsphalt,
      normalMap: sideNorm,
      normalScale: new THREE.Vector2(1.0, 1.0),
      color: winterMode ? 0xb4b8c0 : 0xc4c0b8,
      roughness: 0.82,
      metalness: 0,
      envMapIntensity: 0.9,
    });
    const mesh = new THREE.Mesh(mergedPaved, pavedMat);
    mesh.receiveShadow = true;
    scene.add(mesh);

    if (edgeMaskGeos.length) {
      const mergedMask = mergeGeometries(edgeMaskGeos, false);
      edgeMaskGeos.forEach((g) => g.dispose());
      const maskMat = pavedMat.clone();
      maskMat.polygonOffset = true;
      maskMat.polygonOffsetFactor = -1;
      maskMat.polygonOffsetUnits = -1;
      const maskMesh = new THREE.Mesh(mergedMask, maskMat);
      maskMesh.receiveShadow = true;
      scene.add(maskMesh);
    }
  }

  if (trackGeos.length) {
    const mergedTrack = mergeGeometries(trackGeos, false);
    trackGeos.forEach((g) => g.dispose());
    const trackTex = makeRepeatingTexture(images.gravel, maxAniso, true);
    trackTex.repeat.set(1.5, 2.0);
    const trackMat = new THREE.MeshStandardMaterial({
      map: trackTex,
      color: winterMode ? 0xc2c8d2 : 0xb5aa96,
      roughness: 0.98,
    });
    const mesh = new THREE.Mesh(mergedTrack, trackMat);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  if (giveWayGeos.length) {
    const mergedMarkings = mergeGeometries(giveWayGeos, false);
    giveWayGeos.forEach((g) => g.dispose());
    const markMat = new THREE.MeshStandardMaterial({
      map: buildGiveWayTexture(maxAniso),
      transparent: true,
      depthWrite: false,
      roughness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const markMesh = new THREE.Mesh(mergedMarkings, markMat);
    markMesh.receiveShadow = true;
    scene.add(markMesh);
  }
}
