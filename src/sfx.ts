/** Lightweight Web Audio beeps/chimes — no asset downloads. */

let ctx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    return ctx;
  } catch {
    return null;
  }
}

/** Call from the same user gesture as unlockSpeech. */
export function unlockSfx(): void {
  unlocked = true;
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') {
    void c.resume().catch(() => undefined);
  }
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType = 'sine',
  gain = 0.08,
  when = 0,
  slideTo?: number,
): void {
  if (!unlocked) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') void c.resume().catch(() => undefined);
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo != null) {
    osc.frequency.linearRampToValueAtTime(slideTo, t0 + dur);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Short success arpeggio (phase / mission done). */
export function sfxSuccess(): void {
  tone(523.25, 0.12, 'triangle', 0.09, 0);
  tone(659.25, 0.12, 'triangle', 0.08, 0.1);
  tone(783.99, 0.18, 'triangle', 0.09, 0.2);
}

/** Soft wrong-tool buzz. */
export function sfxWrong(): void {
  tone(180, 0.14, 'square', 0.045, 0, 120);
  tone(140, 0.12, 'square', 0.035, 0.08);
}

/** Feed animal — soft warm blip. */
export function sfxFeed(): void {
  tone(392, 0.09, 'sine', 0.07, 0);
  tone(523.25, 0.11, 'sine', 0.055, 0.07);
}

/** Wash splash. */
export function sfxWash(): void {
  tone(880, 0.05, 'sine', 0.04, 0, 420);
  tone(660, 0.08, 'triangle', 0.05, 0.04, 300);
  tone(520, 0.1, 'sine', 0.035, 0.09);
}

/** Chop corn — crunchy short. */
export function sfxChop(): void {
  tone(220, 0.06, 'sawtooth', 0.04, 0, 90);
  tone(160, 0.07, 'square', 0.03, 0.03);
}

/** Fell tree — low thud + crack. */
export function sfxFell(): void {
  tone(90, 0.16, 'sine', 0.1, 0, 55);
  tone(200, 0.08, 'triangle', 0.05, 0.05, 80);
}

/** Slurry splash — soft wet plop. */
export function sfxSplash(): void {
  tone(240, 0.07, 'sine', 0.045, 0, 110);
  tone(160, 0.1, 'triangle', 0.04, 0.04, 70);
  tone(90, 0.12, 'sine', 0.05, 0.08);
}
