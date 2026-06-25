(() => {
  "use strict";

  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const scoreEl = document.getElementById("score");
  const highEl = document.getElementById("high");
  const stageEl = document.getElementById("stage");
  const livesEl = document.getElementById("lives");
  const startBtn = document.getElementById("start");
  const overlay = document.getElementById("overlay");
  const overlayText = document.getElementById("overlay-text");

  // ---- Constants ----------------------------------------------------------
  const PLAYER_Y = H - 54;
  const PLAYER_SPEED = 4.6;
  const BULLET_SPEED = 10;
  const ENTER_DUR = 80;   // frames for the fly-in swoop
  const DIVE_DUR = 130;   // frames for a dive run
  const RET_DUR = 55;     // frames to slide back into formation

  // Formation layout (classic-ish: bosses on top, butterflies, then bees)
  const ROWS = [
    { type: "boss", n: 4 },
    { type: "butterfly", n: 8 },
    { type: "butterfly", n: 8 },
    { type: "bee", n: 10 },
    { type: "bee", n: 10 },
  ];
  const FORM_TOP = 72;
  const GAP_X = 34;
  const GAP_Y = 40;

  const POINTS = {
    bee: { form: 50, dive: 100, hp: 1, w: 22, h: 20 },
    butterfly: { form: 80, dive: 160, hp: 1, w: 26, h: 22 },
    boss: { form: 150, dive: 400, hp: 2, w: 30, h: 26 },
  };

  // ---- State --------------------------------------------------------------
  let player, bullets, enemyBullets, enemies, stars, explosions;
  let score, stage, lives;
  let highScore = Number(localStorage.getItem("galaga-high") || 0);
  let running = false;
  let paused = false;
  let rafId = null;
  let lastTime = 0;
  let frame = 0;        // global animation clock (frames)
  let waveT = 0;        // time since wave started (frames)
  let diveCooldown = 0;
  let enterEndT = 0;    // when all enemies have finished entering
  const keys = Object.create(null);

  highEl.textContent = highScore;

  // ---- Helpers ------------------------------------------------------------
  function bez(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // Live formation slot for a given row/col, including the gentle sway.
  function slotPos(rowIndex, col, n) {
    const sway = Math.sin(frame * 0.018) * 16;
    const breathe = Math.sin(frame * 0.04) * 3;
    return {
      x: W / 2 + (col - (n - 1) / 2) * GAP_X + sway,
      y: FORM_TOP + rowIndex * GAP_Y + breathe,
    };
  }

  // ---- Starfield (twinkling, scrolling) -----------------------------------
  const STAR_COLORS = ["#ffffff", "#9ad0ff", "#ffd2a6", "#b6ffd0", "#ff9ad0"];
  function makeStars() {
    return Array.from({ length: 90 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      v: rand(0.3, 1.4),
      size: Math.random() < 0.15 ? 2 : 1,
      color: STAR_COLORS[(Math.random() * STAR_COLORS.length) | 0],
      blink: rand(0.01, 0.05),
      phase: Math.random() * Math.PI * 2,
    }));
  }

  // ---- Wave construction --------------------------------------------------
  function spawnWave() {
    enemies = [];
    let order = 0;
    ROWS.forEach((row, rowIndex) => {
      for (let col = 0; col < row.n; col++) {
        const fromLeft = col % 2 === 0;
        const spec = POINTS[row.type];
        const slot = { x: W / 2 + (col - (row.n - 1) / 2) * GAP_X, y: FORM_TOP + rowIndex * GAP_Y };
        // entrance control points: swoop in from a side, loop over the top
        const p0 = { x: fromLeft ? -40 : W + 40, y: H * 0.28 };
        const p1 = { x: fromLeft ? W * 0.18 : W * 0.82, y: -50 };
        const p2 = { x: slot.x + (fromLeft ? 70 : -70), y: slot.y - 50 };
        enemies.push({
          type: row.type,
          rowIndex,
          col,
          n: row.n,
          hp: spec.hp,
          w: spec.w,
          h: spec.h,
          basePoints: spec,
          state: "enter",
          st: 0,
          delay: 10 + order * 5,
          x: p0.x,
          y: p0.y,
          px: p0.x,
          py: p0.y,
          angle: Math.PI / 2,
          p0, p1, p2,
          flap: Math.random() * Math.PI * 2,
          targetX: 0,
          dive: null,
        });
        order++;
      }
    });
    enterEndT = 10 + order * 5 + ENTER_DUR;
    diveCooldown = enterEndT + 30;
  }

  function startGame() {
    player = { x: W / 2, y: PLAYER_Y, cooldown: 0, invuln: 0 };
    bullets = [];
    enemyBullets = [];
    explosions = [];
    stars = makeStars();
    score = 0;
    stage = 1;
    lives = 3;
    running = true;
    paused = false;
    frame = 0;
    waveT = 0;
    spawnWave();
    updateStats();
    overlay.classList.add("hidden");
    lastTime = performance.now();
    cancelAnimationFrame(rafId);
    loop(lastTime);
  }

  function nextStage() {
    stage++;
    waveT = 0;
    enemyBullets = [];
    spawnWave();
    updateStats();
  }

  function updateStats() {
    scoreEl.textContent = score;
    highEl.textContent = highScore;
    stageEl.textContent = stage;
    livesEl.textContent = Math.max(0, lives);
  }

  function addScore(pts) {
    score += pts;
    if (score > highScore) {
      highScore = score;
      localStorage.setItem("galaga-high", String(highScore));
    }
    updateStats();
  }

  // ---- Enemy behaviour ----------------------------------------------------
  function startDive(e) {
    if (e.state !== "form") return;
    const dir = player.x >= e.x ? 1 : -1;
    const slot = slotPos(e.rowIndex, e.col, e.n);
    e.state = "dive";
    e.st = 0;
    e.targetX = player.x;
    e.dive = {
      p0: { x: slot.x, y: slot.y },
      p1: { x: slot.x + dir * 80, y: slot.y - 30 },
      p2: { x: slot.x - dir * 130, y: slot.y + 200 },
      p3: { x: clamp(player.x + dir * 30, 30, W - 30), y: H + 50 },
    };
  }

  function maybeLaunchDives(dt) {
    diveCooldown -= dt;
    if (diveCooldown > 0) return;
    const ready = enemies.filter((e) => e.state === "form");
    if (ready.length === 0) return;
    // dive in a small group, like the real game (a leader + escorts)
    const groupSize = Math.min(1 + ((Math.random() * (1 + stage)) | 0), 3, ready.length);
    for (let i = 0; i < groupSize; i++) {
      startDive(ready[(Math.random() * ready.length) | 0]);
    }
    diveCooldown = Math.max(28, 95 - stage * 7);
  }

  function fireEnemy(e) {
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const sp = Math.min(3 + stage * 0.3, 6);
    enemyBullets.push({ x: e.x, y: e.y + 8, vx: (dx / d) * sp, vy: (dy / d) * sp });
  }

  function setAngleFromMotion(e) {
    const dx = e.x - e.px;
    const dy = e.y - e.py;
    if (dx * dx + dy * dy > 0.2) e.angle = Math.atan2(dy, dx);
  }

  function updateEnemy(e, dt) {
    e.px = e.x;
    e.py = e.y;

    if (e.state === "enter") {
      if (waveT < e.delay) { e.x = e.p0.x; e.y = e.p0.y; return; }
      e.st += dt;
      const t = clamp(e.st / ENTER_DUR, 0, 1);
      const slot = slotPos(e.rowIndex, e.col, e.n);
      e.x = bez(e.p0.x, e.p1.x, e.p2.x, slot.x, t);
      e.y = bez(e.p0.y, e.p1.y, e.p2.y, slot.y, t);
      setAngleFromMotion(e);
      if (t >= 1) { e.state = "form"; e.angle = Math.PI / 2; }
      return;
    }

    if (e.state === "form") {
      const slot = slotPos(e.rowIndex, e.col, e.n);
      e.x = slot.x;
      e.y = slot.y;
      e.angle = Math.PI / 2;
      return;
    }

    if (e.state === "dive") {
      e.st += dt;
      const t = e.st / DIVE_DUR;
      const d = e.dive;
      e.x = bez(d.p0.x, d.p1.x, d.p2.x, d.p3.x, t) + Math.sin(e.st * 0.18) * 10;
      e.y = bez(d.p0.y, d.p1.y, d.p2.y, d.p3.y, t);
      setAngleFromMotion(e);
      if (Math.random() < 0.035 * dt && e.y > 0 && e.y < H - 40) fireEnemy(e);
      if (t >= 1 || e.y > H + 40) { e.state = "return"; e.st = 0; }
      return;
    }

    if (e.state === "return") {
      e.st += dt;
      const t = clamp(e.st / RET_DUR, 0, 1);
      const slot = slotPos(e.rowIndex, e.col, e.n);
      e.x = slot.x;
      e.y = lerp(-30, slot.y, t);
      e.angle = Math.PI / 2;
      if (t >= 1) e.state = "form";
      return;
    }
  }

  // ---- Update -------------------------------------------------------------
  function update(dt) {
    frame += dt;
    waveT += dt;

    for (const s of stars) {
      s.y += s.v * dt;
      if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
      s.phase += s.blink * dt;
    }

    if (player.invuln > 0) player.invuln -= dt;

    if (keys["ArrowLeft"]) player.x -= PLAYER_SPEED * dt;
    if (keys["ArrowRight"]) player.x += PLAYER_SPEED * dt;
    player.x = clamp(player.x, 18, W - 18);

    player.cooldown -= dt;
    if (keys[" "] && player.cooldown <= 0) {
      bullets.push({ x: player.x, y: player.y - 14 });
      player.cooldown = 13;
    }
    for (const b of bullets) b.y -= BULLET_SPEED * dt;
    bullets = bullets.filter((b) => b.y > -20);

    maybeLaunchDives(dt);
    for (const e of enemies) updateEnemy(e, dt);

    for (const b of enemyBullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    enemyBullets = enemyBullets.filter((b) => b.y < H + 10 && b.x > -10 && b.x < W + 10);

    for (const ex of explosions) ex.t += dt;
    explosions = explosions.filter((ex) => ex.t < 22);

    handleCollisions();

    if (enemies.length === 0) nextStage();
  }

  function boxHit(ax, ay, aw, ah, bx, by, bw, bh) {
    return Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh;
  }

  function explode(x, y, big) {
    explosions.push({ x, y, t: 0, big: !!big });
  }

  function killEnemy(e) {
    const diving = e.state === "dive" || e.state === "return";
    addScore(diving ? e.basePoints.dive : e.basePoints.form);
    explode(e.x, e.y, e.type === "boss");
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
  }

  function handleCollisions() {
    // player bullets vs enemies
    for (const b of bullets) {
      if (b.dead) continue;
      for (const e of enemies) {
        if (e.state === "enter" && waveT < e.delay) continue;
        if (boxHit(b.x, b.y, 4, 12, e.x, e.y, e.w, e.h)) {
          b.dead = true;
          e.hp -= 1;
          if (e.hp <= 0) killEnemy(e);
          else explode(b.x, b.y - 4, false); // boss shrugged off a hit
          break;
        }
      }
    }
    bullets = bullets.filter((b) => !b.dead);

    if (player.invuln > 0) return;

    // enemy bullets vs player
    for (const b of enemyBullets) {
      if (boxHit(b.x, b.y, 4, 8, player.x, player.y, 22, 18)) {
        b.y = H + 100;
        hitPlayer();
        return;
      }
    }
    // diving enemies crashing into player
    for (const e of enemies) {
      if (e.state === "dive" && boxHit(e.x, e.y, e.w, e.h, player.x, player.y, 22, 18)) {
        killEnemy(e);
        hitPlayer();
        return;
      }
    }
  }

  function hitPlayer() {
    explode(player.x, player.y, true);
    lives -= 1;
    updateStats();
    enemyBullets = [];
    player.x = W / 2;
    player.invuln = 120;
    if (lives <= 0) gameOver();
  }

  function gameOver() {
    running = false;
    cancelAnimationFrame(rafId);
    overlayText.textContent = "GAME OVER";
    overlay.classList.remove("hidden");
  }

  // ---- Rendering ----------------------------------------------------------
  function draw() {
    ctx.fillStyle = "#03030a";
    ctx.fillRect(0, 0, W, H);

    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(s.phase);
      ctx.globalAlpha = tw;
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }
    ctx.globalAlpha = 1;

    for (const e of enemies) {
      if (e.state === "enter" && waveT < e.delay) continue;
      drawEnemy(e);
    }

    ctx.fillStyle = "#7dfcff";
    for (const b of bullets) ctx.fillRect(b.x - 2, b.y - 6, 4, 12);

    ctx.fillStyle = "#ff7b7b";
    for (const b of enemyBullets) ctx.fillRect(b.x - 2, b.y - 4, 4, 9);

    if (player && (player.invuln <= 0 || ((frame * 0.2) | 0) % 2 === 0)) {
      drawPlayer(player.x, player.y);
    }

    for (const ex of explosions) drawExplosion(ex);
  }

  function drawPlayer(x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#e8e8f0";
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(3, -4);
    ctx.lineTo(-3, -4);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-2, -10, 4, 12);
    ctx.fillRect(-13, 2, 26, 4);
    ctx.fillRect(-5, -2, 10, 8);
    ctx.fillStyle = "#ff4d4d";
    ctx.fillRect(-1, -9, 2, 5);
    ctx.fillStyle = "#4da6ff";
    ctx.fillRect(-13, 2, 4, 4);
    ctx.fillRect(9, 2, 4, 4);
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle + Math.PI / 2);
    const flap = 0.5 + 0.5 * Math.sin(e.flap + frame * 0.25);
    if (e.type === "bee") drawBee(flap);
    else if (e.type === "butterfly") drawButterfly(flap);
    else drawBoss(flap, e.hp);
    ctx.restore();
  }

  function wing(side, x0, y0, x1, y1, x2, y2, x3, y3) {
    ctx.beginPath();
    ctx.moveTo(side * x0, y0);
    ctx.lineTo(side * x1, y1);
    ctx.lineTo(side * x2, y2);
    ctx.lineTo(side * x3, y3);
    ctx.closePath();
    ctx.fill();
  }

  function drawBee(flap) {
    const wy = -2 - flap * 4;
    ctx.fillStyle = "#3aa0ff";
    wing(1, 3, -2, 13, wy, 12, wy + 8, 3, 4);
    wing(-1, 3, -2, 13, wy, 12, wy + 8, 3, 4);
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.ellipse(0, 0, 5, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c9a000";
    ctx.fillRect(-5, -1, 10, 1.6);
    ctx.fillRect(-4, 3, 8, 1.6);
    ctx.strokeStyle = "#3aa0ff";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-2, -7); ctx.lineTo(-4, -12);
    ctx.moveTo(2, -7); ctx.lineTo(4, -12);
    ctx.stroke();
    ctx.fillStyle = "#10101e";
    ctx.fillRect(-3, -4, 2, 2);
    ctx.fillRect(1, -4, 2, 2);
  }

  function drawButterfly(flap) {
    const wy = -3 - flap * 5;
    ctx.fillStyle = "#ff3b4e";
    wing(1, 3, -3, 15, wy, 14, wy + 11, 3, 6);
    wing(-1, 3, -3, 15, wy, 14, wy + 11, 3, 6);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(9, wy, 4, 4);
    ctx.fillRect(-13, wy, 4, 4);
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.ellipse(0, 0, 5, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ff3b4e";
    ctx.fillRect(-5, -2, 10, 2);
    ctx.fillRect(-5, 4, 10, 2);
    ctx.strokeStyle = "#4da6ff";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-2, -8); ctx.lineTo(-5, -13);
    ctx.moveTo(2, -8); ctx.lineTo(5, -13);
    ctx.stroke();
    ctx.fillStyle = "#10101e";
    ctx.fillRect(-3, -5, 2, 2);
    ctx.fillRect(1, -5, 2, 2);
  }

  function drawBoss(flap, hp) {
    const dmg = hp <= 1;
    const wingCol = dmg ? "#c44dff" : "#36e0a0";
    const bodyCol = dmg ? "#8a4dff" : "#2bd6c0";
    const wy = -4 - flap * 5;
    ctx.fillStyle = wingCol;
    wing(1, 4, -3, 17, wy, 15, wy + 12, 4, 7);
    wing(-1, 4, -3, 17, wy, 15, wy + 12, 4, 7);
    ctx.fillStyle = bodyCol;
    ctx.beginPath();
    ctx.ellipse(0, 0, 6, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    // crown horns
    ctx.fillStyle = wingCol;
    ctx.beginPath();
    ctx.moveTo(-5, -8); ctx.lineTo(-7, -14); ctx.lineTo(-2, -9); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(5, -8); ctx.lineTo(7, -14); ctx.lineTo(2, -9); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-4, -5, 3, 3);
    ctx.fillRect(1, -5, 3, 3);
    ctx.fillStyle = "#10101e";
    ctx.fillRect(-3, -4, 1.4, 1.4);
    ctx.fillRect(1.6, -4, 1.4, 1.4);
  }

  function drawExplosion(ex) {
    const p = ex.t / 22;
    const r = (ex.big ? 26 : 16) * p;
    const n = ex.big ? 10 : 7;
    ctx.globalAlpha = 1 - p;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ex.t * 0.1;
      const px = ex.x + Math.cos(a) * r;
      const py = ex.y + Math.sin(a) * r;
      ctx.fillStyle = i % 2 ? "#ffd23f" : "#ff7b3a";
      const s = ex.big ? 4 : 3;
      ctx.fillRect(px - s / 2, py - s / 2, s, s);
    }
    ctx.fillStyle = "rgba(255,255,255," + (0.8 * (1 - p)) + ")";
    ctx.fillRect(ex.x - 2, ex.y - 2, 4, 4);
    ctx.globalAlpha = 1;
  }

  // ---- Main loop ----------------------------------------------------------
  function loop(time) {
    if (!running || paused) return;
    let dt = (time - lastTime) / 16.67;
    lastTime = time;
    if (dt > 3) dt = 3;
    update(dt);
    draw();
    rafId = requestAnimationFrame(loop);
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    if (paused) {
      overlayText.textContent = "PAUSED";
      overlay.classList.remove("hidden");
    } else {
      overlay.classList.add("hidden");
      lastTime = performance.now();
      loop(lastTime);
    }
  }

  // ---- Input --------------------------------------------------------------
  document.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) e.preventDefault();
    if (e.key === "p" || e.key === "P") { togglePause(); return; }
    keys[e.key] = true;
  });
  document.addEventListener("keyup", (e) => { keys[e.key] = false; });

  startBtn.addEventListener("click", startGame);
  overlay.addEventListener("click", () => {
    if (!running) startGame();
    else if (paused) togglePause();
  });

  // ---- Initial render -----------------------------------------------------
  stars = makeStars();
  enemies = [];
  bullets = [];
  enemyBullets = [];
  explosions = [];
  player = { x: W / 2, y: PLAYER_Y, cooldown: 0, invuln: 0 };
  draw();
  overlayText.textContent = "PRESS START";
  overlay.classList.remove("hidden");
})();
