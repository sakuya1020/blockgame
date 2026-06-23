import Matter from 'matter-js';
import './styles.css';

const {
  Engine,
  Render,
  Runner,
  Bodies,
  Body,
  Composite,
  Events,
  Mouse,
  MouseConstraint,
  Vector,
  Vertices,
} = Matter;

const canvas = document.querySelector('#game');
const nextCanvas = document.querySelector('#next');
const scoreEl = document.querySelector('#score');
const timerEl = document.querySelector('#timer');
const bestEl = document.querySelector('#best');
const restartBtn = document.querySelector('#restart');
const pauseBtn = document.querySelector('#pause');
const resultPanel = document.querySelector('#resultPanel');
const resultScore = document.querySelector('#resultScore');
const resultTime = document.querySelector('#resultTime');
const resultTitle = document.querySelector('#resultTitle');
const resultEyebrow = document.querySelector('#resultEyebrow');
const restartFromResult = document.querySelector('#restartFromResult');
const dropGuide = document.querySelector('#dropGuide');

const width = 720;
const height = 900;
const wall = 34;
const floorY = height - 35;
const spawnY = 88;
const goalY = 172;
const shapeScale = 30;
const storageKey = 'stack-rush-best';

const palette = ['#ffbf3d', '#2fc3a3', '#f46575', '#57a4ff', '#b28dff', '#f4813f', '#4dd1e1'];

const shapeDefs = [
  { id: 'ball', label: 'Ball', color: palette[1] },
  { id: 'trapezoid', label: 'Trapezoid', color: palette[5] },
  { id: 'star', label: 'Star', color: palette[2] },
  { id: 'tetromino-t', label: 'T Block', color: palette[4], cells: [[-1, 0], [0, 0], [1, 0], [0, -1]] },
  { id: 'tetromino-l', label: 'L Block', color: palette[0], cells: [[-1, 0], [0, 0], [1, 0], [-1, -1]] },
  { id: 'tetromino-s', label: 'S Block', color: palette[3], cells: [[-1, 0], [0, 0], [0, -1], [1, -1]] },
  { id: 'diamond', label: 'Diamond', color: palette[6] },
];

let engine;
let render;
let runner;
let current;
let nextDef;
let score = 0;
let startTime = 0;
let elapsed = 0;
let paused = false;
let finished = false;
let goalTouchStarted = null;
let lastFrameTime = performance.now();
let dropX = width / 2;
let keys = new Set();

function randomDef() {
  return shapeDefs[Math.floor(Math.random() * shapeDefs.length)];
}

