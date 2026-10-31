"use client";

// Tiny WebAudio-synthesized effects: no audio files, nothing loud. Created lazily after a user
// gesture (browsers block audio before one).
export type SoundName = "turn" | "check" | "chips" | "deal" | "win" | "fold";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call from a click handler (e.g. the sound toggle) so later sounds are allowed to play. */
export function unlockAudio() {
  audio();
}

function tone(a: AudioContext, freq: number, start: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(a.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function noise(a: AudioContext, start: number, dur: number, gain: number, freq: number, q = 1) {
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buffer = a.createBuffer(1, len, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(start);
}

export function playSound(name: SoundName) {
  const a = audio();
  if (!a || a.state !== "running") return;
  const t = a.currentTime + 0.005;
  switch (name) {
    case "turn":
      tone(a, 880, t, 0.16, 0.08);
      tone(a, 1318.5, t + 0.12, 0.22, 0.07);
      break;
    case "check":
      noise(a, t, 0.05, 0.35, 1800, 3);
      noise(a, t + 0.09, 0.05, 0.25, 1600, 3);
      break;
    case "chips":
      for (let i = 0; i < 3; i += 1) noise(a, t + i * 0.045, 0.04, 0.3, 4200 + i * 500, 6);
      break;
    case "deal":
      noise(a, t, 0.09, 0.22, 2600, 0.8);
      break;
    case "fold":
      noise(a, t, 0.12, 0.12, 900, 0.7);
      break;
    case "win":
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(a, f, t + i * 0.08, 0.28, 0.06, "triangle"));
      break;
  }
}
