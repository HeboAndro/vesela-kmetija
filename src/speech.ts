/** Slovenian speech helper – falls back to text-only if unavailable. */

let unlocked = false;

export function unlockSpeech(): void {
  if (unlocked) return;
  unlocked = true;
  if (!('speechSynthesis' in window)) return;
  try {
    // Warm up voices on first user gesture (mobile Safari).
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

function pickSlovenianVoice(): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang.toLowerCase().startsWith('sl')) ||
    voices.find((v) => v.lang.toLowerCase().includes('sl')) ||
    null
  );
}

export function speakSl(text: string): void {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'sl-SI';
    const voice = pickSlovenianVoice();
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.pitch = 1.05;
    window.speechSynthesis.speak(u);
  } catch {
    /* text-only fallback */
  }
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    pickSlovenianVoice();
  };
}
