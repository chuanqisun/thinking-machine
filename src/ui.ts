import baseImgUrl from "./assets/base.webp";
import { getResponse } from "./chat";

export interface Point2D {
  x: number;
  y: number;
}

export interface BlendParam {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  def: number;
  _input?: HTMLInputElement;
  _val?: HTMLSpanElement;
}

export const blendParams: Record<string, BlendParam> = {
  lightStrength: { label: "Light Strength", min: 0, max: 1, step: 0.01, value: 0.63, def: 0.63 },
  exposure: { label: "Exposure", min: -1, max: 1, step: 0.01, value: 0.4, def: 0.4 },
  contrast: { label: "Contrast", min: 0.3, max: 2.5, step: 0.01, value: 1.87, def: 1.87 },
  black: { label: "Black Level", min: 0, max: 0.6, step: 0.01, value: 0, def: 0 },
  white: { label: "White Level", min: 0.4, max: 1.5, step: 0.01, value: 0.55, def: 0.55 },
  gamma: { label: "Gamma", min: 0.2, max: 3, step: 0.01, value: 0.86, def: 0.86 },
  tint: { label: "Color Tint", min: 0, max: 1, step: 0.01, value: 0, def: 0 },
  saturation: { label: "Tint Saturation", min: 0, max: 2, step: 0.01, value: 0, def: 0 },
  softness: { label: "Falloff Softness", min: 0, max: 1, step: 0.01, value: 0.38, def: 0.38 },
};

export const calibrationState = {
  points: [
    { x: 767.19921875, y: 338.19921875 },
    { x: 1122.28515625, y: 294.9140625 },
    { x: 1117.43359375, y: 652.84375 },
    { x: 803.59765625, y: 730.3359375 },
  ] as Point2D[],
  step: 4,
  handlesShown: false,
  adjustMode: false,
};

let onCalibrationChangedCallback: (() => void) | null = null;
let onStartBoardCallback: (() => void) | null = null;
let getDisplayStringCallback: (() => string) | null = null;
let setDisplayStringCallback: ((text: string) => void) | null = null;
let enterIndeterminateStateCallback: (() => void) | null = null;

export function initUI(options: {
  onCalibrationChanged: () => void;
  onStartBoard: () => void;
  getDisplayString: () => string;
  setDisplayString: (text: string) => void;
  enterIndeterminateState?: () => void;
}): void {
  onCalibrationChangedCallback = options.onCalibrationChanged;
  onStartBoardCallback = options.onStartBoard;
  getDisplayStringCallback = options.getDisplayString;
  setDisplayStringCallback = options.setDisplayString;
  enterIndeterminateStateCallback = options.enterIndeterminateState || null;

  loadBlend();
  buildBlendUI();
  loadCalibration();
  loadApiKey();
  setupEventListeners();
  updateHandlesUI();
  scheduleLightmap();
}

function loadBlend(): void {
  try {
    const s = JSON.parse(localStorage.getItem("splitFlapBlendParams") || "{}");
    for (const k in s) {
      if (blendParams[k]) blendParams[k].value = s[k];
    }
  } catch (e) {}
}

