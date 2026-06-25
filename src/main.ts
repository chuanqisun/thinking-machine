import * as THREE from "three";
import { Flap } from "./flap-unit";
import { resumeAudio } from "./sound";
import "./style.css";
import { type Point2D, calibrationState, initUI, scheduleLightmap, updateHandlesUI } from "./ui";

/* ---------- Scene ---------- */
const scene = new THREE.Scene();
scene.background = null;
const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 1000);
camera.position.set(0, 0, 100);
camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
renderer.domElement.style.transformOrigin = "0 0";

const N = 12,
  FLAP_W = 1.3,
  SPEED = 8;
const cellH = FLAP_W * (100 / 70),
  gap = 0.14,
  stepX = FLAP_W + gap,
  stepY = cellH + gap;
const offX = ((N - 1) * stepX) / 2,
  offY = ((N - 1) * stepY) / 2;

const boardGroup = new THREE.Group();
boardGroup.visible = false; // hidden until calibration done
scene.add(boardGroup);

const halfX = offX + (FLAP_W * 1.08) / 2,
  halfY = offY + (cellH * 1.06) / 2;

const BEZEL = FLAP_W;
const outX = halfX + BEZEL,
  outY = halfY + BEZEL;
const GAP_COLOR = 0x080808;
const BEZEL_COLOR = 0x383838;

const gapPlate = new THREE.Mesh(new THREE.PlaneGeometry(halfX * 2, halfY * 2), new THREE.MeshBasicMaterial({ color: GAP_COLOR }));
gapPlate.position.z = -0.19;
boardGroup.add(gapPlate);

const bezelMaterial = new THREE.MeshBasicMaterial({ color: BEZEL_COLOR, transparent: true, opacity: 1.0 });
const bezelPlate = new THREE.Mesh(new THREE.PlaneGeometry(outX * 2, outY * 2), bezelMaterial);
bezelPlate.position.z = -0.2;
boardGroup.add(bezelPlate);

const flaps: Flap[] = [],
  raycastTargets: THREE.Object3D[] = [];
for (let r = 0; r < N; r++) {
  for (let c = 0; c < N; c++) {
    const f = new Flap(FLAP_W, SPEED);
    f.row = r;
    f.col = c;
    f.rippleActive = false;
    f.nextAdvance = 0;
    f.group.position.set(c * stepX - offX, offY - r * stepY, 0);
    boardGroup.add(f.group);
    flaps.push(f);
    f.group.traverse((o) => {
      if (o.userData.flap) raycastTargets.push(o);
    });
  }
}

const BOARD_CORNERS = [
  new THREE.Vector3(-outX, outY, 0), // TL
  new THREE.Vector3(outX, outY, 0), // TR
  new THREE.Vector3(outX, -outY, 0), // BR
  new THREE.Vector3(-outX, -outY, 0), // BL
];

/* ---------- Exact 4-point Homography Projection Mapping ---------- */
function solveHomography(src: Point2D[], dst: Point2D[]): number[] {
  const A: number[][] = [],
    B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const sx = src[i].x,
      sy = src[i].y,
      u = dst[i].x,
      v = dst[i].y;
    A.push([sx, sy, 1, 0, 0, 0, -u * sx, -u * sy]);
    B.push(u);
    A.push([0, 0, 0, sx, sy, 1, -v * sx, -v * sy]);
    B.push(v);
  }
  for (let i = 0; i < 8; i++) {
    let p = i;
    for (let r = i + 1; r < 8; r++) {
      if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    }
    [A[i], A[p]] = [A[p], A[i]];
    [B[i], B[p]] = [B[p], B[i]];
    const piv = A[i][i];
    for (let c = i; c < 8; c++) A[i][c] /= piv;
    B[i] /= piv;
    for (let r = 0; r < 8; r++) {
      if (r === i) continue;
      const fct = A[r][i];
      if (!fct) continue;
      for (let c = i; c < 8; c++) A[r][c] -= fct * A[i][c];
      B[r] -= fct * B[i];
    }
  }
  return B;
}

function applyHomography(h: number[], x: number, y: number): Point2D {
  const w = h[6] * x + h[7] * y + 1;
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

function projectCorner(v: THREE.Vector3): Point2D {
  const p = v.clone().project(camera);
  return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (1 - (p.y * 0.5 + 0.5)) * window.innerHeight };
}

