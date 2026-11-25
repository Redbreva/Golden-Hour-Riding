import * as THREE from 'three';
import { smoothstep } from './noise.js';
import { loadSurfaceImages } from './textures.js';
import { COURSES, getCourseById, resolveCourseFromSearch } from './courses.js';
import { createCourse, loadRealCourseData } from './course.js';
import { createWeatherSystem } from './weather.js';
import { buildWorld } from './world.js';
import { createCockpit } from './cockpit.js';
import { createPostProcessing } from './postfx.js';
import { createRideState, LANE_OFFSET, stepRidePhysics } from './physics.js';
import { createAudioEngine } from './audio.js';
import { createTrainerController } from './trainer.js';
import { initVoiceControl } from './voice.js';
import { initRideLog } from './log.js';

const V3 = THREE.Vector3;
const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
let activeCourseDef = resolveCourseFromSearch(window.location.search);
let courseId = activeCourseDef.id;
let winterMode = Boolean(activeCourseDef.winter);
const sceneryParam = params.get('scenery');
const sceneryMode = sceneryParam !== null;

const RES_MODES = ['1x', '0.75x'];
let resMode = localStorage.getItem('ghr_res') || '1x';
if (!RES_MODES.includes(resMode)) resMode = '1x';
function getActivePixelRatio() {
  return resMode === '0.75x' ? 0.75 : 1;
}

const canvas = $('scene-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(getActivePixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.33;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const maxAniso = renderer.capabilities.getMaxAnisotropy();

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  const banner = document.createElement('div');
  banner.textContent = 'Graphics context reset. Reloading…';
  banner.style.cssText =
    'position:fixed;inset:0;display:grid;place-items:center;background:rgba(10,9,8,.85);letter-spacing:.1em;font-size:13px;z-index:50;';
  document.body.append(banner);
  setTimeout(() => window.location.reload(), 1500);
});

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.05, 9000);
scene.add(camera);

const uniforms = {
  uTime: { value: 0 },
  uCloud: { value: 1 },
  uMote: { value: 1 },
  uMeadow: { value: new THREE.Vector2() },
  uSunAmt: { value: 1 },
  uLid: { value: 0 },
  uCloudLit: { value: new V3() },
  uCloudDark: { value: new V3() },
  uCloudHaze: { value: new V3() },
  uPx: { value: (window.innerHeight * getActivePixelRatio()) / (2 * Math.tan(0.6)) },
};

const loadingEl = $('loading');
let loadingHideTimer = null;
function showLoading(text) {
  if (loadingHideTimer) {
    clearTimeout(loadingHideTimer);
    loadingHideTimer = null;
  }
  loadingEl.textContent = text || 'Building course…';
  loadingEl.hidden = false;
  loadingEl.style.pointerEvents = 'auto';
  loadingEl.style.opacity = '1';
}
function hideLoading() {
  loadingEl.style.opacity = '0';
  loadingEl.style.pointerEvents = 'none';
  loadingHideTimer = setTimeout(() => {
    loadingEl.hidden = true;
  }, 850);
}

// Hamburger menu drawer
const menuBtn = $('btn-menu');
const menuDrawer = $('menu-drawer');
const menuCloseBtn = $('btn-menu-close');

function setMenuOpen(open) {
  menuDrawer.hidden = !open;
  menuBtn.classList.toggle('on', open);
  menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setMenuOpen(menuDrawer.hidden);
});
menuCloseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setMenuOpen(false);
});
menuDrawer.addEventListener('click', (e) => e.stopPropagation());

// Load shared surface textures once
showLoading(activeCourseDef.loadingText || 'Building course…');
const images = await loadSurfaceImages();

let realData = null;
if (activeCourseDef.type === 'real') {
  realData = await loadRealCourseData(activeCourseDef.dataId || activeCourseDef.id);
  $('credit').textContent = realData.creditText;
} else {
  $('credit').textContent = '';
}