function saveBlend(): void {
  const o: Record<string, number> = {};
  for (const k in blendParams) o[k] = blendParams[k].value;
  localStorage.setItem("splitFlapBlendParams", JSON.stringify(o));
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

let bgData: Uint8ClampedArray | null = null;
let bgImgW = 0;
let bgImgH = 0;
let dx = 0;
let dy = 0;
let dw = 0;
let dh = 0;

const bgImage = new Image();
bgImage.crossOrigin = "anonymous";
bgImage.src = baseImgUrl;
bgImage.onload = () => {
  try {
    bgImgW = bgImage.naturalWidth;
    bgImgH = bgImage.naturalHeight;
    const oc = document.createElement("canvas");
    oc.width = bgImgW;
    oc.height = bgImgH;
    const octx = oc.getContext("2d", { willReadFrequently: true });
    if (!octx) throw new Error("Could not get context");
    octx.drawImage(bgImage, 0, 0);
    bgData = octx.getImageData(0, 0, bgImgW, bgImgH).data;
  } catch (e) {
    console.warn("Could not read background pixels (CORS?):", e);
    bgData = null;
  }
  scheduleLightmap();
};

function pointInQuad(x: number, y: number, q: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = q[i].x,
      yi = q[i].y,
      xj = q[j].x,
      yj = q[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function sampleRGB(sx: number, sy: number): [number, number, number] | null {
  if (!bgData) return null;
  const ix = ((sx - dx) / dw) * bgImgW;
  const iy = ((sy - dy) / dh) * bgImgH;
  const px = Math.floor(ix),
    py = Math.floor(iy);
  if (px < 0 || py < 0 || px >= bgImgW || py >= bgImgH) return null;
  const i = (py * bgImgW + px) * 4;
  return [bgData[i], bgData[i + 1], bgData[i + 2]];
}

const lum = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

export function buildLightmap(): void {
  const lightCanvas = document.getElementById("lightmap") as HTMLCanvasElement;
  if (!lightCanvas) return;
  const lightCtx = lightCanvas.getContext("2d") as CanvasRenderingContext2D;
  if (!lightCtx) return;

  if (!bgData || calibrationState.points.length !== 4 || (calibrationState.step >= 0 && calibrationState.step < 4)) {
    lightCanvas.style.display = "none";
    return;
  }
  const W = window.innerWidth,
    H = window.innerHeight;
  lightCanvas.width = W;
  lightCanvas.height = H;

  const imgAspect = bgImgW / bgImgH,
    winAspect = W / H;
  if (imgAspect > winAspect) {
    dw = W;
    dh = W / imgAspect;
  } else {
    dh = H;
    dw = H * imgAspect;
  }
  dx = (W - dw) / 2;
  dy = (H - dh) / 2;

  const q = calibrationState.points;
  const minX = Math.max(0, Math.floor(Math.min(q[0].x, q[1].x, q[2].x, q[3].x)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(q[0].x, q[1].x, q[2].x, q[3].x)));
  const minY = Math.max(0, Math.floor(Math.min(q[0].y, q[1].y, q[2].y, q[3].y)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(q[0].y, q[1].y, q[2].y, q[3].y)));

  let maxB = 1e-6;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!pointInQuad(x + 0.5, y + 0.5, q)) continue;
      const rgb = sampleRGB(x + 0.5, y + 0.5);
      if (!rgb) continue;
      const b = lum(rgb[0], rgb[1], rgb[2]);
      if (b > maxB) maxB = b;
    }
  }

  const P: Record<string, number> = {};
  for (const k in blendParams) P[k] = blendParams[k].value;
  const expGain = Math.pow(2, P.exposure);
  const wMinusB = Math.max(0.001, P.white - P.black);

  const img = lightCtx.createImageData(W, H);
  const d = img.data;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!pointInQuad(x + 0.5, y + 0.5, q)) continue;
      const rgb = sampleRGB(x + 0.5, y + 0.5);
      if (!rgb) continue;
      const l = lum(rgb[0], rgb[1], rgb[2]);

      let n = l / maxB;
      n = (n - P.black) / wMinusB;
      n = clamp01(n);
      if (P.gamma !== 1) n = Math.pow(n, P.gamma);
      if (P.softness > 0) {
        const ss = n * n * (3 - 2 * n);
        n = n + (ss - n) * P.softness;
      }
      n = (n - 0.5) * P.contrast + 0.5;
      n *= expGain;
      n = clamp01(n);
      const f = 1 - P.lightStrength * (1 - n);

      let tr = 1,
        tg = 1,
        tb = 1;
      if (P.tint > 0) {
        const ll = Math.max(1e-3, l);
        let cr = rgb[0] / ll,
          cg = rgb[1] / ll,
          cb = rgb[2] / ll;
        const cm = (cr + cg + cb) / 3;
        cr = cm + (cr - cm) * P.saturation;
        cg = cm + (cg - cm) * P.saturation;
        cb = cm + (cb - cm) * P.saturation;
        tr = 1 + (cr - 1) * P.tint;
        tg = 1 + (cg - 1) * P.tint;
        tb = 1 + (cb - 1) * P.tint;
      }

      const idx = (y * W + x) * 4;
      d[idx] = Math.round(clamp01(f * tr) * 255);
      d[idx + 1] = Math.round(clamp01(f * tg) * 255);
      d[idx + 2] = Math.round(clamp01(f * tb) * 255);
      d[idx + 3] = 255;
    }
  }
  lightCtx.putImageData(img, 0, 0);
  lightCanvas.style.display = "block";
}

