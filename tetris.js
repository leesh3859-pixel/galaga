(() => {
  "use strict";

  const COLS = 10;
  const ROWS = 20;
  const CELL = 30;

  const board = document.getElementById("board");
  const ctx = board.getContext("2d");
  const nextCanvas = document.getElementById("next");
  const nctx = nextCanvas.getContext("2d");

  const scoreEl = document.getElementById("score");
  const linesEl = document.getElementById("lines");
  const levelEl = document.getElementById("level");
  const startBtn = document.getElementById("start");
  const overlay = document.getElementById("overlay");
  const overlayText = document.getElementById("overlay-text");

  // Tetromino definitions (rotation states as 4x4 / NxN matrices)
  const SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
    O: [[1, 1], [1, 1]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  };

  const COLORS = {
    I: "#33ffff",
    J: "#3366ff",
    L: "#ff9933",
    O: "#ffff33",
    S: "#33ff66",
    T: "#cc66ff",
    Z: "#ff3366",
  };

  let grid, current, next, score, lines, level;
  let dropCounter, dropInterval, lastTime;
  let running = false;
  let paused = false;
  let rafId = null;

  function createGrid() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  function randomPiece() {
    const keys = Object.keys(SHAPES);
    const type = keys[(Math.random() * keys.length) | 0];
    const matrix = SHAPES[type].map((row) => row.slice());
    return {
      type,
      matrix,
      x: ((COLS - matrix[0].length) / 2) | 0,
      y: 0,
    };
  }

  function rotate(matrix) {
    const N = matrix.length;
    const result = matrix.map((row) => row.slice());
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        result[x][N - 1 - y] = matrix[y][x];
      }
    }
    return result;
  }

  function collides(piece, grid) {
    const { matrix, x: px, y: py } = piece;
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (!matrix[y][x]) continue;
        const nx = px + x;
        const ny = py + y;
        if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
        if (ny >= 0 && grid[ny][nx]) return true;
      }
    }
    return false;
  }

  function merge(piece, grid) {
    piece.matrix.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value) grid[piece.y + y][piece.x + x] = piece.type;
      });
    });
  }

  function clearLines() {
    let cleared = 0;
    outer: for (let y = ROWS - 1; y >= 0; y--) {
      for (let x = 0; x < COLS; x++) {
        if (!grid[y][x]) continue outer;
      }
      grid.splice(y, 1);
      grid.unshift(Array(COLS).fill(null));
      cleared++;
      y++; // re-check same row index after shift
    }
    if (cleared > 0) {
      const points = [0, 100, 300, 500, 800];
      score += points[cleared] * level;
      lines += cleared;
      level = Math.floor(lines / 10) + 1;
      dropInterval = Math.max(80, 1000 - (level - 1) * 90);
      updateStats();
    }
  }

  function spawn() {
    current = next || randomPiece();
    next = randomPiece();
    drawNext();
    if (collides(current, grid)) {
      gameOver();
    }
  }

  function move(dir) {
    current.x += dir;
    if (collides(current, grid)) current.x -= dir;
  }

  function softDrop() {
    current.y++;
    if (collides(current, grid)) {
      current.y--;
      lockPiece();
    }
    dropCounter = 0;
  }

  function hardDrop() {
    while (!collides(current, grid)) current.y++;
    current.y--;
    lockPiece();
  }

  function lockPiece() {
    merge(current, grid);
    clearLines();
    spawn();
  }

  function playerRotate() {
    const rotated = rotate(current.matrix);
    const prev = current.matrix;
    current.matrix = rotated;
    // simple wall kick
    const kicks = [0, -1, 1, -2, 2];
    for (const k of kicks) {
      current.x += k;
      if (!collides(current, grid)) return;
      current.x -= k;
    }
    current.matrix = prev;
  }

  function updateStats() {
    scoreEl.textContent = score;
    linesEl.textContent = lines;
    levelEl.textContent = level;
  }

  function drawCell(context, x, y, type, size) {
    context.fillStyle = COLORS[type];
    context.fillRect(x * size, y * size, size, size);
    context.strokeStyle = "rgba(0,0,0,0.35)";
    context.lineWidth = 2;
    context.strokeRect(x * size, y * size, size, size);
  }

  function draw() {
    ctx.fillStyle = "#11111f";
    ctx.fillRect(0, 0, board.width, board.height);

    // grid background lines
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL, 0);
      ctx.lineTo(x * CELL, board.height);
      ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL);
      ctx.lineTo(board.width, y * CELL);
      ctx.stroke();
    }

    // settled blocks
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x]) drawCell(ctx, x, y, grid[y][x], CELL);
      }
    }

    // ghost piece
    if (current) {
      const ghost = { ...current, matrix: current.matrix };
      let gy = current.y;
      const test = { ...current };
      while (!collides({ ...test, y: gy + 1 }, grid)) gy++;
      ctx.globalAlpha = 0.25;
      current.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
          if (value) drawCell(ctx, current.x + x, gy + y, current.type, CELL);
        });
      });
      ctx.globalAlpha = 1;

      // current piece
      current.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
          if (value) drawCell(ctx, current.x + x, current.y + y, current.type, CELL);
        });
      });
    }
  }

  function drawNext() {
    nctx.fillStyle = "#11111f";
    nctx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!next) return;
    const size = 24;
    const m = next.matrix;
    const offsetX = (nextCanvas.width / size - m[0].length) / 2;
    const offsetY = (nextCanvas.height / size - m.length) / 2;
    m.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value) drawCell(nctx, offsetX + x, offsetY + y, next.type, size);
      });
    });
  }

  function update(time = 0) {
    if (!running || paused) return;
    const delta = time - lastTime;
    lastTime = time;
    dropCounter += delta;
    if (dropCounter > dropInterval) {
      softDrop();
    }
    draw();
    rafId = requestAnimationFrame(update);
  }

  function gameOver() {
    running = false;
    cancelAnimationFrame(rafId);
    overlayText.textContent = "GAME OVER";
    overlay.classList.remove("hidden");
  }

  function startGame() {
    grid = createGrid();
    score = 0;
    lines = 0;
    level = 1;
    dropCounter = 0;
    dropInterval = 1000;
    lastTime = performance.now();
    next = null;
    running = true;
    paused = false;
    overlay.classList.add("hidden");
    updateStats();
    spawn();
    cancelAnimationFrame(rafId);
    update(performance.now());
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
      update(performance.now());
    }
  }

  document.addEventListener("keydown", (e) => {
    if (!running) return;
    switch (e.key) {
      case "ArrowLeft":
        if (!paused) move(-1);
        break;
      case "ArrowRight":
        if (!paused) move(1);
        break;
      case "ArrowDown":
        if (!paused) softDrop();
        break;
      case "ArrowUp":
        if (!paused) playerRotate();
        break;
      case " ":
        e.preventDefault();
        if (!paused) hardDrop();
        break;
      case "p":
      case "P":
        togglePause();
        break;
      default:
        return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) {
      e.preventDefault();
      draw();
    }
  });

  startBtn.addEventListener("click", startGame);

  // initial render
  grid = createGrid();
  draw();
  overlayText.textContent = "PRESS START";
  overlay.classList.remove("hidden");
})();
