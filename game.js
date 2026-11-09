import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

(() => {
'use strict';

const TRACK_WIDTH = 96;
const LAPS = 3;
const PLAYER_COLOR = 0xe10600;
const AI_COLOR = 0xb7bfc9;
const BEST_LAP_KEY = 'f1racingsim-bestlap';

const CONTROL_POINTS = [
  [300, 220], [760, 150], [1220, 170], [1560, 300], [1680, 620],
  [1560, 900], [1280, 980], [1080, 880], [940, 950], [960, 1180],
  [760, 1330], [480, 1290], [300, 1100], [260, 800], [330, 560],
  [230, 380],
];

function catrom(a, b, c, d, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}

function buildTrack(points, per) {
  const out = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i];
    const p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    for (let j = 0; j < per; j++) {
      const t = j / per;
      out.push([
        catrom(p0[0], p1[0], p2[0], p3[0], t),
        catrom(p0[1], p1[1], p2[1], p3[1], t),
      ]);
    }
  }
  return out;
}

const track = buildTrack(CONTROL_POINTS, 10);
const N = track.length;

const curvature = new Array(N);
for (let i = 0; i < N; i++) {
  const a = track[(i - 1 + N) % N], b = track[i], c = track[(i + 1) % N];
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  curvature[i] = area < 1e-6 ? 0 : (4 * area) / (ab * bc * ca);
}

