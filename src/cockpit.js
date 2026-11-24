import * as THREE from 'three';
import { createCanvas2D } from './noise.js';

const V3 = THREE.Vector3;

export function createCockpit(camera) {
  const rig = new THREE.Group();
  rig.position.set(0, -0.33, -0.5);
  camera.add(rig);

  const [huCanvas, huCtx] = createCanvas2D(128, 224);
  const huTex = new THREE.CanvasTexture(huCanvas);
  huTex.colorSpace = THREE.SRGBColorSpace;

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

  const tapeMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.82 });
  const glossMat = new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.35, metalness: 0.3 });

  rig.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(barPts), 140, 0.0135, 12), tapeMat));

  for (const side of [-1, 1]) {
    const hood = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.075, 6, 14), glossMat);
    hood.position.set(side * 0.207, 0.022, -0.115);
    hood.rotation.x = -1.0;
    rig.add(hood);
  }

  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.03, 0.12), glossMat);
  stem.position.set(0, -0.004, 0.06);
  rig.add(stem);

  const headUnit = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.012, 0.092), glossMat);
  headUnit.position.set(0, 0.03, -0.075);
  headUnit.rotation.x = 0.4;
  rig.add(headUnit);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.047, 0.083).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: huTex })
  );
  screen.position.y = 0.0065;
  headUnit.add(screen);

  const frontTyre = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.014, 10, 72), tapeMat);
  frontTyre.rotation.y = Math.PI / 2;
  frontTyre.position.set(0, -0.66, -0.12);
  rig.add(frontTyre);

  rig.traverse((obj) => {
    if (obj.isMesh && obj !== screen) obj.receiveShadow = true;
  });

  function drawHeadUnit(kmh, watts) {
    huCtx.fillStyle = '#d9dccf';
    huCtx.fillRect(0, 0, 128, 224);
    huCtx.fillStyle = '#16181a';
    huCtx.textAlign = 'center';
    huCtx.font = '600 58px Helvetica, Arial, sans-serif';
    huCtx.fillText(kmh.toFixed(0), 64, 82);
    huCtx.font = '600 13px Helvetica, Arial, sans-serif';
    huCtx.fillText('KM/H', 64, 104);
    huCtx.fillRect(14, 122, 100, 2);
    huCtx.font = '600 40px Helvetica, Arial, sans-serif';
    huCtx.fillText(watts.toFixed(0), 64, 176);
    huCtx.font = '600 13px Helvetica, Arial, sans-serif';
    huCtx.fillText('WATTS', 64, 198);
    huTex.needsUpdate = true;
  }

  return { rig, drawHeadUnit };
}