let weather = createWeatherSystem(renderer, scene, camera, uniforms, winterMode);
let course = createCourse(weather.sunFlat, realData);
let world = buildWorld(scene, course, weather, images, maxAniso, uniforms, winterMode);
const cockpit = createCockpit(camera);
const postfx = createPostProcessing(renderer, scene, camera, weather.hazeLum);
const audio = createAudioEngine();

const state = createRideState();
state.s = activeCourseDef.startDistance ?? course.startDistance;
window.ride = state;

function getWeatherOptions() {
  return [
    ...(winterMode ? [{ id: 'snow', name: 'Snow', key: 'S' }] : []),
    { id: 'golden', name: 'Golden Hour', key: '1' },
    { id: 'sunset', name: 'Deep Sunset', key: '2' },
    { id: 'overcast', name: 'Overcast', key: '3' },
    { id: 'rain', name: 'Rain', key: '4' },
    { id: 'mist', name: 'Mist', key: '5' },
    { id: 'starry', name: 'Starry Night', key: '6' },
  ];
}

function renderWeatherGrid() {
  const grid = $('weather-grid');
  grid.innerHTML = getWeatherOptions()
    .map(
      (w) =>
        `<button type="button" class="weather-pill${w.id === weather.currentName ? ' active' : ''}" data-weather="${w.id}">` +
        `<span>${w.name}</span><span class="weather-key">${w.key}</span>` +
        `</button>`
    )
    .join('');

  grid.querySelectorAll('.weather-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      weather.setWeather(btn.dataset.weather);
    });
  });
}

function renderCourseList() {
  const list = $('course-list');
  $('drawer-course-sub').textContent = activeCourseDef.name;
  const accCourseVal = $('acc-course-val');
  if (accCourseVal) accCourseVal.textContent = activeCourseDef.shortName;
  list.innerHTML = COURSES.map(
    (c) =>
      `<button type="button" class="course-card${c.id === activeCourseDef.id ? ' active' : ''}" data-course-id="${c.id}">` +
      `<div class="course-card-head"><span class="course-card-name">${c.name}</span><span class="course-badge">${c.badge}</span></div>` +
      `<div class="course-card-sub">${c.subtitle}</div>` +
      `</button>`
  ).join('');

  list.querySelectorAll('.course-card').forEach((card) => {
    card.addEventListener('click', () => {
      const targetId = card.dataset.courseId;
      if (targetId === activeCourseDef.id) {
        setMenuOpen(false);
        return;
      }
      switchCourse(targetId);
    });
  });
}

function disposeCurrentScene() {
  const toRemove = scene.children.filter((child) => child !== camera);
  for (const obj of toRemove) {
    scene.remove(obj);
    obj.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of mats) {
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'emissiveMap']) {
            if (mat[key] && typeof mat[key].dispose === 'function') mat[key].dispose();
          }
          mat.dispose();
        }
      }
    });
  }
  if (weather && typeof weather.dispose === 'function') {
    weather.dispose();
  }
}

let switchingCourse = false;
async function switchCourse(targetId) {
  if (switchingCourse) return;
  const nextDef = getCourseById(targetId);
  if (!nextDef) return;
  switchingCourse = true;
  setMenuOpen(false);
  showLoading(nextDef.loadingText || `Building ${nextDef.name}…`);

  // Yield a frame so the loading overlay renders before synchronous mesh generation
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    let nextRealData = null;
    if (nextDef.type === 'real') {
      nextRealData = await loadRealCourseData(nextDef.dataId || nextDef.id);
    }

    disposeCurrentScene();

    activeCourseDef = nextDef;
    courseId = nextDef.id;
    winterMode = Boolean(nextDef.winter);
    realData = nextRealData;
    $('credit').textContent = realData ? realData.creditText : '';

    weather = createWeatherSystem(renderer, scene, camera, uniforms, winterMode);
    course = createCourse(weather.sunFlat, realData);
    world = buildWorld(scene, course, weather, images, maxAniso, uniforms, winterMode);
    postfx.rays.uniforms.uThr.value = weather.hazeLum * 2.0;

    // Reset route progress while preserving live Bluetooth trainer connection & target power
    state.s = activeCourseDef.startDistance ?? course.startDistance;
    state.v = state.trainerConnected ? 0 : 6;
    state.distance = 0;
    state.grade = 0;
    state.lean = 0;

    if (winterMode) {
      weather.setWeather('snow', true);
    } else {
      weather.setWeather('golden', true);
    }

    rideLog.setCourse(courseId);
    renderCourseList();
    renderWeatherGrid();

    const url = new URL(window.location.href);
    url.searchParams.delete('theme');
    if (courseId === 'valley') url.searchParams.delete('course');
    else url.searchParams.set('course', courseId);
    window.history.replaceState(null, '', url.toString());
  } catch (err) {
    console.error('Failed to switch course:', err);
  } finally {
    switchingCourse = false;
    hideLoading();
  }
}