let invHomography: number[] | null = null;

function applyCalibration(): void {
  if (calibrationState.points.length !== 4) {
    boardGroup.visible = false;
    renderer.domElement.style.transform = "";
    invHomography = null;
    scheduleLightmap();
    return;
  }
  boardGroup.visible = true;
  camera.updateMatrixWorld(true);
  const src = BOARD_CORNERS.map(projectCorner);
  const h = solveHomography(src, calibrationState.points);
  invHomography = solveHomography(calibrationState.points, src);
  const [a, b, c, d, e, f, g, hh] = h;
  renderer.domElement.style.transform = `matrix3d(${a},${d},0,${g},${b},${e},0,${hh},0,0,1,0,${c},${f},0,1)`;
  scheduleLightmap();
}

/* ---------- Start board ---------- */
function startBoard(): void {
  resumeAudio();
  const overlay = document.getElementById("overlay") as HTMLDivElement;
  if (overlay) {
    overlay.style.opacity = "0";
    overlay.style.pointerEvents = "none";
    setTimeout(() => (overlay.style.display = "none"), 400);
  }

  const word = "HELLO";
  const startRow = Math.floor((N - 1) / 2);
  const startCol = Math.floor((N - word.length) / 2);

  setTimeout(() => {
    flaps.forEach((f, i) => {
      const r = Math.floor(i / N);
      const c = i % N;
      let targetChar = " ";
      if (r === startRow && c >= startCol && c < startCol + word.length) {
        targetChar = word.charAt(c - startCol);
      }
      setTimeout(() => f.go(targetChar), (r + c) * 80);
    });
  }, 100);
}

/* ---------- Read/Write Display Abstraction ---------- */
function getDisplayString(): string {
  const lines: string[] = [];
  for (let r = 0; r < N; r++) {
    let line = "";
    for (let c = 0; c < N; c++) {
      const f = flaps[r * N + c];
      if (f.queueTarget === "?") {
        line += "?";
      } else {
        line += f.current;
      }
    }
    lines.push(line);
  }
  return lines.join("\n");
}

function centerTextInGrid(text: string, size: number): string {
  const lines = text.split("\n");

  // Trim leading empty/blank lines
  let firstLine = 0;
  while (firstLine < lines.length && lines[firstLine].trim() === "") {
    firstLine++;
  }

  // Trim trailing empty/blank lines
  let lastLine = lines.length - 1;
  while (lastLine >= firstLine && lines[lastLine].trim() === "") {
    lastLine--;
  }

  if (firstLine > lastLine) {
    return Array(size).fill(" ".repeat(size)).join("\n");
  }

  const contentLines = lines.slice(firstLine, lastLine + 1);
  const numLines = Math.min(contentLines.length, size);
  const verticalSlice = contentLines.slice(0, numLines);

  const centeredLines = verticalSlice.map((line) => {
    const trimmed = line.trim();
    if (trimmed.length >= size) {
      return trimmed.slice(0, size);
    }
    const leftPad = Math.floor((size - trimmed.length) / 2);
    const rightPad = size - trimmed.length - leftPad;
    return " ".repeat(leftPad) + trimmed + " ".repeat(rightPad);
  });

  const topPad = Math.floor((size - numLines) / 2);
  const bottomPad = size - numLines - topPad;

  const resultLines: string[] = [];
  for (let i = 0; i < topPad; i++) {
    resultLines.push(" ".repeat(size));
  }
  for (const line of centeredLines) {
    resultLines.push(line);
  }
  for (let i = 0; i < bottomPad; i++) {
    resultLines.push(" ".repeat(size));
  }

  return resultLines.join("\n");
}

function setDisplayString(text: string): void {
  rippleTimeouts.forEach(clearTimeout);
  rippleTimeouts = [];
  const centeredText = centerTextInGrid(text, N);
  const lines = centeredText.split("\n");
  for (let r = 0; r < N; r++) {
    const line = lines[r] || "";
    for (let c = 0; c < N; c++) {
      const char = line.charAt(c) || " ";
      const f = flaps[r * N + c];
      f.go(char);
    }
  }
}

let rippleTimeouts: any[] = [];