function trackDir(i) {
  const a = track[i], b = track[(i + 1) % N];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

function trackNormal(i) {
  const d = trackDir(i);
  return [Math.cos(d + Math.PI / 2), Math.sin(d + Math.PI / 2)];
}

function nearestIndex(pos, hint) {
  let best = -1, bestD = Infinity;
  const win = 18;
  for (let o = -win; o <= win; o++) {
    const i = ((hint + o) % N + N) % N;
    const dx = track[i][0] - pos[0], dy = track[i][1] - pos[1];
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (bestD > (TRACK_WIDTH * 4) ** 2) {
    for (let i = 0; i < N; i++) {
      const dx = track[i][0] - pos[0], dy = track[i][1] - pos[1];
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  return best;
}

function offTrack(pos, idx) {
  const dx = pos[0] - track[idx][0], dy = pos[1] - track[idx][1];
  return Math.hypot(dx, dy) > TRACK_WIDTH / 2 + 6;
}

function normAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function fmtTime(sec) {
  if (sec == null || !isFinite(sec)) return '--:--.---';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec * 1000) % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

class Car {
  constructor(name, color, isPlayer) {
    this.name = name;
    this.color = color;
    this.isPlayer = isPlayer;
    this.lane = 0;
    this.reset();
  }

  reset() {
    const startIdx = this.isPlayer ? N - 4 : N - 10;
    const i = ((startIdx % N) + N) % N;
    const dir = trackDir(i);
    const n = trackNormal(i);
    this.pos = [track[i][0] + n[0] * this.lane, track[i][1] + n[1] * this.lane];
    this.angle = dir;
    this.speed = 0;
    this.idx = i;
    this.prevProgress = i / N;
    this.lap = 0;
    this.passedHalf = false;
    this.lapStart = 0;
    this.lastLap = null;
    this.bestLap = null;
    this.totalTime = null;
    this.finished = false;
    this.wrongWayTimer = 0;
  }

  progress() { return this.lap + this.idx / N; }

  update(dt, inputs, raceTime, onLap) {
    if (this.finished) return;

    const grass = offTrack(this.pos, this.idx);
    const maxSpeed = grass ? 170 : 540;

    if (inputs.throttle) this.speed += 320 * dt;
    if (inputs.brake) this.speed -= 560 * dt;
    if (!inputs.throttle && !inputs.brake) this.speed -= this.speed * 0.5 * dt;
    if (grass) this.speed -= this.speed * 1.6 * dt;
    this.speed = clamp(this.speed, -140, maxSpeed);

    const sf = clamp(Math.abs(this.speed) / 90, 0, 1) / (1 + (Math.abs(this.speed) / 320) ** 1.6 * 0.55);
    this.angle += inputs.steer * 2.9 * sf * Math.sign(this.speed || 1) * dt;

    this.pos[0] += Math.cos(this.angle) * this.speed * dt;
    this.pos[1] += Math.sin(this.angle) * this.speed * dt;

    const newIdx = nearestIndex(this.pos, this.idx);
    const progress = newIdx / N;

    if (this.prevProgress > 0.9 && progress < 0.1 && this.passedHalf) {
      this.lap++;
      this.passedHalf = false;
      const t = raceTime - this.lapStart;
      this.lastLap = t;
      if (this.bestLap == null || t < this.bestLap) this.bestLap = t;
      this.lapStart = raceTime;
      if (this.lap >= LAPS) {
        this.finished = true;
        this.totalTime = raceTime;
        this.speed *= 0.4;
      }
      if (onLap) onLap(this);
    } else if (this.prevProgress < 0.1 && progress > 0.9) {
      this.passedHalf = false;
    }
    if (progress > 0.4 && progress < 0.6) this.passedHalf = true;

    const dir = trackDir(newIdx);
    const along = Math.cos(dir) * Math.cos(this.angle) + Math.sin(dir) * Math.sin(this.angle);
    if (along < -0.2 && this.speed > 60) this.wrongWayTimer += dt;
    else this.wrongWayTimer = Math.max(0, this.wrongWayTimer - dt * 2);

    this.idx = newIdx;
    this.prevProgress = progress;
  }
}

const player = new Car('YOU', PLAYER_COLOR, true);
const ai = new Car('RIVAL', AI_COLOR, false);
ai.lane = 24;
const cars = [player, ai];

function aiInputs(car) {
  const look = (car.idx + Math.round(5 + car.speed * 0.045)) % N;
  const n = trackNormal(look);
  const tx = track[look][0] + n[0] * car.lane * 0.4;
  const ty = track[look][1] + n[1] * car.lane * 0.4;
  const desired = Math.atan2(ty - car.pos[1], tx - car.pos[0]);
  const diff = normAngle(desired - car.angle);
  const steer = clamp(diff * 2.6, -1, 1);
  const k = Math.max(curvature[look], 0.0004);
  const targetSpeed = Math.min(510, Math.sqrt(560 / k) * 0.92);
  return {
    throttle: car.speed < targetSpeed ? 1 : 0,
    brake: car.speed > targetSpeed * 1.07 ? 1 : 0,
    steer,
  };
}

const keys = {};
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === 'r') restart();
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

function playerInputs() {
  return {
    throttle: keys['arrowup'] || keys['w'] ? 1 : 0,
    brake: keys['arrowdown'] || keys['s'] ? 1 : 0,
    steer: (keys['arrowleft'] || keys['a'] ? -1 : 0) + (keys['arrowright'] || keys['d'] ? 1 : 0),
  };
}

// ---------- three.js scene ----------

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc0e8);
scene.fog = new THREE.Fog(0x8fc0e8, 280, 1100);

const camera = new THREE.PerspectiveCamera(72, 1, 0.5, 3000);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xcfe5ff, 0x3e6b35, 1.0));
const sun = new THREE.DirectionalLight(0xfff2d0, 1.4);
sun.position.set(600, 900, 300);
scene.add(sun);

const grass = new THREE.Mesh(
  new THREE.PlaneGeometry(3400, 2600),
  new THREE.MeshLambertMaterial({ color: 0x41813b })
);
grass.rotation.x = -Math.PI / 2;
grass.position.set(980, -0.05, 750);
scene.add(grass);

