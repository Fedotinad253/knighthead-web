// Картинки и звуки. Пути — относительно web/assets (работает и на GitHub Pages в подпапке).
const url = (path) => new URL(`../assets/${path}`, import.meta.url).href;
const images = new Map();

export const assets = {
  image(path) {
    if (!path) return null;
    let image = images.get(path);
    if (!image) {
      image = new Image();
      image.src = url(path);
      images.set(path, image);
    }
    return image;
  },

  /** Загрузить всё заранее; onProgress(доля 0..1). */
  async preload(paths, onProgress) {
    let done = 0;
    await Promise.all(paths.map((p) => new Promise((resolve) => {
      const image = this.image(p);
      const finish = () => { onProgress?.(++done / paths.length); resolve(); };
      if (image.complete && image.naturalWidth) finish();
      else { image.onload = finish; image.onerror = finish; }
    })));
  },
};

export const ALL_IMAGES = [
  ...['arm_back', 'arm_front', 'cape', 'helmet', 'leg_back', 'leg_front', 'torso'].map((n) => `characters/bogatyr/${n}.png`),
  ...['arm_left', 'arm_right', 'eye', 'eye_blind', 'eye_glow', 'hand', 'head', 'shin_left', 'shin_right', 'thigh', 'torso']
    .map((n) => `characters/likho/${n}.png`),
  'characters/Healer.png', 'characters/Smith.png',
  ...['Sword', 'Axe', 'Mace', 'Bow', 'Crossbow'].map((n) => `weapons/${n}.png`),
];

// ---------------------------------------------------------------- Звук
// Всё идёт через общий регулятор громкости (сохраняется в localStorage).
// Звуки из файлов выравниваются по громкости с ударом меча: при загрузке меряется самая громкая
// часть файла и подгоняется под самую громкую часть взмаха.

const VOLUME_KEY = 'knighthead.volume';
let audioContext = null;
let output = null;
const buffers = new Map();
const levels = new Map();
let volume = 0.8;
try { const saved = Number(localStorage.getItem(VOLUME_KEY)); if (localStorage.getItem(VOLUME_KEY) !== null && Number.isFinite(saved)) volume = saved; } catch { /* по умолчанию */ }

/** Синтезированные звуки боя. */
export const SOUNDS = {
  slash: { freq: 320, to: 120, duration: 0.1, type: 'sawtooth', volume: 0.04, noise: 0.06 },
  shot: { freq: 900, to: 300, duration: 0.08, type: 'triangle', volume: 0.06 },
  dash: { freq: 500, to: 180, duration: 0.12, type: 'sine', volume: 0.05, noise: 0.05 },
  hurt: { freq: 140, to: 60, duration: 0.2, type: 'square', volume: 0.08, noise: 0.08 },
};

function context() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    output = audioContext.createGain();
    output.gain.value = volume;
    output.connect(audioContext.destination);
  }
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

export function getVolume() { return volume; }

export function setVolume(value) {
  volume = Math.min(1, Math.max(0, value));
  if (output) output.gain.value = volume;
  try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch { /* без сохранения */ }
}

/** Громкость звука: самый громкий кусок в 30 мс (среднеквадратичное по всем каналам). */
function loudness(buffer) {
  const windowSize = Math.max(1, Math.floor(buffer.sampleRate * 0.03));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  let best = 0;
  for (let start = 0; start < buffer.length; start += Math.floor(windowSize / 2)) {
    let sum = 0, count = 0;
    for (const data of channels)
      for (let i = start; i < Math.min(buffer.length, start + windowSize); i++) { sum += data[i] * data[i]; count++; }
    if (count) best = Math.max(best, Math.sqrt(sum / count));
  }
  return best;
}

/** Громкость взмаха меча — образец, под который подгоняются звуки из файлов. */
let referenceLevel = null;
async function reference() {
  if (referenceLevel !== null) return referenceLevel;
  const rate = 44100, preset = SOUNDS.slash;
  const offline = new OfflineAudioContext(1, Math.ceil(rate * (preset.duration + 0.05)), rate);
  renderBlip(offline, offline.destination, 0, preset);
  referenceLevel = loudness(await offline.startRendering());
  return referenceLevel;
}

export async function loadSound(name, path) {
  try {
    const data = await (await fetch(url(path))).arrayBuffer();
    const buffer = await context().decodeAudioData(data);
    buffers.set(name, buffer);
    const level = loudness(buffer);
    levels.set(name, level > 0 ? (await reference()) / level : 1);
  } catch { /* без звука — не страшно */ }
}

export function playSound(name, gainScale = 1) {
  const buffer = buffers.get(name);
  if (!buffer || !audioContext) return;
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  gain.gain.value = gainScale * (levels.get(name) ?? 1);
  source.buffer = buffer;
  source.connect(gain).connect(output);
  source.start();
}

function renderBlip(ctx, destination, t, { freq = 220, to = 90, duration = 0.12, type = 'triangle', volume: level = 0.15, noise = 0 }) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(level, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  gain.connect(destination);
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
  osc.connect(gain);
  osc.start(t); osc.stop(t + duration);
  if (noise > 0) {
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    g.gain.value = noise;
    src.buffer = buffer;
    src.connect(g).connect(destination);
    src.start(t);
  }
}

/** Короткий синтезированный звук боя: имя из SOUNDS. */
export function blip(name) {
  if (!audioContext) return;
  renderBlip(audioContext, output, audioContext.currentTime, SOUNDS[name]);
}

export const unlockAudio = () => context();

/** Во сколько раз звук из файла приглушён (или усилен), чтобы совпасть с ударом меча. */
export const soundGain = (name) => levels.get(name) ?? 1;