function enterIndeterminateState(): void {
  rippleTimeouts.forEach(clearTimeout);
  rippleTimeouts = [];

  const nonEmptyFlaps = flaps.filter((f) => {
    const cur = f.current;
    const tgt = f.queueTarget;
    return (cur !== " " && cur !== "?") || (tgt !== null && tgt !== " " && tgt !== "?");
  });

  const propagationDelay = 120; // ms per grid unit of distance

  if (nonEmptyFlaps.length > 0) {
    for (const f of flaps) {
      let minDist = Infinity;
      for (const orig of nonEmptyFlaps) {
        const d = Math.hypot(f.row - orig.row, f.col - orig.col);
        if (d < minDist) {
          minDist = d;
        }
      }
      const delay = minDist * propagationDelay;
      const tid = setTimeout(() => {
        if (f.queueTarget !== "?") {
          f.go("?");
        }
      }, delay);
      rippleTimeouts.push(tid);
    }
  } else {
    const centerRow = (N - 1) / 2;
    const centerCol = (N - 1) / 2;
    for (const f of flaps) {
      const d = Math.hypot(f.row - centerRow, f.col - centerCol);
      const delay = d * propagationDelay;
      const tid = setTimeout(() => {
        if (f.queueTarget !== "?") {
          f.go("?");
        }
      }, delay);
      rippleTimeouts.push(tid);
    }
  }
}

/* ---------- Initialize UI ---------- */
initUI({
  onCalibrationChanged: () => {
    applyCalibration();
  },
  onStartBoard: () => {
    startBoard();
  },
  getDisplayString,
  setDisplayString,
  enterIndeterminateState,
  onBezelChanged: (color: string, opacity: number) => {
    bezelMaterial.color.set(color);
    bezelMaterial.opacity = opacity;
  },
});

/* ---------- Resize ---------- */
function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
  const aspect = window.innerWidth / window.innerHeight,
    vh = 40,
    vw = vh * aspect;
  camera.left = -vw / 2;
  camera.right = vw / 2;
  camera.top = vh / 2;
  camera.bottom = -vh / 2;
  camera.updateProjectionMatrix();
  applyCalibration();
  updateHandlesUI();
}
window.addEventListener("resize", resize);
// Initial resize trigger to calibrate and draw handles properly
setTimeout(resize, 150);

/* ---------- Pointer / raycasting ---------- */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let isPointerDown = false;