function ribbon(innerOff, outerOff, y, colorFn) {
  const positions = [];
  const colors = [];
  const indices = [];
  const c = new THREE.Color();
  for (let i = 0; i <= N; i++) {
    const idx = i % N;
    const p = track[idx];
    const n = trackNormal(idx);
    colorFn(idx, c);
    positions.push(
      p[0] + n[0] * innerOff, y, p[1] + n[1] * innerOff,
      p[0] + n[0] * outerOff, y, p[1] + n[1] * outerOff
    );
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    if (i < N) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

const half = TRACK_WIDTH / 2;

scene.add(ribbon(half + 5, half + 11, 0.02, (i, c) => {
  c.set(i % 2 ? 0xd43a2f : 0xf2f2f2);
}));
scene.add(ribbon(-half - 11, -half - 5, 0.02, (i, c) => {
  c.set(i % 2 ? 0xd43a2f : 0xf2f2f2);
}));

scene.add(ribbon(half - 3, half - 1, 0.03, (i, c) => c.set(0xe8e8e8)));
scene.add(ribbon(-half + 1, -half + 3, 0.03, (i, c) => c.set(0xe8e8e8)));

scene.add(ribbon(-half, half, 0.01, (i, c) => c.set(0x454b54)));

const startLineCanvas = document.createElement('canvas');
startLineCanvas.width = 8;
startLineCanvas.height = 2;
{
  const g = startLineCanvas.getContext('2d');
  for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) {
    g.fillStyle = (x + y) % 2 ? '#14171c' : '#f2f2f2';
    g.fillRect(x, y, 1, 1);
  }
}
const startTex = new THREE.CanvasTexture(startLineCanvas);
startTex.magFilter = THREE.NearestFilter;
const startLine = new THREE.Mesh(
  new THREE.PlaneGeometry(TRACK_WIDTH, 14),
  new THREE.MeshBasicMaterial({ map: startTex })
);
startLine.rotation.x = -Math.PI / 2;
{
  const d = trackDir(0);
  startLine.rotation.z = -(Math.PI / 2 - d);
  startLine.position.set(track[0][0], 0.04, track[0][1]);
}
scene.add(startLine);

const standMat = new THREE.MeshLambertMaterial({ color: 0x9aa3ad });
const roofMat = new THREE.MeshLambertMaterial({ color: 0xe10600 });
{
  const n = trackNormal(0);
  const d = trackDir(0);
  for (let s = -1; s <= 1; s += 2) {
    for (let k = 0; k < 3; k++) {
      const along = (k - 1) * 90;
      const cx = track[0][0] + n[0] * 55 * s - Math.cos(d) * along;
      const cz = track[0][1] + n[1] * 55 * s - Math.sin(d) * along;
      const stand = new THREE.Mesh(new THREE.BoxGeometry(80, 14, 10), standMat);
      stand.position.set(cx, 7, cz);
      stand.rotation.y = -(Math.PI / 2 - d);
      scene.add(stand);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(84, 1.5, 14), roofMat);
      roof.position.set(cx, 15, cz);
      roof.rotation.y = stand.rotation.y;
      scene.add(roof);
    }
  }
}

function buildCarMesh(color) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x14171c });
  const tireMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });

  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };

  add(new THREE.BoxGeometry(2.0, 0.7, 7), bodyMat, 0, 0.75, 0);
  add(new THREE.BoxGeometry(0.9, 0.35, 3.4), bodyMat, 0, 0.7, 4.6);
  add(new THREE.BoxGeometry(4.4, 0.15, 1.3), bodyMat, 0, 0.45, 5.8);
  add(new THREE.BoxGeometry(3.4, 0.15, 1.0), bodyMat, 0, 1.6, -3.8);
  add(new THREE.BoxGeometry(0.9, 0.6, 3.2), bodyMat, 1.35, 0.75, 0.4);
  add(new THREE.BoxGeometry(0.9, 0.6, 3.2), bodyMat, -1.35, 0.75, 0.4);
  add(new THREE.BoxGeometry(1.0, 0.6, 2.6), bodyMat, 0, 1.25, -1.6);
  add(new THREE.BoxGeometry(3.0, 0.25, 0.25), darkMat, 0, 1.0, -3.4);

  const halo = add(new THREE.TorusGeometry(0.85, 0.09, 8, 24), darkMat, 0, 1.45, 1.2);
  halo.rotation.x = Math.PI / 2;
  add(new THREE.SphereGeometry(0.38, 12, 10), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }), 0, 1.35, 0.3);

  const wheelGeoR = new THREE.CylinderGeometry(0.58, 0.58, 0.65, 14);
  const wheelGeoF = new THREE.CylinderGeometry(0.5, 0.5, 0.6, 14);
  for (const [x, z, geo] of [
    [1.2, 2.7, wheelGeoF], [-1.2, 2.7, wheelGeoF],
    [1.25, -2.7, wheelGeoR], [-1.25, -2.7, wheelGeoR],
  ]) {
    const w = new THREE.Mesh(geo, tireMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.58, z);
    g.add(w);
  }
  return g;
}

