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

let audioContext = null;
const buffers = new Map();

function context() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

export async function loadSound(name, path) {
  try {
    const data = await (await fetch(url(path))).arrayBuffer();
    buffers.set(name, await context().decodeAudioData(data));
  } catch { /* без звука — не страшно */ }
}

export function playSound(name, volume = 1) {
  const buffer = buffers.get(name);
  if (!buffer || !audioContext) return;
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  gain.gain.value = volume;
  source.buffer = buffer;
  source.connect(gain).connect(audioContext.destination);
  source.start();
}

/** Короткий синтезированный звук (удар, взмах), чтобы бой не был немым. */
export function blip({ freq = 220, to = 90, duration = 0.12, type = 'triangle', volume = 0.15, noise = 0 } = {}) {
  if (!audioContext) return;
  const t = audioContext.currentTime;
  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  gain.connect(audioContext.destination);
  const osc = audioContext.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
  osc.connect(gain);
  osc.start(t); osc.stop(t + duration);
  if (noise > 0) {
    const length = Math.floor(audioContext.sampleRate * duration);
    const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = audioContext.createBufferSource();
    const g = audioContext.createGain();
    g.gain.value = noise;
    src.buffer = buffer;
    src.connect(g).connect(audioContext.destination);
    src.start(t);
  }
}

export const unlockAudio = () => context();
