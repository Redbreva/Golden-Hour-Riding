import * as THREE from 'three';
import { smoothstep } from './noise.js';
import { loadSurfaceImages } from './textures.js';
import { COURSES, resolveCourseFromSearch } from './courses.js';
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
const activeCourseDef = resolveCourseFromSearch(window.location.search);
const courseId = activeCourseDef.id;
const winterMode = Boolean(activeCourseDef.winter);
const sceneryParam = params.get('scenery');
const sceneryMode = sceneryParam !== null;

const canvas = $('scene-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
  uPx: { value: (window.innerHeight * Math.min(window.devicePixelRatio, 2)) / (2 * Math.tan(0.6)) },
};

let realData = null;
$('loading').textContent = activeCourseDef.loadingText || 'Building course…';
if (activeCourseDef.type === 'real') {
  realData = await loadRealCourseData(activeCourseDef.dataId || activeCourseDef.id);
  $('credit').textContent = realData.creditText;
}

// Course selector panel
const courseBtn = $('btn-course');
const coursePanel = $('course-panel');
courseBtn.textContent = `Course: ${activeCourseDef.shortName} ▾`;

function renderCoursePanel() {
  coursePanel.innerHTML =
    `<h3>Select Course</h3><div class="course-list">` +
    COURSES.map(
      (c) =>
        `<button type="button" class="course-card${c.id === activeCourseDef.id ? ' active' : ''}" data-course-id="${c.id}">` +
        `<div class="course-card-head"><span class="course-card-name">${c.name}</span><span class="course-badge">${c.badge}</span></div>` +
        `<div class="course-card-sub">${c.subtitle}</div>` +
        `</button>`
    ).join('') +
    `</div>`;

  coursePanel.querySelectorAll('.course-card').forEach((card) => {
    card.addEventListener('click', () => {
      const targetId = card.dataset.courseId;
      if (targetId === activeCourseDef.id) {
        closeCoursePanel();
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.delete('theme');
      if (targetId === 'valley') url.searchParams.delete('course');
      else url.searchParams.set('course', targetId);
      window.location.href = url.toString();
    });
  });
}

function closeCoursePanel() {
  coursePanel.hidden = true;
  courseBtn.classList.remove('on');
  courseBtn.setAttribute('aria-expanded', 'false');
}

function closeAllPanels() {
  closeCoursePanel();
  closeWeatherPanel();
  const logPanel = $('ride-log');
  if (!logPanel.hidden) {
    logPanel.hidden = true;
    $('btn-log').classList.remove('on');
  }
}

courseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = coursePanel.hidden;
  closeAllPanels();
  if (willOpen) {
    renderCoursePanel();
    coursePanel.hidden = false;
    courseBtn.classList.add('on');
    courseBtn.setAttribute('aria-expanded', 'true');
  }
});

coursePanel.addEventListener('click', (e) => e.stopPropagation());

// Weather selector panel
const WEATHER_OPTIONS = [
  ...(winterMode ? [{ id: 'snow', name: 'Snow', subtitle: 'Winter dusk with gentle falling snow', key: 'Snow' }] : []),
  { id: 'golden', name: 'Golden Hour', subtitle: 'Low warm sun, long shadows & light shafts', key: '1' },
  { id: 'sunset', name: 'Deep Sunset', subtitle: 'Amber-rose dusk sky with long dramatic shadows', key: '2' },
  { id: 'overcast', name: 'Overcast', subtitle: 'Soft diffuse light under a grey cloud deck', key: '3' },
  { id: 'rain', name: 'Rain', subtitle: 'Falling streaks, wet tarmac ripples & lens drops', key: '4' },
  { id: 'mist', name: 'Mist', subtitle: 'Thick valley fog with soft sunlit rays', key: '5' },
  { id: 'starry', name: 'Starry Night', subtitle: 'Swirling night sky with painterly brush filter', key: '6' },
];
const weatherBtn = $('btn-weather');
const weatherPanel = $('weather-panel');

function closeWeatherPanel() {
  weatherPanel.hidden = true;
  weatherBtn.classList.remove('on');
  weatherBtn.setAttribute('aria-expanded', 'false');
}