const aiMesh = buildCarMesh(AI_COLOR);
scene.add(aiMesh);

const cockpit = new THREE.Group();
{
  const bodyMat = new THREE.MeshLambertMaterial({ color: PLAYER_COLOR });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x14171c });
  const tireMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });

  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    cockpit.add(m);
    return m;
  };

  add(new THREE.BoxGeometry(0.55, 0.3, 3.6), bodyMat, 0, -0.85, -3.4);
  add(new THREE.BoxGeometry(3.6, 0.12, 0.9), bodyMat, 0, -1.15, -4.6);
  add(new THREE.BoxGeometry(0.16, 0.9, 0.16), darkMat, 0, -0.45, -1.7);
  add(new THREE.BoxGeometry(1.0, 0.06, 0.5), darkMat, 0, -0.55, -1.2);
  add(new THREE.BoxGeometry(0.7, 0.7, 1.4), tireMat, -1.05, -1.25, -1.9);
  add(new THREE.BoxGeometry(0.7, 0.7, 1.4), tireMat, 1.05, -1.25, -1.9);
  add(new THREE.BoxGeometry(0.8, 0.5, 1.0), tireMat, -1.1, -1.05, -3.2);
  add(new THREE.BoxGeometry(0.8, 0.5, 1.0), tireMat, 1.1, -1.05, -3.2);
}
camera.add(cockpit);

// ---------- HUD / overlays ----------

const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const overlayContent = document.getElementById('overlay-content');
const restartBtn = document.getElementById('restart-btn');
const wrongWayEl = document.getElementById('wrong-way');
const minimap = document.getElementById('minimap');
const mmCtx = minimap.getContext('2d');

let state = 'countdown';
let countdown = 3.6;
let raceTime = 0;
let sessionBest = parseFloat(localStorage.getItem(BEST_LAP_KEY));
if (!isFinite(sessionBest)) sessionBest = null;

let W = 0, H = 0;

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  renderer.setSize(W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  minimap.width = 170;
  minimap.height = 128;
}
window.addEventListener('resize', resize);
resize();

function restart() {
  player.reset();
  ai.reset();
  ai.lane = 24;
  raceTime = 0;
  countdown = 3.6;
  state = 'countdown';
  overlayTitle.innerHTML = 'F1 RACING <span>SIM</span>';
  overlaySub.textContent = 'Arrows / WASD to drive · R to restart';
  overlayContent.innerHTML = 'GET READY';
  restartBtn.style.display = 'none';
  overlay.classList.remove('hidden');
}
restartBtn.addEventListener('click', restart);
restart();

function showResults() {
  const sorted = [...cars].sort((a, b) => {
    if (a.finished && b.finished) return a.totalTime - b.totalTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress() - a.progress();
  });
  const winner = sorted[0];
  const rows = sorted.map((c, i) => {
    const time = c.finished ? fmtTime(c.totalTime) : 'DNF';
    return `<tr class="${c.isPlayer ? 'win' : ''}"><td>P${i + 1}</td><td>${c.name}</td><td>${time}</td><td>${fmtTime(c.bestLap)}</td></tr>`;
  }).join('');
  overlayTitle.innerHTML = winner.isPlayer ? 'YOU <span>WIN!</span>' : 'RIVAL <span>WINS</span>';
  overlaySub.textContent = winner.isPlayer ? 'Chequered flag — great drive!' : 'Better luck next race.';
  overlayContent.innerHTML = `<table><tr><th>POS</th><th>DRIVER</th><th>TOTAL</th><th>BEST LAP</th></tr>${rows}</table>`;
  restartBtn.style.display = 'block';
  overlay.classList.remove('hidden');
}