function getIntersectedFlap(cx: number, cy: number): Flap | null {
  let x = cx,
    y = cy;
  if (invHomography) {
    const p = applyHomography(invHomography, cx, cy);
    x = p.x;
    y = p.y;
  }
  pointer.x = (x / window.innerWidth) * 2 - 1;
  pointer.y = -(y / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(raycastTargets, false);
  return hits.length ? (hits[0].object.userData.flap as Flap) : null;
}

/* ---------- Ripple-based hold interaction ---------- */
interface Ripple {
  cr: number;
  cc: number;
  outer: number;
  inner: number;
  maxRadius: number;
}

interface TouchSession {
  cr: number;
  cc: number;
  startTime: number;
  lastEmitTime: number;
  force: number;
}

let ripples: Ripple[] = [];
let activeTouch: TouchSession | null = null;

const EXPAND_SPEED = 11;
const RING_WIDTH = 1.5;
const EMIT_INTERVAL = 150; // ms between ring emissions
const MIN_FORCE = 3.0;
const MAX_FORCE = 20.0;
const FORCE_GROWTH_RATE = 15.0; // force increase per second
const HOLD_PERIOD = Math.max(120, (1000 / SPEED) * 1.15);

function emitRing(row: number, col: number, maxRadius: number): void {
  ripples.push({
    cr: row,
    cc: col,
    outer: 0,
    inner: -RING_WIDTH,
    maxRadius,
  });
}

function startTouch(flap: Flap): void {
  const now = performance.now();
  activeTouch = {
    cr: flap.row,
    cc: flap.col,
    startTime: now,
    lastEmitTime: now,
    force: MIN_FORCE,
  };
  emitRing(flap.row, flap.col, MIN_FORCE);
  flap.rippleActive = true;
  flap.advance();
  flap.nextAdvance = now + HOLD_PERIOD;
}

function moveTouch(flap: Flap | null): void {
  if (activeTouch && flap) {
    activeTouch.cr = flap.row;
    activeTouch.cc = flap.col;
  }
}

function releaseTouch(): void {
  activeTouch = null;
}

function updateRipples(now: number, dt: number): void {
  // Update current touch and emit new rings periodically
  if (activeTouch) {
    activeTouch.force = Math.min(MAX_FORCE, activeTouch.force + FORCE_GROWTH_RATE * dt);
    const elapsedSinceEmit = now - activeTouch.lastEmitTime;
    if (elapsedSinceEmit >= EMIT_INTERVAL) {
      emitRing(activeTouch.cr, activeTouch.cc, activeTouch.force);
      activeTouch.lastEmitTime = now;
    }
  }

  // Update existing ripples
  for (const r of ripples) {
    if (r.outer < r.maxRadius) {
      r.outer += EXPAND_SPEED * dt;
      if (r.outer > r.maxRadius) {
        r.outer = r.maxRadius;
      }
    }
    if (r.outer < r.maxRadius) {
      r.inner = r.outer - RING_WIDTH;
    } else {
      r.inner += EXPAND_SPEED * dt;
    }
  }
  ripples = ripples.filter((r) => r.inner < r.maxRadius);

  // Apply activation to flaps
  for (const f of flaps) {
    let active = false;
    for (const r of ripples) {
      const d = Math.hypot(f.row - r.cr, f.col - r.cc);
      if (d <= r.outer && d > r.inner) {
        active = true;
        break;
      }
    }
    if (active) {
      if (!f.rippleActive) {
        f.rippleActive = true;
        f.nextAdvance = now;
      }
      if (now >= f.nextAdvance) {
        f.advance();
        f.nextAdvance = now + HOLD_PERIOD;
      }
    } else {
      f.rippleActive = false;
    }
  }
}

window.addEventListener("pointerdown", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest("#menu-container") || target.closest("#start-btn") || target.closest("#calibration-handles")) return;
  resumeAudio();
  if (calibrationState.step >= 0 && calibrationState.step < 4) {
    calibrationState.points[calibrationState.step++] = { x: e.clientX, y: e.clientY };
    updateHandlesUI();
    const msgs = ["Click Top-Right Corner", "Click Bottom-Right Corner", "Click Bottom-Left Corner"];
    const calibMsg = document.getElementById("calibration-msg") as HTMLDivElement;
    const doneBtn = document.getElementById("btn-calibrate-done") as HTMLButtonElement;
    if (calibrationState.step < 4) {
      if (calibMsg) calibMsg.textContent = msgs[calibrationState.step - 1];
    } else {
      if (calibMsg) calibMsg.textContent = "Calibration complete! Drag corners to adjust";
      if (doneBtn) doneBtn.style.display = "block";
      applyCalibration();
      localStorage.setItem("splitFlapCalibrationPoints", JSON.stringify(calibrationState.points));
    }
    return;
  }
  if (calibrationState.adjustMode) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if (!boardGroup.visible) return;
  isPointerDown = true;
  const flap = getIntersectedFlap(e.clientX, e.clientY);
  if (flap) startTouch(flap);
});

window.addEventListener("pointermove", (e) => {
  const target = e.target as HTMLElement;
  if (
    target.closest("#menu-container") ||
    target.closest("#calibration-handles") ||
    calibrationState.adjustMode ||
    (calibrationState.step >= 0 && calibrationState.step < 4) ||
    !boardGroup.visible
  ) {
    document.body.style.cursor = "default";
    return;
  }
  const flap = getIntersectedFlap(e.clientX, e.clientY);
  document.body.style.cursor = flap ? "pointer" : "default";
  if (isPointerDown && activeTouch) moveTouch(flap);
});

window.addEventListener("pointerup", () => {
  isPointerDown = false;
  releaseTouch();
});
window.addEventListener("pointercancel", () => {
  isPointerDown = false;
  releaseTouch();
});
window.addEventListener("contextmenu", (e) => e.preventDefault());

/* ---------- Render loop ---------- */
let lastTime = performance.now();
function animate(): void {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  updateRipples(now, dt);
  for (const f of flaps) f.update(now);
  renderer.render(scene, camera);
}
animate();
