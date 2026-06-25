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

  // ---- Tunables -----------------------------------------------------------
  const PLAYER_W = 36;
  const PLAYER_H = 24;
  const PLAYER_SPEED = 5;
  const PLAYER_Y = H - 60;
  const BULLET_SPEED = 9;
  const ENEMY_BULLET_SPEED = 4;
  const FORMATION_COLS = 8;

  // ---- Game state ---------------------------------------------------------
  let player, bullets, enemyBullets, enemies, stars;
  let score, stage, lives;
  let highScore = Number(localStorage.getItem("galaga-high") || 0);
  let running = false;
  let paused = false;
  let rafId = null;
  let lastTime = 0;
  let shootCooldown = 0;
  let formationDir = 1; // 1 = right, -1 = left
  let diveTimer = 0;
  const keys = Object.create(null);

  highEl.textContent = highScore;

  // ---- Starfield ----------------------------------------------------------
  function makeStars() {
    return Array.from({ length: 70 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      s: Math.random() * 1.6 + 0.4,
      v: Math.random() * 1.2 + 0.3,
    }));
  }

  // ---- Spawning -----------------------------------------------------------
  function spawnWave() {
    enemies = [];
    const rows = Math.min(3 + Math.floor(stage / 2), 5);
    const marginX = 60;
    const gapX = (W - marginX * 2) / (FORMATION_COLS - 1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < FORMATION_COLS; c++) {
        const isBoss = r === 0;
        enemies.push({
          homeX: marginX + c * gapX,
          homeY: 70 + r * 46,
          x: marginX + c * gapX,
          y: 70 + r * 46,
          w: 30,
          h: 24,
          alive: true,
          diving: false,
          color: isBoss ? "#ff4d6d" : r === 1 ? "#ffd166" : "#5ad6ff",
          points: isBoss ? 150 : r === 1 ? 80 : 50,
          t: 0,
        });
      }
    }
  }

  function startGame() {
    player = { x: W / 2 - PLAYER_W / 2, y: PLAYER_Y };
    bullets = [];
    enemyBullets = [];
    stars = makeStars();
    score = 0;
    stage = 1;
    lives = 3;
    running = true;
    paused = false;
    formationDir = 1;
    diveTimer = 0;
    shootCooldown = 0;
    spawnWave();
    updateStats();
    overlay.classList.add("hidden");
    lastTime = performance.now();
    cancelAnimationFrame(rafId);
    loop(lastTime);
  }

  function nextStage() {
    stage++;
    formationDir = 1;
    diveTimer = 0;
    enemyBullets = [];
    spawnWave();
    updateStats();
  }

  function updateStats() {
    scoreEl.textContent = score;
    highEl.textContent = highScore;
    stageEl.textContent = stage;
    livesEl.textContent = lives;
  }

  // ---- Update -------------------------------------------------------------
  function update(dt) {
    // starfield scroll
    for (const s of stars) {
      s.y += s.v * dt;
      if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
    }

    // player movement
    if (keys["ArrowLeft"]) player.x -= PLAYER_SPEED * dt;
    if (keys["ArrowRight"]) player.x += PLAYER_SPEED * dt;
    player.x = Math.max(8, Math.min(W - PLAYER_W - 8, player.x));

    // shooting
    shootCooldown -= dt;
    if (keys[" "] && shootCooldown <= 0) {
      bullets.push({ x: player.x + PLAYER_W / 2 - 2, y: player.y, w: 4, h: 12 });
      shootCooldown = 14;
    }

    // player bullets
    for (const b of bullets) b.y -= BULLET_SPEED * dt;
    bullets = bullets.filter((b) => b.y + b.h > 0);

    // formation horizontal sweep
    const living = enemies.filter((e) => e.alive && !e.diving);
    let hitEdge = false;
    const speed = 0.6 + stage * 0.15;
    for (const e of living) {
      e.homeX += formationDir * speed * dt;
      if (e.homeX < 30 || e.homeX > W - 30) hitEdge = true;
    }
    if (hitEdge) formationDir *= -1;

    // diving behaviour
    diveTimer -= dt;
    if (diveTimer <= 0 && living.length > 0) {
      const pick = living[(Math.random() * living.length) | 0];
      pick.diving = true;
      pick.t = 0;
      pick.startX = pick.x;
      pick.startY = pick.y;
      diveTimer = Math.max(40, 120 - stage * 8);
    }

    // enemy positions + firing
    for (const e of enemies) {
      if (!e.alive) continue;
      if (e.diving) {
        e.t += dt;
        const p = e.t / 90;
        // swooping sine dive toward bottom
        e.x = e.startX + Math.sin(e.t * 0.06) * 80;
        e.y = e.startY + p * 70 * dt + e.t * 2.2;
        // occasional shot
        if (Math.random() < 0.02 * dt) fireEnemy(e);
        if (e.y > H + 30) {
          // returned past bottom -> back to formation
          e.diving = false;
          e.y = e.homeY;
          e.x = e.homeX;
        }
      } else {
        e.x = e.homeX;
        e.y = e.homeY;
        if (Math.random() < 0.004 * dt) fireEnemy(e);
      }
    }

    // enemy bullets
    for (const b of enemyBullets) b.y += ENEMY_BULLET_SPEED * dt;
    enemyBullets = enemyBullets.filter((b) => b.y < H);

    handleCollisions();

    if (enemies.every((e) => !e.alive)) nextStage();
  }

  function fireEnemy(e) {
    enemyBullets.push({ x: e.x + e.w / 2 - 2, y: e.y + e.h, w: 4, h: 12 });
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function handleCollisions() {
    // player bullets vs enemies
    for (const b of bullets) {
      const bb = { x: b.x, y: b.y, w: b.w, h: b.h };
      for (const e of enemies) {
        if (!e.alive) continue;
        if (rectsOverlap(bb, e)) {
          e.alive = false;
          b.y = -100; // mark for removal
          score += e.points;
          if (score > highScore) {
            highScore = score;
            localStorage.setItem("galaga-high", String(highScore));
          }
          updateStats();
          break;
        }
      }
    }
    bullets = bullets.filter((b) => b.y > -50);

    const playerRect = { x: player.x, y: player.y, w: PLAYER_W, h: PLAYER_H };

    // enemy bullets vs player
    for (const b of enemyBullets) {
      if (rectsOverlap(b, playerRect)) {
        b.y = H + 100;
        loseLife();
        return;
      }
    }
    // diving enemies vs player
    for (const e of enemies) {
      if (e.alive && e.diving && rectsOverlap(e, playerRect)) {
        e.alive = false;
        loseLife();
        return;
      }
    }
  }

  function loseLife() {
    lives--;
    updateStats();
    enemyBullets = [];
    player.x = W / 2 - PLAYER_W / 2;
    if (lives <= 0) gameOver();
  }

  function gameOver() {
    running = false;
    cancelAnimationFrame(rafId);
    overlayText.textContent = "GAME OVER";
    overlay.classList.remove("hidden");
  }

  // ---- Render -------------------------------------------------------------
  function draw() {
    ctx.fillStyle = "#05050f";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#ffffff";
    for (const s of stars) ctx.fillRect(s.x, s.y, s.s, s.s);

    // player ship
    if (player) drawShip(player.x, player.y);

    // player bullets
    ctx.fillStyle = "#7dfcff";
    for (const b of bullets) ctx.fillRect(b.x, b.y, b.w, b.h);

    // enemy bullets
    ctx.fillStyle = "#ff7b7b";
    for (const b of enemyBullets) ctx.fillRect(b.x, b.y, b.w, b.h);

    // enemies
    for (const e of enemies) {
      if (!e.alive) continue;
      drawEnemy(e);
    }
  }

  function drawShip(x, y) {
    ctx.fillStyle = "#5ad6ff";
    ctx.beginPath();
    ctx.moveTo(x + PLAYER_W / 2, y);
    ctx.lineTo(x + PLAYER_W, y + PLAYER_H);
    ctx.lineTo(x + PLAYER_W * 0.65, y + PLAYER_H);
    ctx.lineTo(x + PLAYER_W / 2, y + PLAYER_H * 0.6);
    ctx.lineTo(x + PLAYER_W * 0.35, y + PLAYER_H);
    ctx.lineTo(x, y + PLAYER_H);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillRect(x + PLAYER_W / 2 - 2, y + 4, 4, PLAYER_H - 8);
  }

  function drawEnemy(e) {
    ctx.fillStyle = e.color;
    ctx.fillRect(e.x + 6, e.y + 4, e.w - 12, e.h - 8);
    ctx.fillRect(e.x, e.y + e.h / 2 - 3, e.w, 6);
    // wings
    ctx.fillRect(e.x + 2, e.y + e.h - 6, 6, 6);
    ctx.fillRect(e.x + e.w - 8, e.y + e.h - 6, 6, 6);
    // eyes
    ctx.fillStyle = "#05050f";
    ctx.fillRect(e.x + 9, e.y + 8, 4, 4);
    ctx.fillRect(e.x + e.w - 13, e.y + 8, 4, 4);
  }

  // ---- Main loop ----------------------------------------------------------
  function loop(time) {
    if (!running || paused) return;
    // delta normalized to ~60fps frames (dt ~= 1 at 60fps)
    let dt = (time - lastTime) / 16.67;
    lastTime = time;
    if (dt > 3) dt = 3; // clamp after tab switch
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
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) {
      e.preventDefault();
    }
    if (e.key === "p" || e.key === "P") { togglePause(); return; }
    keys[e.key] = true;
  });
  document.addEventListener("keyup", (e) => { keys[e.key] = false; });

  startBtn.addEventListener("click", startGame);

  // Clicking the overlay label itself starts or resumes the game.
  overlay.addEventListener("click", () => {
    if (!running) startGame();
    else if (paused) togglePause();
  });

  // ---- Initial render -----------------------------------------------------
  stars = makeStars();
  enemies = [];
  bullets = [];
  enemyBullets = [];
  draw();
  overlayText.textContent = "PRESS START";
  overlay.classList.remove("hidden");
})();
