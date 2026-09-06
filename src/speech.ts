/** Slovenian speech helper – falls back to text-only if unavailable. */

let unlocked = false;
let cachedVoice: SpeechSynthesisVoice | null | undefined;

export function unlockSpeech(): void {
  if (unlocked) return;
  unlocked = true;
  if (!('speechSynthesis' in window)) return;
  try {
    // Warm up voices on first user gesture (mobile Safari).
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    u.lang = 'sl-SI';
    window.speechSynthesis.speak(u);
    window.speechSynthesis.cancel();
    // Refresh voice cache after unlock (voices often load late).
    cachedVoice = undefined;
    pickSlovenianVoice();
  } catch {
    /* ignore */
  }
}

function scoreVoice(v: SpeechSynthesisVoice): number {
  const lang = (v.lang || '').toLowerCase();
  const name = (v.name || '').toLowerCase();
  let score = 0;
  if (lang === 'sl-si' || lang === 'sl_si') score += 100;
  else if (lang.startsWith('sl')) score += 80;
  else if (lang.includes('sl')) score += 40;
  if (/sloven|slovens|slovenšč|slovenia/.test(name)) score += 50;
  if (v.localService) score += 20;
  if (v.default) score += 5;
  return score;
}

function pickSlovenianVoice(): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window)) return null;
  if (cachedVoice !== undefined) return cachedVoice;

  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) {
    cachedVoice = null;
    return null;
  }

  let best: SpeechSynthesisVoice | null = null;
  let bestScore = 0;
  for (const v of voices) {
    const s = scoreVoice(v);
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }
  // Only accept a voice that is actually Slovenian-ish.
  cachedVoice = bestScore >= 40 ? best : null;
  return cachedVoice;
}

export function speakSl(text: string): void {
  if (!('speechSynthesis' in window)) return;
  const clean = text.replace(/[🌟🎉★✓→]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    // Always force Slovenian locale so engines don't guess HR/SR/EN.
    u.lang = 'sl-SI';
    const voice = pickSlovenianVoice();
    if (voice) {
      u.voice = voice;
      // Keep utterance lang aligned with the chosen voice when possible.
      if (voice.lang && voice.lang.toLowerCase().startsWith('sl')) {
        u.lang = voice.lang;
      } else {
        u.lang = 'sl-SI';
      }
    }
    // Slightly slow + warm for kids (Amadej / Aleks).
    u.rate = 0.92;
    u.pitch = 1.08;
    window.speechSynthesis.speak(u);
  } catch {
    /* text-only fallback */
  }
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoice = undefined;
    pickSlovenianVoice();
  };
}