let lmTimer: any = null;
export function scheduleLightmap(): void {
  if (lmTimer) clearTimeout(lmTimer);
  lmTimer = setTimeout(buildLightmap, 50);
}

function buildBlendUI(): void {
  const blendContainer = document.getElementById("blend-controls") as HTMLDivElement;
  if (!blendContainer) return;
  blendContainer.innerHTML = "";
  for (const key in blendParams) {
    const p = blendParams[key];
    const row = document.createElement("div");
    row.className = "param-row";
    const label = document.createElement("label");
    label.textContent = p.label;
    const sr = document.createElement("div");
    sr.className = "slider-row";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(p.min);
    input.max = String(p.max);
    input.step = String(p.step);
    input.value = String(p.value);
    const val = document.createElement("span");
    val.textContent = (+p.value).toFixed(2);
    input.addEventListener("input", () => {
      p.value = +input.value;
      val.textContent = p.value.toFixed(2);
      saveBlend();
      scheduleLightmap();
    });
    p._input = input;
    p._val = val;
    sr.appendChild(input);
    sr.appendChild(val);
    row.appendChild(label);
    row.appendChild(sr);
    blendContainer.appendChild(row);
  }
}

function syncBlendUI(): void {
  for (const k in blendParams) {
    const p = blendParams[k];
    if (p._input) {
      p._input.value = String(p.value);
    }
    if (p._val) {
      p._val.textContent = (+p.value).toFixed(2);
    }
  }
}

function loadCalibration(): void {
  try {
    const saved = localStorage.getItem("splitFlapCalibrationPoints");
    if (saved) {
      calibrationState.points = JSON.parse(saved);
      calibrationState.step = 4;
    }
  } catch (e) {
    console.warn("Calibration load failed:", e);
  }
}

function loadApiKey(): void {
  const apiKeyInput = document.getElementById("openai-api-key") as HTMLInputElement;
  if (apiKeyInput) {
    apiKeyInput.value = localStorage.getItem("openaiApiKey") || "";
  }
}

export function getOpenAiApiKey(): string {
  return localStorage.getItem("openaiApiKey") || "";
}

export function updateHandlesUI(): void {
  const handlesContainer = document.getElementById("calibration-handles") as HTMLDivElement;
  const calibSvg = document.getElementById("calibration-svg") as unknown as SVGElement;
  const calibPoly = document.getElementById("calibration-poly") as unknown as SVGPolygonElement;
  if (!handlesContainer || !calibSvg || !calibPoly) return;

  const show = calibrationState.handlesShown && calibrationState.points.length > 0;
  if (!show) {
    handlesContainer.style.display = "none";
    calibSvg.style.display = "none";
    return;
  }
  handlesContainer.style.display = "block";
  calibSvg.style.display = calibrationState.adjustMode ? "none" : "block";
  const poly: string[] = [];
  for (let i = 0; i < 4; i++) {
    const handle = document.getElementById(`handle-${i}`) as HTMLDivElement;
    if (!handle) continue;
    if (i < calibrationState.points.length) {
      handle.style.left = calibrationState.points[i].x + "px";
      handle.style.top = calibrationState.points[i].y + "px";
      handle.style.display = "flex";
      poly.push(`${calibrationState.points[i].x},${calibrationState.points[i].y}`);
    } else {
      handle.style.display = "none";
    }
  }
  calibPoly.setAttribute("points", poly.join(" "));
}

export function setAdjustMode(on: boolean): void {
  const adjustBtn = document.getElementById("btn-adjust-corners") as HTMLButtonElement;
  calibrationState.adjustMode = on;
  calibrationState.handlesShown = on;
  if (adjustBtn) {
    if (on) {
      adjustBtn.textContent = "Finish Adjusting";
      adjustBtn.style.background = "#553300";
      adjustBtn.style.borderColor = "#aa7722";
      adjustBtn.style.color = "#ffcc88";
    } else {
      adjustBtn.textContent = "Adjust Corners";
      adjustBtn.style.background = "";
      adjustBtn.style.borderColor = "";
      adjustBtn.style.color = "";
    }
  }
  updateHandlesUI();
}

