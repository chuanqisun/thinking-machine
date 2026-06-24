import * as THREE from "three";
import { playFlapSound } from "./sound";

export const CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");

const texCache: Record<string, THREE.CanvasTexture> = {};

export function charTexture(ch: string): THREE.CanvasTexture {
  if (texCache[ch]) return texCache[ch];
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 180;
  const x = c.getContext("2d");
  if (!x) throw new Error("Could not get canvas context");
  x.fillStyle = "#1e1e1e";
  x.fillRect(0, 0, 128, 180);
  x.fillStyle = "#f0f0f0";
  x.font = "bold 130px monospace";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(ch, 64, 94);
  x.fillStyle = "#0a0a0a";
  x.fillRect(0, 88, 128, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return (texCache[ch] = t);
}

export function normalize(v: string | null | undefined): string {
  const normalizedChar = (v || " ").toUpperCase().charAt(0) || " ";
  return CHARS.indexOf(normalizedChar) < 0 ? " " : normalizedChar;
}

export function makeHalfGeometry(W: number, H: number, vMin: number, vMax: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(W, H),
    uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) === 1 ? vMax : vMin);
  uv.needsUpdate = true;
  return g;
}

/* ---------- Flap ---------- */
export interface FlapAnim {
  start: number;
  dur: number;
  to: string;
  res: () => void;
}

export class Flap {
  W: number;
  H: number;
  speed: number;
  current: string;
  busy: boolean;
  queueTarget: string | null;
  anim: FlapAnim | null;
  audioJitter: number;
  group: THREE.Group;
  topStatic: THREE.Mesh;
  bottomStatic: THREE.Mesh;
  topLeafPivot: THREE.Group;
  topLeaf: THREE.Mesh;
  bottomLeafPivot: THREE.Group;
  bottomLeaf: THREE.Mesh;

  row: number = 0;
  col: number = 0;
  rippleActive: boolean = false;
  nextAdvance: number = 0;

  constructor(W: number, speed: number) {
    this.W = W;
    this.H = W * (100 / 70);
    this.speed = speed;
    this.current = CHARS[Math.floor(Math.random() * CHARS.length)];
    this.busy = false;
    this.queueTarget = null;
    this.anim = null;
    this.audioJitter = Math.random() * 0.035;
    const hh = this.H / 2;
    this.group = new THREE.Group();

    const frame = new THREE.Mesh(new THREE.BoxGeometry(W * 1.08, this.H * 1.06, 0.12), new THREE.MeshBasicMaterial({ color: 0x0d0d0d }));
    frame.position.z = -0.06;
    this.group.add(frame);

    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, W * 1.04, 8), new THREE.MeshBasicMaterial({ color: 0x050505 }));
    axle.rotation.z = Math.PI / 2;
    axle.position.z = 0.02;
    this.group.add(axle);

    const tex = charTexture(this.current);
    this.topStatic = new THREE.Mesh(makeHalfGeometry(W, hh, 0.5, 1.0), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    this.topStatic.position.set(0, hh / 2, 0.005);
    this.bottomStatic = new THREE.Mesh(makeHalfGeometry(W, hh, 0.0, 0.5), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    this.bottomStatic.position.set(0, -hh / 2, 0.005);

    this.topLeafPivot = new THREE.Group();
    this.topLeaf = new THREE.Mesh(makeHalfGeometry(W, hh, 0.5, 1.0), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    this.topLeaf.position.set(0, hh / 2, 0.015);
    this.topLeafPivot.add(this.topLeaf);
    this.topLeafPivot.visible = false;

    this.bottomLeafPivot = new THREE.Group();
    this.bottomLeaf = new THREE.Mesh(makeHalfGeometry(W, hh, 0.0, 0.5), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    this.bottomLeaf.position.set(0, -hh / 2, 0.015);
    this.bottomLeafPivot.add(this.bottomLeaf);
    this.bottomLeafPivot.visible = false;

    this.group.add(this.topStatic, this.bottomStatic, this.topLeafPivot, this.bottomLeafPivot);
    [this.topStatic, this.bottomStatic, frame].forEach((m) => (m.userData.flap = this));
  }

  setMap(mesh: THREE.Mesh, ch: string): void {
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.map = charTexture(ch);
    mat.needsUpdate = true;
  }

  flipOnce(from: string, to: string): Promise<void> {
    playFlapSound(this.audioJitter);
    return new Promise<void>((res) => {
      this.setMap(this.topStatic, to);
      this.setMap(this.topLeaf, from);
      this.setMap(this.bottomLeaf, to);
      this.topLeafPivot.visible = true;
      this.bottomLeafPivot.visible = false;
      this.topLeafPivot.rotation.x = 0;
      this.bottomLeafPivot.rotation.x = -Math.PI / 2;
      this.anim = { start: performance.now(), dur: 1000 / this.speed, to, res };
    });
  }

  update(now: number): void {
    if (!this.anim) return;
    const a = this.anim;
    const t = Math.min((now - a.start) / a.dur, 1);
    if (t < 0.5) {
      this.topLeafPivot.visible = true;
      this.bottomLeafPivot.visible = false;
      this.topLeafPivot.rotation.x = (Math.PI / 2) * (t / 0.5);
    } else {
      this.topLeafPivot.visible = false;
      this.bottomLeafPivot.visible = true;
      this.bottomLeafPivot.rotation.x = -(Math.PI / 2) * (1 - (t - 0.5) / 0.5);
    }
    if (t >= 1) {
      this.setMap(this.bottomStatic, a.to);
      this.topLeafPivot.visible = false;
      this.bottomLeafPivot.visible = false;
      this.anim = null;
      a.res();
    }
  }

  async go(value: string): Promise<void> {
    this.queueTarget = normalize(value);
    if (this.busy) return;
    this.busy = true;
    let idx = CHARS.indexOf(this.current);
    while (this.current !== this.queueTarget) {
      idx = (idx + 1) % CHARS.length;
      await this.flipOnce(this.current, CHARS[idx]);
      this.current = CHARS[idx];
    }
    this.busy = false;
  }

  advance(): void {
    this.go(CHARS[(CHARS.indexOf(this.current) + 1) % CHARS.length]);
  }
}