// Initial weather + drawer lists
if (winterMode) {
  weather.setWeather('snow', true);
} else {
  weather.setWeather('golden', true);
}
renderCourseList();
renderWeatherGrid();

const setTargetPower = (w) => {
  state.targetPower = Math.min(900, Math.max(0, w));
  $('power-slider').value = Math.min(600, state.targetPower);
  $('power-readout').textContent = `${Math.round(state.targetPower)} W`;
};
const skipDistance = (metres) => {
  state.s = (((state.s + metres) % course.length) + course.length) % course.length;
};
const setCleanMode = (hide) => {
  if (hide) setMenuOpen(false);
  document.body.classList.toggle('clean', hide);
};
const isCleanMode = () => document.body.classList.contains('clean');

$('power-slider').addEventListener('input', (e) => {
  setTargetPower(+e.target.value);
});
$('btn-back').addEventListener('click', () => skipDistance(-250));
$('btn-skip').addEventListener('click', () => skipDistance(250));
$('btn-clean').addEventListener('click', (e) => {
  e.stopPropagation();
  setCleanMode(true);
});

window.addEventListener('click', () => {
  if (isCleanMode()) {
    setCleanMode(false);
    return;
  }
  if (!menuDrawer.hidden) setMenuOpen(false);
});

const lightBtn = $('btn-light');
function setHeadlight(on) {
  cockpit.setHeadlight(on);
  lightBtn.textContent = on ? 'Light: ON' : 'Light: off';
  lightBtn.classList.toggle('on', on);
}
lightBtn.addEventListener('click', () => setHeadlight(!cockpit.isHeadlightOn()));

const soundBtn = $('btn-sound');
function toggleSound() {
  const nextMuted = !audio.isMuted();
  audio.setMuted(nextMuted);
  soundBtn.textContent = nextMuted ? 'Sound: off' : 'Sound: on';
  soundBtn.classList.toggle('on', !nextMuted);
}
soundBtn.addEventListener('click', toggleSound);

const resBtn = $('btn-res');
function updateResButton() {
  const isFast = resMode === '0.75x';
  resBtn.textContent = isFast ? 'Res: 0.75×' : 'Res: 1×';
  resBtn.classList.toggle('on', isFast);
  const accDispVal = $('acc-display-val');
  if (accDispVal) accDispVal.textContent = isFast ? '0.75×' : '1×';
}
function toggleResolution() {
  const nextIdx = (RES_MODES.indexOf(resMode) + 1) % RES_MODES.length;
  resMode = RES_MODES[nextIdx];
  localStorage.setItem('ghr_res', resMode);
  const dpr = getActivePixelRatio();
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setPixelRatio(dpr, window.innerWidth, window.innerHeight);
  uniforms.uPx.value = (window.innerHeight * dpr) / (2 * Math.tan(0.6));
  updateResButton();
}
updateResButton();
resBtn.addEventListener('click', toggleResolution);