function setupEventListeners(): void {
  const doneBtn = document.getElementById("btn-calibrate-done") as HTMLButtonElement;
  const startBtn = document.getElementById("btn-calibrate-start") as HTMLButtonElement;
  const adjustBtn = document.getElementById("btn-adjust-corners") as HTMLButtonElement;
  const calibBanner = document.getElementById("calibration-banner") as HTMLDivElement;
  const calibMsg = document.getElementById("calibration-msg") as HTMLDivElement;
  const btnCalibrateReset = document.getElementById("btn-calibrate-reset") as HTMLButtonElement;
  const btnBlendReset = document.getElementById("btn-blend-reset") as HTMLButtonElement;
  const menuContainer = document.getElementById("menu-container") as HTMLDivElement;
  const collapseIcon = document.getElementById("collapse-icon") as HTMLSpanElement;
  const menuHeader = document.getElementById("menu-header") as HTMLDivElement;
  const lightCanvas = document.getElementById("lightmap") as HTMLCanvasElement;

  if (btnBlendReset) {
    btnBlendReset.addEventListener("click", () => {
      for (const k in blendParams) blendParams[k].value = blendParams[k].def;
      syncBlendUI();
      saveBlend();
      scheduleLightmap();
    });
  }

  let activeDrag: number | null = null;
  document.querySelectorAll<HTMLDivElement>(".handle").forEach((handle) => {
    const idx = +(handle.dataset.idx || 0);
    handle.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      activeDrag = idx;
      handle.classList.add("active");
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (activeDrag === null) return;
      e.stopPropagation();
      calibrationState.points[idx] = { x: e.clientX, y: e.clientY };
      updateHandlesUI();
      if (onCalibrationChangedCallback) onCalibrationChangedCallback();
    });
    const stop = (e: PointerEvent) => {
      if (activeDrag === null) return;
      e.stopPropagation();
      handle.releasePointerCapture(e.pointerId);
      handle.classList.remove("active");
      activeDrag = null;
      localStorage.setItem("splitFlapCalibrationPoints", JSON.stringify(calibrationState.points));
      buildLightmap();
    };
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  });

  if (startBtn) {
    startBtn.addEventListener("click", () => {
      setAdjustMode(false);
      calibrationState.points = [];
      calibrationState.step = 0;
      calibrationState.handlesShown = true;
      if (onCalibrationChangedCallback) onCalibrationChangedCallback();
      updateHandlesUI();
      if (calibBanner) calibBanner.style.display = "block";
      if (calibMsg) calibMsg.textContent = "Click Top-Left Corner";
      if (doneBtn) doneBtn.style.display = "none";
      startBtn.textContent = "Restart Calibration";
      if (lightCanvas) lightCanvas.style.display = "none";
    });
  }

  if (adjustBtn) {
    adjustBtn.addEventListener("click", () => {
      if (calibrationState.points.length !== 4) return;
      setAdjustMode(!calibrationState.adjustMode);
    });
  }

  if (doneBtn) {
    doneBtn.addEventListener("click", () => {
      calibrationState.step = 4;
      calibrationState.handlesShown = false;
      if (calibBanner) calibBanner.style.display = "none";
      doneBtn.style.display = "none";
      updateHandlesUI();
      buildLightmap();
    });
  }

  if (btnCalibrateReset) {
    btnCalibrateReset.addEventListener("click", () => {
      setAdjustMode(false);
      calibrationState.points = [];
      calibrationState.step = -1;
      calibrationState.handlesShown = false;
      if (calibBanner) calibBanner.style.display = "none";
      if (doneBtn) doneBtn.style.display = "none";
      localStorage.removeItem("splitFlapCalibrationPoints");
      if (onCalibrationChangedCallback) onCalibrationChangedCallback();
      updateHandlesUI();
      if (lightCanvas) lightCanvas.style.display = "none";
    });
  }

  if (menuHeader && menuContainer && collapseIcon) {
    menuHeader.addEventListener("click", () => {
      menuContainer.classList.toggle("collapsed");
      collapseIcon.textContent = menuContainer.classList.contains("collapsed") ? "[+]" : "[-]";
    });
  }

  const importFileInput = document.getElementById("import-file") as HTMLInputElement;
  const btnExport = document.getElementById("btn-export") as HTMLButtonElement;
  const btnImport = document.getElementById("btn-import") as HTMLButtonElement;

  if (btnExport) {
    btnExport.addEventListener("click", exportSettings);
  }
  if (btnImport && importFileInput) {
    btnImport.addEventListener("click", () => importFileInput.click());
  }

  const apiKeyInput = document.getElementById("openai-api-key") as HTMLInputElement;
  if (apiKeyInput) {
    apiKeyInput.addEventListener("input", () => {
      localStorage.setItem("openaiApiKey", apiKeyInput.value);
    });
  }
  if (importFileInput) {
    importFileInput.addEventListener("change", (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files && target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          importSettings(JSON.parse(reader.result as string));
        } catch (err: any) {
          alert("Invalid JSON file: " + err.message);
        }
      };
      reader.readAsText(file);
      target.value = "";
    });
  }

  const startBtnOverlay = document.getElementById("start-btn") as HTMLButtonElement;
  if (startBtnOverlay) {
    startBtnOverlay.addEventListener("click", () => {
      if (onStartBoardCallback) onStartBoardCallback();
    });
  }

  const chatInput = document.getElementById("chat-input") as HTMLInputElement;
  if (chatInput) {
    chatInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        const userPrompt = chatInput.value.trim();
        if (!userPrompt) return;

        const apiKey = getOpenAiApiKey();
        if (!apiKey) {
          alert("Please enter your OpenAI API Key first.");
          return;
        }

        const currentDisplay = getDisplayStringCallback ? getDisplayStringCallback() : "";

        // Disable input during request
        chatInput.disabled = true;
        const originalPlaceholder = chatInput.placeholder;
        chatInput.placeholder = "Thinking...";
        chatInput.value = "";

        if (enterIndeterminateStateCallback) {
          enterIndeterminateStateCallback();
        }

        try {
          const response = await getResponse({
            apiKey,
            userPrompt,
            currentDisplay,
            dimension: [16, 16],
          });

          console.log("AI Response:", response);

          if (setDisplayStringCallback && response.displayResponse) {
            setDisplayStringCallback(response.displayResponse);
          }
        } catch (error) {
          console.error("Error getting AI response:", error);
          alert("Error: " + (error instanceof Error ? error.message : error));
        } finally {
          chatInput.disabled = false;
          chatInput.placeholder = originalPlaceholder;
          chatInput.focus();
        }
      }
    });
  }
}

