import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { createRng } from './noise.js';

const V3 = THREE.Vector3;

export function createWeatherSystem(renderer, scene, camera, uniforms, winterMode) {
  const sunElev = winterMode ? 4.5 : 11;
  const sunAz = -24;
  const sunDir = new V3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - sunElev),
    THREE.MathUtils.degToRad(sunAz)
  );
  const sunFlat = new V3(sunDir.x, 0, sunDir.z).normalize();

  const sky = new Sky();
  sky.scale.setScalar(450000);
  sky.material.uniforms.turbidity.value = winterMode ? 5 : 7;
  sky.material.uniforms.rayleigh.value = winterMode ? 3.2 : 2.2;
  sky.material.uniforms.mieCoefficient.value = 0.004;
  sky.material.uniforms.mieDirectionalG.value = 0.82;
  sky.material.uniforms.sunPosition.value.copy(sunDir);

  const envScene = new THREE.Scene();
  envScene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = pmrem.fromScene(envScene);
  scene.environment = envRT.texture;

  function sampleSkyColor(dir) {
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.FloatType });
    const cam = new THREE.PerspectiveCamera(2, 1, 0.1, 10);
    cam.lookAt(dir);
    renderer.setRenderTarget(rt);
    renderer.render(envScene, cam);
    const px = new Float32Array(64);
    renderer.readRenderTargetPixels(rt, 0, 0, 4, 4, px);
    renderer.setRenderTarget(null);
    rt.dispose();
    const valid = Number.isFinite(px[0]) && px[0] + px[1] + px[2] > 0.01;
    return valid ? new THREE.Color(px[0], px[1], px[2]) : new THREE.Color(0.9, 0.62, 0.42);
  }

  const hazeDir = new V3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(88),
    THREE.MathUtils.degToRad(sunAz + 55)
  );
  const hazeCol = sampleSkyColor(hazeDir);
  const hazeLum = (hazeCol.r + hazeCol.g + hazeCol.b) / 3;

  scene.add(sky);
  scene.fog = new THREE.FogExp2(hazeCol, 0.0007);

  const sun = new THREE.DirectionalLight(0xffb070, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, {
    left: -110,
    right: 110,
    top: 110,
    bottom: -110,
    near: 1,
    far: 700,
  });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(
    winterMode ? 0xa6b4ea : 0xa9b8ee,
    winterMode ? 0x9aa2b6 : 0x6b563a,
    2.2
  );
  scene.add(hemi);

  // Overcast + Starry Night sky dome
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(8000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uH: { value: new V3() },
        uZ: { value: new V3() },
        uA: { value: 0 },
        uPaint: { value: 0 },
        uGain: { value: hazeLum * 1.5 },
        uTime: uniforms.uTime,
      },
      vertexShader:
        'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: `
        uniform vec3 uH, uZ; uniform float uA, uPaint, uGain, uTime; varying vec3 vDir;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){
          vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p){ float s = 0., a = 0.5; for (int i = 0; i < 5; i++) { s += a * n(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
        vec3 starrySky(vec3 d){
          vec2 p = d.xz / (1.15 + d.y) * 1.6;
          float t = uTime * 0.03;
          vec2 q = p - vec2(0.25, -0.35); float r = length(q), tw = 2.6 * exp(-r * r * 6.);
          p = mat2(cos(tw), -sin(tw), sin(tw), cos(tw)) * q + vec2(0.25, -0.35);
          vec2 w = vec2(fbm(p * 1.6 + t), fbm(p * 1.6 + 5.2 - t));
          float f = fbm(p * 2.2 + w * 2.4), band = 0.5 + 0.5 * sin(f * 46. + w.x * 6.);
          vec3 col = mix(vec3(0.03, 0.07, 0.28), vec3(0.10, 0.25, 0.72), band);
          col = mix(col, vec3(0.45, 0.62, 0.9), smoothstep(0.62, 0.9, fbm(p * 3.1 - w * 2.)) * band);
          for (int i = 0; i < 11; i++) {
            vec2 s = vec2(h(vec2(float(i), 1.7)), h(vec2(float(i), 9.1))) * 2.6 - 1.3;
            float dd = length(p - s), rad = 0.07 + 0.06 * h(vec2(float(i), 4.));
            col = mix(col, vec3(1., 0.85, 0.25) * (0.6 + 0.4 * sin(dd * 160. - uTime * 1.5)), exp(-dd * dd / (rad * rad)) * 0.85);
            col += vec3(1., 0.95, 0.6) * smoothstep(rad * 0.28, 0., dd);
          }
          vec2 m = p - vec2(-0.85, 0.6); float md = length(m);
          col = mix(col, vec3(1., 0.8, 0.2) * (0.65 + 0.35 * sin(md * 120. - uTime)), exp(-md * md / 0.035) * 0.9);
          col += vec3(1.2, 0.9, 0.3) * smoothstep(0.075, 0.06, md) * smoothstep(0.05, 0.065, length(m - vec2(0.03, 0.012)));
          return col;
        }
        void main(){
          vec3 col = mix(uH, uZ, smoothstep(0.2, 0.9, vDir.y));
          if (uPaint > 0.01) col = mix(col, starrySky(normalize(vDir)) * uGain, uPaint);
          gl_FragColor = vec4(col, uA);
        }`,
    })
  );
  dome.renderOrder = 1;
  dome.frustumCulled = false;
  scene.add(dome);

  // Rain streaks
  const rng = createRng(909);
  const rainUniforms = {
    uTime: uniforms.uTime,
    uRain: { value: 0 },
    uVel: { value: new V3() },
    uCol: { value: new V3(0.9, 0.95, 1).multiplyScalar(hazeLum) },
  };
  const rainMesh = (() => {
    const count = 16000;
    const pos = new Float32Array(count * 6);
    const ends = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = rng() * 30;
      const y = rng() * 30;
      const z = rng() * 30;
      pos.set([x, y, z, x, y, z], i * 6);
      ends[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    const mesh = new THREE.LineSegments(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: rainUniforms,
        vertexShader: `
          uniform float uTime; uniform vec3 uVel; attribute float aEnd; varying float vA;
          void main(){
            vec3 fall = vec3(1.5, -13., 0.8);
            vec3 p = mod(position + fall * uTime - cameraPosition, 30.) - 15. + cameraPosition;
            p += (fall - uVel) * 0.03 * aEnd;
            vec4 mv = viewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
            vA = smoothstep(15., 9., -mv.z) * (1. - aEnd * 0.6);
          }`,
        fragmentShader:
          'uniform vec3 uCol; uniform float uRain; varying float vA; void main(){ gl_FragColor = vec4(uCol, vA * 0.3 * uRain); }',
      })
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  })();

  // Snowflakes
  const uSnow = { value: 0 };
  const snowMesh = (() => {
    const count = 9000;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) pos[i] = rng() * 40;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mesh = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: uniforms.uTime,
          uPx: uniforms.uPx,
          uSnow,
          uCol: { value: new V3(1, 1.02, 1.08).multiplyScalar(hazeLum * 2.4) },
        },
        vertexShader: `
          uniform float uTime, uPx; varying float vA;
          void main(){
            vec3 p = position + vec3(sin(uTime * 0.6 + position.y * 1.7) * 0.5 + uTime * 0.45, -uTime * 1.5, cos(uTime * 0.5 + position.x * 1.3) * 0.5);
            p = mod(p - cameraPosition, 40.) - 20. + cameraPosition;
            vec4 mv = viewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
            float d = -mv.z; gl_PointSize = clamp(0.05 * uPx / d, 1.3, 9.);
            vA = smoothstep(20., 13., d) * smoothstep(0.4, 1.6, d);
          }`,
        fragmentShader:
          'uniform vec3 uCol; uniform float uSnow; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uCol, smoothstep(0.5, 0.15, r) * vA * 0.8 * uSnow); }',
      })
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  })();

  const hz = [hazeCol.r, hazeCol.g, hazeCol.b];
  const grey = (r, g, b) => [r * hazeLum, g * hazeLum, b * hazeLum];
  const warmLit = grey(2.6, 1.75, 1.05);
  const warmDark = grey(0.42, 0.45, 0.58);

  const presets = {
    golden: {
      sun: 10, sunCol: [1, 0.69, 0.44], hemi: 2.2, fog: 0.0007, fogCol: hz,
      dome: 0, domeH: hz, domeZ: hz, cloud: 1, cLit: warmLit, cDark: warmDark,
      mote: 1, rays: 1, rain: 0, snow: 0, rough: 1, tint: 1, ground: 1, paint: 0, expo: 0.33,
    },
    overcast: {
      sun: 1.5, sunCol: [1, 1, 1], hemi: 7, fog: 0.0008, fogCol: grey(0.8, 0.83, 0.88),
      dome: 1, domeH: grey(0.8, 0.83, 0.88), domeZ: grey(0.5, 0.53, 0.6),
      cloud: 1, cLit: grey(0.98, 1, 1.04), cDark: grey(0.5, 0.53, 0.6),
      mote: 0, rays: 0, rain: 0, snow: 0, rough: 0.9, tint: 0.9, ground: 0.95, paint: 0, expo: 0.5,
    },
    rain: {
      sun: 0, sunCol: [1, 1, 1], hemi: 5.3, fog: 0.0016, fogCol: grey(0.5, 0.54, 0.6),
      dome: 1, domeH: grey(0.5, 0.54, 0.6), domeZ: grey(0.36, 0.39, 0.45),
      cloud: 1, cLit: grey(0.56, 0.6, 0.66), cDark: grey(0.3, 0.33, 0.39),
      mote: 0, rays: 0, rain: 1, snow: 0, rough: 0.32, tint: 0.55, ground: 0.72, paint: 0, expo: 0.5,
    },
    mist: {
      sun: 5, sunCol: [1, 0.8, 0.6], hemi: 2.6, fog: 0.0075, fogCol: hz.map((v) => v * 0.95),
      dome: 0.6, domeH: hz, domeZ: hz.map((v) => v * 0.8),
      cloud: 0.3, cLit: warmLit, cDark: warmDark,
      mote: 1, rays: 1.8, rain: 0, snow: 0, rough: 0.7, tint: 0.85, ground: 0.95, paint: 0, expo: 0.33,
    },
    starry: {
      sun: 5, sunCol: [1, 0.93, 0.74], hemi: 3.2, fog: 0.0005, fogCol: grey(0.16, 0.26, 0.52),
      dome: 1, domeH: grey(0.16, 0.26, 0.52), domeZ: grey(0.05, 0.1, 0.4),
      cloud: 0, cLit: warmLit, cDark: warmDark,
      mote: 5, rays: 0, rain: 0, snow: 0, rough: 0.95, tint: 1, ground: 1, paint: 1, expo: 0.5,
    },
    snow: {
      sun: 5, sunCol: [1, 0.64, 0.46], hemi: 2.5, fog: 0.0015,
      fogCol: [hz[0] * 0.8, hz[1] * 0.86, hz[2] * 1.05],
      dome: 0.4, domeH: hz, domeZ: grey(0.26, 0.33, 0.62),
      cloud: 0.8, cLit: grey(1.7, 1.2, 1.05), cDark: grey(0.34, 0.4, 0.62),
      mote: 0, rays: 0.8, rain: 0, snow: 1, rough: 0.5, tint: 0.62, ground: 1, paint: 0, expo: 0.38,
    },
  };

  const current = JSON.parse(JSON.stringify(presets.golden));
  let target = presets.golden;
  let currentName = 'golden';

  const WEATHER_LABELS = {
    golden: 'Golden',
    overcast: 'Overcast',
    rain: 'Rain',
    mist: 'Mist',
    starry: 'Starry',
    snow: 'Snow',
  };

  function setWeather(name, instant = false) {
    if (!presets[name]) return;
    currentName = name;
    target = presets[name];
    if (instant) {
      Object.assign(current, JSON.parse(JSON.stringify(target)));
    }
    // Re-bake environment reflection map for the target sky
    const u = dome.material.uniforms;
    const saved = [u.uA.value, u.uH.value.clone(), u.uZ.value.clone(), u.uPaint.value];
    u.uA.value = target.dome;
    u.uH.value.fromArray(target.domeH);
    u.uZ.value.fromArray(target.domeZ);
    u.uPaint.value = target.paint;
    envScene.add(sky, dome);
    const rt = pmrem.fromScene(envScene, 0, 0.1, 20000);
    scene.add(sky, dome);
    envRT.dispose();
    envRT = rt;
    scene.environment = rt.texture;
    u.uA.value = saved[0];
    u.uH.value.copy(saved[1]);
    u.uZ.value.copy(saved[2]);
    u.uPaint.value = saved[3];

    const weatherBtn = document.getElementById('btn-weather');
    if (weatherBtn) {
      weatherBtn.textContent = `Weather: ${WEATHER_LABELS[name] || name} ▾`;
    }
    document.querySelectorAll('#weather-panel .course-card').forEach((card) => {
      card.classList.toggle('active', card.dataset.weather === name);
    });
  }

  function stepWeather(dt, sceneryMode, terrainMat, roadMat) {
    const rate = Math.min(1, dt * (sceneryMode ? 0.07 : 1.2));
    for (const key in current) {
      const a = current[key];
      const b = target[key];
      if (Array.isArray(a)) {
        for (let i = 0; i < a.length; i++) a[i] += (b[i] - a[i]) * rate;
      } else {
        const k = key === 'dome' ? Math.min(1, dt * (sceneryMode ? 0.25 : 4)) : rate;
        current[key] += (b - a) * k;
      }
    }

    sun.intensity = current.sun;
    sun.color.setRGB(current.sunCol[0], current.sunCol[1], current.sunCol[2], THREE.SRGBColorSpace);
    hemi.intensity = current.hemi;
    scene.fog.density = current.fog;
    scene.fog.color.fromArray(current.fogCol);

    const u = dome.material.uniforms;
    u.uA.value = current.dome;
    u.uH.value.fromArray(current.domeH);
    u.uZ.value.fromArray(current.domeZ);
    u.uPaint.value = current.paint;
    dome.position.copy(camera.position);

    uniforms.uCloud.value = current.cloud;
    uniforms.uMote.value = current.mote;
    uniforms.uLid.value = current.dome;
    uniforms.uSunAmt.value = Math.min(1, current.sun / 10);
    uniforms.uCloudLit.value.fromArray(current.cLit);
    uniforms.uCloudDark.value.fromArray(current.cDark);
    uniforms.uCloudHaze.value.fromArray(current.fogCol);

    terrainMat.color.setScalar(current.ground);
    rainUniforms.uRain.value = current.rain;
    rainMesh.visible = current.rain > 0.01;
    uSnow.value = current.snow;
    snowMesh.visible = current.snow > 0.01;
    roadMat.roughness = current.rough;
    roadMat.color.setScalar(current.tint);
    renderer.toneMappingExposure = current.expo;
  }

  return {
    sunDir,
    sunFlat,
    sun,
    hazeCol,
    hazeLum,
    rainUniforms,
    current,
    get currentName() { return currentName; },
    setWeather,
    stepWeather,
  };
}
