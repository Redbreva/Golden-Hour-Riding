// 2D Route Mini-Map overlay (bottom-right) with pre-rendered route + side roads & live rider marker

export function createMiniMap(canvas) {
  const SIZE = 320;
  const DPR = 2;
  const PAD = 24;
  canvas.width = SIZE * DPR;
  canvas.height = SIZE * DPR;
  const ctx = canvas.getContext('2d');

  // Offscreen static cache (route outline + side roads + start dot + N indicator)
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = SIZE * DPR;
  bgCanvas.height = SIZE * DPR;
  const bg = bgCanvas.getContext('2d');

  let courseRef = null;
  let projX = () => SIZE * 0.5;
  let projZ = () => SIZE * 0.5;
  let totalKm = 0;

  function setCourse(course) {
    courseRef = course;
    totalKm = course.length / 1000;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of course.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    const spanX = Math.max(20, maxX - minX);
    const spanZ = Math.max(20, maxZ - minZ);
    const drawSize = SIZE - PAD * 2 - 14; // leave slight room at bottom for km text
    const scale = drawSize / Math.max(spanX, spanZ);
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const ox = SIZE * 0.5;
    const oz = (SIZE - 14) * 0.5;

    projX = (x) => ox + (x - cx) * scale;
    projZ = (z) => oz + (z - cz) * scale;

    bg.setTransform(DPR, 0, 0, DPR, 0, 0);
    bg.clearRect(0, 0, SIZE, SIZE);

    // Subtle North indicator
    bg.fillStyle = 'rgba(255, 255, 255, 0.45)';
    bg.font = '600 9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    bg.textAlign = 'right';
    bg.textBaseline = 'top';
    bg.fillText('N', SIZE - 9, 7);

    // Faint intersecting side roads so junctions are visible on the map
    if (course.sideRoads && course.sideRoads.length) {
      bg.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      bg.lineWidth = 1.2;
      bg.lineCap = 'round';
      bg.beginPath();
      for (const sr of course.sideRoads) {
        const pts = sr.points;
        if (!pts || pts.length < 2) continue;
        bg.moveTo(projX(pts[0][0]), projZ(pts[0][1]));
        for (let i = 1; i < pts.length; i++) {
          bg.lineTo(projX(pts[i][0]), projZ(pts[i][1]));
        }
      }
      bg.stroke();
    }

    // Main route outline (stride so huge routes stay crisp and fast)
    const pts = course.points;
    const stride = Math.max(1, Math.floor(pts.length / 500));
    bg.strokeStyle = 'rgba(255, 255, 255, 0.48)';
    bg.lineWidth = 2.4;
    bg.lineJoin = 'round';
    bg.lineCap = 'round';
    bg.beginPath();
    for (let i = 0; i < pts.length; i += stride) {
      const px = projX(pts[i].x);
      const pz = projZ(pts[i].z);
      if (i === 0) bg.moveTo(px, pz);
      else bg.lineTo(px, pz);
    }
    if (course.closed !== false) {
      bg.closePath();
    } else {
      const last = pts[pts.length - 1];
      bg.lineTo(projX(last.x), projZ(last.z));
    }
    bg.stroke();

    // Start marker (small green dot)
    const s0 = pts[0];
    bg.fillStyle = '#6ee787';
    bg.beginPath();
    bg.arc(projX(s0.x), projZ(s0.z), 3, 0, Math.PI * 2);
    bg.fill();

    // Finish marker for point-to-point routes (small red-orange dot)
    if (course.closed === false) {
      const sEnd = pts[pts.length - 1];
      bg.fillStyle = '#ff7a70';
      bg.beginPath();
      bg.arc(projX(sEnd.x), projZ(sEnd.z), 3, 0, Math.PI * 2);
      bg.fill();
    }
  }

  function update(pose, s) {
    if (!courseRef || canvas.hidden) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bgCanvas, 0, 0);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // Highlight travelled section up to current s
    const pts = courseRef.points;
    const curIdx = Math.min(pts.length - 1, Math.max(0, Math.floor((s / courseRef.length) * pts.length)));
    if (curIdx > 1) {
      const stride = Math.max(1, Math.floor(pts.length / 500));
      ctx.strokeStyle = 'rgba(255, 207, 143, 0.88)';
      ctx.lineWidth = 2.6;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i <= curIdx; i += stride) {
        const px = projX(pts[i].x);
        const pz = projZ(pts[i].z);
        if (i === 0) ctx.moveTo(px, pz);
        else ctx.lineTo(px, pz);
      }
      ctx.lineTo(projX(pose.p.x), projZ(pose.p.z));
      ctx.stroke();
    }

    // Rider heading cone + glowing marker dot
    const rx = projX(pose.p.x);
    const rz = projZ(pose.p.z);
    const ang = Math.atan2(pose.t.z, pose.t.x);

    ctx.save();
    ctx.translate(rx, rz);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(255, 207, 143, 0.35)';
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-2, -5.5);
    ctx.lineTo(-2, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#ffcf8f';
    ctx.beginPath();
    ctx.arc(rx, rz, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#14110e';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Bottom progress readout
    const curKm = (s / 1000).toFixed(2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.font = '500 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${curKm} / ${totalKm.toFixed(1)} km`, SIZE * 0.5, SIZE - 5);
  }

  return { setCourse, update };
}
