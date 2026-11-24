import * as THREE from 'three';
import { createCanvas2D } from './noise.js';

const V3 = THREE.Vector3;

function buildBarTapeTexture() {
  const [c, g] = createCanvas2D(256, 256);
  g.fillStyle = '#141416';
  g.fillRect(0, 0, 256, 256);
  // Diagonal overlapping tape wrap bands + micro-perforations
  for (let i = -256; i < 512; i += 28) {
    g.strokeStyle = 'rgba(0,0,0,0.65)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 256, 256);
    g.stroke();

    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(i + 3, 0);
    g.lineTo(i + 259, 256);
    g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,0.45)';
  for (let y = 6; y < 256; y += 12) {
    for (let x = 6; x < 256; x += 12) {
      g.beginPath();
      g.arc(x, y, 1.3, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCockpit(camera) {
  const rig = new THREE.Group();
  rig.position.set(0, -0.33, -0.5);
  camera.add(rig);

  const [huCanvas, huCtx] = createCanvas2D(256, 416);
  const huTex = new THREE.CanvasTexture(huCanvas);
  huTex.colorSpace = THREE.SRGBColorSpace;

  const tapeTex = buildBarTapeTexture();
  const tapeMat = new THREE.MeshStandardMaterial({
    map: tapeTex,
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.05,
  });
  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x16171a,
    roughness: 0.34,
    metalness: 0.35,
  });
  const alloyMat = new THREE.MeshStandardMaterial({
    color: 0x7b8088,
    roughness: 0.3,
    metalness: 0.85,
  });
  const hoodRubberMat = new THREE.MeshStandardMaterial({
    color: 0x111113,
    roughness: 0.88,
    metalness: 0.02,
  });
  const tyreMat = new THREE.MeshStandardMaterial({
    color: 0x121214,
    roughness: 0.85,
  });
  const tanWallMat = new THREE.MeshStandardMaterial({
    color: 0x8b6b43,
    roughness: 0.8,
  });

  // Drop handlebars
  const halfBar = [
    [0.205, -0.135, 0.05],
    [0.21, -0.13, -0.05],
    [0.21, -0.07, -0.105],
    [0.205, -0.005, -0.085],
    [0.19, 0, -0.02],
    [0.14, 0, 0],
    [0, 0, 0],
  ];
  const barPts = [
    ...halfBar,
    ...halfBar
      .slice(0, -1)
      .reverse()
      .map((p) => [-p[0], p[1], p[2]]),
  ].map((p) => new V3(...p));
  rig.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(barPts), 160, 0.014, 14), tapeMat));

  // Unwrapped central clamp section
  const centerBar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0155, 0.0155, 0.11, 14).rotateZ(Math.PI / 2),
    carbonMat
  );
  rig.add(centerBar);

  // Sculpted brake hoods, brake levers, and subtle cable routing
  for (const side of [-1, 1]) {
    const hood = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.072, 8, 16), hoodRubberMat);
    hood.position.set(side * 0.206, 0.024, -0.114);
    hood.rotation.x = -0.96;
    hood.rotation.z = side * 0.05;
    rig.add(hood);

    const hoodTip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 10), hoodRubberMat);
    hoodTip.position.set(side * 0.204, 0.048, -0.146);
    rig.add(hoodTip);

    // Curved brake lever blade
    const leverCurve = new THREE.CatmullRomCurve3([
      new V3(side * 0.206, 0.014, -0.14),
      new V3(side * 0.208, -0.04, -0.155),
      new V3(side * 0.205, -0.095, -0.135),
    ]);
    rig.add(new THREE.Mesh(new THREE.TubeGeometry(leverCurve, 14, 0.0045, 8), carbonMat));

    // Inner shift paddle
    const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.042, 0.008), alloyMat);
    paddle.position.set(side * 0.197, -0.025, -0.144);
    rig.add(paddle);

    // Bar-end plug
    const plug = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.006, 12).rotateX(Math.PI / 2), alloyMat);
    plug.position.set(side * 0.205, -0.135, 0.052);
    rig.add(plug);

    // Brake/shift cable looping neatly under the stem
    const cableCurve = new THREE.CatmullRomCurve3([
      new V3(side * 0.11, -0.01, -0.005),
      new V3(side * 0.06, -0.03, -0.025),
      new V3(side * 0.02, -0.09, 0.045),
    ]);
    rig.add(new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 14, 0.0024, 6), hoodRubberMat));
  }

  // Stem, faceplate, 4 stainless bolts, and headset top cap
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.031, 0.115), carbonMat);
  stem.position.set(0, -0.003, 0.056);
  rig.add(stem);

  const faceplate = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.036, 0.012), carbonMat);
  faceplate.position.set(0, 0, -0.012);
  rig.add(faceplate);

  for (const bx of [-0.014, 0.014]) {
    for (const by of [-0.011, 0.011]) {
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.005, 8).rotateX(Math.PI / 2), alloyMat);
      bolt.position.set(bx, by, -0.019);
      rig.add(bolt);
    }
  }

  const topCap = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.008, 18), carbonMat);
  topCap.position.set(0, 0.015, 0.105);
  rig.add(topCap);
  const topBolt = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.009, 10), alloyMat);
  topBolt.position.set(0, 0.016, 0.105);
  rig.add(topBolt);

  // Out-front aero mount + bevelled GPS cycling computer
  const mountArm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, 0.088), carbonMat);
  mountArm.position.set(0.024, 0.012, -0.042);
  mountArm.rotation.y = 0.25;
  rig.add(mountArm);

  const unit = new THREE.Group();
  unit.position.set(0, 0.028, -0.084);
  unit.rotation.x = 0.36;
  rig.add(unit);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.013, 0.098), carbonMat);
  unit.add(body);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.053, 0.002, 0.091), hoodRubberMat);
  bezel.position.y = 0.0068;
  unit.add(bezel);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.048, 0.084).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: huTex })
  );
  screen.position.y = 0.0081;
  unit.add(screen);

  // Spinning front wheel (tyre, tan sidewall, deep-section carbon rim, and spokes)
  const wheelGroup = new THREE.Group();
  wheelGroup.position.set(0, -0.66, -0.12);
  rig.add(wheelGroup);

  const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.014, 12, 72), tyreMat);
  tyre.rotation.y = Math.PI / 2;
  wheelGroup.add(tyre);

  const sidewall = new THREE.Mesh(new THREE.TorusGeometry(0.324, 0.012, 10, 72), tanWallMat);
  sidewall.rotation.y = Math.PI / 2;
  wheelGroup.add(sidewall);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.304, 0.016, 10, 72), carbonMat);
  rim.rotation.y = Math.PI / 2;
  wheelGroup.add(rim);

  const spokeGeo = new THREE.CylinderGeometry(0.001, 0.001, 0.6, 4);
  for (let i = 0; i < 8; i++) {
    const spoke = new THREE.Mesh(spokeGeo, alloyMat);
    spoke.rotation.x = (i / 8) * Math.PI;
    wheelGroup.add(spoke);
  }

  rig.traverse((obj) => {
    if (obj.isMesh && obj !== screen) obj.receiveShadow = true;
  });

  function drawHeadUnit(kmh, watts, grade = 0) {
    // Crisp high-contrast transflective GPS screen
    huCtx.fillStyle = '#dde1d4';
    huCtx.fillRect(0, 0, 256, 416);

    // Header status bar
    huCtx.fillStyle = '#1b1f22';
    huCtx.fillRect(0, 0, 256, 36);
    huCtx.fillStyle = '#d9dccf';
    huCtx.font = '600 18px Helvetica, Arial, sans-serif';
    huCtx.textAlign = 'left';
    huCtx.fillText('GPS', 14, 24);
    huCtx.textAlign = 'right';
    huCtx.fillText(`${grade >= 0 ? '+' : ''}${grade.toFixed(1)}%`, 242, 24);

    // Speed
    huCtx.fillStyle = '#14171a';
    huCtx.textAlign = 'center';
    huCtx.font = '700 112px Helvetica, Arial, sans-serif';
    huCtx.fillText(kmh.toFixed(0), 128, 162);
    huCtx.font = '600 22px Helvetica, Arial, sans-serif';
    huCtx.fillStyle = '#42494f';
    huCtx.fillText('KM/H', 128, 194);

    // Divider
    huCtx.fillStyle = '#1b1f22';
    huCtx.fillRect(24, 218, 208, 3);

    // Power
    huCtx.fillStyle = '#14171a';
    huCtx.font = '700 92px Helvetica, Arial, sans-serif';
    huCtx.fillText(watts.toFixed(0), 128, 336);
    huCtx.font = '600 22px Helvetica, Arial, sans-serif';
    huCtx.fillStyle = '#42494f';
    huCtx.fillText('WATTS', 128, 370);

    huTex.needsUpdate = true;
  }

  function spinWheel(speedMs, dt) {
    // angular velocity = v / radius (0.335 m)
    wheelGroup.rotation.x -= (speedMs / 0.335) * dt;
  }

  return { rig, drawHeadUnit, spinWheel };
}
