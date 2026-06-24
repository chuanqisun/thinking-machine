import flapSoundUrl from "./assets/flap-sound.mp3";

let audioCtx: AudioContext | null = null;
let cachedBuffers: AudioBuffer[] = [];

export async function initAudio(): Promise<void> {
  if (audioCtx) return;
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    const response = await fetch(flapSoundUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buf = await audioCtx.decodeAudioData(arrayBuffer);
    const OAC = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    if (!OAC) {
      cachedBuffers = [buf];
      return;
    }
    const n = 12;
    const out: AudioBuffer[] = [];
    for (let i = 0; i < n; i++) {
      const rate = 0.85 + (i / (n - 1)) * 0.3 + (Math.random() - 0.5) * 0.05;
      const oc = new OAC(buf.numberOfChannels, Math.ceil(buf.length / rate), buf.sampleRate);
      const s = oc.createBufferSource();
      s.buffer = buf;
      s.playbackRate.setValueAtTime(rate, 0);
      s.connect(oc.destination);
      s.start(0);
      out.push(await oc.startRendering());
    }
    cachedBuffers = out;
  } catch (e) {
    console.error("Audio init failed:", e);
  }
}

export function resumeAudio(): void {
  if (!audioCtx) initAudio();
  else if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
}

interface ActiveSound {
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  endTime: number;
}

const MAX_SOUNDS = 32;
let activeSounds: ActiveSound[] = [];

export function playFlapSound(jitter = 0): void {
  if (!audioCtx || !cachedBuffers.length) return;
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  const now = audioCtx.currentTime;
  activeSounds = activeSounds.filter((s) => s.endTime > now);
  if (activeSounds.length >= MAX_SOUNDS) {
    const o = activeSounds.shift();
    if (o) {
      try {
        o.gainNode.gain.cancelScheduledValues(now);
        o.gainNode.gain.setValueAtTime(o.gainNode.gain.value || 0.5, now);
        o.gainNode.gain.linearRampToValueAtTime(0, now + 0.05);
        o.source.stop(now + 0.05);
      } catch (e) {}
    }
  }
  const t = now + jitter + Math.random() * 0.02;
  const buffer = cachedBuffers[Math.floor(Math.random() * cachedBuffers.length)];
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.45 + Math.random() * 0.35, t);
  src.connect(g);
  g.connect(audioCtx.destination);
  src.start(t);
  activeSounds.push({ source: src, gainNode: g, endTime: t + buffer.duration });
}

// Auto-initialize audio
initAudio();
