// Cycling physics model: power -> speed with gravity, rolling resistance, and aero drag

export const RIDER_MASS_KG = 80;
export const GRAVITY = 9.81;
export const ROLLING_RESISTANCE = 0.004;
export const AIR_DENSITY = 1.2;
export const CDA = 0.32;
export const LANE_OFFSET = -1.75;

export function createRideState() {
  return {
    s: 0,
    v: 6,
    power: 220,
    targetPower: 220,
    distance: 0,
    grade: 0,
    lean: 0,
    pedalPhase: 0,
    trainerConnected: false,
  };
}

export function stepRidePhysics(state, dt, course, pose, probe, sceneryMode) {
  state.power += (state.targetPower - state.power) * Math.min(1, dt * 3);
  if (state.targetPower === 0 && state.power < 0.5) state.power = 0;
  course.samplePose(state.s, pose);

  const v = state.v;
  const slope = pose.t.y > 0 ? pose.t.y : pose.t.y * 0.5;
  const brakeForce = v > 15 ? RIDER_MASS_KG * 0.5 * (v - 15) : 0;
  // Allow realistic low-gear torque from a standstill so riders can start on steep climbs
  const driveForce = state.power > 0.5 ? state.power / Math.max(v, 0.6) : 0;
  const gravityAndRoll = RIDER_MASS_KG * GRAVITY * (slope + ROLLING_RESISTANCE);
  const aeroDrag = 0.5 * AIR_DENSITY * CDA * v * v;

  const netForce = driveForce - gravityAndRoll - aeroDrag - brakeForce;
  const nextV = Math.max(0, v + (netForce / RIDER_MASS_KG) * dt);
  // Hold stationary at 0 W once stopped (don't creep/drift before pedaling starts)
  state.v = state.power < 1 && v < 0.05 && nextV < 0.2 ? 0 : nextV;

  if (sceneryMode) {
    // Gentle ~18 km/h cruise in autopilot scenery mode
    state.v = v + (5 - v) * Math.min(1, dt);
  }

  state.s = (state.s + state.v * dt) % course.length;
  state.distance += state.v * dt;
  state.grade += (pose.t.y * 100 - state.grade) * Math.min(1, dt * 2);

  // Corner curvature for bike lean
  course.samplePose(state.s, pose);
  course.samplePose(state.s + 4, probe);
  const curvature = -(pose.t.z * probe.t.x - pose.t.x * probe.t.z) / 4;
  const targetLean = Math.atan((state.v * state.v * curvature) / GRAVITY) * 0.55;
  state.lean += (targetLean - state.lean) * Math.min(1, dt * 3);

  // Cadence-based pedal sway
  const cadenceRpm = state.power > 5 ? 60 + Math.min(40, state.power / 8) : 0;
  state.pedalPhase += (dt * Math.PI * 2 * cadenceRpm) / 60;
}