function buildStarPoints(cx, cy, outer, inner, points = 5) {
  const verts = [];
  for (let i = 0; i < points * 2; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / points;
    const radius = i % 2 === 0 ? outer : inner;
    verts.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return verts;
}

function bodyOptions(def) {
  return {
    restitution: 0.03,
    friction: 0.84,
    frictionStatic: 1.4,
    frictionAir: 0.012,
    density: 0.0015,
    render: {
      fillStyle: def.color,
      strokeStyle: '#10151f',
      lineWidth: 2,
    },
  };
}

function createBody(def, x, y, preview = false) {
  const options = bodyOptions(def);
  const size = preview ? shapeScale * 0.9 : shapeScale;

  if (def.id === 'ball') {
    return Bodies.circle(x, y, size * 1.38, options);
  }

  if (def.id === 'trapezoid') {
    const verts = [
      { x: x - size * 1.45, y: y + size * 0.95 },
      { x: x + size * 1.45, y: y + size * 0.95 },
      { x: x + size * 0.96, y: y - size * 0.95 },
      { x: x - size * 0.96, y: y - size * 0.95 },
    ];
    return Bodies.fromVertices(x, y, [verts], options, true);
  }

  if (def.id === 'star') {
    return Bodies.fromVertices(x, y, [buildStarPoints(x, y, size * 1.55, size * 0.72)], options, true);
  }

  if (def.id === 'diamond') {
    return Bodies.polygon(x, y, 4, size * 1.58, options);
  }

  const cellSize = size * 1.2;
  const parts = def.cells.map(([cx, cy]) => Bodies.rectangle(
    x + cx * cellSize,
    y + cy * cellSize,
    cellSize,
    cellSize,
    options,
  ));
  return Body.create({ parts, friction: options.friction, frictionStatic: options.frictionStatic, restitution: options.restitution });
}

function addStaticWorld() {
  const staticOptions = {
    isStatic: true,
    render: { fillStyle: '#243140', strokeStyle: '#344558', lineWidth: 1 },
  };
  Composite.add(engine.world, [
    Bodies.rectangle(width / 2, floorY + wall / 2, width, wall, staticOptions),
    Bodies.rectangle(-wall / 2, height / 2, wall, height, staticOptions),
    Bodies.rectangle(width + wall / 2, height / 2, wall, height, staticOptions),
  ]);
}

function spawnPreview() {
  const def = nextDef ?? randomDef();
  nextDef = randomDef();
  current = createBody(def, dropX, spawnY);
  current.isPreview = true;
  current.shapeId = def.id;
  current.label = def.label;
  Body.setStatic(current, true);
  Composite.add(engine.world, current);
  drawNext();
}

function dropCurrent() {
  if (!current || finished || paused) return;
  current.isPreview = false;
  Body.setStatic(current, false);
  Body.setVelocity(current, { x: 0, y: 1.4 });
  Body.setAngularVelocity(current, 0);
  score += 1;
  scoreEl.textContent = String(score);
  current = null;
  window.setTimeout(() => {
    if (!finished && !paused) spawnPreview();
  }, 450);
}

function movePreview(dx) {
  if (!current || !current.isPreview || paused || finished) return;
  const bounds = current.bounds;
  const minX = current.position.x - bounds.min.x + 18;
  const maxX = width - (bounds.max.x - current.position.x) - 18;
  const nextX = Math.max(minX, Math.min(maxX, current.position.x + dx));
  Body.setPosition(current, { x: nextX, y: spawnY });
  dropX = nextX;
  updateGuide();
}

function setPreviewX(x) {
  if (!current || !current.isPreview || paused || finished) return;
  const bounds = current.bounds;
  const minX = current.position.x - bounds.min.x + 18;
  const maxX = width - (bounds.max.x - current.position.x) - 18;
  const nextX = Math.max(minX, Math.min(maxX, x));
  Body.setPosition(current, { x: nextX, y: spawnY });
  dropX = nextX;
  updateGuide();
}

function rotatePreview(direction = 1) {
  if (!current || !current.isPreview || paused || finished) return;
  Body.rotate(current, direction * Math.PI / 10);
}

function updateGuide() {
  dropGuide.style.left = `${(dropX / width) * 100}%`;
}

function drawGoalLine() {
  const ctx = render.context;
  ctx.save();
  ctx.setLineDash([10, 10]);
  ctx.strokeStyle = '#ffdf70';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(26, goalY);
  ctx.lineTo(width - 26, goalY);
  ctx.stroke();
  ctx.restore();
}

function drawSoftShadows() {
  const ctx = render.context;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
  for (let y = goalY + 75; y < floorY; y += 92) {
    ctx.fillRect(34, y, width - 68, 1);
  }
  ctx.restore();
}

function drawNext() {
  const ctx = nextCanvas.getContext('2d');
  ctx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  ctx.save();
  ctx.translate(nextCanvas.width / 2, nextCanvas.height / 2 + 14);
  ctx.fillStyle = nextDef.color;
  ctx.strokeStyle = '#10151f';
  ctx.lineWidth = 3;

  if (nextDef.id === 'ball') {
    ctx.beginPath();
    ctx.arc(0, -6, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (nextDef.id === 'star') {
    const pts = buildStarPoints(0, -5, 42, 20);
    drawPath(ctx, pts);
  } else if (nextDef.id === 'trapezoid') {
    drawPath(ctx, [{ x: -44, y: 28 }, { x: 44, y: 28 }, { x: 31, y: -28 }, { x: -31, y: -28 }]);
  } else if (nextDef.id === 'diamond') {
    drawPath(ctx, [{ x: 0, y: -43 }, { x: 43, y: 0 }, { x: 0, y: 43 }, { x: -43, y: 0 }]);
  } else {
    const s = 30;
    nextDef.cells.forEach(([x, y]) => {
      ctx.fillRect(x * s - s / 2, y * s - s / 2, s, s);
      ctx.strokeRect(x * s - s / 2, y * s - s / 2, s, s);
    });
  }
  ctx.restore();
}

function drawPath(ctx, pts) {
  ctx.beginPath();
  pts.forEach((pt, index) => {
    if (index === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function highestSettledY() {
  const bodies = Composite.allBodies(engine.world).filter((body) => !body.isStatic && !body.isPreview);
  if (!bodies.length) return floorY;
  return Math.min(...bodies.map((body) => body.bounds.min.y));
}

function updateTimer(now) {
  if (finished || paused) return;
  elapsed = (now - startTime) / 1000;
  timerEl.textContent = elapsed.toFixed(1);
}

function checkGoal(now) {
  if (finished || paused) return;
  const top = highestSettledY();
  const touchingGoal = top <= goalY;
  if (touchingGoal && goalTouchStarted === null) {
    goalTouchStarted = now;
  }
  if (!touchingGoal) {
    goalTouchStarted = null;
  }
  if (goalTouchStarted !== null && now - goalTouchStarted > 850) {
    finishGame(true);
  }
}

function finishGame(won) {
  finished = true;
  resultPanel.classList.remove('hidden');
  resultEyebrow.textContent = won ? 'CLEAR' : 'FINISH';
  resultTitle.textContent = won ? 'Stack Complete' : 'Game Over';
  resultScore.textContent = String(score);
  resultTime.textContent = elapsed.toFixed(1);

  const best = readBest();
  if (!best || score < best.score || (score === best.score && elapsed < best.time)) {
    localStorage.setItem(storageKey, JSON.stringify({ score, time: elapsed }));
  }
  renderBest();
}

function readBest() {
  try {
    return JSON.parse(localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}

function renderBest() {
  const best = readBest();
  bestEl.textContent = best ? `${best.score}` : '--';
}

function resetGame() {
  if (runner) Runner.stop(runner);
  if (render) {
    Render.stop(render);
  }

  engine = Engine.create({ gravity: { x: 0, y: 1.05 } });
  render = Render.create({
    canvas,
    engine,
    options: {
      width,
      height,
      wireframes: false,
      background: '#17212d',
      pixelRatio: Math.min(window.devicePixelRatio, 2),
    },
  });
  runner = Runner.create();
  addStaticWorld();

  const mouse = Mouse.create(render.canvas);
  const mouseConstraint = MouseConstraint.create(engine, {
    mouse,
    constraint: { stiffness: 0.16, render: { visible: false } },
  });
  Composite.add(engine.world, mouseConstraint);
  render.mouse = mouse;

  score = 0;
  elapsed = 0;
  paused = false;
  finished = false;
  current = null;
  nextDef = randomDef();
  goalTouchStarted = null;
  dropX = width / 2;
  startTime = performance.now();
  lastFrameTime = startTime;
  scoreEl.textContent = '0';
  timerEl.textContent = '0.0';
  pauseBtn.textContent = 'Pause';
  resultPanel.classList.add('hidden');
  renderBest();
  updateGuide();

  Events.on(render, 'afterRender', () => {
    drawSoftShadows();
    drawGoalLine();
  });

  Events.on(engine, 'beforeUpdate', () => {
    if (keys.has('KeyA') || keys.has('ArrowLeft')) movePreview(-7);
    if (keys.has('KeyD') || keys.has('ArrowRight')) movePreview(7);
  });

  Events.on(engine, 'afterUpdate', () => {
    const now = performance.now();
    updateTimer(now);
    checkGoal(now);
    lastFrameTime = now;
  });

  Render.run(render);
  Runner.run(runner, engine);
  spawnPreview();
}

function togglePause() {
  if (finished) return;
  paused = !paused;
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  if (paused) {
    Runner.stop(runner);
  } else {
    const pauseOffset = performance.now() - lastFrameTime;
    startTime += pauseOffset;
    Runner.run(runner, engine);
  }
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    event.preventDefault();
    dropCurrent();
  }
  if (event.code === 'KeyW' || event.code === 'ArrowUp') {
    event.preventDefault();
    rotatePreview(event.shiftKey ? -1 : 1);
  }
  if (event.code === 'KeyP') togglePause();
  keys.add(event.code);
});

window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
});

canvas.addEventListener('pointermove', (event) => {
  const rect = canvas.getBoundingClientRect();
  setPreviewX(((event.clientX - rect.left) / rect.width) * width);
});

canvas.addEventListener('pointerdown', () => {
  dropCurrent();
});

restartBtn.addEventListener('click', resetGame);
restartFromResult.addEventListener('click', resetGame);
pauseBtn.addEventListener('click', togglePause);

resetGame();
