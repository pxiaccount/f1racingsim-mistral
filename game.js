(() => {
'use strict';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const TRACK_WIDTH = 96;
const LAPS = 3;
const PLAYER_COLOR = '#e10600';
const AI_COLOR = '#b7bfc9';
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

const trackPath = new Path2D();
trackPath.moveTo(track[0][0], track[0][1]);
for (let i = 1; i < N; i++) trackPath.lineTo(track[i][0], track[i][1]);
trackPath.closePath();

function trackDir(i) {
  const a = track[i], b = track[(i + 1) % N];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
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
    const px = Math.cos(dir + Math.PI / 2), py = Math.sin(dir + Math.PI / 2);
    this.pos = [track[i][0] + px * this.lane, track[i][1] + py * this.lane];
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
  const dir = trackDir(look);
  const px = Math.cos(dir + Math.PI / 2), py = Math.sin(dir + Math.PI / 2);
  const tx = track[look][0] + px * car.lane * 0.4;
  const ty = track[look][1] + py * car.lane * 0.4;
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

const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const overlayContent = document.getElementById('overlay-content');
const restartBtn = document.getElementById('restart-btn');
const wrongWayEl = document.getElementById('wrong-way');

let state = 'countdown';
let countdown = 3.6;
let raceTime = 0;
let sessionBest = parseFloat(localStorage.getItem(BEST_LAP_KEY));
if (!isFinite(sessionBest)) sessionBest = null;

const cam = { x: player.pos[0], y: player.pos[1] };
let W = 0, H = 0, zoom = 0.6;

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
  zoom = clamp(Math.min(W / 1500, H / 1050), 0.34, 0.85);
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
  overlayContent.classList.remove('big');
  restartBtn.style.display = 'none';
  overlay.classList.remove('hidden');
  cam.x = player.pos[0];
  cam.y = player.pos[1];
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

function drawCar(c) {
  ctx.save();
  ctx.translate(c.pos[0], c.pos[1]);
  ctx.rotate(c.angle);

  ctx.fillStyle = '#14171c';
  ctx.fillRect(-22, -13, 12, 5);
  ctx.fillRect(-22, 8, 12, 5);
  ctx.fillRect(12, -12, 8, 4.5);
  ctx.fillRect(12, 7.5, 8, 4.5);

  ctx.fillStyle = c.color;
  ctx.beginPath();
  ctx.moveTo(-24, -7);
  ctx.lineTo(-10, -5.5);
  ctx.lineTo(20, -4);
  ctx.lineTo(26, 0);
  ctx.lineTo(20, 4);
  ctx.lineTo(-10, 5.5);
  ctx.lineTo(-24, 7);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(-2, -3.2, 9, 6.4);

  ctx.fillStyle = c.color;
  ctx.fillRect(-26, -9, 4, 18);
  ctx.fillRect(24, -8, 3.5, 16);

  ctx.fillStyle = '#14171c';
  ctx.fillRect(-8, -2.5, 5, 5);

  ctx.restore();
}

function drawStartLine() {
  const i = 0;
  const dir = trackDir(i);
  const px = Math.cos(dir + Math.PI / 2), py = Math.sin(dir + Math.PI / 2);
  ctx.save();
  ctx.translate(track[i][0], track[i][1]);
  ctx.rotate(dir);
  const half = TRACK_WIDTH / 2;
  for (let row = 0; row < 2; row++) {
    for (let s = 0; s < 8; s++) {
      ctx.fillStyle = (row + s) % 2 ? '#14171c' : '#f2f2f2';
      const y = -half + (s * half) / 4;
      ctx.fillRect(-8 + row * 8, y, 8, half / 4);
    }
  }
  ctx.restore();
}

function drawMinimap() {
  const mw = 170, mh = mw * (1500 / 2000);
  const ox = W - mw - 16, oy = H - mh - 16;
  const sx = mw / 2000, sy = mh / 1500;
  ctx.save();
  ctx.fillStyle = 'rgba(15,18,22,0.72)';
  ctx.fillRect(ox - 6, oy - 6, mw + 12, mh + 12);
  ctx.translate(ox, oy);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(track[0][0] * sx, track[0][1] * sy);
  for (let i = 1; i < N; i++) ctx.lineTo(track[i][0] * sx, track[i][1] * sy);
  ctx.closePath();
  ctx.stroke();
  for (const c of cars) {
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(c.pos[0] * sx, c.pos[1] * sy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#41813b';
  ctx.fillRect(0, 0, W, H);

  ctx.setTransform(zoom, 0, 0, zoom, W / 2 - cam.x * zoom, H / 2 - cam.y * zoom);

  ctx.lineJoin = ctx.lineCap = 'round';

  ctx.strokeStyle = '#d43a2f';
  ctx.lineWidth = TRACK_WIDTH + 26;
  ctx.setLineDash([26, 26]);
  ctx.stroke(trackPath);
  ctx.setLineDash([]);

  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = TRACK_WIDTH + 10;
  ctx.stroke(trackPath);

  ctx.strokeStyle = '#454b54';
  ctx.lineWidth = TRACK_WIDTH;
  ctx.stroke(trackPath);

  drawStartLine();

  const sortedCars = [...cars].sort((a, b) => a.pos[1] - b.pos[1]);
  for (const c of sortedCars) drawCar(c);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawMinimap();
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

  cam.x += (player.pos[0] - cam.x) * Math.min(1, dt * 6);
  cam.y += (player.pos[1] - cam.y) * Math.min(1, dt * 6);

  render();
  updateHud();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
})();
