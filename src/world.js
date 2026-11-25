import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCanvas2D, createRng, fbm, smoothstep } from './noise.js';
import {
  buildGrassTuftTexture,
  buildPineBoughTexture,
  buildRoadAlbedoTexture,
  buildShoulderTexture,
  buildWetRoughnessTexture,
  makeRepeatingTexture,
} from './textures.js';
import { buildSideRoads } from './junctions.js';

const V3 = THREE.Vector3;

function buildRibbonStrip(course, offA, dyA, offB, dyB, uA, uB, vTiles, isShoulder = false) {
  const { sampleCount: N, points: P, rights: R, closed } = course;
  const segCount = closed === false ? N - 1 : N;
  const pos = new Float32Array((segCount + 1) * 6);
  const uv = new Float32Array((segCount + 1) * 4);
  const idx = new Uint32Array(segCount * 6);
  for (let i = 0; i <= segCount; i++) {
    const j = closed === false ? Math.min(i, N - 1) : i % N;
    const p = P[j];
    const r = R[j];
    const ax = p.x + r.x * offA;
    const az = p.z + r.z * offA;
    const bx = p.x + r.x * offB;
    const bz = p.z + r.z * offB;
    let ay = p.y + dyA;
    let by = p.y + dyB;
    if (isShoulder) {
      const nrA = course.nearestRoad(ax, az);
      if ((nrA && nrA.d < 3.4) || course.isOnSideRoad(ax, az, 0.4)) ay -= 0.45;
      const nrB = course.nearestRoad(bx, bz);
      if ((nrB && nrB.d < 3.4) || course.isOnSideRoad(bx, bz, 0.4)) by -= 0.45;
    }
    pos.set([ax, ay, az, bx, by, bz], i * 6);
    uv.set([uA, (i / N) * vTiles, uB, (i / N) * vTiles], i * 4);
    if (i < segCount) idx.set([2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

export function buildWorld(scene, course, weather, images, maxAniso, uniforms, winterMode) {
  const rng = createRng(7);
  const {
    real,
    terrainSize: TS,
    terrainCells: TG,
    cellStep: TC,
    gridWidth: TW,
    heights: H,
    sampleCount: N,
    points: P,
    tangents: T,
    rights: R,
    length: LEN,
  } = course;

  /* ---------- 1. Terrain mesh ---------- */
  const tPos = new Float32Array(TW * TW * 3);
  const tUv = new Float32Array(TW * TW * 2);
  const tCol = new Float32Array(TW * TW * 3);
  for (let iz = 0; iz < TW; iz++) {
    for (let ix = 0; ix < TW; ix++) {
      const x = -TS / 2 + ix * TC;
      const z = -TS / 2 + iz * TC;
      const k = iz * TW + ix;
      tPos.set([x, H[k], z], k * 3);
      tUv.set([x / 4, z / 4], k * 2);
    }
  }
  const tIdx = new Uint32Array(TG * TG * 6);
  for (let iz = 0, q = 0; iz < TG; iz++) {
    for (let ix = 0; ix < TG; ix++) {
      const a = iz * TW + ix;
      const b = a + TW;
      const c = b + 1;
      const d = a + 1;
      tIdx[q++] = a; tIdx[q++] = b; tIdx[q++] = d;
      tIdx[q++] = b; tIdx[q++] = c; tIdx[q++] = d;
    }
  }

  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
  tGeo.setAttribute('uv', new THREE.BufferAttribute(tUv, 2));
  tGeo.setIndex(new THREE.BufferAttribute(tIdx, 1));
  tGeo.computeVertexNormals();

  const nrm = tGeo.attributes.normal.array;
  const col = new THREE.Color();
  const grassTintA = new THREE.Color(0.8, 0.95, 0.7);
  const grassTintB = new THREE.Color(1.3, 1.15, 0.75);
  const white = new THREE.Color(1, 1, 1);
  const tMix = new Float32Array(TW * TW * 2);

  for (let k = 0; k < TW * TW; k++) {
    const x = tPos[k * 3];
    const h = tPos[k * 3 + 1];
    const z = tPos[k * 3 + 2];
    const ny = nrm[k * 3 + 1];
    const rockAmt = smoothstep(0.86, 0.66, ny);
    const snowAmt = winterMode
      ? smoothstep(0.42, 0.72, ny) * 1.25
      : smoothstep(330, 430, h) * smoothstep(0.5, 0.75, ny);
    col.copy(grassTintA).lerp(grassTintB, smoothstep(0.3, 0.7, fbm(x / 45, z / 45, 3))).lerp(white, rockAmt);
    if (winterMode) {
      const drift = 0.9 + 0.2 * fbm(x / 30, z / 30, 3);
      col.setRGB(drift, drift, drift * 1.04);
    }
    tCol.set([col.r, col.g, col.b], k * 3);
    tMix.set([rockAmt, snowAmt], k * 2);
  }
  tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  tGeo.setAttribute('aMix', new THREE.BufferAttribute(tMix, 2));

  // Distant ridge self-shadowing + concavity shading
  const shade = new Float32Array(TW * TW);
  for (let iz = 0; iz < TW; iz++) {
    for (let ix = 0; ix < TW; ix++) {
      const k = iz * TW + ix;
      const x = tPos[k * 3];
      const h = H[k];
      const z = tPos[k * 3 + 2];
      const around =
        H[iz * TW + Math.max(ix - 1, 0)] +
        H[iz * TW + Math.min(ix + 1, TG)] +
        H[Math.max(iz - 1, 0) * TW + ix] +
        H[Math.min(iz + 1, TG) * TW + ix];
      const cavity = Math.min(1.2, Math.max(0.6, 1 - (around - 4 * h) * 0.06));
      tCol[k * 3] *= cavity;
      tCol[k * 3 + 1] *= cavity;
      tCol[k * 3 + 2] *= cavity;

      let lit = 1;
      let far = smoothstep(450, 650, Math.hypot(x, z));
      if (real) {
        const nr = course.nearestRoad(x, z);
        far = smoothstep(120, 220, nr ? nr.d : 999);
      }
      if (far > 0) {
        for (let t = 20; t < 1400; t += 22) {
          const px = x + weather.sunDir.x * t;
          const pz = z + weather.sunDir.z * t;
          if (Math.abs(px) > TS / 2 || Math.abs(pz) > TS / 2) break;
          lit = Math.min(lit, ((h + 3 + weather.sunDir.y * t - course.meshElevation(px, pz)) / t) * 10);
          if (lit <= 0) {
            lit = 0;
            break;
          }
        }
      }
      shade[k] = 1 - far * 0.58 * (1 - lit);
    }
  }
  tGeo.setAttribute('aShade', new THREE.BufferAttribute(shade, 1));

  const rockMap = makeRepeatingTexture(images.rock, maxAniso, true);
  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: makeRepeatingTexture(images.grass, maxAniso, true),
    normalMap: makeRepeatingTexture(images.grassNormal, maxAniso, false),
    roughness: 1,
  });
  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uRock = { value: rockMap };
    shader.uniforms.uSunAmt = uniforms.uSunAmt;
    shader.uniforms.uSunDir = { value: weather.sunDir };
    shader.uniforms.uValleyY = { value: real ? 105.0 : 32.0 };
    shader.vertexShader =
      'attribute vec2 aMix; attribute float aShade; varying vec2 vMix; varying float vShade; varying vec3 vWorldPos;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n vMix = aMix; vShade = aShade; vWorldPos = (modelMatrix * vec4(transformed, 1.)).xyz;'
      );
    shader.fragmentShader =
      'uniform sampler2D uRock; uniform float uSunAmt, uValleyY; uniform vec3 uSunDir; varying vec2 vMix; varying float vShade; varying vec3 vWorldPos;\n' +
      shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          `
          vec3 gc = mix(texture2D(map, vMapUv).rgb, texture2D(map, vMapUv * 0.137).rgb, 0.15);
          gc = mix(gc, vec3(gc.g * 0.6, gc.g * 1.05, gc.g * 0.35), 0.4);
          vec3 r1 = texture2D(uRock, vMapUv * 0.3).rgb;
          vec3 r2 = texture2D(uRock, vMapUv * 0.041).rgb;
          vec3 r3 = texture2D(uRock, vMapUv * 0.009).rgb;
          float l2 = dot(r2, vec3(0.333)), l3 = dot(r3, vec3(0.333));
          vec3 rc = mix(r1, r2, 0.4) * (0.35 + l2 * 1.2 + l3 * 1.6);
          float rockAmt = smoothstep(0.3, 0.7, vMix.x + (l2 - 0.3) * 0.9);
          float snowAmt = smoothstep(0.35, 0.65, vMix.y + (l3 - 0.3) * 0.8);
          diffuseColor.rgb *= mix(mix(gc, rc, rockAmt), ${winterMode ? 'vec3(0.66, 0.70, 0.78)' : 'vec3(0.92)'}, snowAmt) * mix(1., vShade, uSunAmt);`
        )
        .replace(
          '#include <fog_fragment>',
          `#include <fog_fragment>
          #ifdef USE_FOG
            // Subtle golden valley floor mist: denser in low hollows, clearer on high ridges
            vec3 toCam = vWorldPos - cameraPosition;
            float distW = length(toCam);
            float lowMask = exp(-max(0., vWorldPos.y - uValleyY) * 0.024);
            float sunScatter = pow(max(0., dot(normalize(toCam), normalize(uSunDir))), 4.) * uSunAmt;
            float valleyMist = (1. - exp(-distW * 0.0014 * lowMask)) * 0.42 * lowMask;
            vec3 mistCol = mix(fogColor, fogColor * vec3(1.22, 1.04, 0.82), sunScatter * 0.65);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, mistCol, clamp(valleyMist, 0., 0.65));
          #endif`
        );
  };

  const terrain = new THREE.Mesh(tGeo, terrainMat);
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  scene.add(terrain);

  /* ---------- 2. Road & gravel shoulders ---------- */
  const roadTiles = Math.round(LEN / 12);
  const asphaltMap = buildRoadAlbedoTexture(images.asphalt, maxAniso, winterMode);
  const asphaltNormal = makeRepeatingTexture(images.asphaltNormal, maxAniso, false);
  asphaltNormal.repeat.set(7 / 3, 4);

  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltMap,
    roughnessMap: buildWetRoughnessTexture(roadTiles, maxAniso),
    roughness: 1,
    metalness: 0,
    normalMap: asphaltNormal,
    normalScale: new THREE.Vector2(1.2, 1.2),
    envMapIntensity: 1,
  });
  roadMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uRain = weather.rainUniforms.uRain;
    shader.uniforms.uSunDir = { value: weather.sunDir };
    shader.uniforms.uSunAmt = uniforms.uSunAmt;
    shader.vertexShader =
      'varying vec3 vWp;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.)).xyz;'
      );
    shader.fragmentShader =
      `uniform float uTime, uRain, uSunAmt; uniform vec3 uSunDir; varying vec3 vWp;
      vec2 rip(vec2 p, float t){
        vec2 i = floor(p), f = fract(p) - 0.5;
        float h1 = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453), h2 = fract(h1 * 57.31 + 0.37);
        float life = fract(t * (0.7 + h2 * 0.6) + h1 * 7.);
        vec2 d = f - (vec2(h1, h2) - 0.5) * 0.24; float r = length(d) + 1e-4, R = life * 0.36;
        return d / r * sin((r - R) * 60.) * exp(-pow((r - R) * 14., 2.)) * (1. - life);
      }\n` +
      shader.fragmentShader
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          if (uRain > 0.01) {
            vec2 rp = rip(vWp.xz * 3.2, uTime) + rip(vWp.xz * 2.1 + 13.7, uTime * 0.9 + 3.);
            normal = normalize(normal + (viewMatrix * vec4(rp.x, 0., rp.y, 0.)).xyz * 0.5 * uRain * smoothstep(40., 8., length(vViewPosition)));
          }`
        )
        .replace(
          '#include <dithering_fragment>',
          `// Grazing-angle golden sunset sheen on damp asphalt & puddles
          vec3 viewDirW = normalize(cameraPosition - vWp);
          float fresnel = pow(1. - max(0., viewDirW.y), 4.0);
          vec3 reflDir = reflect(-viewDirW, vec3(0., 1., 0.));
          float sunGlint = pow(max(0., dot(reflDir, normalize(uSunDir))), 18.0) * uSunAmt;
          float dampBoost = 0.22 + uRain * 0.65;
          gl_FragColor.rgb += vec3(1.0, 0.72, 0.42) * sunGlint * fresnel * dampBoost * 0.55;
          #include <dithering_fragment>`
        );
  };

  const road = new THREE.Mesh(buildRibbonStrip(course, -3.5, 0, 3.5, 0, 0, 1, roadTiles), roadMat);
  road.receiveShadow = true;
  scene.add(road);

  const shoulderMat = new THREE.MeshStandardMaterial({
    map: buildShoulderTexture(images.gravel, maxAniso, winterMode),
    roughness: 1,
  });
  for (const geo of [
    buildRibbonStrip(course, -6.8, -0.72, -3.5, -0.025, 1, 0, LEN / 5, true),
    buildRibbonStrip(course, 3.5, -0.025, 6.8, -0.72, 0, 1, LEN / 5, true),
  ]) {
    const m = new THREE.Mesh(geo, shoulderMat);
    m.receiveShadow = true;
    scene.add(m);
  }

  buildSideRoads(scene, course, images, maxAniso, winterMode);

  /* ---------- 2b. Roadside wooden verge posts & wildflowers for foreground parallax ---------- */
  {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new V3(0, 1, 0);
    const sc = new V3();
    const ps = new V3();
    const c = new THREE.Color();

    // Weathered timber verge posts spaced along scenic outer bends
    const postPositions = [];
    for (let i = 0; i < N; i += 28) {
      if (fbm(i / 45 + 2.1, 1.3, 2) < 0.44) continue;
      for (const side of [-1, 1]) {
        if (rng() < 0.35) continue;
        const off = side * (4.15 + rng() * 0.25);
        const x = P[i].x + R[i].x * off;
        const z = P[i].z + R[i].z * off;
        const nrP = course.nearestRoad(x, z);
        if ((nrP && nrP.d < 4.1) || course.isOnSideRoad(x, z, 2.5)) continue;
        const y = P[i].y - 0.14;
        postPositions.push([x, y, z, rng() * 0.12 - 0.06]);
      }
    }
    if (postPositions.length) {
      const postGeo = new THREE.CylinderGeometry(0.055, 0.068, 0.95, 6).translate(0, 0.475, 0);
      const postMat = new THREE.MeshStandardMaterial({ color: 0x5c4b3a, roughness: 0.95 });
      const posts = new THREE.InstancedMesh(postGeo, postMat, postPositions.length);
      postPositions.forEach(([x, y, z, tilt], idx) => {
        ps.set(x, y, z);
        q.setFromEuler(new THREE.Euler(tilt, rng() * Math.PI * 2, tilt * 0.5));
        sc.set(1, 0.85 + rng() * 0.3, 1);
        posts.setMatrixAt(idx, m4.compose(ps, q, sc));
        posts.setColorAt(idx, c.setHSL(0.08 + rng() * 0.03, 0.18, 0.34 + rng() * 0.16));
      });
      posts.castShadow = true;
      posts.receiveShadow = true;
      posts.frustumCulled = false;
      scene.add(posts);
    }

    // Wildflower clusters (buttercups, daisies, cow parsley) along the verge in non-winter mode
    if (!winterMode) {
      const flowerCount = Math.min(4500, Math.floor(N * 1.4));
      const flowerGeo = new THREE.IcosahedronGeometry(0.065, 0);
      const flowerMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
      const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCount);
      const palette = [
        [0.98, 0.84, 0.22], // buttercup yellow
        [0.96, 0.96, 0.90], // oxeye daisy white
        [0.92, 0.95, 0.82], // cow parsley cream
        [0.86, 0.56, 0.72], // clover pink
      ];
      for (let k = 0; k < flowerCount; k++) {
        const i = Math.floor(rng() * N);
        const side = rng() < 0.5 ? -1 : 1;
        const d = 3.85 + Math.pow(rng(), 1.4) * 7.5;
        const j = (rng() - 0.5) * 1.5;
        const x = P[i].x + R[i].x * side * d + T[i].x * j;
        const z = P[i].z + R[i].z * side * d + T[i].z * j;
        const nrF = course.nearestRoad(x, z);
        if ((nrF && nrF.d < 3.9) || course.isOnSideRoad(x, z, 1.5)) {
          flowers.setMatrixAt(k, m4.makeScale(0, 0, 0));
          flowers.setColorAt(k, c.setRGB(1, 1, 1));
          continue;
        }
        const y = course.meshElevation(x, z);
        const s = 0.65 + rng() * 1.1;
        ps.set(x, y + 0.18 + rng() * 0.34, z);
        q.setFromAxisAngle(up, rng() * Math.PI * 2);
        sc.set(s, s * 0.65, s);
        flowers.setMatrixAt(k, m4.compose(ps, q, sc));
        const rgb = palette[(rng() * palette.length) | 0];
        flowers.setColorAt(k, c.setRGB(rgb[0], rgb[1], rgb[2]));
      }
      flowers.receiveShadow = true;
      flowers.frustumCulled = false;
      scene.add(flowers);
    }
  }

  /* ---------- 3. Real-course countryside: sheep flocks & hay stooks ---------- */
  const pastureStamps = [];
  if (real) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new V3(0, 1, 0);
    const sc = new V3();
    const ps = new V3();
    const c = new THREE.Color();

    const isOpen = (x, z) =>
      Math.abs(x) < TS / 2 - 60 && Math.abs(z) < TS / 2 - 60 && !real.isWoodland(x, z);
    const slopeAt = (x, z) =>
      Math.hypot(
        course.demElevation(x + 10, z) - course.demElevation(x - 10, z),
        course.demElevation(x, z + 10) - course.demElevation(x, z - 10)
      ) / 20;
    const roadDist = (x, z) => {
      const nr = course.nearestRoad(x, z);
      return nr ? nr.d : 999;
    };
    const tintGround = (x, z, r, rgb) => {
      const i0 = Math.round((x + TS / 2) / TC);
      const j0 = Math.round((z + TS / 2) / TC);
      const n = Math.ceil(r / TC);
      for (let j = j0 - n; j <= j0 + n; j++) {
        for (let i = i0 - n; i <= i0 + n; i++) {
          if (i < 0 || j < 0 || i > TG || j > TG) continue;
          const k = j * TW + i;
          const f = smoothstep(r, r * 0.6, Math.hypot(tPos[k * 3] - x, tPos[k * 3 + 2] - z));
          for (let a = 0; a < 3; a++) tCol[k * 3 + a] += (rgb[a] - tCol[k * 3 + a]) * f;
        }
      }
      tGeo.attributes.color.needsUpdate = true;
    };
    const paintGeo = (g, r, gg, b) => {
      const count = g.attributes.position.count;
      const arr = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) arr.set([r, gg, b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return g;
    };
    const placeInstanced = (geo, mat, spots, fn) => {
      if (!spots.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
      spots.forEach(([x, z], i) => {
        fn(x, z);
        mesh.setMatrixAt(i, m4.compose(ps, q, sc));
        mesh.setColorAt(i, c);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
    };

    // Sheep flocks on high ground
    const sheep = [];
    for (let n = 0; n < 5000 && pastureStamps.length < 46; n++) {
      const i = Math.floor(rng() * N);
      if (P[i].y < 175) continue;
      const off = (rng() < 0.5 ? -1 : 1) * (30 + rng() * 65);
      const x = P[i].x + R[i].x * off;
      const z = P[i].z + R[i].z * off;
      if (!isOpen(x, z) || roadDist(x, z) < 24 || slopeAt(x, z) > 0.3) continue;
      if (pastureStamps.some((s) => Math.hypot(s.x - x, s.z - z) < 70)) continue;
      pastureStamps.push({ x, z, r: 48, amt: 0.36 });
      const flockSize = 6 + rng() * 9;
      for (let k = 0; k < flockSize; k++) {
        const a = rng() * Math.PI * 2;
        const rad = Math.sqrt(rng()) * 24;
        const sx = x + Math.cos(a) * rad;
        const sz = z + Math.sin(a) * rad;
        if (roadDist(sx, sz) > 10 && !real.isWoodland(sx, sz)) sheep.push([sx, sz]);
      }
    }

    const sheepGeo = (headY) =>
      mergeGeometries([
        paintGeo(new THREE.SphereGeometry(0.5, 9, 7).scale(1.12, 0.76, 0.7).translate(0, 0.74, 0), 0.82, 0.78, 0.69),
        paintGeo(new THREE.BoxGeometry(0.3, 0.24, 0.22).translate(0.66, headY, 0), 0.1, 0.09, 0.08),
        ...[
          [0.32, 0.19],
          [0.32, -0.19],
          [-0.32, 0.19],
          [-0.32, -0.19],
        ].map(([lx, lz]) => paintGeo(new THREE.BoxGeometry(0.08, 0.44, 0.08).translate(lx, 0.22, lz), 0.1, 0.09, 0.08)),
      ]);
    const woolMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const standSheep = (x, z) => {
      ps.set(x, course.meshElevation(x, z), z);
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      const s = 1.1 + rng() * 0.35;
      sc.set(s, s, s);
      c.setScalar(0.85 + rng() * 0.15);
    };
    placeInstanced(sheepGeo(0.4), woolMat, sheep.filter((_, i) => i % 3 !== 0), standSheep);
    placeInstanced(sheepGeo(0.86), woolMat, sheep.filter((_, i) => i % 3 === 0), standSheep);

    // Cut fields with hay stooks in the vale
    const stooks = [];
    let fieldCount = 0;
    for (let n = 0; n < 5000 && fieldCount < 26; n++) {
      const i = Math.floor(rng() * N);
      if (P[i].y > 150) continue;
      const off = (rng() < 0.5 ? -1 : 1) * (48 + rng() * 50);
      const x = P[i].x + R[i].x * off;
      const z = P[i].z + R[i].z * off;
      if (!isOpen(x, z) || roadDist(x, z) < 40 || slopeAt(x, z) > 0.1) continue;
      if (pastureStamps.some((s) => Math.hypot(s.x - x, s.z - z) < 110)) continue;
      pastureStamps.push({ x, z, r: 46, amt: 0.5 });
      tintGround(x, z, 46, [1.5, 1.22, 0.6]);
      fieldCount++;
      const a = Math.atan2(T[i].z, T[i].x);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (let u = -3; u <= 3; u++) {
        for (let v = -2; v <= 2; v++) {
          const du = u * 9 + (rng() - 0.5) * 1.5;
          const dv = v * 10 + (rng() - 0.5) * 1.5;
          const sx = x + du * ca - dv * sa;
          const sz = z + du * sa + dv * ca;
          if (!real.isWoodland(sx, sz) && roadDist(sx, sz) > 12) stooks.push([sx, sz]);
        }
      }
    }
    const [stc, stg] = createCanvas2D(64, 64);
    stg.fillStyle = '#b8964a';
    stg.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 260; i++) {
      const l = 150 + ((rng() * 80) | 0);
      stg.fillStyle = `rgb(${l},${(l * 0.8) | 0},${(l * 0.42) | 0})`;
      stg.fillRect(rng() * 64, 0, 1 + rng() * 1.5, 64);
    }
    const strawTex = new THREE.CanvasTexture(stc);
    strawTex.colorSpace = THREE.SRGBColorSpace;
    placeInstanced(
      new THREE.ConeGeometry(0.62, 1.5, 7).translate(0, 0.75, 0),
      new THREE.MeshStandardMaterial({ map: strawTex, roughness: 1 }),
      stooks,
      (x, z) => {
        ps.set(x, course.meshElevation(x, z) - 0.05, z);
        q.setFromAxisAngle(up, rng() * Math.PI * 2);
        sc.set(1.3 + rng() * 0.5, 1.25 + rng() * 0.45, 1.3 + rng() * 0.5);
        c.setScalar(0.85 + rng() * 0.15);
      }
    );
  }

  /* ---------- 4. Chunked roadside grass + travelling meadow ---------- */
  const tuftGeo = (() => {
    const planes = [0, 1, 2, 3].map((k) =>
      new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateY((k * Math.PI) / 2)
    );
    const g = mergeGeometries(planes);
    const norm = g.attributes.normal;
    for (let i = 0; i < norm.count; i++) norm.setXYZ(i, 0, 1, 0);
    return g;
  })();

  const grassMap = buildGrassTuftTexture();
  const grassMat = new THREE.MeshStandardMaterial({ map: grassMap, alphaTest: 0.45, roughness: 1 });
  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uSunDir = { value: weather.sunDir };
    shader.uniforms.uSunAmt = uniforms.uSunAmt;
    shader.vertexShader =
      'uniform float uTime; varying float vTip; varying vec3 vGrassW;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTip = uv.y;
        #ifdef USE_INSTANCING
          vec4 wp = instanceMatrix * vec4(0., 0., 0., 1.);
          float w = sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.27) * 0.16 + sin(uTime * 3.3 + wp.x * 1.3) * 0.05;
          transformed.x += w * uv.y; transformed.z += w * 0.6 * uv.y;
          vGrassW = (instanceMatrix * vec4(transformed, 1.)).xyz;
        #else
          vGrassW = (modelMatrix * vec4(transformed, 1.)).xyz;
        #endif`
      );
    shader.fragmentShader =
      'uniform vec3 uSunDir; uniform float uSunAmt; varying float vTip; varying vec3 vGrassW;\n' +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `vec3 vToCam = normalize(cameraPosition - vGrassW);
        float backLit = pow(max(0., dot(-vToCam, normalize(uSunDir))), 3.5) * uSunAmt;
        gl_FragColor.rgb += vec3(0.45, 0.34, 0.10) * backLit * vTip * vTip;
        #include <dithering_fragment>`
      );
  };

  const grassChunks = [];
  if (!winterMode) {
    const PER = 40;
    const COUNT = 6000;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new V3(0, 1, 0);
    const sc = new V3();
    const ps = new V3();
    const c = new THREE.Color();

    const buildChunk = (c0) => {
      const mesh = new THREE.InstancedMesh(tuftGeo, grassMat, COUNT);
      for (let k = 0; k < COUNT; k++) {
        const i = c0 + Math.floor(rng() * PER);
        const side = rng() < 0.5 ? -1 : 1;
        const d = 3.55 + Math.pow(rng(), 1.6) * 12.5;
        const j = (rng() - 0.5) * 1.5;
        const x = P[i].x + R[i].x * side * d + T[i].x * j;
        const z = P[i].z + R[i].z * side * d + T[i].z * j;
        const nrG = course.nearestRoad(x, z);
        if ((nrG && nrG.d < 3.95) || course.isOnSideRoad(x, z, 2.0)) {
          mesh.setMatrixAt(k, m4.makeScale(0, 0, 0));
          mesh.setColorAt(k, c.setRGB(0.5, 0.5, 0.5));
          continue;
        }
        const y = course.meshElevation(x, z);
        const tall = 0.28 + rng() * 0.5 + (d > 5 ? rng() * 0.25 : 0);
        ps.set(x, y - 0.03, z);
        q.setFromAxisAngle(up, rng() * Math.PI * 2);
        sc.set(0.5 + rng() * 0.5, tall, 0.5 + rng() * 0.5);
        mesh.setMatrixAt(k, m4.compose(ps, q, sc));
        mesh.setColorAt(k, c.setHSL(0.19 + rng() * 0.07, 0.25 + rng() * 0.25, 0.5 + rng() * 0.25));
      }
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    };

    for (let c0 = 0; c0 + PER <= N; c0 += PER) {
      grassChunks.push({ center: P[c0 + PER / 2], mesh: null, build: () => buildChunk(c0) });
    }
  }

  // GPU-wrapped travelling meadow
  if (!winterMode) {
    const fieldData = new Float32Array(TW * TW * 4);
    for (let k = 0; k < TW * TW; k++) {
      const wx = tPos[k * 3];
      const wz = tPos[k * 3 + 2];
      const nr = course.nearestRoad(wx, wz);
      const sr = course.nearestSideRoad(wx, wz);
      let roadDist = nr ? Math.min(nr.d, 100) : 100;
      if (sr) roadDist = Math.min(roadDist, Math.max(0, sr.d - sr.halfWidth - Math.max(3.0, TC * 0.65)));
      fieldData.set(
        [
          H[k],
          roadDist,
          Math.max(tMix[k * 2], tMix[k * 2 + 1]),
          smoothstep(0.3, 0.7, fbm(wx / 45, wz / 45, 3)),
        ],
        k * 4
      );
    }
    for (const s of pastureStamps) {
      const i0 = Math.round((s.x + TS / 2) / TC);
      const j0 = Math.round((s.z + TS / 2) / TC);
      const n = Math.ceil(s.r / TC);
      for (let j = j0 - n; j <= j0 + n; j++) {
        for (let i = i0 - n; i <= i0 + n; i++) {
          if (i < 0 || j < 0 || i > TG || j > TG) continue;
          const k = j * TW + i;
          fieldData[k * 4 + 2] = Math.max(
            fieldData[k * 4 + 2],
            s.amt * smoothstep(s.r, s.r * 0.55, Math.hypot(tPos[k * 3] - s.x, tPos[k * 3 + 2] - s.z))
          );
        }
      }
    }
    const fieldTex = new THREE.DataTexture(fieldData, TW, TW, THREE.RGBAFormat, THREE.FloatType);
    fieldTex.needsUpdate = true;

    const span = 260;
    const count = 220000;
    const inst = new Float32Array(count * 4);
    const tall = new Float32Array(count);
    const tint = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      inst.set([rng() * span, rng() * span, rng() * Math.PI * 2, 0.6 + rng() * 0.6], i * 4);
      tall[i] = 0.3 + rng() * 0.6;
      c.setHSL(0.17 + rng() * 0.09, 0.25 + rng() * 0.25, 0.45 + rng() * 0.25);
      tint.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = tuftGeo.index;
    for (const a of ['position', 'normal', 'uv']) geo.setAttribute(a, tuftGeo.attributes[a]);
    geo.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 4));
    geo.setAttribute('aTall', new THREE.InstancedBufferAttribute(tall, 1));
    geo.setAttribute('color', new THREE.InstancedBufferAttribute(tint, 3));
    geo.instanceCount = count;

    const mat = new THREE.MeshStandardMaterial({
      map: grassMap,
      alphaTest: 0.45,
      roughness: 1,
      vertexColors: true,
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uTime: uniforms.uTime,
        uField: { value: fieldTex },
        uMeadowC: uniforms.uMeadow,
      });
      shader.vertexShader =
        'uniform float uTime; uniform vec2 uMeadowC; uniform sampler2D uField; attribute vec4 aInst; attribute float aTall;\n' +
        shader.vertexShader
          .replace(
            '#include <color_vertex>',
            `
            vec2 wxz = mod(aInst.xy - uMeadowC, ${span.toFixed(1)}) - ${(span / 2).toFixed(1)} + uMeadowC;
            vec2 gf = (wxz + ${(TS / 2).toFixed(1)}) / ${TC.toFixed(1)};
            ivec2 gi = clamp(ivec2(floor(gf)), ivec2(0), ivec2(${TG - 1}));
            vec2 gu = clamp(gf - vec2(gi), 0., 1.);
            vec4 fa = texelFetch(uField, gi, 0), fb = texelFetch(uField, gi + ivec2(0, 1), 0),
                 fc = texelFetch(uField, gi + ivec2(1, 1), 0), fd = texelFetch(uField, gi + ivec2(1, 0), 0);
            vec4 fl = gu.x + gu.y <= 1. ? fa + (fd - fa) * gu.x + (fb - fa) * gu.y : fc + (fb - fc) * (1. - gu.x) + (fd - fc) * (1. - gu.y);
            #include <color_vertex>
            vColor.rgb *= mix(vec3(0.8, 0.95, 0.7), vec3(1.3, 1.15, 0.75), fl.w) * 1.15;`
          )
          .replace(
            '#include <beginnormal_vertex>',
            `#include <beginnormal_vertex>
            objectNormal = normalize(vec3(fa.x - fd.x, ${TC.toFixed(1)}, fa.x - fb.x));`
          )
          .replace(
            '#include <begin_vertex>',
            `
            vec2 dc = abs(wxz - uMeadowC);
            float keep = (1. - smoothstep(${(span * 0.36).toFixed(1)}, ${(span * 0.48).toFixed(1)}, max(dc.x, dc.y)))
                       * smoothstep(12.5, 16.5, fl.y) * (1. - smoothstep(0.15, 0.5, fl.z));
            float cs = cos(aInst.z), sn = sin(aInst.z);
            vec3 loc = vec3(position.x * aInst.w, position.y * aTall, position.z * aInst.w);
            loc.xz = vec2(cs * loc.x - sn * loc.z, sn * loc.x + cs * loc.z);
            float wv = sin(uTime * 1.7 + wxz.x * 0.35 + wxz.y * 0.27) * 0.16 + sin(uTime * 3.3 + wxz.x * 1.3) * 0.05;
            loc.x += wv * uv.y; loc.z += wv * 0.6 * uv.y;
            vec3 transformed = vec3(wxz.x, fl.x - 0.03, wxz.y) + loc * keep;`
          );
    };
    const meadow = new THREE.Mesh(geo, mat);
    meadow.frustumCulled = false;
    meadow.receiveShadow = true;
    scene.add(meadow);
  }

  /* ---------- 5. Optional winter chalets + fairy lights (Valley winter mode) ---------- */
  const chalets = [];
  const fairyLights = { p: [], c: [] };
  const LIGHT_COLORS = [
    [1, 0.62, 0.25],
    [1, 0.12, 0.08],
    [0.15, 0.9, 0.25],
    [0.2, 0.4, 1],
    [1, 0.75, 0.1],
  ];

  if (winterMode && !real) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new V3(0, 1, 0);
    const sc = new V3();
    const ps = new V3();

    const [wc, wg] = createCanvas2D(256, 128);
    const [ec, eg] = createCanvas2D(256, 128);
    wg.fillStyle = '#3d2a1c';
    wg.fillRect(0, 0, 256, 128);
    for (let y = 0; y < 128; y += 9) {
      wg.fillStyle = `rgba(${20 + ((rng() * 30) | 0)},${12 + ((rng() * 16) | 0)},8,0.55)`;
      wg.fillRect(0, y, 256, 1.5);
    }
    wg.fillStyle = '#8d8a84';
    wg.fillRect(0, 100, 256, 28);
    eg.fillStyle = '#000';
    eg.fillRect(0, 0, 256, 128);
    for (const x of [44, 128, 212]) {
      wg.fillStyle = '#e9e2d0'; wg.fillRect(x - 21, 34, 42, 46);
      wg.fillStyle = '#f6c877'; wg.fillRect(x - 17, 38, 34, 38);
      wg.fillStyle = '#e9e2d0'; wg.fillRect(x - 1, 38, 2, 38); wg.fillRect(x - 17, 56, 34, 2);
      wg.fillStyle = '#dfe6f2'; wg.fillRect(x - 24, 80, 48, 5);
      const gr = eg.createRadialGradient(x, 60, 2, x, 57, 30);
      gr.addColorStop(0, '#ffd28a'); gr.addColorStop(1, '#c9781e');
      eg.fillStyle = gr; eg.fillRect(x - 17, 38, 34, 38);
      eg.fillStyle = '#000'; eg.fillRect(x - 1, 38, 2, 38); eg.fillRect(x - 17, 56, 34, 2);
    }
    const wallTex = new THREE.CanvasTexture(wc); wallTex.colorSpace = THREE.SRGBColorSpace;
    const emTex = new THREE.CanvasTexture(ec); emTex.colorSpace = THREE.SRGBColorSpace;
    const wallMat = new THREE.MeshStandardMaterial({
      map: wallTex, emissiveMap: emTex, emissive: 0xffffff, emissiveIntensity: 7, roughness: 0.95,
    });
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

    const rp = []; const rc = [];
    const snowC = [0.74, 0.78, 0.86]; const woodC = [0.2, 0.13, 0.08];
    const tri = (a, b, c, color) => { rp.push(...a, ...b, ...c); rc.push(...color, ...color, ...color); };
    for (const sgn of [-1, 1]) {
      const e1 = [-0.58, 0, sgn * 0.62]; const e2 = [0.58, 0, sgn * 0.62];
      const r1 = [-0.58, 1, 0]; const r2 = [0.58, 1, 0];
      if (sgn < 0) { tri(e1, r1, r2, snowC); tri(e1, r2, e2, snowC); }
      else { tri(e1, r2, r1, snowC); tri(e1, e2, r2, snowC); }
      const gx = sgn * 0.5;
      tri([gx, 0, -0.5], [gx, 0, 0.5], [gx, 0.8, 0], woodC);
      tri([gx, 0, 0.5], [gx, 0, -0.5], [gx, 0.8, 0], woodC);
    }
    const roofGeo = new THREE.BufferGeometry();
    roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    roofGeo.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
    roofGeo.computeVertexNormals();

    const WANT = 14;
    const walls = new THREE.InstancedMesh(box, wallMat, WANT);
    const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }), WANT);
    const stacks = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x77726b, roughness: 1 }), WANT);
    let placed = 0;

    for (let k = 0; k < WANT * 6 && placed < WANT; k++) {
      const i = Math.floor(((k + 0.2 + rng() * 0.6) / (WANT * 6)) * N) % N;
      const side = rng() < 0.5 ? -1 : 1;
      const d = 21 + rng() * 17;
      const x = P[i].x + R[i].x * side * d;
      const z = P[i].z + R[i].z * side * d;
      const y = course.meshElevation(x, z);
      if (Math.abs(y - P[i].y) > 8 || chalets.some((ch) => (ch[0] - x) ** 2 + (ch[1] - z) ** 2 < 140 * 140)) continue;
      const slope = Math.hypot(course.meshElevation(x + 5, z) - course.meshElevation(x - 5, z), course.meshElevation(x, z + 5) - course.meshElevation(x, z - 5)) / 10;
      if (slope > 0.4) continue;
      const w = 9 + rng() * 4; const dp = 6.5 + rng() * 2; const h = 3.9 + rng() * 0.8;
      const a = Math.atan2(-T[i].z, T[i].x); const lo = y - slope * 6 - 0.3;
      q.setFromAxisAngle(up, a);
      walls.setMatrixAt(placed, m4.compose(ps.set(x, lo, z), q, sc.set(w, h + (y - lo), dp)));
      const top = y + h; const rh = dp * 0.36;
      roofs.setMatrixAt(placed, m4.compose(ps.set(x, top, z), q, sc.set(w, rh, dp)));
      const ca = Math.cos(a); const sa = Math.sin(a);
      stacks.setMatrixAt(placed, m4.compose(ps.set(x + ca * w * 0.25, top + rh * 0.45, z - sa * w * 0.25), q, sc.set(0.8, rh * 0.9 + 0.5, 0.8)));
      for (const sgn of [-1, 1]) {
        for (let t = 0; t <= 1.001; t += 1 / 26) {
          const lx = (t - 0.5) * w * 1.14; const lz = sgn * dp * 0.6;
          fairyLights.p.push(x + ca * lx + sa * lz, top + 0.02 - 0.12 * Math.sin(t * Math.PI * 6) ** 2, z - sa * lx + ca * lz);
          fairyLights.c.push(...LIGHT_COLORS[0]);
        }
      }
      chalets.push([x, z]);
      placed++;
    }
    walls.count = roofs.count = stacks.count = placed;
    for (const m of [walls, roofs, stacks]) {
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m);
    }
  }

  /* ---------- 6. Trees (Conifers for Valley, English Broadleaf for real courses) ---------- */
  {
    const pos = []; const uv = []; const nrmArr = []; const idx = [];
    let treeMap;

    if (real) {
      const [lc, lg] = createCanvas2D(256, 256);
      for (let i = 0; i < 760; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * 116;
        const l = 20 + ((rng() * 42) | 0);
        lg.fillStyle = `rgb(${(l * 0.8) | 0},${l + 30},${(l * 0.42) | 0})`;
        lg.beginPath();
        lg.ellipse(
          128 + Math.cos(a) * r,
          128 + Math.sin(a) * r * 0.88,
          5 + rng() * 7,
          3 + rng() * 4,
          rng() * Math.PI,
          0,
          Math.PI * 2
        );
        lg.fill();
      }
      treeMap = new THREE.CanvasTexture(lc);
      treeMap.colorSpace = THREE.SRGBColorSpace;
      treeMap.anisotropy = 4;

      const crownCenter = new V3(0, 7, 0);
      const addQuad = (corners) => {
        const base = pos.length / 3;
        corners.forEach(([x, y, z], k) => {
          pos.push(x, y, z);
          uv.push(k === 0 || k === 3 ? 0 : 1, k < 2 ? 0 : 1);
          const n = new V3(x, y + 1.5, z).sub(crownCenter).normalize();
          nrmArr.push(n.x, n.y, n.z);
        });
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      for (const a of [0, 1.047, 2.094]) {
        const cx = Math.cos(a) * 4.2;
        const cz = Math.sin(a) * 4.2;
        addQuad([[-cx, 3.2, -cz], [cx, 3.2, cz], [cx, 10.8, cz], [-cx, 10.8, -cz]]);
      }
      for (const y of [5.6, 8.2]) {
        addQuad([[-3.7, y, -3.7], [3.7, y, -3.7], [3.7, y, 3.7], [-3.7, y, 3.7]]);
      }
    } else {
      treeMap = buildPineBoughTexture(winterMode);
      const addCard = (a, y, L, W, droop, vertical) => {
        const ca = Math.cos(a); const sa = Math.sin(a);
        const cd = Math.cos(droop); const sd = Math.sin(droop);
        const base = pos.length / 3;
        for (const [x, w] of [[0, -0.5], [1, -0.5], [1, 0.5], [0, 0.5]]) {
          const yy = vertical ? w * W : 0;
          const zz = vertical ? 0 : w * W;
          const xx = x * L + 0.05;
          const rad = xx * cd + yy * sd;
          const upv = -xx * sd + yy * cd;
          pos.push(rad * ca - zz * sa, y + upv, rad * sa + zz * ca);
          uv.push(x, w + 0.5);
          nrmArr.push(ca * 0.75, 0.66, sa * 0.75);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      for (let k = 0; k < 15; k++) {
        const t = k / 14;
        const y = 2.0 + t * 8.6;
        const L = 2.9 * Math.pow(1 - t, 0.85) + 0.4;
        const droop = 0.5 - t * 1.1;
        const a0 = rng() * Math.PI * 2;
        for (let b = 0; b < 5; b++) {
          const a = a0 + b * 1.2566 + (rng() - 0.5) * 0.5;
          const l = L * (0.8 + rng() * 0.35);
          addCard(a, y + (rng() - 0.5) * 0.3, l, l * 0.62, droop, false);
          addCard(a, y + (rng() - 0.5) * 0.3, l, l * 0.5, droop, true);
        }
      }
    }

    const folGeo = new THREE.BufferGeometry();
    folGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    folGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    folGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nrmArr, 3));
    folGeo.setIndex(idx);

    const folMat = new THREE.MeshStandardMaterial({
      map: treeMap,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    folMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uSunDir = { value: weather.sunDir };
      shader.uniforms.uSunAmt = uniforms.uSunAmt;
      shader.vertexShader =
        'uniform float uTime; varying vec3 vFolW;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec4 wp = instanceMatrix * vec4(0., 0., 0., 1.);
            transformed.x += sin(uTime * 1.1 + wp.x * 0.13 + wp.z * 0.09) * 0.022 * position.y;
            transformed.z += sin(uTime * 0.9 + wp.z * 0.11) * 0.016 * position.y;
            vFolW = (instanceMatrix * vec4(transformed, 1.)).xyz;
          #else
            vFolW = (modelMatrix * vec4(transformed, 1.)).xyz;
          #endif`
        );
      shader.fragmentShader =
        'uniform vec3 uSunDir; uniform float uSunAmt; varying vec3 vFolW;\n' +
        shader.fragmentShader
          .replace(
            '#include <normal_fragment_begin>',
            THREE.ShaderChunk.normal_fragment_begin.replace(/gl_FrontFacing \? 1\.0 : - ?1\.0/, '1.0')
          )
          .replace(
            '#include <dithering_fragment>',
            `// Golden-hour subsurface translucency when trees are backlit by the low sun
            vec3 viewToLeaf = normalize(vFolW - cameraPosition);
            float trans = pow(max(0., dot(viewToLeaf, normalize(uSunDir))), 3.0) * uSunAmt;
            gl_FragColor.rgb += diffuseColor.rgb * vec3(1.15, 0.78, 0.32) * trans * 0.45;
            #include <dithering_fragment>`
          );
    };

    const trunkGeo = real
      ? new THREE.CylinderGeometry(0.16, 0.3, 5.2, 6).translate(0, 2.6, 0)
      : new THREE.CylinderGeometry(0.04, 0.25, 10.8, 6).translate(0, 5.4, 0);

    const spots = [];
    const builtFootprints = new Set();
    const cellKey10 = (x, z) => Math.floor(x / 10) * 4096 + Math.floor(z / 10);
    if (real) {
      for (const [bx, bz, bw] of real.osm.buildings) {
        for (let dx = -bw / 2 - 4; dx <= bw / 2 + 4; dx += 10) {
          for (let dz = -bw / 2 - 4; dz <= bw / 2 + 4; dz += 10) {
            builtFootprints.add(cellKey10(bx + dx, bz + dz));
          }
        }
      }
      for (const [x, z] of real.osm.trees) {
        const nr = course.nearestRoad(x, z);
        if (!nr || nr.d > 5.5) spots.push([x, course.meshElevation(x, z), z]);
      }
    }

    const maxTries = real ? 320000 : 70000;
    const maxTrees = real ? 26000 : 7000;
    for (let n = 0; n < maxTries && spots.length < maxTrees; n++) {
      const x = (rng() - 0.5) * TS * 0.78;
      const z = (rng() - 0.5) * TS * 0.78;
      const nr = course.nearestRoad(x, z);
      const d = nr ? nr.d : 999;
      if (d < 11) continue;
      if (chalets.some((ch) => (ch[0] - x) ** 2 + (ch[1] - z) ** 2 < 170)) continue;
      if (real) {
        if (!real.isWoodland(x, z) || builtFootprints.has(cellKey10(x, z))) continue;
      } else {
        const forest = fbm(x / 140 + 3, z / 140 + 7, 3);
        if (!(forest > 0.53 || (d < 55 && rng() < (winterMode ? 0.42 : 0.1)))) continue;
      }
      const y = course.meshElevation(x, z);
      if (!real && y > 240) continue;
      spots.push([x, y, z]);
    }

    const fol = new THREE.InstancedMesh(folGeo, folMat, spots.length);
    const trunk = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshStandardMaterial({ color: 0x33251a, roughness: 1 }),
      spots.length
    );
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new V3(0, 1, 0);
    const sc = new V3();
    const ps = new V3();
    const c = new THREE.Color();

    spots.forEach(([x, y, z], i) => {
      const s = 0.9 + rng() * 0.9;
      ps.set(x, y - 0.3, z);
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      sc.set(s * (0.85 + rng() * 0.3), s, s * (0.85 + rng() * 0.3));
      m4.compose(ps, q, sc);
      fol.setMatrixAt(i, m4);
      trunk.setMatrixAt(i, m4);
      fol.setColorAt(i, c.setRGB(0.7 + rng() * 0.3, 0.75 + rng() * 0.25, 0.6 + rng() * 0.3));

      if (winterMode && !real && fairyLights.p.length < 90000 * 3) {
        const nr = course.nearestRoad(x, z);
        if (nr && nr.d < 70 && (nr.d < 45 || rng() < 0.6)) {
          const multicolor = rng() < 0.4;
          const a0 = rng() * Math.PI * 2;
          const w = (sc.x + sc.z) / 2;
          for (let k = 0; k < 80; k++) {
            const t = (k + rng() * 0.6) / 80;
            const rad = (2.9 * Math.pow(1 - t, 0.85) + 0.4) * 0.74 * w;
            const a = a0 + t * 54;
            fairyLights.p.push(x + Math.cos(a) * rad, y - 0.3 + (2.0 + t * 8.6) * s - 0.25 * rad, z + Math.sin(a) * rad);
            fairyLights.c.push(...(multicolor ? LIGHT_COLORS[(rng() * LIGHT_COLORS.length) | 0] : LIGHT_COLORS[0]));
          }
        }
      }
    });

    for (const m of [fol, trunk]) {
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m);
    }
  }

  if (fairyLights.p.length) {
    const n = fairyLights.p.length / 3;
    const ph = new Float32Array(n);
    for (let i = 0; i < n; i++) ph[i] = rng();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(fairyLights.p, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(fairyLights.c, 3));
    g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    const lights = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: uniforms.uTime, uPx: uniforms.uPx },
        vertexShader: `
          uniform float uTime, uPx; attribute vec3 aCol; attribute float aPh; varying vec3 vCol;
          void main(){
            vec4 mv = viewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv;
            float d = -mv.z, tw = 0.8 + 0.2 * sin(uTime * (1.2 + aPh * 2.5) + aPh * 40.);
            float px = 0.62 * uPx / d; gl_PointSize = clamp(px, 3., 30.);
            vCol = aCol * tw * (1. - smoothstep(450., 1100., d)) * min(1., px / 3.);
          }`,
        fragmentShader:
          'varying vec3 vCol; void main(){ float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vCol * (pow(smoothstep(0.5, 0.0, r), 2.) * 5. + smoothstep(0.2, 0.0, r) * 30.), 1.); }',
      })
    );
    lights.frustumCulled = false;
    lights.renderOrder = 4;
    scene.add(lights);
  }

  /* ---------- 7. Hedges & dry-stone walls (real courses) ---------- */
  if (real && real.osm.lines.length) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new V3(0, 1, 0);
    const sc = new V3();
    const ps = new V3();
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

    const [hc, hg] = createCanvas2D(64, 64);
    hg.fillStyle = '#263a17';
    hg.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 500; i++) {
      const l = 30 + ((rng() * 50) | 0);
      hg.fillStyle = `rgb(${(l * 0.7) | 0},${l + 20},${(l * 0.4) | 0})`;
      hg.fillRect(rng() * 64, rng() * 64, 2 + rng() * 3, 2 + rng() * 3);
    }

    const [wc, wg] = createCanvas2D(64, 64);
    wg.fillStyle = '#9c927c';
    wg.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 500; i++) {
      const l = (150 + (rng() - 0.5) * 90) | 0;
      wg.fillStyle = `rgba(${l},${l - 4},${l - 14},0.5)`;
      wg.fillRect(rng() * 64, rng() * 64, 2 + rng() * 5, 1 + rng() * 2);
    }

    const wrapTex = (canvas) => {
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };

    // Subdivide long hedge/wall segments into <= 8 m pieces so they follow hill slopes without floating
    const subLines = [];
    for (const [x1, z1, x2, z2, kind] of real.osm.lines) {
      const segLen = Math.hypot(x2 - x1, z2 - z1);
      const steps = Math.max(1, Math.ceil(segLen / 8));
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps;
        const t1 = (s + 1) / steps;
        const sx1 = x1 + (x2 - x1) * t0;
        const sz1 = z1 + (z2 - z1) * t0;
        const sx2 = x1 + (x2 - x1) * t1;
        const sz2 = z1 + (z2 - z1) * t1;
        const mx = (sx1 + sx2) * 0.5;
        const mz = (sz1 + sz2) * 0.5;
        const nr = course.nearestRoad(mx, mz);
        if ((nr && nr.d < 4.4) || course.isOnSideRoad(mx, mz, 1.8)) continue;
        subLines.push([sx1, sz1, sx2, sz2, kind]);
      }
    }

    const meshes = [
      new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ map: wrapTex(hc), roughness: 1 }), Math.max(1, subLines.length)),
      new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ map: wrapTex(wc), roughness: 1 }), Math.max(1, subLines.length)),
    ];
    const counts = [0, 0];
    for (const [x1, z1, x2, z2, kind] of subLines) {
      const mx = (x1 + x2) / 2;
      const mz = (z1 + z2) / 2;
      const segLen = Math.hypot(x2 - x1, z2 - z1);
      q.setFromAxisAngle(up, -Math.atan2(z2 - z1, x2 - x1));
      const scale = kind
        ? sc.set(segLen + 0.3, 1.9, 0.55)
        : sc.set(segLen + 0.4, 2.3 + rng() * 0.3, 1.3 + rng() * 0.3);
      meshes[kind].setMatrixAt(counts[kind]++, m4.compose(ps.set(mx, course.meshElevation(mx, mz) - 0.85, mz), q, scale));
    }
    meshes.forEach((m, k) => {
      m.count = counts[k];
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      scene.add(m);
    });
  }

  /* ---------- 7b. OpenStreetMap Buildings (2 instanced draw calls: walls + pitched roofs) ---------- */
  if (real && real.osm.buildings && real.osm.buildings.length) {
    // Check building centre AND all 4 rotated corners against both main road and side roads
    const bldgs = real.osm.buildings.filter(([cx, cz, w, d, ang]) => {
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const hw = w * 0.52;
      const hd = d * 0.52;
      const pts = [
        [cx, cz],
        [cx + ca * hw - sa * hd, cz + sa * hw + ca * hd],
        [cx - ca * hw - sa * hd, cz - sa * hw + ca * hd],
        [cx + ca * hw + sa * hd, cz + sa * hw - ca * hd],
        [cx - ca * hw + sa * hd, cz - sa * hw - ca * hd],
      ];
      for (const [px, pz] of pts) {
        const nr = course.nearestRoad(px, pz);
        if (nr && nr.d < 4.5) return false;
        if (course.isOnSideRoad(px, pz, 1.2)) return false;
      }
      return true;
    });
    if (bldgs.length) {
      // Procedural facade texture with subtle masonry & glazed windows
      const [fc, fg] = createCanvas2D(128, 128);
      fg.fillStyle = '#ddd6ca';
      fg.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 400; i++) {
        const v = 205 + ((rng() * 32) | 0);
        fg.fillStyle = `rgba(${v},${v - 5},${v - 12},0.35)`;
        fg.fillRect(rng() * 128, rng() * 128, 4 + rng() * 8, 2 + rng() * 3);
      }
      // 2 rows x 3 cols of windows
      for (let row = 0; row < 2; row++) {
        const wy = 20 + row * 52;
        for (let colIdx = 0; colIdx < 3; colIdx++) {
          const wx = 14 + colIdx * 38;
          fg.fillStyle = '#edeae4';
          fg.fillRect(wx - 2, wy - 2, 24, 30);
          fg.fillStyle = '#2d3744';
          fg.fillRect(wx, wy, 20, 26);
          fg.fillStyle = 'rgba(180,205,230,0.22)';
          fg.fillRect(wx + 2, wy + 2, 7, 10);
        }
      }
      const facadeTex = new THREE.CanvasTexture(fc);
      facadeTex.wrapS = THREE.RepeatWrapping;
      facadeTex.wrapT = THREE.RepeatWrapping;
      facadeTex.colorSpace = THREE.SRGBColorSpace;

      const wallGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const wallMat = new THREE.MeshStandardMaterial({ map: facadeTex, roughness: 0.9, metalness: 0.02 });
      const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, bldgs.length);

      // Gable pitched roof prism (width along X, depth along Z, ridge along X, height 0..1)
      const roofPos = new Float32Array([
        // Left slope (-Z to ridge)
        -0.52, 0, -0.52,  0.52, 0, -0.52,  0.52, 1, 0,
        -0.52, 0, -0.52,  0.52, 1, 0,     -0.52, 1, 0,
        // Right slope (+Z to ridge)
         0.52, 0,  0.52, -0.52, 0,  0.52, -0.52, 1, 0,
         0.52, 0,  0.52, -0.52, 1, 0,      0.52, 1, 0,
        // Front & back gable triangles
        -0.52, 0,  0.52, -0.52, 0, -0.52, -0.52, 1, 0,
         0.52, 0, -0.52,  0.52, 0,  0.52,  0.52, 1, 0,
      ]);
      const roofGeo = new THREE.BufferGeometry();
      roofGeo.setAttribute('position', new THREE.BufferAttribute(roofPos, 3));
      roofGeo.computeVertexNormals();
      const roofMat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0.05 });
      const pitchedBldgs = bldgs.filter((b) => b[6] === 1);
      const roofMesh = pitchedBldgs.length
        ? new THREE.InstancedMesh(roofGeo, roofMat, pitchedBldgs.length)
        : null;

      const wallPalette = [
        [0.78, 0.54, 0.44], // warm red brick
        [0.86, 0.79, 0.66], // Cotswold stone / sandstone
        [0.90, 0.88, 0.84], // cream render
        [0.76, 0.73, 0.69], // weathered grey stone
        [0.82, 0.66, 0.52], // buff brick
      ];
      const roofPalette = [
        [0.24, 0.25, 0.28], // dark slate
        [0.34, 0.30, 0.29], // weathered grey tile
        [0.48, 0.27, 0.21], // terracotta clay tile
      ];

      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new V3(0, 1, 0);
      const sc = new V3();
      const ps = new V3();
      const c = new THREE.Color();

      let rIdx = 0;
      bldgs.forEach(([cx, cz, w, d, ang, h, pitched], i) => {
        const baseY = course.meshElevation(cx, cz);
        const embed = 1.4;
        const wallH = Math.max(2.6, h || 5.6);
        q.setFromAxisAngle(up, -ang);
        ps.set(cx, baseY - embed, cz);
        sc.set(w, wallH + embed, d);
        wallMesh.setMatrixAt(i, m4.compose(ps, q, sc));
        const wp = wallPalette[(rng() * wallPalette.length) | 0];
        const v = 0.92 + rng() * 0.16;
        wallMesh.setColorAt(i, c.setRGB(wp[0] * v, wp[1] * v, wp[2] * v));

        if (pitched === 1 && roofMesh) {
          const roofH = Math.min(3.8, Math.max(1.5, Math.min(w, d) * 0.34));
          ps.set(cx, baseY + wallH - 0.05, cz);
          sc.set(w, roofH, d);
          roofMesh.setMatrixAt(rIdx, m4.compose(ps, q, sc));
          const rp = roofPalette[(rng() * roofPalette.length) | 0];
          const rv = 0.88 + rng() * 0.24;
          roofMesh.setColorAt(rIdx, c.setRGB(rp[0] * rv, rp[1] * rv, rp[2] * rv));
          rIdx++;
        }
      });

      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      wallMesh.frustumCulled = false;
      scene.add(wallMesh);
      if (roofMesh) {
        roofMesh.castShadow = true;
        roofMesh.receiveShadow = true;
        roofMesh.frustumCulled = false;
        scene.add(roofMesh);
      }
    }
  }

  /* ---------- 8. Quarry smoke on the scarp (real courses) ---------- */
  if (real && real.quarry) {
    const [qx, qz] = real.quarry;
    const candidates = [];
    for (let n = 0; n < 400; n++) {
      const x = qx + (rng() - 0.5) * 520;
      const z = qz + (rng() - 0.5) * 520;
      const slope = Math.hypot(
        course.demElevation(x + 10, z) - course.demElevation(x - 10, z),
        course.demElevation(x, z + 10) - course.demElevation(x, z - 10)
      );
      candidates.push([slope, x, z]);
    }
    candidates.sort((a, b) => b[0] - a[0]);
    const sources = [];
    for (const [, x, z] of candidates) {
      if (sources.length < 3 && sources.every((s) => Math.hypot(s[0] - x, s[1] - z) > 70)) {
        sources.push([x, z]);
      }
    }
    const PUFFS = 46;
    const total = sources.length * PUFFS;
    const pos = new Float32Array(total * 3);
    const phase = new Float32Array(total);
    sources.forEach(([x, z], k) => {
      const y = course.meshElevation(x, z) + 1.5;
      for (let i = 0; i < PUFFS; i++) {
        pos.set([x, y, z], (k * PUFFS + i) * 3);
        phase[k * PUFFS + i] = rng();
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPh', new THREE.BufferAttribute(phase, 1));
    const smoke = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: uniforms.uTime, uPx: uniforms.uPx, uCol: uniforms.uCloudHaze },
        vertexShader: `
          uniform float uTime, uPx; attribute float aPh; varying float vA;
          void main(){
            float age = fract(uTime * 0.035 + aPh);
            vec3 p = position + vec3(2.2, 0., 1.1) * age * 38.
                   + vec3(sin(aPh * 40. + age * 5.) * 3. * age, age * 30. + age * age * 26., cos(aPh * 31. + age * 4.) * 3. * age);
            vec4 mv = viewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
            gl_PointSize = (5. + age * 26.) * uPx / -mv.z;
            vA = smoothstep(0., 0.08, age) * (1. - age) * 0.5;
          }`,
        fragmentShader:
          'uniform vec3 uCol; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uCol * 1.05, smoothstep(0.5, 0.15, r) * vA); }',
      })
    );
    smoke.frustumCulled = false;
    smoke.renderOrder = 3;
    scene.add(smoke);
  }

  /* ---------- 9. Clouds & golden dust motes ---------- */
  {
    const clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: uniforms.uTime,
          uCloud: uniforms.uCloud,
          uLid: uniforms.uLid,
          uSun: { value: weather.sunFlat },
          uHaze: uniforms.uCloudHaze,
          uLit: uniforms.uCloudLit,
          uDark: uniforms.uCloudDark,
        },
        vertexShader:
          'varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position, 1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.); }',
        fragmentShader: `
          uniform float uTime, uCloud, uLid; uniform vec3 uSun, uHaze, uLit, uDark; varying vec3 vW;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n(vec2 p){
            vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
            return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
          }
          float fbm(vec2 p){ float s = 0., a = 0.5; for (int i = 0; i < 6; i++) { s += a * n(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
          float dens(vec2 p){ return smoothstep(0.46, 0.8, fbm(p)); }
          void main(){
            vec2 p = vW.xz * 0.00034 + uTime * 0.004;
            float d = dens(p), d2 = dens(p + uSun.xz * 0.07);
            vec3 col = mix(uDark, uLit, clamp(0.5 + (d - d2) * 1.7, 0., 1.));
            float fade = 1. - smoothstep(3200., 8500., length(vW.xz - cameraPosition.xz));
            gl_FragColor = vec4(mix(uHaze, col, 0.25 + 0.75 * fade), d * fade * 0.92 * uCloud * mix(1., smoothstep(0.25, 0.6, (vW.y - cameraPosition.y) / length(vW - cameraPosition)), uLid));
          }`,
      })
    );
    clouds.position.y = 1400;
    clouds.frustumCulled = false;
    clouds.renderOrder = 2;
    scene.add(clouds);

    const moteCount = 700;
    const motePos = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount * 3; i++) motePos[i] = rng() * 40;
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
    const motes = new THREE.Points(
      mg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: uniforms.uTime,
          uMote: uniforms.uMote,
          uCol: { value: new V3(2.4, 1.8, 1.1).multiplyScalar(weather.hazeLum) },
        },
        vertexShader: `
          uniform float uTime; varying float vA;
          void main(){
            vec3 p = position + vec3(sin(uTime * 0.3 + position.y) * 0.6, uTime * 0.08, cos(uTime * 0.25 + position.x) * 0.6);
            p = mod(p - cameraPosition, 40.) - 20. + cameraPosition;
            vec4 mv = viewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
            float d = -mv.z; gl_PointSize = clamp(60. / d, 1., 4.);
            vA = smoothstep(20., 12., d) * smoothstep(0.6, 3., d);
          }`,
        fragmentShader:
          'uniform vec3 uCol; uniform float uMote; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uCol, smoothstep(0.5, 0.1, r) * vA * 0.12 * uMote); }',
      })
    );
    motes.frustumCulled = false;
    motes.renderOrder = 3;
    scene.add(motes);
  }

  function updateGrassChunks(cameraPosition) {
    let builtOne = false;
    for (const chunk of grassChunks) {
      const d2 = chunk.center.distanceToSquared(cameraPosition);
      if (d2 < 230 * 230) {
        if (!chunk.mesh && !builtOne) {
          chunk.mesh = chunk.build();
          builtOne = true;
        }
      } else if (chunk.mesh && d2 > 330 * 330) {
        scene.remove(chunk.mesh);
        chunk.mesh.dispose();
        chunk.mesh = null;
      }
    }
  }

  return {
    terrainMat,
    roadMat,
    updateGrassChunks,
  };
}