/* ---------- Export / Import settings ---------- */
interface SettingsData {
  version: number;
  exportedAt: string;
  calibrationPoints: Point2D[];
  blendParams: Record<string, number>;
}

export function exportSettings(): void {
  const blend: Record<string, number> = {};
  for (const k in blendParams) blend[k] = blendParams[k].value;
  const data: SettingsData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    calibrationPoints: calibrationState.points,
    blendParams: blend,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "split-flap-settings.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function importSettings(data: any): void {
  try {
    if (data.blendParams) {
      for (const k in data.blendParams) if (blendParams[k]) blendParams[k].value = +data.blendParams[k];
      syncBlendUI();
      saveBlend();
    }
    if (Array.isArray(data.calibrationPoints) && data.calibrationPoints.length === 4) {
      calibrationState.points = data.calibrationPoints.map((p: any) => ({ x: +p.x, y: +p.y }));
      calibrationState.step = 4;
      setAdjustMode(false);
      localStorage.setItem("splitFlapCalibrationPoints", JSON.stringify(calibrationState.points));
      if (onCalibrationChangedCallback) onCalibrationChangedCallback();
      updateHandlesUI();
    } else if (data.calibrationPoints && data.calibrationPoints.length === 0) {
      calibrationState.points = [];
      calibrationState.step = -1;
      localStorage.removeItem("splitFlapCalibrationPoints");
      if (onCalibrationChangedCallback) onCalibrationChangedCallback();
      updateHandlesUI();
    }
    buildLightmap();
  } catch (e: any) {
    alert("Failed to apply settings: " + e.message);
  }
}