const fpsBtn = $('btn-fps');
function toggleFps() {
  const badge = $('fps-badge');
  badge.hidden = !badge.hidden;
  const visible = !badge.hidden;
  fpsBtn.textContent = visible ? 'FPS: on' : 'FPS: off';
  fpsBtn.classList.toggle('on', visible);
}
fpsBtn.addEventListener('click', toggleFps);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isCleanMode()) setCleanMode(false);
    else setMenuOpen(menuDrawer.hidden);
    return;
  }
  if (e.key === 'ArrowUp') setTargetPower(state.targetPower + 10);
  if (e.key === 'ArrowDown') setTargetPower(state.targetPower - 10);
  if (e.key === 'ArrowRight') skipDistance(250);
  if (e.key === 'ArrowLeft') skipDistance(-250);
  if ((e.key === 'h' || e.key === 'H') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    setCleanMode(!isCleanMode());
  }
  if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    toggleSound();
  }
  if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    setHeadlight(!cockpit.isHeadlightOn());
  }
  if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    toggleFps();
  }
  if ((e.key === 'q' || e.key === 'Q') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    toggleResolution();
  }
  const weatherKey = ['golden', 'sunset', 'overcast', 'rain', 'mist', 'starry'][+e.key - 1];
  if (weatherKey) weather.setWeather(weatherKey);
});

audio.unlock();
window.addEventListener('focus', () => {
  audio.unlock();
  audio.setFocused(true);
});
window.addEventListener('blur', () => audio.setFocused(false));
document.addEventListener('visibilitychange', () => audio.setFocused(!document.hidden && document.hasFocus()));
window.addEventListener('pointerdown', () => audio.unlock());
window.addEventListener('keydown', () => audio.unlock());

const trainer = createTrainerController({
  btButton: $('btn-trainer'),
  hillsDownBtn: $('btn-hills-down'),
  hillsUpBtn: $('btn-hills-up'),
  hillsLabel: $('hills-label'),
  btModal: $('bt-modal'),
  btDeviceList: $('bt-device-list'),
  btCancelBtn: $('bt-cancel'),
  onPower: setTargetPower,
  getGrade: () => state.grade,
  onConnectedChange: (connected) => {
    state.trainerConnected = connected;
    $('status-trainer').hidden = !connected;
  },
});

initVoiceControl({
  button: $('btn-voice'),
  isWinterMode: () => winterMode,
  setWeather: (w) => weather.setWeather(w),
  skipDistance,
  setCleanMode,
  setMuted: (muted) => {
    audio.setMuted(muted);
    soundBtn.textContent = muted ? 'Sound: off' : 'Sound: on';
    soundBtn.classList.toggle('on', !muted);
  },
  setHeadlight,
  adjustHills: (delta) => trainer.setHills(trainer.getHillsPercent() + delta),
  setHills: (pct) => trainer.setHills(pct),
  getHillsLabel: () => trainer.getHillsLabel(),
  onStatusChange: (listening) => {
    $('status-voice').hidden = !listening;
  },
});

const rideLog = initRideLog({
  panel: $('ride-log'),
  toggleBtn: $('btn-log'),
  courseId,
  getDistance: () => state.distance,
  resetDistance: () => { state.distance = 0; },
});

window.addEventListener('resize', () => {
  const dpr = getActivePixelRatio();
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setPixelRatio(dpr, window.innerWidth, window.innerHeight);
  uniforms.uPx.value = (window.innerHeight * dpr) / (2 * Math.tan(0.6));
});

// Scenery autopilot plan
const sceneryPlan = winterMode
  ? [['snow', 280], ['mist', 100], ['snow', 180], ['golden', 95]]
  : [['golden', 200], ['mist', 110], ['rain', 130], ['overcast', 70], ['golden', 90]];
let sceneryElapsed = 0;
let sceneryIndex = 0;

if (sceneryMode) {
  setCleanMode(true);
  state.targetPower = 90;
  state.power = 90;
  if (sceneryParam === 'nobars') cockpit.rig.visible = false;
}

const clock = new THREE.Clock();
const mkPose = () => ({ p: new V3(), t: new V3(), r: new V3() });
const pose = mkPose();
const ahead = mkPose();
const probe = mkPose();
const lookTarget = new V3();
const sunNdc = new V3();
const fwdDir = new V3();