function updateHud() {
  document.getElementById('lap-num').textContent = Math.min(player.lap + 1, LAPS);
  document.getElementById('lap-total').textContent = LAPS;
  document.getElementById('car-count').textContent = cars.length;

  const sorted = [...cars].sort((a, b) => {
    if (a.finished && b.finished) return a.totalTime - b.totalTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress() - a.progress();
  });
  document.getElementById('position').textContent = sorted.indexOf(player) + 1;

  document.getElementById('lap-time').textContent = state === 'racing' && !player.finished
    ? fmtTime(raceTime - player.lapStart) : fmtTime(player.lastLap);
  document.getElementById('last-lap').textContent = fmtTime(player.lastLap);
  document.getElementById('best-lap').textContent = fmtTime(player.bestLap ?? sessionBest);

  document.getElementById('speed-num').textContent = Math.round(Math.abs(player.speed) * 0.72);
  document.getElementById('gear-num').textContent = player.speed < -1 ? 'R' : 1 + Math.min(7, Math.floor(Math.abs(player.speed) / 68));

  wrongWayEl.style.display = player.wrongWayTimer > 1 ? 'block' : 'none';
}

function drawMinimap() {
  const mw = minimap.width, mh = minimap.height;
  const sx = mw / 2000, sy = mh / 1500;
  mmCtx.clearRect(0, 0, mw, mh);
  mmCtx.fillStyle = 'rgba(15,18,22,0.72)';
  mmCtx.fillRect(0, 0, mw, mh);
  mmCtx.strokeStyle = 'rgba(255,255,255,0.45)';
  mmCtx.lineWidth = 3;
  mmCtx.beginPath();
  mmCtx.moveTo(track[0][0] * sx, track[0][1] * sy);
  for (let i = 1; i < N; i++) mmCtx.lineTo(track[i][0] * sx, track[i][1] * sy);
  mmCtx.closePath();
  mmCtx.stroke();
  mmCtx.fillStyle = '#b7bfc9';
  mmCtx.beginPath();
  mmCtx.arc(ai.pos[0] * sx, ai.pos[1] * sy, 4, 0, Math.PI * 2);
  mmCtx.fill();
  mmCtx.fillStyle = '#e10600';
  mmCtx.beginPath();
  mmCtx.arc(player.pos[0] * sx, player.pos[1] * sy, 4, 0, Math.PI * 2);
  mmCtx.fill();
}

function updateCamera(dt) {
  const a = player.angle;
  const dx = Math.cos(a), dz = Math.sin(a);
  const camDist = 4.5;
  camera.position.set(
    player.pos[0] - dx * camDist,
    2.1,
    player.pos[1] - dz * camDist
  );
  const look = new THREE.Vector3(player.pos[0] + dx * 45, 1.2, player.pos[1] + dz * 45);
  camera.lookAt(look);
  const steer = playerInputs().steer;
  camera.rotateZ(-steer * 0.045);

  const targetFov = 72 + (Math.abs(player.speed) / 540) * 16;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 5);
    camera.updateProjectionMatrix();
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (state === 'countdown') {
    countdown -= dt;
    const n = Math.ceil(countdown - 0.6);
    if (countdown > 0.6) {
      overlayContent.innerHTML = `<div class="big">${n}</div>`;
    } else if (countdown > 0) {
      overlayContent.innerHTML = '<div class="big">GO!</div>';
    } else {
      state = 'racing';
      overlay.classList.add('hidden');
    }
  } else if (state === 'racing') {
    raceTime += dt;
    player.update(dt, playerInputs(), raceTime, (car) => {
      if (car.bestLap != null && (sessionBest == null || car.bestLap < sessionBest)) {
        sessionBest = car.bestLap;
        localStorage.setItem(BEST_LAP_KEY, String(sessionBest));
      }
    });
    ai.update(dt, aiInputs(ai), raceTime, null);
    if (player.finished && ai.finished) state = 'finished';
  } else {
    for (const c of cars) {
      c.speed *= 1 - 1.4 * dt;
      c.pos[0] += Math.cos(c.angle) * c.speed * dt;
      c.pos[1] += Math.sin(c.angle) * c.speed * dt;
    }
    if (state === 'finished' && overlay.classList.contains('hidden')) showResults();
  }

  aiMesh.position.set(ai.pos[0], 0, ai.pos[1]);
  aiMesh.rotation.y = Math.PI / 2 - ai.angle;

  updateCamera(dt);
  renderer.render(scene, camera);
  drawMinimap();
  updateHud();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
})();