function renderWeatherPanel() {
  weatherPanel.innerHTML =
    `<h3>Select Weather</h3><div class="course-list">` +
    WEATHER_OPTIONS.map(
      (w) =>
        `<button type="button" class="course-card${w.id === weather.currentName ? ' active' : ''}" data-weather="${w.id}">` +
        `<div class="course-card-head"><span class="course-card-name">${w.name}</span><span class="course-badge">${w.key}</span></div>` +
        `<div class="course-card-sub">${w.subtitle}</div>` +
        `</button>`
    ).join('') +
    `</div>`;

  weatherPanel.querySelectorAll('.course-card').forEach((card) => {
    card.addEventListener('click', () => {
      weather.setWeather(card.dataset.weather);
      closeWeatherPanel();
    });
  });
}

weatherBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = weatherPanel.hidden;
  closeAllPanels();
  if (willOpen) {
    renderWeatherPanel();
    weatherPanel.hidden = false;
    weatherBtn.classList.add('on');
    weatherBtn.setAttribute('aria-expanded', 'true');
  }
});

weatherPanel.addEventListener('click', (e) => e.stopPropagation());

window.addEventListener('click', () => {
  if (!coursePanel.hidden) closeCoursePanel();
  if (!weatherPanel.hidden) closeWeatherPanel();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!coursePanel.hidden) closeCoursePanel();
    if (!weatherPanel.hidden) closeWeatherPanel();
  }
});

const images = await loadSurfaceImages();
const weather = createWeatherSystem(renderer, scene, camera, uniforms, winterMode);
const course = createCourse(weather.sunFlat, realData);
const world = buildWorld(scene, course, weather, images, maxAniso, uniforms, winterMode);
const cockpit = createCockpit(camera);
const postfx = createPostProcessing(renderer, scene, camera, weather.hazeLum);
const audio = createAudioEngine();

const state = createRideState();
state.s = activeCourseDef.startDistance ?? course.startDistance;
window.ride = state;

$('btn-log').addEventListener('click', () => {
  if (!coursePanel.hidden) closeCoursePanel();
  if (!weatherPanel.hidden) closeWeatherPanel();
});

// Initial weather label
if (winterMode) {
  weather.setWeather('snow', true);
} else {
  weather.setWeather('golden', true);
}

const setTargetPower = (w) => {
  state.targetPower = Math.min(900, Math.max(0, w));
  $('power-slider').value = state.targetPower;
};
const skipDistance = (metres) => {
  state.s = (((state.s + metres) % course.length) + course.length) % course.length;
};
const setCleanMode = (hide) => document.body.classList.toggle('clean', hide);
const isCleanMode = () => document.body.classList.contains('clean');

$('power-slider').addEventListener('input', (e) => {
  state.targetPower = +e.target.value;
});
$('btn-skip').addEventListener('click', () => skipDistance(250));
$('btn-clean').addEventListener('click', (e) => {
  e.stopPropagation();
  setCleanMode(true);
});
window.addEventListener('click', () => {
  if (isCleanMode()) setCleanMode(false);
});

window.addEventListener('keydown', (e) => {
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
    const badge = $('fps-badge');
    badge.hidden = !badge.hidden;
  }
  const weatherKey = ['golden', 'sunset', 'overcast', 'rain', 'mist', 'starry'][+e.key - 1];
  if (weatherKey) weather.setWeather(weatherKey);
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
  onConnectedChange: (connected) => { state.trainerConnected = connected; },
});

initVoiceControl({
  button: $('btn-voice'),
  winterMode,
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
});

initRideLog({
  panel: $('ride-log'),
  toggleBtn: $('btn-log'),
  courseId,
  getDistance: () => state.distance,
  resetDistance: () => { state.distance = 0; },
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.resize(window.innerWidth, window.innerHeight);
  uniforms.uPx.value = (window.innerHeight * Math.min(window.devicePixelRatio, 2)) / (2 * Math.tan(0.6));
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
  postfx.rays.uniforms.uAmt.value =
    0.25 * weather.current.rays * smoothstep(0.1, 0.6, camera.getWorldDirection(fwdDir).dot(weather.sunDir));
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
    const loading = $('loading');
    if (loading) {
      loading.style.opacity = '0';
      setTimeout(() => loading.remove(), 900);
    }
  }

  requestAnimationFrame(animate);
}

animate();