let hudTimer = 0;
let fpsFrames = 0;
let fpsElapsed = 0;
let firstFrame = true;

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  uniforms.uTime.value += dt;
  fpsFrames++;
  fpsElapsed += dt;
  if (fpsElapsed >= 0.5) {
    const fps = Math.round(fpsFrames / fpsElapsed);
    const badge = $('fps-badge');
    if (badge && !badge.hidden) {
      badge.textContent = `${fps} FPS`;
      badge.style.color = fps >= 50 ? '#a8f5a8' : fps >= 30 ? '#ffd97d' : '#ff7a70';
    }
    fpsFrames = 0;
    fpsElapsed = 0;
  }

  if (!switchingCourse) {
    stepRidePhysics(state, dt, course, pose, probe, sceneryMode);

    if (sceneryMode) {
      sceneryElapsed += dt;
      if (sceneryElapsed >= sceneryPlan[sceneryIndex][1]) {
        sceneryElapsed = 0;
        sceneryIndex = (sceneryIndex + 1) % sceneryPlan.length;
        weather.setWeather(sceneryPlan[sceneryIndex][0]);
      }
    }

    // Camera tracking, lean, pedal sway, and speed FOV
    course.samplePose(state.s, pose);
    course.samplePose(state.s + 9, ahead);
    uniforms.uMeadow.value.set(pose.p.x + pose.t.x * 78, pose.p.z + pose.t.z * 78);

    const effort = Math.min(1, state.power / 300);
    const sway = Math.sin(state.pedalPhase);
    camera.position.copy(pose.p).addScaledVector(pose.r, LANE_OFFSET + sway * 0.004 * effort);
    camera.position.y += 1.52;
    lookTarget.copy(ahead.p).addScaledVector(ahead.r, LANE_OFFSET);
    lookTarget.y += 0.3;
    camera.lookAt(lookTarget);
    camera.rotateZ(-state.lean);

    const fov = 62 + Math.min(state.v, 20) * 0.75;
    if (Math.abs(fov - camera.fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    weather.stepWeather(dt, sceneryMode, world.terrainMat, world.roadMat);
    weather.rainUniforms.uVel.value.copy(pose.t).multiplyScalar(state.v);

    // Move shadow frustum with the rider
    weather.sun.target.position.copy(pose.p).addScaledVector(pose.t, 70);
    weather.sun.position.copy(weather.sun.target.position).addScaledVector(weather.sunDir, 350);

    world.updateGrassChunks(camera.position);

    // Post-processing uniforms
    sunNdc.copy(camera.position).addScaledVector(weather.sunDir, 1000).project(camera);
    postfx.rays.uniforms.uSunUv.value.set(sunNdc.x * 0.5 + 0.5, sunNdc.y * 0.5 + 0.5);
    const raysAmt =
      0.25 * weather.current.rays * smoothstep(0.1, 0.6, camera.getWorldDirection(fwdDir).dot(weather.sunDir));
    postfx.rays.uniforms.uAmt.value = raysAmt;
    postfx.rays.enabled = raysAmt > 0.005;
    postfx.lens.uniforms.uSpeed.value = Math.min(1, state.v / 22);
    postfx.lens.uniforms.uTime.value = uniforms.uTime.value;
    postfx.lens.uniforms.uRain.value = weather.current.rain;
    postfx.lens.uniforms.uPaint.value = weather.current.paint;

    audio.update(state.v, weather.current.rain);
    cockpit.spinWheel(state.v, dt);

    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.25;
      cockpit.drawHeadUnit(state.v * 3.6, state.power, state.grade);
      $('hud-power').textContent = state.power.toFixed(0);
      $('hud-speed').textContent = (state.v * 3.6).toFixed(1);
      $('hud-grade').textContent = `${state.grade >= 0 ? '+' : ''}${state.grade.toFixed(1)}`;
      $('hud-dist').textContent = (state.distance / 1000).toFixed(2);
    }

    postfx.composer.render();

    if (firstFrame) {
      firstFrame = false;
      hideLoading();
    }
  }

  requestAnimationFrame(animate);
}

animate();
