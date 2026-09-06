import { IMPLEMENTS, MISSIONS, type ImplementId, type Mission, type MissionId } from './missions';
import {
  sfxChop,
  sfxFeed,
  sfxFell,
  sfxSplash,
  sfxSuccess,
  sfxWash,
  sfxWrong,
  unlockSfx,
} from './sfx';
import { speakSl, unlockSpeech } from './speech';

interface Zone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Animal {
  kind: 'cow' | 'sheep';
  x: number;
  y: number;
  angle: number;
  fed: boolean;
  bob: number;
  homeX: number;
  homeY: number;
  tx: number;
  ty: number;
  wait: number;
}

interface HayPatch {
  x: number;
  y: number;
  r: number;
  baled: boolean;
}

interface FieldCell {
  x: number;
  y: number;
  w: number;
  h: number;
  tilled: boolean;
  sown: boolean;
}

/** Dirty courtyard / driveway spots for metla mission. */
interface YardCell {
  x: number;
  y: number;
  w: number;
  h: number;
  dirty: boolean;
}

/** Meadow / hay workflow on leftField. */
type MeadowState = 'tall' | 'cut' | 'windrow' | 'baled' | 'wrapped';

interface MeadowCell {
  x: number;
  y: number;
  w: number;
  h: number;
  state: MeadowState;
}

/** Slurry / gnojnica cells on manureField (separate from hay meadow). */
interface ManureCell {
  x: number;
  y: number;
  w: number;
  h: number;
  manured: boolean;
}

type CornState = 'empty' | 'planted' | 'chopped';

interface CornCell {
  x: number;
  y: number;
  w: number;
  h: number;
  state: CornState;
}

interface ForestTree {
  x: number;
  y: number;
  r: number;
  felled: boolean;
  /** Log still on ground (after fell, before loaded). */
  logOnGround: boolean;
}

interface Bird {
  x: number;
  y: number;
  vx: number;
  phase: number;
}

interface Wanderer {
  kind: 'cow' | 'sheep';
  x: number;
  y: number;
  angle: number;
  bob: number;
  homeX: number;
  homeY: number;
  tx: number;
  ty: number;
  wait: number;
}

interface FxParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

/** Playable world / mapa.png size (full-bleed). */
const MAP_W = 2400;
const MAP_H = 1600;
const TRACTOR_DRAW = 112;
/** Half tractor footprint — expand cell hit boxes so driving across always marks. */
const CELL_HIT_EXPAND = TRACTOR_DRAW * 0.5;
const COW_DRAW = 72;
const SHEEP_DRAW = 58;
const TRACTOR_SPEED = 220;
/** How much of the map height a phone should see (~55–70%). */
const VIEW_FRAC = 0.62;
const CAM_LERP = 5.5;
/**
 * Tall phones (e.g. Galaxy S24+ ~19.5:9) get letterboxed so the play
 * canvas is not a full stretched column. Cap height/width of the play area.
 */
const MAX_PLAY_ASPECT = 1.72; // ≈16:9.3 portrait — tablets/landscape unchanged
/** Soft night veil peak alpha (was ~0.9 hard blackout). */
const NIGHT_VEIL_ALPHA = 0.62;

type TractorId = 'deutz' | 'goldoni' | 'utb' | 'torpedo';

/** How to strip studio backdrop from tractor sprites at load. */
type TractorKeyMode = 'none' | 'soft' | 'black';

interface TractorDef {
  id: TractorId;
  label: string;
  shortLabel: string;
  src: string;
  /** Draw size multiplier vs TRACTOR_DRAW (Goldoni smaller, Torpedo larger). */
  scale: number;
  /**
   * Backdrop keying:
   * - none: already-transparent PNG (e.g. green Deutz) — do not punch mid greens
   * - soft: edge-flood only near-white / near-black (safe for green bodies)
   * - black: classic studio-black flood (non-green implements / dark-backed art)
   */
  keyMode: TractorKeyMode;
}

const TRACTORS: TractorDef[] = [
  {
    id: 'deutz',
    label: 'Deutz Agrotron',
    shortLabel: 'Deutz',
    src: './tractor-deutz.png',
    scale: 1,
    // Already transparent green body — never run black/green chroma that eats paint.
    keyMode: 'none',
  },
  {
    id: 'goldoni',
    label: 'Goldoni Universal 230',
    shortLabel: 'Goldoni',
    src: './tractor-goldoni.png',
    scale: 0.86,
    keyMode: 'none',
  },
  {
    id: 'utb',
    label: 'UTB Universal 643 DT',
    shortLabel: 'UTB 643',
    src: './tractor-utb.png',
    scale: 1.02,
    keyMode: 'none',
  },
  {
    id: 'torpedo',
    label: 'Torpedo RX 120',
    shortLabel: 'Torpedo',
    src: './tractor-torpedo.png',
    scale: 1.14,
    keyMode: 'none',
  },
];

const TRACTOR_STORAGE_KEY = 'vesela-kmetija-traktor';

function loadSavedTractorId(): TractorId {
  try {
    const v = localStorage.getItem(TRACTOR_STORAGE_KEY);
    if (v && TRACTORS.some((t) => t.id === v)) return v as TractorId;
  } catch {
    /* ignore */
  }
  return 'deutz';
}


function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Ne morem naložiti ${src}`));
    img.src = src;
  });
}

/** Chroma-key bright green → transparent (safe if already transparent). */
function chromaKeyGreen(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, c.width, c.height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const a = d[i + 3];
    if (a < 8) continue;
    const greenDom = g > r + 35 && g > b + 35 && g > 100;
    const nearChroma = g > 140 && g > r * 1.25 && g > b * 1.25;
    if (greenDom || nearChroma) {
      d[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return c;
}

/**
 * True for mid-green body paint (Deutz hood/fenders). Never treat as backdrop.
 * Protects green tractors from soft/black key floods eating the chassis.
 */
function isMidGreenBody(r: number, g: number, b: number): boolean {
  return g > 55 && g > r + 12 && g > b + 12;
}

/**
 * Soft backdrop key for green tractors: edge-flood only near-white / near-black.
 * Never removes mid greens (Deutz body paint).
 */
function chromaKeySoftBg(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, c.width, c.height);
  const d = imageData.data;
  const w = c.width;
  const h = c.height;
  const n = w * h;
  const isBg = (i: number) => {
    const o = i * 4;
    const a = d[o + 3];
    if (a < 8) return true;
    const r = d[o];
    const g = d[o + 1];
    const b = d[o + 2];
    if (isMidGreenBody(r, g, b)) return false;
    const maxc = Math.max(r, g, b);
    const minc = Math.min(r, g, b);
    const mean = (r + g + b) / 3;
    const nearWhite = minc > 235 && maxc > 245;
    // Stricter than chromaKeyBlack — only pure studio black, not dark grey metal
    const nearBlack = maxc < 14 || (mean < 10 && maxc < 20);
    return nearWhite || nearBlack;
  };
  const seen = new Uint8Array(n);
  const q = new Int32Array(n);
  let qs = 0;
  let qe = 0;
  const push = (i: number) => {
    if (i < 0 || i >= n || seen[i]) return;
    if (!isBg(i)) return;
    seen[i] = 1;
    q[qe++] = i;
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + (w - 1));
  }
  while (qs < qe) {
    const i = q[qs++];
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x + 1 < w) push(i + 1);
    if (y > 0) push(i - w);
    if (y + 1 < h) push(i + w);
  }
  for (let i = 0; i < n; i++) {
    if (seen[i]) d[i * 4 + 3] = 0;
  }
  ctx.putImageData(imageData, 0, 0);
  return c;
}

/** Chroma-key near-black studio backdrop via edge flood (keeps dark tires + mid greens). */
function chromaKeyBlack(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, c.width, c.height);
  const d = imageData.data;
  const w = c.width;
  const h = c.height;
  const n = w * h;
  const isBg = (i: number) => {
    const o = i * 4;
    const a = d[o + 3];
    if (a < 8) return true;
    const r = d[o];
    const g = d[o + 1];
    const b = d[o + 2];
    if (isMidGreenBody(r, g, b)) return false;
    const maxc = Math.max(r, g, b);
    const mean = (r + g + b) / 3;
    // Studio black only — tires (~25–55) stay if not flood-connected from edge
    return maxc < 22 || (mean < 16 && maxc < 32);
  };
  const seen = new Uint8Array(n);
  const q = new Int32Array(n);
  let qs = 0;
  let qe = 0;
  const push = (i: number) => {
    if (i < 0 || i >= n || seen[i]) return;
    if (!isBg(i)) return;
    seen[i] = 1;
    q[qe++] = i;
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + (w - 1));
  }
  while (qs < qe) {
    const i = q[qs++];
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x + 1 < w) push(i + 1);
    if (y > 0) push(i - w);
    if (y + 1 < h) push(i + w);
  }
  for (let i = 0; i < n; i++) {
    if (seen[i]) d[i * 4 + 3] = 0;
  }
  ctx.putImageData(imageData, 0, 0);
  return c;
}

export class FarmGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private missionTitleEl: HTMLElement;
  private missionPickEl: HTMLSelectElement;
  private missionHintEl: HTMLElement;
  private progressFill: HTMLElement;
  private starsCountEl: HTMLElement;
  private toastEl: HTMLElement;
  private implementBar: HTMLElement;
  private restartBtn: HTMLButtonElement;
  private garageBtn: HTMLButtonElement;
  private missionNeedIcon: HTMLElement;
  private missionNeedLabel: HTMLElement;
  private questBangEl: HTMLElement | null = null;
  private implChipIcon: HTMLElement | null = null;
  private implChipLabel: HTMLElement | null = null;
  private nearGarage = false;

  private mapImg: HTMLImageElement | null = null;
  private tractorImg: HTMLCanvasElement | HTMLImageElement | null = null;
  /** All selectable tractor sprites (chroma/cropped). */
  private tractorImgs: Partial<Record<TractorId, HTMLCanvasElement>> = {};
  private selectedTractor: TractorId = loadSavedTractorId();
  private tractorChoicesEl: HTMLElement;
  private cowImg: HTMLCanvasElement | HTMLImageElement | null = null;
  /** Chroma-keyed implement sprites (plug/balirka/ovijalka; black bg). */
  private implementImgs: Partial<Record<ImplementId, HTMLCanvasElement>> = {};
  /**
   * Uniform hitch — no per-PNG eye calibration (that kept breaking).
   * Canvas fallbacks are authored with hitch at +Y (toward tractor), body −Y.
   * If a PNG is drawn, it uses the same rot=0 / centered placement.
   */
  private hitchTune: Record<
    ImplementId,
    { rot: number; offsetY: number; offsetX?: number; scale: number; flip?: boolean; front?: boolean }
  > = {
    // Proportional to TRACTOR_DRAW. Hitch on image RIGHT (or flip).
    plug: { rot: 0, offsetX: 0, offsetY: 0.02, scale: 1.0 },
    balirka: { rot: 0, offsetX: 0, offsetY: 0.05, scale: 1.15 },
    ovijalka: { rot: 0, offsetX: 0, offsetY: 0.05, scale: 1.08 },
    sejalnik: { rot: 0, offsetX: 0, offsetY: 0.03, scale: 1.0 },
    kosilnica: { rot: 0, offsetX: 0.12, offsetY: 0.02, scale: 1.05 },
    zgrabljalnik: { rot: 0, offsetX: 0, offsetY: 0.04, scale: 1.05 },
    gnojnica: { rot: 0, offsetX: 0, offsetY: 0.06, scale: 1.18 },
    kombajn: { rot: 0, offsetX: 0.18, offsetY: 0.04, scale: 1.12 },
    // prikolica mirrored (hitch RIGHT); metla rotated 180° (hitch LEFT → flip).
    prikolica: { rot: 0, offsetX: 0, offsetY: 0.08, scale: 1.22 },
    krmilnik: { rot: 0, offsetX: 0, offsetY: 0.06, scale: 1.2, flip: true },
    vitla: { rot: 0, offsetX: 0, offsetY: 0.02, scale: 0.78 },
    silazer: { rot: 0, offsetX: 0, offsetY: 0.05, scale: 1.0 },
    metla: { rot: 0, offsetX: 0, offsetY: 0.02, scale: 0.95, front: true, flip: true },
  };

  private ready = false;

  private zones: Zone[] = [];
  private fieldCells: FieldCell[] = [];
  private yardCells: YardCell[] = [];
  private meadowCells: MeadowCell[] = [];
  private manureCells: ManureCell[] = [];
  private cornCells: CornCell[] = [];
  private trees: ForestTree[] = [];
  private hayPatches: HayPatch[] = [];
  private animals: Animal[] = [];
  private bales: { x: number; y: number; wrapped: boolean }[] = [];
  private birds: Bird[] = [];
  private grassWaves: { x: number; y: number; phase: number }[] = [];
  private wanderers: Wanderer[] = [];
  private particles: FxParticle[] = [];
  /** Logs currently on the trailer. */
  private trailerLogs = 0;
  /** Logs delivered to barn yard. */
  private deliveredLogs = 0;
  /** Wrapped bales on trailer (hay finale / neighbor). */
  private trailerBales = 0;
  /** Wrapped bales delivered to barn yard or neighbor. */
  private deliveredBales = 0;
  /** Lost lambs/sheep for night mission (find with headlights). */
  private lostLambs: { x: number; y: number; found: boolean; sparkle: number }[] = [];
  /** Fixed starfield for night overlay (world coords). */
  private nightStars: { x: number; y: number; r: number; phase: number }[] = [];
  private static readonly NIGHT_LAMB_COUNT = 3;
  /** Silage mound after corn harvest. */
  private silagePile = { x: 1100, y: 420, amount: 0 };
  /** 1 = dirty, 0 = clean. Washes off at washBay during wash mission. */
  private tractorDirt = 1;
  /** Cooldown so wash splash beep is not every frame. */
  private washSfxCd = 0;
  /** Cooldown so slurry splash beep is not every frame. */
  private slurrySfxCd = 0;

  private tractor = { x: 1200, y: 800, angle: 0 };
  private speed = TRACTOR_SPEED;
  private bouncePhase = 0;
  private moving = false;

  /** World-space camera center (smooth follow). */
  private cam = { x: 1200, y: 800 };
  /** Optional nudge from one-finger drag on empty map. */
  private camNudge = { x: 0, y: 0 };
  private pan = {
    active: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
  };

  private selectedImplement: ImplementId | null = 'plug';
  private wrongEquipFlash = 0;

  private missionIndex = 0;
  private phaseIndex = 0;
  private missionProgress = 0;
  private completedMissions = 0;
  /** WoW-style: which missions are finished (free pick + markers). */
  private completedIds = new Set<MissionId>();
  /** Auto-accept cooldown so we don't spam toasts. */
  private questAcceptCd = 0;
  /** Soft proximity hint cooldown for manual-accept quests (night/sheep). */
  private questHintCd = 0;
  /** 0→1 fade for night overlay so darkness is not an instant blackout. */
  private nightVeil = 0;
  /** Fill_cistern phase 1 progress 0..1 */
  private cisternFill = 0;
  /** Daytime sheep hunt targets. */
  private lostSheep: { x: number; y: number; found: boolean }[] = [];
  private static readonly SHEEP_FIND_COUNT = 3;
  /** Stuck tractor for rescue mission (world coords). */
  private stuckTractor = {
    x: 1680,
    y: 980,
    angle: -0.4,
    hooked: false,
    delivered: false,
  };
  private celebrating = false;
  private gameDone = false;

  private lastTs = 0;
  private pulse = 0;

  /** World → screen scale (camera viewport, not object-fit cover). */
  private viewScale = 1;
  private cssW = 0;
  private cssH = 0;

  /** Virtual joystick (CSS/screen pixels). */
  private joy = {
    active: false,
    pointerId: -1,
    baseX: 0,
    baseY: 0,
    knobX: 0,
    knobY: 0,
    dx: 0,
    dy: 0,
    radius: 64,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas ni na voljo');
    this.ctx = ctx;

    this.missionTitleEl = document.getElementById('mission-title')!;
    this.missionPickEl = document.getElementById('mission-pick') as HTMLSelectElement;
    this.missionHintEl = document.getElementById('mission-hint')!;
    this.progressFill = document.getElementById('progress-fill')!;
    this.starsCountEl = document.getElementById('stars-count')!;
    this.toastEl = document.getElementById('toast')!;
    this.implementBar = document.getElementById('implement-bar')!;
    this.tractorChoicesEl = document.getElementById('tractor-choices')!;
    this.restartBtn = document.getElementById('restart-btn') as HTMLButtonElement;
    this.restartBtn.addEventListener('click', (e) => {
      e.preventDefault();
      unlockSpeech();
      unlockSfx();
      this.restartGame();
    });
    this.garageBtn = document.getElementById('garage-btn') as HTMLButtonElement;
    this.missionNeedIcon = document.getElementById('mission-need-icon')!;
    this.missionNeedLabel = document.getElementById('mission-need-label')!;
    this.questBangEl = document.getElementById('quest-bang');
    this.implChipIcon = document.getElementById('impl-chip-icon');
    this.implChipLabel = document.getElementById('impl-chip-label');
    const hornBtn = document.getElementById('action-horn');
    hornBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      unlockSfx();
      sfxSplash();
      this.showToast('Beep beep!', 700);
    });
    const camBtn = document.getElementById('action-cam');
    camBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      // Nudge camera briefly for kids “look around”
      this.camNudge.x += Math.cos(this.tractor.angle) * 90;
      this.camNudge.y += Math.sin(this.tractor.angle) * 90;
      this.showToast('Pogled naprej', 700);
    });
    this.garageBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      unlockSpeech();
      unlockSfx();
      this.attachNeededFromGarage();
    });
    this.garageBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      unlockSpeech();
      unlockSfx();
      this.attachNeededFromGarage();
    });

    this.buildWorld();
    this.buildImplementBar();
    this.buildTractorBar();
    this.buildMissionPicker();
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('scroll', () => this.resize());
    void this.loadAssets();
    requestAnimationFrame((t) => this.loop(t));
  }

  private async loadAssets(): Promise<void> {
    try {
      const [
        map,
        cow,
        plug,
        balirka,
        ovijalka,
        gnojnica,
        sejalnik,
        kosilnica,
        zgrabljalnik,
        kombajn,
        prikolica,
        krmilnik,
        vitla,
        metla,
        ...tractorRaws
      ] = await Promise.all([
        loadImage('./mapa.png'),
        loadImage('./krava.png'),
        loadImage('./plug.png'),
        loadImage('./balirka.png'),
        loadImage('./ovijalka.png'),
        loadImage('./gnojnica.png'),
        loadImage('./sejalnik.png'),
        loadImage('./kosilnica.png'),
        loadImage('./zgrabljalnik.png'),
        loadImage('./kombajn.png'),
        loadImage('./prikolica.png'),
        loadImage('./krmilnik.png'),
        loadImage('./vitla.png'),
        loadImage('./metla.png'),
        ...TRACTORS.map((t) => loadImage(t.src)),
      ]);
      this.mapImg = map;
      this.cowImg = chromaKeyGreen(cow);
      for (let i = 0; i < TRACTORS.length; i++) {
        const def = TRACTORS[i];
        const raw = tractorRaws[i] as HTMLImageElement;
        const keyed =
          def.keyMode === 'black'
            ? chromaKeyBlack(raw)
            : def.keyMode === 'soft'
              ? chromaKeySoftBg(raw)
              : canvasFromImage(raw);
        this.tractorImgs[def.id] = cropTransparent(keyed);
      }
      // Fallback: keep legacy traktor.png path if Deutz file missing processed ok
      if (!this.tractorImgs.deutz) {
        try {
          const legacy = await loadImage('./traktor.png');
          // Legacy art may be green — soft key only, never mid-green punch
          this.tractorImgs.deutz = cropTransparent(chromaKeySoftBg(legacy));
        } catch {
          /* ignore */
        }
      }
      this.applySelectedTractor();
      const keyCrop = (img: HTMLImageElement) => cropTransparent(chromaKeyBlack(img));
      this.implementImgs.plug = keyCrop(plug);
      this.implementImgs.balirka = keyCrop(balirka);
      this.implementImgs.ovijalka = keyCrop(ovijalka);
      this.implementImgs.gnojnica = keyCrop(gnojnica);
      this.implementImgs.sejalnik = keyCrop(sejalnik);
      this.implementImgs.kosilnica = keyCrop(kosilnica);
      this.implementImgs.zgrabljalnik = keyCrop(zgrabljalnik);
      this.implementImgs.kombajn = keyCrop(kombajn);
      this.implementImgs.prikolica = keyCrop(prikolica);
      this.implementImgs.krmilnik = keyCrop(krmilnik);
      this.implementImgs.vitla = keyCrop(vitla);
      this.implementImgs.metla = keyCrop(metla);
      this.ready = true;
      this.refreshImplementBarIcons();
      this.rebuildImplementBar();
      this.refreshImplementBar();
      this.refreshTractorBar();
      this.updateHud();
      this.announceMission();
    } catch (err) {
      console.error(err);
      this.missionTitleEl.textContent = 'Napaka pri nalaganju';
      this.missionHintEl.textContent = 'Preveri slike v public/';
    }
  }

  private buildWorld(): void {
    // Calibrated to painted landmarks on mapa.png (2400×1600 full-bleed)
    // Top-left forest+logs, left pond, barn/silo/openBarn/garage cluster,
    // mid-right wash gantry, bottom grain/corn/sheep, slurry right, neighbor top-right.
    this.zones = [
      // Forest + log stacks (top-left)
      { id: 'forest', x: 10, y: 10, w: 560, h: 440 },
      { id: 'pond', x: 30, y: 470, w: 360, h: 260 },
      // Hay meadow (kosilnica → zgrabljalnik → balirka → ovijalka) — grass belt below pond
      { id: 'leftField', x: 40, y: 740, w: 520, h: 200 },
      // Grain field (plug → sejalnik) — plowed brown bottom-left
      { id: 'rightField', x: 80, y: 960, w: 660, h: 500 },
      // Corn (bottom-center)
      { id: 'cornField', x: 780, y: 1000, w: 480, h: 480 },
      // Night lamb paddock (bottom-right)
      { id: 'nightPaddock', x: 1350, y: 1120, w: 780, h: 400 },
      // Slurry tank pad for gnojnica (right of paddock)
      { id: 'manureField', x: 1860, y: 780, w: 500, h: 320 },
      // Red barn + silo cluster
      { id: 'barn', x: 700, y: 160, w: 400, h: 340 },
      { id: 'garage', x: 900, y: 540, w: 280, h: 220 },
      { id: 'hay', x: 1020, y: 460, w: 200, h: 140 },
      // Open barn / feed alley (cows)
      { id: 'openBarn', x: 1140, y: 280, w: 480, h: 300 },
      { id: 'trough', x: 1240, y: 360, w: 160, h: 120 },
      // Yellow CAR WASH gantry on pad (painted on mapa — no PNG overlay)
      { id: 'washBay', x: 1640, y: 380, w: 420, h: 320 },
      // Slurry cistern / tank pad (fill mission)
      { id: 'slurryTank', x: 1980, y: 700, w: 280, h: 200 },
      // Stuck tractor spawn (rescue mission marker)
      { id: 'stuckTractor', x: 1580, y: 900, w: 220, h: 180 },
      // Courtyard: metla + log/bale drop (dirt hub)
      { id: 'barnYard', x: 1100, y: 640, w: 460, h: 280 },
      { id: 'mudPath', x: 860, y: 720, w: 260, h: 160 },
      // Neighbor yellow house (top-right)
      { id: 'neighbor', x: 2040, y: 30, w: 340, h: 360 },
      { id: 'fenceCorridor', x: 1760, y: 120, w: 280, h: 200 },
    ];
    this.resetWorldState();
  }

  /** Reset fields, meadow, animals, tractor — safe to call on restart without rebinding input. */
  private resetWorldState(): void {
    this.yardCells = [];
    const yardZ = this.zones.find((z) => z.id === 'barnYard')!;
    const yCols = 5;
    const yRows = 3;
    const ycw = yardZ.w / yCols;
    const ych = yardZ.h / yRows;
    for (let r = 0; r < yRows; r++) {
      for (let c = 0; c < yCols; c++) {
        this.yardCells.push({
          x: yardZ.x + c * ycw + ycw / 2,
          y: yardZ.y + r * ych + ych / 2,
          w: ycw,
          h: ych,
          dirty: true,
        });
      }
    }

    this.fieldCells = [];
    const field = this.zones.find((z) => z.id === 'rightField')!;
    const cols = 6;
    const rows = 5;
    const cw = field.w / cols;
    const ch = field.h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.fieldCells.push({
          x: field.x + c * cw + cw / 2,
          y: field.y + r * ch + ch / 2,
          w: cw,
          h: ch,
          tilled: false,
          sown: false,
        });
      }
    }

    // Left meadow for hay workflow (tall → cut → windrow → bale → wrap)
    this.meadowCells = [];
    const meadow = this.zones.find((z) => z.id === 'leftField')!;
    const mCols = 5;
    const mRows = 4;
    const mcw = meadow.w / mCols;
    const mch = meadow.h / mRows;
    for (let r = 0; r < mRows; r++) {
      for (let c = 0; c < mCols; c++) {
        this.meadowCells.push({
          x: meadow.x + c * mcw + mcw / 2,
          y: meadow.y + r * mch + mch / 2,
          w: mcw,
          h: mch,
          state: 'tall',
        });
      }
    }

    // Manure / gnojnica meadow (separate from hay)
    this.manureCells = [];
    const manureZ = this.zones.find((z) => z.id === 'manureField')!;
    const manCols = 5;
    const manRows = 3;
    const manCw = manureZ.w / manCols;
    const manCh = manureZ.h / manRows;
    for (let r = 0; r < manRows; r++) {
      for (let c = 0; c < manCols; c++) {
        this.manureCells.push({
          x: manureZ.x + c * manCw + manCw / 2,
          y: manureZ.y + r * manCh + manCh / 2,
          w: manCw,
          h: manCh,
          manured: false,
        });
      }
    }

    // Corn field (right pad) — plant then chop to silage
    this.cornCells = [];
    const corn = this.zones.find((z) => z.id === 'cornField')!;
    const cCols = 4;
    const cRows = 5;
    const ccw = corn.w / cCols;
    const cch = corn.h / cRows;
    for (let r = 0; r < cRows; r++) {
      for (let c = 0; c < cCols; c++) {
        this.cornCells.push({
          x: corn.x + c * ccw + ccw / 2,
          y: corn.y + r * cch + cch / 2,
          w: ccw,
          h: cch,
          state: 'empty',
        });
      }
    }

    // Forest trees (top-left)
    this.trees = [];
    const forest = this.zones.find((z) => z.id === 'forest')!;
    const spots = [
      [0.22, 0.2],
      [0.55, 0.18],
      [0.78, 0.35],
      [0.3, 0.55],
      [0.62, 0.58],
      [0.42, 0.8],
    ];
    for (const [fx, fy] of spots) {
      this.trees.push({
        x: forest.x + forest.w * fx,
        y: forest.y + forest.h * fy,
        r: 22 + Math.random() * 8,
        felled: false,
        logOnGround: false,
      });
    }
    this.trailerLogs = 0;
    this.deliveredLogs = 0;
    this.trailerBales = 0;
    this.deliveredBales = 0;
    this.spawnNightLambs();
    this.nightStars = [];
    for (let i = 0; i < 55; i++) {
      this.nightStars.push({
        x: 40 + Math.random() * (MAP_W - 80),
        y: 30 + Math.random() * (MAP_H * 0.55),
        r: 0.8 + Math.random() * 1.8,
        phase: Math.random() * Math.PI * 2,
      });
    }
    this.silagePile = { x: 1100, y: 420, amount: 0 };
    this.particles = [];

    // Legacy barn-side hay (hidden — meadow workflow uses leftField)
    this.hayPatches = [
      { x: 1040, y: 500, r: 36, baled: true },
      { x: 1120, y: 520, r: 34, baled: true },
      { x: 1080, y: 560, r: 32, baled: true },
      { x: 1180, y: 490, r: 34, baled: true },
    ];
    this.bales = [];
    this.tractorDirt = 1;
    this.washSfxCd = 0;
    this.slurrySfxCd = 0;
    this.cisternFill = 0;
    this.spawnLostSheep();
    this.stuckTractor = {
      x: 1680,
      y: 980,
      angle: -0.4,
      hooked: false,
      delivered: false,
    };

    // Open barn: two rows of stalls — govedo + ovce mixed, alley in the middle
    const barn = this.zones.find((z) => z.id === 'openBarn')!;
    const leftX = barn.x + 55;
    const rightX = barn.x + barn.w - 55;
    const ys = [
      barn.y + 48,
      barn.y + barn.h * 0.36,
      barn.y + barn.h * 0.62,
      barn.y + barn.h - 48,
    ];
    // Left: cow, sheep, cow, sheep | Right: sheep, cow, sheep, cow → 4 cows + 4 sheep
    this.animals = [
      this.makeAnimal('cow', leftX, ys[0], 0.2, 0),
      this.makeAnimal('sheep', leftX, ys[1], 0.15, 0.7),
      this.makeAnimal('cow', leftX, ys[2], 0.25, 1.4),
      this.makeAnimal('sheep', leftX, ys[3], 0.18, 2.0),
      this.makeAnimal('sheep', rightX, ys[0], Math.PI - 0.2, 0.4),
      this.makeAnimal('cow', rightX, ys[1], Math.PI - 0.15, 1.1),
      this.makeAnimal('sheep', rightX, ys[2], Math.PI - 0.22, 1.8),
      this.makeAnimal('cow', rightX, ys[3], Math.PI - 0.25, 2.5),
    ];

    this.birds = [];
    for (let i = 0; i < 5; i++) {
      this.birds.push({
        x: 200 + Math.random() * (MAP_W - 400),
        y: 80 + Math.random() * 280,
        vx: 28 + Math.random() * 40,
        phase: Math.random() * Math.PI * 2,
      });
    }

    this.grassWaves = [];
    for (let i = 0; i < 55; i++) {
      this.grassWaves.push({
        x: 80 + Math.random() * (MAP_W - 160),
        y: 100 + Math.random() * (MAP_H - 200),
        phase: Math.random() * Math.PI * 2,
      });
    }

    // Living pasture wanderers on leftField (decorative; feed animals stay in openBarn)
    const pasture = this.zones.find((z) => z.id === 'leftField')!;
    this.wanderers = [];
    const wSpots: Array<['cow' | 'sheep', number, number]> = [
      ['cow', 0.22, 0.28],
      ['sheep', 0.48, 0.22],
      ['cow', 0.7, 0.4],
      ['sheep', 0.35, 0.58],
      ['cow', 0.58, 0.72],
      ['sheep', 0.18, 0.78],
    ];
    for (const [kind, fx, fy] of wSpots) {
      const wx = pasture.x + pasture.w * fx;
      const wy = pasture.y + pasture.h * fy;
      this.wanderers.push({
        kind,
        x: wx,
        y: wy,
        angle: Math.random() * Math.PI * 2,
        bob: Math.random() * Math.PI * 2,
        homeX: wx,
        homeY: wy,
        tx: wx,
        ty: wy,
        wait: Math.random() * 2,
      });
    }

    // Dirt-road hub between barn yard, garage, and fields
    this.tractor = { x: 1200, y: 800, angle: -Math.PI / 2 };
    this.cam = { x: this.tractor.x, y: this.tractor.y };
    this.camNudge = { x: 0, y: 0 };
    this.moving = false;
    this.bouncePhase = 0;
  }

  /** True if tractor center is inside cell rect expanded by half tractor size. */
  private tractorHitsCell(cx: number, cy: number, cw: number, ch: number): boolean {
    const ex = CELL_HIT_EXPAND;
    const halfW = cw / 2 + ex;
    const halfH = ch / 2 + ex;
    return (
      this.tractor.x >= cx - halfW &&
      this.tractor.x <= cx + halfW &&
      this.tractor.y >= cy - halfH &&
      this.tractor.y <= cy + halfH
    );
  }

  private makeAnimal(
    kind: 'cow' | 'sheep',
    x: number,
    y: number,
    angle: number,
    bob: number,
  ): Animal {
    return {
      kind,
      x,
      y,
      angle,
      fed: false,
      bob,
      homeX: x,
      homeY: y,
      tx: x + (Math.random() - 0.5) * 50,
      ty: y + (Math.random() - 0.5) * 32,
      wait: Math.random() * 2,
    };
  }

  private buildImplementBar(): void {
    this.rebuildImplementBar();
  }

  private buildTractorBar(): void {
    this.tractorChoicesEl.innerHTML = '';
    for (const item of TRACTORS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tractor-btn';
      btn.dataset.id = item.id;
      btn.setAttribute('aria-label', item.label);
      btn.innerHTML = `<img class="tractor-thumb" alt="" src="${item.src}" /><span class="tractor-name">${item.shortLabel}</span>`;
      let lastPtrPick = 0;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        lastPtrPick = performance.now();
        unlockSpeech();
        unlockSfx();
        this.selectTractor(item.id);
      });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (performance.now() - lastPtrPick < 450) return;
        unlockSpeech();
        unlockSfx();
        this.selectTractor(item.id);
      });
      this.tractorChoicesEl.appendChild(btn);
    }
    this.refreshTractorBar();
  }

  private selectTractor(id: TractorId): void {
    if (!TRACTORS.some((t) => t.id === id)) return;
    this.selectedTractor = id;
    this.applySelectedTractor();
    this.refreshTractorBar();
    try {
      localStorage.setItem(TRACTOR_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
    const label = TRACTORS.find((t) => t.id === id)?.label ?? id;
    this.showToast(`Traktor: ${label}`, 1400);
  }

  private applySelectedTractor(): void {
    this.tractorImg = this.tractorImgs[this.selectedTractor] ?? null;
  }

  private refreshTractorBar(): void {
    const buttons = this.tractorChoicesEl.querySelectorAll<HTMLButtonElement>('.tractor-btn');
    buttons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.id === this.selectedTractor);
    });
  }

  private tractorDrawScale(): number {
    return TRACTORS.find((t) => t.id === this.selectedTractor)?.scale ?? 1;
  }


  /** Show all implements; player must pick the correct one for the phase. */
  private rebuildImplementBar(): void {
    this.implementBar.innerHTML = '';
    {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'impl-btn';
      btn.dataset.id = '';
      btn.setAttribute('aria-label', 'Brez priključka');
      btn.innerHTML = '<span class="impl-icon" aria-hidden="true">🔓</span><span class="impl-label">Brez</span>';
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        unlockSpeech();
        unlockSfx();
        this.selectImplement(null);
      });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        unlockSpeech();
        unlockSfx();
        this.selectImplement(null);
      });
      this.implementBar.appendChild(btn);
    }
    for (const item of IMPLEMENTS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'impl-btn';
      btn.dataset.id = item.id;
      btn.setAttribute('aria-label', item.label);
      btn.innerHTML = `<span class="impl-icon" aria-hidden="true">${item.emoji}</span><span class="impl-label">${item.shortLabel}</span>`;
      // pointerdown first so canvas/joystick never steals the tap
      let lastPtrPick = 0;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        lastPtrPick = performance.now();
        unlockSpeech();
        unlockSfx();
        this.selectImplement(item.id);
      });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Skip duplicate after pointerdown; still allow keyboard-activated click
        if (performance.now() - lastPtrPick < 450) return;
        unlockSpeech();
        unlockSfx();
        this.selectImplement(item.id);
      });
      this.implementBar.appendChild(btn);
    }
    this.refreshImplementBarIcons();
    this.refreshImplementBar();
  }

  /** Swap toolbar emoji for small chroma-keyed sprite thumbs when loaded. */
  private refreshImplementBarIcons(): void {
    const buttons = this.implementBar.querySelectorAll<HTMLButtonElement>('.impl-btn');
    buttons.forEach((btn) => {
      const raw = btn.dataset.id ?? '';
      if (!raw) return;
      const id = raw as ImplementId;
      const slot = btn.querySelector('.impl-icon');
      if (!slot) return;
      const img = this.implementImgs[id];
      if (img) {
        const thumb = document.createElement('canvas');
        const tw = 48;
        const th = 48;
        thumb.width = tw;
        thumb.height = th;
        const tctx = thumb.getContext('2d')!;
        const scale = Math.min(tw / img.width, th / img.height) * 0.92;
        const dw = img.width * scale;
        const dh = img.height * scale;
        tctx.drawImage(img, (tw - dw) / 2, (th - dh) / 2, dw, dh);
        const el = document.createElement('img');
        el.src = thumb.toDataURL('image/png');
        el.alt = '';
        el.className = 'impl-thumb';
        slot.replaceChildren(el);
      }
    });
  }

  private selectImplement(id: ImplementId | null): void {
    this.selectedImplement = id;
    this.refreshImplementBar();
    this.refreshGarageButton();
    const needed = this.currentImplement();
    if (id === null) {
      if (needed === null) this.showToast('Brez priključka — pelji na avtopralnico!', 1600);
      else this.showToast('Priključek odklopljen', 1200);
      return;
    }
    const label = IMPLEMENTS.find((i) => i.id === id)?.label ?? id;
    if (id === needed) {
      this.showToast(`${label} priklopljen!`, 1400);
    } else if (needed === null) {
      this.wrongEquipFlash = 1.2;
      sfxWrong();
      this.showToast('Za pranje odklopiti priključek', 1800);
    } else {
      this.wrongEquipFlash = 1.2;
      sfxWrong();
      this.showToast(`Pelji v garažo po pravi priključek`, 1800);
    }
  }

  /** On phase/mission start: rebuild all tools + soft needed hint; keep prior selection. */
  private prepareImplementsForPhase(): void {
    const m = this.currentMission();
    // Wash needs no hitch; sheep hunt allows any hitch — don't strip tools.
    if (this.currentImplement() === null && m.id !== 'sheep') {
      this.selectedImplement = null;
    }
    this.rebuildImplementBar();
    this.refreshImplementBar();
  }

  /** Full game restart after completion. */
  private restartGame(): void {
    this.missionIndex = 0;
    this.phaseIndex = 0;
    this.missionProgress = 0;
    this.completedMissions = 0;
    this.completedIds.clear();
    this.celebrating = false;
    this.gameDone = false;
    this.wrongEquipFlash = 0;
    this.selectedImplement = 'plug';
    this.resetWorldState();
    this.rebuildImplementBar();
    this.updateHud();
    this.announceMission();
    speakSl('Začnimo znova!');
    this.showToast('Začnimo znova!', 1600);
  }

  /** Free mission picker — kids can jump without strict sequence. */
  private buildMissionPicker(): void {
    if (!this.missionPickEl) return;
    this.missionPickEl.innerHTML = '';
    MISSIONS.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${i + 1}. ${m.title}`;
      this.missionPickEl.appendChild(opt);
    });
    this.missionPickEl.value = String(this.missionIndex);
    this.missionPickEl.addEventListener('change', () => {
      unlockSpeech();
      unlockSfx();
      const idx = Number(this.missionPickEl.value);
      if (!Number.isFinite(idx)) return;
      this.jumpToMission(idx);
    });
  }

  /** Jump to any mission (free play). Resets world progress for a clean start. */
  private jumpToMission(index: number): void {
    if (index < 0 || index >= MISSIONS.length) return;
    this.missionIndex = index;
    this.phaseIndex = 0;
    this.missionProgress = 0;
    this.celebrating = false;
    this.gameDone = false;
    this.wrongEquipFlash = 0;
    // Replaying a finished quest clears only that star so ! can return after redo.
    const mid = MISSIONS[index].id;
    this.completedIds.delete(mid);
    this.completedMissions = this.completedIds.size;
    this.resetWorldState();
    const needed = this.currentImplement();
    this.selectedImplement = needed ?? 'plug';
    this.rebuildImplementBar();
    this.updateHud();
    this.announceMission();
    const title = this.currentMission().title;
    this.showToast(`Naloga: ${title}`, 1600);
  }

  private refreshImplementBar(): void {
    const needed = this.currentImplement();
    const buttons = this.implementBar.querySelectorAll<HTMLButtonElement>('.impl-btn');
    buttons.forEach((btn) => {
      const raw = btn.dataset.id ?? '';
      const id = raw === '' ? null : (raw as ImplementId);
      btn.classList.toggle('active', id === this.selectedImplement);
      btn.classList.toggle('needed', id === needed && !this.gameDone);
    });
    this.refreshImplChip();
  }

  private hasCorrectImplement(): boolean {
    const needed = this.currentImplement();
    const m = this.currentMission();
    if (m.id === 'rescue') {
      return this.selectedImplement === 'prikolica' || this.selectedImplement === 'vitla';
    }
    // Sheep hunt: any hitch (or none) is fine — just drive near sheep.
    if (m.id === 'sheep') return true;
    if (needed === null) return this.selectedImplement === null;
    return this.selectedImplement === needed;
  }

  private currentMission(): Mission {
    return MISSIONS[Math.min(this.missionIndex, MISSIONS.length - 1)];
  }

  private currentPhase() {
    const m = this.currentMission();
    return m.phases[Math.min(this.phaseIndex, m.phases.length - 1)];
  }

  private currentImplement(): ImplementId | null {
    return this.currentPhase().implement;
  }

  private announceMission(): void {
    const m = this.currentMission();
    const p = this.currentPhase();
    if (m.id === 'neighbor' || (m.id === 'hay' && p.implement === 'prikolica')) {
      this.ensureNeighborBales();
    }
    speakSl(`${m.title}. ${p.hint}`);
  }

  private updateHud(): void {
    const m = this.currentMission();
    const p = this.currentPhase();
    if (this.gameDone) {
      this.missionTitleEl.textContent = 'Vse naloge so končane! 🎉';
      this.missionHintEl.textContent = 'Odlično delo, kmetiček! Pritisni Začni znova';
      this.restartBtn.classList.add('visible');
      this.restartBtn.hidden = false;
      this.missionNeedIcon.textContent = '★';
      this.missionNeedLabel.textContent = 'Končano';
    } else {
      const phaseNum = m.phases.length > 1 ? ` (${this.phaseIndex + 1}/${m.phases.length})` : '';
      this.missionTitleEl.textContent = `${m.title}${phaseNum}`;
      if (m.id === 'night') {
        const found = this.lostLambs.filter((l) => l.found).length;
        const need = Math.max(1, this.lostLambs.length || FarmGame.NIGHT_LAMB_COUNT);
        this.missionHintEl.textContent = `${p.hint}  (${found}/${need})`;
      } else if (m.id === 'sheep') {
        const found = this.lostSheep.filter((s) => s.found).length;
        const need = Math.max(1, this.lostSheep.length || FarmGame.SHEEP_FIND_COUNT);
        this.missionHintEl.textContent = `${p.hint}  (${found}/${need})`;
      } else if (m.id === 'fill_cistern' && this.phaseIndex === 0) {
        this.missionHintEl.textContent = `${p.hint}  (${Math.round(this.cisternFill * 100)}%)`;
      } else {
        this.missionHintEl.textContent = p.hint;
      }
      this.restartBtn.classList.remove('visible');
      this.restartBtn.hidden = true;
      this.refreshMissionNeed();
    }

    this.starsCountEl.textContent = String(this.completedIds.size || this.completedMissions);
    if (this.missionPickEl) {
      const want = this.gameDone ? String(MISSIONS.length - 1) : String(this.missionIndex);
      if (this.missionPickEl.value !== want) this.missionPickEl.value = want;
      this.missionPickEl.disabled = false;
    }

    const local = this.gameDone ? 1 : this.missionProgress;
    this.progressFill.style.width = `${Math.round(local * 100)}%`;
    if (this.questBangEl) {
      this.questBangEl.textContent = this.gameDone ? '★' : '?';
    }
    this.refreshImplChip();
    this.refreshImplementBar();
    this.refreshGarageButton();
  }

  private refreshImplChip(): void {
    if (!this.implChipIcon || !this.implChipLabel) return;
    const id = this.selectedImplement;
    if (id === null) {
      this.implChipLabel.textContent = 'Brez';
      this.implChipIcon.textContent = '🔓';
      return;
    }
    const meta = IMPLEMENTS.find((i) => i.id === id);
    this.implChipLabel.textContent = meta?.shortLabel ?? id;
    const img = this.implementImgs[id];
    if (img) {
      const thumb = document.createElement('canvas');
      thumb.width = 36;
      thumb.height = 36;
      const tctx = thumb.getContext('2d')!;
      const scale = Math.min(36 / img.width, 36 / img.height) * 0.92;
      const dw = img.width * scale;
      const dh = img.height * scale;
      tctx.drawImage(img, (36 - dw) / 2, (36 - dh) / 2, dw, dh);
      const el = document.createElement('img');
      el.src = thumb.toDataURL('image/png');
      el.alt = '';
      el.className = 'impl-thumb';
      this.implChipIcon.replaceChildren(el);
    } else {
      this.implChipIcon.textContent = meta?.emoji ?? '🔧';
    }
  }

  /** HUD chip: required implement emoji/sprite + name for current phase. */
  private refreshMissionNeed(): void {
    const id = this.currentImplement();
    if (id === null) {
      this.missionNeedLabel.textContent = 'Brez priključka';
      this.missionNeedIcon.textContent = '🧼';
      return;
    }
    const meta = IMPLEMENTS.find((i) => i.id === id);
    this.missionNeedLabel.textContent = meta?.label ?? id;
    const img = this.implementImgs[id];
    if (img) {
      const thumb = document.createElement('canvas');
      const tw = 40;
      const th = 40;
      thumb.width = tw;
      thumb.height = th;
      const tctx = thumb.getContext('2d')!;
      const scale = Math.min(tw / img.width, th / img.height) * 0.92;
      const dw = img.width * scale;
      const dh = img.height * scale;
      tctx.drawImage(img, (tw - dw) / 2, (th - dh) / 2, dw, dh);
      const el = document.createElement('img');
      el.src = thumb.toDataURL('image/png');
      el.alt = '';
      el.className = 'impl-thumb';
      this.missionNeedIcon.replaceChildren(el);
    } else {
      this.missionNeedIcon.textContent = meta?.emoji ?? '🔧';
    }
  }

  private attachNeededFromGarage(): void {
    if (this.gameDone || this.celebrating) return;
    if (!this.nearGarage) {
      this.showToast('Pelji do garaže!', 1400);
      return;
    }
    const needed = this.currentImplement();
    if (this.selectedImplement === needed) {
      if (needed === null) {
        this.showToast('Že brez priključka', 1200);
      } else {
        const label = IMPLEMENTS.find((i) => i.id === needed)?.label ?? needed;
        this.showToast(`${label} je že priklopljen`, 1200);
      }
      return;
    }
    this.selectImplement(needed);
    this.refreshGarageButton();
  }

  private refreshGarageButton(): void {
    const show =
      this.ready &&
      !this.gameDone &&
      !this.celebrating &&
      this.nearGarage;
    this.garageBtn.hidden = !show;
    if (show) {
      const needed = this.currentImplement();
      const already = this.selectedImplement === needed;
      if (needed === null) {
        this.garageBtn.textContent = already
          ? 'Brez priključka ✓'
          : 'Odklop priključka (pranje)';
      } else {
        const label = IMPLEMENTS.find((i) => i.id === needed)?.label ?? needed;
        this.garageBtn.textContent = already
          ? `Priklop: ${label} ✓`
          : `Zamenjaj priključek → ${label}`;
      }
    }
  }

  private updateGarageProximity(): void {
    const g = this.zones.find((z) => z.id === 'garage');
    if (!g) {
      this.nearGarage = false;
      return;
    }
    const cx = g.x + g.w / 2;
    const cy = g.y + g.h / 2;
    const prev = this.nearGarage;
    this.nearGarage = Math.hypot(this.tractor.x - cx, this.tractor.y - cy) < 150;
    if (prev !== this.nearGarage) this.refreshGarageButton();
  }

  /** Mission work zone, or garage when wrong implement attached. */
  private missionArrowTarget(): { x: number; y: number; kind: 'zone' | 'garage' } | null {
    if (this.gameDone || this.celebrating) return null;
    if (!this.hasCorrectImplement()) {
      const g = this.zones.find((z) => z.id === 'garage');
      if (!g) return null;
      return { x: g.x + g.w / 2, y: g.y + g.h / 2, kind: 'garage' };
    }
    const m = this.currentMission();
    if (m.id === 'night') {
      const next = this.nearestUnfoundLamb();
      if (next) return { x: next.x, y: next.y, kind: 'zone' };
    }
    if (m.id === 'sheep') {
      const next = this.lostSheep.find((s) => !s.found);
      if (next) return { x: next.x, y: next.y, kind: 'zone' };
    }
    if (m.id === 'rescue' && !this.stuckTractor.delivered) {
      if (this.stuckTractor.hooked) {
        const yard = this.zones.find((z) => z.id === 'barnYard');
        if (yard) return { x: yard.x + yard.w / 2, y: yard.y + yard.h / 2, kind: 'zone' };
      }
      return { x: this.stuckTractor.x, y: this.stuckTractor.y, kind: 'zone' };
    }
    const zone = this.currentMissionZone();
    if (!zone) return null;
    return { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2, kind: 'zone' };
  }

  private currentMissionZone(): Zone | undefined {
    const m = this.currentMission();
    if (m.id === 'grain') return this.zones.find((z) => z.id === 'rightField');
    if (m.id === 'hay') {
      if (this.currentImplement() === 'prikolica') {
        return this.zones.find((z) => z.id === 'barnYard');
      }
      return this.zones.find((z) => z.id === 'leftField');
    }
    if (m.id === 'gnojnica') return this.zones.find((z) => z.id === 'manureField');
    if (m.id === 'fill_cistern') {
      if (this.phaseIndex === 0) return this.zones.find((z) => z.id === 'slurryTank');
      return this.zones.find((z) => z.id === 'manureField');
    }
    if (m.id === 'koruza') return this.zones.find((z) => z.id === 'cornField');
    if (m.id === 'gozd') {
      if (this.currentImplement() === 'prikolica' && this.trailerLogs > 0) {
        return this.zones.find((z) => z.id === 'barnYard');
      }
      return this.zones.find((z) => z.id === 'forest');
    }
    if (m.id === 'feed') return this.zones.find((z) => z.id === 'openBarn');
    if (m.id === 'wash') return this.zones.find((z) => z.id === 'washBay');
    if (m.id === 'yard') return this.zones.find((z) => z.id === 'barnYard');
    if (m.id === 'night') {
      return undefined; // arrow points at nearest unfound lamb
    }
    if (m.id === 'sheep') {
      const next = this.lostSheep.find((s) => !s.found);
      if (next) return undefined;
      return this.zones.find((z) => z.id === 'nightPaddock');
    }
    if (m.id === 'rescue') {
      if (this.stuckTractor.hooked && !this.stuckTractor.delivered) {
        return this.zones.find((z) => z.id === 'barnYard') ?? this.zones.find((z) => z.id === 'garage');
      }
      return this.zones.find((z) => z.id === 'stuckTractor');
    }
    if (m.id === 'neighbor') return this.zones.find((z) => z.id === 'neighbor');
    return undefined;
  }

  private showToast(text: string, ms = 2200): void {
    this.toastEl.hidden = false;
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.setTimeout(() => {
      this.toastEl.classList.remove('show');
      this.toastEl.hidden = true;
    }, ms);
  }

  private resize(): void {
    const vv = window.visualViewport;
    const layoutW = window.innerWidth;
    const layoutH = window.innerHeight;
    // Prefer visualViewport so mobile browser chrome doesn't inflate height.
    const availW = Math.max(1, Math.floor(vv?.width ?? layoutW));
    const availH = Math.max(1, Math.floor(vv?.height ?? layoutH));

    const cs = getComputedStyle(document.documentElement);
    const safeTop = parseFloat(cs.getPropertyValue('--sat')) || 0;
    const safeBottom = parseFloat(cs.getPropertyValue('--sab')) || 0;
    const safeLeft = parseFloat(cs.getPropertyValue('--sal')) || 0;
    const safeRight = parseFloat(cs.getPropertyValue('--sar')) || 0;

    const padX = Math.max(0, safeLeft) + Math.max(0, safeRight);
    const padY = Math.max(0, safeTop) + Math.max(0, safeBottom);
    let playW = Math.max(1, availW - padX);
    let playH = Math.max(1, availH - padY);

    // Tall narrow phones: letterbox vertically so the game isn't a stretched column.
    const portraitPhone = playW < 900 && playH / playW > MAX_PLAY_ASPECT;
    if (portraitPhone) {
      playH = Math.floor(playW * MAX_PLAY_ASPECT);
    }

    // Position inside #app (not visualViewport offset — HUD is app-relative).
    const offsetX = Math.floor(safeLeft + (availW - padX - playW) / 2);
    const offsetY = Math.floor(safeTop + (availH - padY - playH) / 2);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = playW;
    this.cssH = playH;
    this.canvas.width = Math.floor(playW * dpr);
    this.canvas.height = Math.floor(playH * dpr);
    this.canvas.style.width = `${playW}px`;
    this.canvas.style.height = `${playH}px`;
    this.canvas.style.left = `${offsetX}px`;
    this.canvas.style.top = `${offsetY}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Contain-style zoom inside the letterboxed play area (less cramped on tall phones).
    const scaleH = playH / (MAP_H * VIEW_FRAC);
    const scaleW = playW / (MAP_W * VIEW_FRAC);
    this.viewScale = Math.min(scaleH, scaleW);
    // Never zoom out past a gentle "fit map" floor on tiny screens.
    const fit = Math.min(playW / MAP_W, playH / MAP_H);
    this.viewScale = Math.max(this.viewScale, fit * 1.15);

    const margin = Math.max(18, Math.min(playW, playH) * 0.04);
    const joySafeBottom = Math.max(10, safeBottom * 0.35);
    this.joy.radius = Math.max(52, Math.min(72, Math.min(playW, playH) * 0.11));
    this.joy.baseX = margin + this.joy.radius + 8;
    this.joy.baseY = playH - margin - this.joy.radius - 12 - joySafeBottom;
    if (!this.joy.active) {
      this.joy.knobX = this.joy.baseX;
      this.joy.knobY = this.joy.baseY;
    }

    document.documentElement.style.setProperty('--play-top', `${offsetY}px`);
    document.documentElement.style.setProperty('--play-left', `${offsetX}px`);
    document.documentElement.style.setProperty('--play-w', `${playW}px`);
    document.documentElement.style.setProperty('--play-h', `${playH}px`);
  }

  private clampCamera(cx: number, cy: number): { x: number; y: number } {
    const halfW = this.cssW / (2 * this.viewScale);
    const halfH = this.cssH / (2 * this.viewScale);
    let x = cx;
    let y = cy;
    if (MAP_W > halfW * 2) {
      x = Math.max(halfW, Math.min(MAP_W - halfW, x));
    } else {
      x = MAP_W / 2;
    }
    if (MAP_H > halfH * 2) {
      y = Math.max(halfH, Math.min(MAP_H - halfH, y));
    } else {
      y = MAP_H / 2;
    }
    return { x, y };
  }

  private bindInput(): void {
    const inJoystickZone = (sx: number, sy: number) => {
      const dx = sx - this.joy.baseX;
      const dy = sy - this.joy.baseY;
      return Math.hypot(dx, dy) <= this.joy.radius * 1.85;
    };

    const setKnob = (sx: number, sy: number) => {
      const dx = sx - this.joy.baseX;
      const dy = sy - this.joy.baseY;
      const dist = Math.hypot(dx, dy);
      const max = this.joy.radius * 0.72;
      const clamped = dist > max && dist > 0 ? max / dist : 1;
      this.joy.knobX = this.joy.baseX + dx * clamped;
      this.joy.knobY = this.joy.baseY + dy * clamped;
      this.joy.dx = (this.joy.knobX - this.joy.baseX) / max;
      this.joy.dy = (this.joy.knobY - this.joy.baseY) / max;
      const mag = Math.hypot(this.joy.dx, this.joy.dy);
      if (mag > 1) {
        this.joy.dx /= mag;
        this.joy.dy /= mag;
      }
      if (mag < 0.12) {
        this.joy.dx = 0;
        this.joy.dy = 0;
      }
    };

    this.canvas.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        unlockSpeech();
        unlockSfx();
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const nearJoy =
          inJoystickZone(sx, sy) ||
          (sx < this.cssW * 0.42 && sy > this.cssH * 0.55);
        if (nearJoy) {
          this.joy.active = true;
          this.joy.pointerId = e.pointerId;
          try {
            this.canvas.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          setKnob(sx, sy);
        } else if (this.tryAcceptQuestAtScreen(sx, sy)) {
          // Accepted a ! marker (esp. night/sheep manual accept).
        } else {
          // One-finger drag on empty map nudges camera a bit
          this.pan.active = true;
          this.pan.pointerId = e.pointerId;
          this.pan.lastX = sx;
          this.pan.lastY = sy;
          try {
            this.canvas.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        }
      },
      { passive: false },
    );

    this.canvas.addEventListener(
      'pointermove',
      (e) => {
        if (this.joy.active && e.pointerId === this.joy.pointerId) {
          e.preventDefault();
          const rect = this.canvas.getBoundingClientRect();
          setKnob(e.clientX - rect.left, e.clientY - rect.top);
          return;
        }
        if (this.pan.active && e.pointerId === this.pan.pointerId) {
          e.preventDefault();
          const rect = this.canvas.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          const dx = (sx - this.pan.lastX) / this.viewScale;
          const dy = (sy - this.pan.lastY) / this.viewScale;
          this.pan.lastX = sx;
          this.pan.lastY = sy;
          // Drag moves the view (opposite of finger) — soft nudge only
          this.camNudge.x = Math.max(-120, Math.min(120, this.camNudge.x - dx));
          this.camNudge.y = Math.max(-120, Math.min(120, this.camNudge.y - dy));
        }
      },
      { passive: false },
    );

    const endPointer = (e: PointerEvent) => {
      if (e.pointerId === this.joy.pointerId) {
        this.joy.active = false;
        this.joy.pointerId = -1;
        this.joy.dx = 0;
        this.joy.dy = 0;
        this.joy.knobX = this.joy.baseX;
        this.joy.knobY = this.joy.baseY;
      }
      if (e.pointerId === this.pan.pointerId) {
        this.pan.active = false;
        this.pan.pointerId = -1;
      }
    };

    this.canvas.addEventListener('pointerup', endPointer);
    this.canvas.addEventListener('pointercancel', endPointer);
  }

  private loop(ts: number): void {
    const dt = Math.min(0.05, (ts - this.lastTs) / 1000 || 0);
    this.lastTs = ts;
    this.pulse += dt;
    this.update(dt);
    this.draw();
    requestAnimationFrame((t) => this.loop(t));
  }

  private update(dt: number): void {
    if (this.wrongEquipFlash > 0) this.wrongEquipFlash -= dt;
    if (this.washSfxCd > 0) this.washSfxCd -= dt;
    if (this.slurrySfxCd > 0) this.slurrySfxCd -= dt;
    if (this.questAcceptCd > 0) this.questAcceptCd -= dt;
    if (this.questHintCd > 0) this.questHintCd -= dt;
    // Soft night fade in/out — never slam to full black on accept.
    const wantNight = this.ready && !this.gameDone && this.currentMission().id === 'night';
    const nightSpeed = wantNight ? 0.55 : 1.2;
    this.nightVeil = wantNight
      ? Math.min(1, this.nightVeil + dt * nightSpeed)
      : Math.max(0, this.nightVeil - dt * nightSpeed);

    this.updateAnimals(dt);
    this.updateWanderers(dt);
    this.updateBirds(dt);
    this.updateParticles(dt);
    this.updateGarageProximity();
    this.updateQuestAutoAccept();

    // Ease camera nudge back toward tractor-follow
    if (!this.pan.active) {
      this.camNudge.x += (0 - this.camNudge.x) * Math.min(1, dt * 2.2);
      this.camNudge.y += (0 - this.camNudge.y) * Math.min(1, dt * 2.2);
      if (Math.abs(this.camNudge.x) < 0.3) this.camNudge.x = 0;
      if (Math.abs(this.camNudge.y) < 0.3) this.camNudge.y = 0;
    }

    this.moving = false;

    if (!this.celebrating && !this.gameDone && this.ready) {
      const jx = this.joy.dx;
      const jy = this.joy.dy;
      const mag = Math.hypot(jx, jy);
      if (mag > 0.05) {
        const nx = jx / mag;
        const ny = jy / mag;
        this.tractor.angle = Math.atan2(ny, nx);
        const step = this.speed * dt * Math.min(1, mag);
        this.tractor.x += nx * step;
        this.tractor.y += ny * step;
        this.moving = true;
        this.bouncePhase += dt * 16;

        const m = 40;
        this.tractor.x = Math.max(m, Math.min(MAP_W - m, this.tractor.x));
        this.tractor.y = Math.max(m, Math.min(MAP_H - m, this.tractor.y));

        this.doMissionWork();
      } else if (
        this.currentMission().id === 'wash' &&
        this.hasCorrectImplement()
      ) {
        // Holding in the pond also washes dirt off
        this.workWash();
      }
      this.updateNightLambGlow();
    }

    // Smooth camera follow tractor
    const targetX = this.tractor.x;
    const targetY = this.tractor.y;
    const t = 1 - Math.exp(-CAM_LERP * dt);
    this.cam.x += (targetX - this.cam.x) * t;
    this.cam.y += (targetY - this.cam.y) * t;
    const clamped = this.clampCamera(
      this.cam.x + this.camNudge.x,
      this.cam.y + this.camNudge.y,
    );
    // Soft pull cam toward clamped view center (bounds)
    this.cam.x += (clamped.x - this.camNudge.x - this.cam.x) * Math.min(1, dt * 8);
    this.cam.y += (clamped.y - this.camNudge.y - this.cam.y) * Math.min(1, dt * 8);
  }

  private updateAnimals(dt: number): void {
    for (const a of this.animals) {
      a.bob += dt * 2.2;
      a.wait -= dt;
      if (a.wait <= 0) {
        const dx = a.tx - a.x;
        const dy = a.ty - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 4) {
          a.wait = 1.2 + Math.random() * 2.8;
          const ang = Math.random() * Math.PI * 2;
          const rad = 10 + Math.random() * 22;
          a.tx = a.homeX + Math.cos(ang) * rad;
          a.ty = a.homeY + Math.sin(ang) * rad * 0.7;
          a.tx = Math.max(a.homeX - 28, Math.min(a.homeX + 28, a.tx));
          a.ty = Math.max(a.homeY - 35, Math.min(a.homeY + 35, a.ty));
        } else {
          const speed = 14;
          a.x += (dx / dist) * speed * dt;
          a.y += (dy / dist) * speed * dt;
          a.angle = Math.atan2(dy, dx);
        }
      }
    }
  }

  private updateBirds(dt: number): void {
    for (const b of this.birds) {
      b.phase += dt * 8;
      b.x += b.vx * dt;
      b.y += Math.sin(b.phase * 0.35) * 12 * dt;
      if (b.x > MAP_W + 40) {
        b.x = -40;
        b.y = 60 + Math.random() * 300;
      }
    }
  }

  private updateWanderers(dt: number): void {
    const pasture = this.zones.find((z) => z.id === 'leftField');
    if (!pasture) return;
    const pad = 48;
    const minX = pasture.x + pad;
    const maxX = pasture.x + pasture.w - pad;
    const minY = pasture.y + pad;
    const maxY = pasture.y + pasture.h - pad;
    for (const a of this.wanderers) {
      a.bob += dt * 2.0;
      a.wait -= dt;
      if (a.wait <= 0) {
        const dx = a.tx - a.x;
        const dy = a.ty - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 5) {
          a.wait = 1.5 + Math.random() * 3.5;
          const ang = Math.random() * Math.PI * 2;
          const rad = 40 + Math.random() * 90;
          a.tx = Math.max(minX, Math.min(maxX, a.homeX + Math.cos(ang) * rad));
          a.ty = Math.max(minY, Math.min(maxY, a.homeY + Math.sin(ang) * rad * 0.85));
        } else {
          const speed = 18;
          a.x += (dx / dist) * speed * dt;
          a.y += (dy / dist) * speed * dt;
          a.angle = Math.atan2(dy, dx);
        }
      }
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 40 * dt;
      p.vx *= 0.98;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  private spawnParticles(
    x: number,
    y: number,
    n: number,
    colors: string[],
    speed = 70,
  ): void {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = speed * (0.35 + Math.random() * 0.9);
      const life = 0.35 + Math.random() * 0.55;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 12,
        y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 30,
        life,
        maxLife: life,
        color: colors[i % colors.length],
        size: 2 + Math.random() * 3.5,
      });
    }
    if (this.particles.length > 180) this.particles.splice(0, this.particles.length - 180);
  }

  private doMissionWork(): void {
    if (this.celebrating || this.gameDone) return;
    if (!this.hasCorrectImplement()) {
      if (this.wrongEquipFlash <= 0) {
        this.wrongEquipFlash = 0.8;
        sfxWrong();
      }
      return;
    }
    const m = this.currentMission();
    const impl = this.currentImplement();
    switch (m.id) {
      case 'grain':
        if (impl === 'plug') this.workPlow();
        else if (impl === 'sejalnik') this.workSow();
        break;
      case 'hay':
        if (impl === 'kosilnica') this.workMow();
        else if (impl === 'zgrabljalnik') this.workRake();
        else if (impl === 'balirka') this.workBaleMeadow();
        else if (impl === 'ovijalka') this.workWrapMeadow();
        else if (impl === 'prikolica') this.workHaulHayBales();
        break;
      case 'gnojnica':
        if (impl === 'gnojnica') this.workSlurry();
        break;
      case 'fill_cistern':
        if (impl === 'gnojnica') {
          if (this.phaseIndex === 0) this.workFillCistern();
          else this.workSlurry();
        }
        break;
      case 'koruza':
        if (impl === 'sejalnik') this.workPlantCorn();
        else if (impl === 'kombajn') this.workChopCorn();
        break;
      case 'gozd':
        if (impl === 'vitla') this.workFellTrees();
        else if (impl === 'prikolica') this.workHaulLogs();
        break;
      case 'feed':
        this.workFeed();
        break;
      case 'wash':
        this.workWash();
        break;
      case 'yard':
        if (impl === 'metla') this.workYardSweep();
        break;
      case 'night':
        this.workNightRescue();
        break;
      case 'sheep':
        this.workFindSheep();
        break;
      case 'rescue':
        this.workRescueTractor();
        break;
      case 'neighbor':
        if (impl === 'prikolica') this.workNeighborDelivery();
        break;
    }
  }

  private spawnLostSheep(): void {
    const pad = this.zones.find((z) => z.id === 'nightPaddock');
    const meadow = this.zones.find((z) => z.id === 'leftField');
    const spots: { x: number; y: number }[] = [];
    if (pad) {
      spots.push(
        { x: pad.x + pad.w * 0.25, y: pad.y + pad.h * 0.35 },
        { x: pad.x + pad.w * 0.62, y: pad.y + pad.h * 0.55 },
        { x: pad.x + pad.w * 0.4, y: pad.y + pad.h * 0.78 },
      );
    }
    if (meadow && spots.length < 3) {
      spots.push({ x: meadow.x + meadow.w * 0.5, y: meadow.y + meadow.h * 0.5 });
    }
    while (spots.length < FarmGame.SHEEP_FIND_COUNT) {
      spots.push({ x: 1500 + spots.length * 80, y: 1200 });
    }
    this.lostSheep = spots.slice(0, FarmGame.SHEEP_FIND_COUNT).map((s) => ({
      x: s.x,
      y: s.y,
      found: false,
    }));
  }

  private workFillCistern(): void {
    const tank = this.zones.find((z) => z.id === 'slurryTank');
    if (!tank) return;
    const inTank =
      this.tractor.x > tank.x &&
      this.tractor.x < tank.x + tank.w &&
      this.tractor.y > tank.y &&
      this.tractor.y < tank.y + tank.h;
    if (inTank && this.moving) {
      this.cisternFill = Math.min(1, this.cisternFill + 0.012);
      if (this.slurrySfxCd <= 0) {
        sfxSplash();
        this.slurrySfxCd = 0.28;
      }
    }
    this.missionProgress = this.cisternFill;
    this.updateHud();
    if (this.cisternFill >= 0.98) {
      this.cisternFill = 1;
      this.missionProgress = 1;
      this.completePhase();
    }
  }

  private workFindSheep(): void {
    let found = 0;
    for (const s of this.lostSheep) {
      if (!s.found) {
        const d = Math.hypot(s.x - this.tractor.x, s.y - this.tractor.y);
        if (d < 95) {
          s.found = true;
          sfxFeed();
          this.showToast('Ovca najdena!', 1000);
        }
      }
      if (s.found) found++;
    }
    const need = Math.max(1, this.lostSheep.length);
    this.missionProgress = found / need;
    this.updateHud();
    if (found >= need) this.completePhase();
  }

  private workRescueTractor(): void {
    if (this.stuckTractor.delivered) {
      this.missionProgress = 1;
      this.completePhase();
      return;
    }
    const st = this.stuckTractor;
    const dist = Math.hypot(st.x - this.tractor.x, st.y - this.tractor.y);
    if (!st.hooked) {
      if (dist < 110) {
        st.hooked = true;
        sfxSuccess();
        this.showToast('Priklop! Vleci traktor na dvorišče', 1800);
        speakSl('Priklop! Vleci traktor na dvorišče.');
      }
      this.missionProgress = dist < 200 ? 0.25 : 0.05;
      this.updateHud();
      return;
    }
    // Tow: stuck tractor follows behind player
    const follow = 95;
    const ang = this.tractor.angle + Math.PI;
    const tx = this.tractor.x + Math.cos(ang) * follow;
    const ty = this.tractor.y + Math.sin(ang) * follow;
    st.x += (tx - st.x) * 0.18;
    st.y += (ty - st.y) * 0.18;
    st.angle = this.tractor.angle;
    const yard = this.zones.find((z) => z.id === 'barnYard') ?? this.zones.find((z) => z.id === 'garage');
    if (yard) {
      const inYard =
        st.x > yard.x && st.x < yard.x + yard.w && st.y > yard.y && st.y < yard.y + yard.h;
      const progressDist = Math.hypot(st.x - (yard.x + yard.w / 2), st.y - (yard.y + yard.h / 2));
      this.missionProgress = Math.min(0.95, 0.35 + (1 - Math.min(1, progressDist / 900)) * 0.6);
      if (inYard) {
        st.delivered = true;
        st.hooked = false;
        this.missionProgress = 1;
        this.updateHud();
        this.completePhase();
        return;
      }
    }
    this.updateHud();
  }

  /** Sweep dirty barnYard cells with metla. */
  private workYardSweep(): void {
    let done = 0;
    let justHit = false;
    for (const cell of this.yardCells) {
      if (cell.dirty && this.tractorHitsCell(cell.x, cell.y, cell.w, cell.h)) {
        cell.dirty = false;
        justHit = true;
        this.spawnParticles(cell.x, cell.y, 6, [
          '#efebe9',
          '#d7ccc8',
          '#a1887f',
          '#fffde7',
          '#ffe082',
        ], 50);
      }
      if (!cell.dirty) done++;
    }
    if (justHit && this.washSfxCd <= 0) {
      sfxWash();
      this.washSfxCd = 0.18;
    }
    this.missionProgress = done / Math.max(1, this.yardCells.length);
    this.updateHud();
    if (done >= this.yardCells.length) {
      this.missionProgress = 1;
      this.completePhase();
    }
  }

  /** Night: find multiple lost lambs with headlights (progress N/3). */
  private workNightRescue(): void {
    const need = Math.max(1, this.lostLambs.length);
    for (const lamb of this.lostLambs) {
      if (lamb.found) {
        // Happy bounce near tractor once found (soft follow toward cabin)
        lamb.x += (this.tractor.x - lamb.x) * 0.04;
        lamb.y += (this.tractor.y - 36 - lamb.y) * 0.04;
        lamb.sparkle = Math.max(0, lamb.sparkle - 0.02);
        continue;
      }
      const d = Math.hypot(lamb.x - this.tractor.x, lamb.y - this.tractor.y);
      const lit = this.inHeadlightBeam(lamb.x, lamb.y);
      if (lit) {
        lamb.sparkle = Math.min(1, lamb.sparkle + 0.08);
      } else {
        lamb.sparkle = Math.max(0, lamb.sparkle - 0.04);
      }
      // Find when close; headlights make them glow so kids know where to go
      if (d < 78 && (lit || d < 52)) {
        lamb.found = true;
        lamb.sparkle = 1;
        const count = this.lostLambs.filter((l) => l.found).length;
        this.showToast(`Našel si jagnje! (${count}/${need})`, 1800);
        speakSl('Našel si jagnje!');
        sfxFeed();
      }
    }
    const found = this.lostLambs.filter((l) => l.found).length;
    this.missionProgress = found / need;
    this.updateHud();
    if (found >= need) {
      this.missionProgress = 1;
      this.completePhase();
    }
  }

  /** Soft glow tick even when standing still (headlights aimed at lambs). */
  private updateNightLambGlow(): void {
    if (this.currentMission().id !== 'night' || this.celebrating || this.gameDone) return;
    for (const lamb of this.lostLambs) {
      if (lamb.found) {
        lamb.sparkle = Math.max(0, lamb.sparkle - 0.02);
        continue;
      }
      if (this.inHeadlightBeam(lamb.x, lamb.y)) {
        lamb.sparkle = Math.min(1, lamb.sparkle + 0.08);
      } else {
        lamb.sparkle = Math.max(0, lamb.sparkle - 0.04);
      }
    }
  }

  private spawnNightLambs(): void {
    const count = FarmGame.NIGHT_LAMB_COUNT;
    const nightPad = this.zones.find((z) => z.id === 'nightPaddock');
    const spots: { x: number; y: number }[] = [];
    const tryPlace = (x: number, y: number): boolean => {
      for (const s of spots) {
        if (Math.hypot(s.x - x, s.y - y) < 110) return false;
      }
      spots.push({ x, y });
      return true;
    };
    if (nightPad) {
      // 2 inside paddock, 1 scattered just outside nearby
      for (let i = 0; i < count; i++) {
        for (let attempt = 0; attempt < 40; attempt++) {
          let x: number;
          let y: number;
          if (i < count - 1) {
            x = nightPad.x + 50 + Math.random() * (nightPad.w - 100);
            y = nightPad.y + 50 + Math.random() * (nightPad.h - 100);
          } else {
            // Scatter near paddock edge (outside / fringe)
            const side = Math.floor(Math.random() * 4);
            if (side === 0) {
              x = nightPad.x - 40 - Math.random() * 120;
              y = nightPad.y + Math.random() * nightPad.h;
            } else if (side === 1) {
              x = nightPad.x + nightPad.w + 40 + Math.random() * 120;
              y = nightPad.y + Math.random() * nightPad.h;
            } else if (side === 2) {
              x = nightPad.x + Math.random() * nightPad.w;
              y = nightPad.y - 40 - Math.random() * 100;
            } else {
              x = nightPad.x + Math.random() * nightPad.w;
              y = nightPad.y + nightPad.h + 40 + Math.random() * 80;
            }
            x = Math.max(80, Math.min(MAP_W - 80, x));
            y = Math.max(80, Math.min(MAP_H - 80, y));
          }
          if (tryPlace(x, y)) break;
        }
      }
    }
    while (spots.length < count) {
      tryPlace(1500 + Math.random() * 500, 1180 + Math.random() * 280);
    }
    this.lostLambs = spots.slice(0, count).map((s) => ({
      x: s.x,
      y: s.y,
      found: false,
      sparkle: 0,
    }));
  }

  private nearestUnfoundLamb(): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const lamb of this.lostLambs) {
      if (lamb.found) continue;
      const d = Math.hypot(lamb.x - this.tractor.x, lamb.y - this.tractor.y);
      if (d < bestD) {
        bestD = d;
        best = lamb;
      }
    }
    return best;
  }

  /** True if world point is inside tractor headlight cone. */
  private inHeadlightBeam(px: number, py: number, range = 240, halfAngle = 0.55): boolean {
    const dx = px - this.tractor.x;
    const dy = py - this.tractor.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 42) return true;
    if (dist > range) return false;
    const ang = Math.atan2(dy, dx);
    let diff = ang - this.tractor.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return Math.abs(diff) <= halfAngle;
  }

  /** Neighbor delivery: pick wrapped bales, avoid fence, unload at neighbor. */
  private workNeighborDelivery(): void {
    this.ensureNeighborBales();
    // Pick up wrapped bales
    for (const b of this.bales) {
      if (!b.wrapped) continue;
      if ((b as { hauled?: boolean }).hauled) continue;
      const d = Math.hypot(b.x - this.tractor.x, b.y - this.tractor.y);
      if (d < 70 && this.trailerBales < 4) {
        (b as { hauled?: boolean }).hauled = true;
        this.trailerBales++;
        sfxFeed();
      }
    }
    // Fence bump soft reset of progress feel
    const fence = this.zones.find((z) => z.id === 'fenceCorridor');
    if (fence) {
      const inFenceBand =
        this.tractor.y > fence.y - 8 &&
        this.tractor.y < fence.y + fence.h + 8 &&
        this.tractor.x > fence.x &&
        this.tractor.x < fence.x + fence.w;
      // Stay in corridor center — hitting top/bottom edges "hits fence"
      const cy = fence.y + fence.h / 2;
      if (inFenceBand && Math.abs(this.tractor.y - cy) > fence.h * 0.38) {
        if (this.wrongEquipFlash <= 0) {
          this.wrongEquipFlash = 0.6;
          sfxWrong();
          this.showToast('Pazi ograjo!', 900);
        }
        // Soft push back to center
        this.tractor.y += (cy - this.tractor.y) * 0.08;
      }
    }
    const neigh = this.zones.find((z) => z.id === 'neighbor')!;
    const inN =
      this.tractor.x > neigh.x &&
      this.tractor.x < neigh.x + neigh.w &&
      this.tractor.y > neigh.y &&
      this.tractor.y < neigh.y + neigh.h;
    if (inN && this.trailerBales > 0) {
      this.deliveredBales += this.trailerBales;
      this.trailerBales = 0;
    }
    const need = Math.max(3, this.bales.filter((b) => b.wrapped).length || 3);
    this.missionProgress = Math.min(1, (this.deliveredBales + this.trailerBales * 0.35) / need);
    this.updateHud();
    if (this.deliveredBales >= need) {
      this.missionProgress = 1;
      this.completePhase();
    }
  }

  /** Ensure wrapped bales exist for neighbor / hay haul phases. */
  private ensureNeighborBales(): void {
    const wrapped = this.bales.filter((b) => b.wrapped && !(b as { hauled?: boolean }).hauled);
    if (wrapped.length >= 3) return;
    const meadow = this.zones.find((z) => z.id === 'leftField');
    if (!meadow) return;
    while (this.bales.filter((b) => b.wrapped).length < 3) {
      this.bales.push({
        x: meadow.x + 80 + Math.random() * (meadow.w - 160),
        y: meadow.y + 80 + Math.random() * (meadow.h - 160),
        wrapped: true,
      });
    }
  }

  /** Spread slurry (gnojnica) over manureField cells. */
  private workSlurry(): void {
    let done = 0;
    let justHit = false;
    for (const cell of this.manureCells) {
      if (!cell.manured && this.tractorHitsCell(cell.x, cell.y, cell.w, cell.h)) {
        cell.manured = true;
        justHit = true;
        this.spawnParticles(cell.x, cell.y, 5, [
          '#5d4037',
          '#6d4c41',
          '#4e342e',
          '#8d6e63',
          '#33691e',
        ], 55);
      }
      if (cell.manured) done++;
    }
    if (justHit && this.slurrySfxCd <= 0) {
      sfxSplash();
      this.slurrySfxCd = 0.22;
    }
    this.missionProgress = done / this.manureCells.length;
    this.updateHud();
    if (done >= this.manureCells.length) {
      this.missionProgress = 1;
      this.completePhase();
    }
  }

  private workPlow(): void {
    let done = 0;
    for (const cell of this.fieldCells) {
      if (this.tractorHitsCell(cell.x, cell.y, cell.w, cell.h)) cell.tilled = true;
      if (cell.tilled) done++;
    }
    this.missionProgress = done / this.fieldCells.length;
    this.updateHud();
    if (done >= this.fieldCells.length) {
      this.missionProgress = 1;
      this.completePhase();
    }
  }

  private workSow(): void {
    let sown = 0;
    for (const cell of this.fieldCells) {
      if (!cell.tilled) continue;
      if (this.tractorHitsCell(cell.x, cell.y, cell.w, cell.h)) cell.sown = true;
      if (cell.sown) sown++;
    }
    this.missionProgress = sown / this.fieldCells.length;
    this.updateHud();
    if (sown >= this.fieldCells.length) {
      this.missionProgress = 1;
      this.completePhase();
    }
  }

  private workMow(): void {
    let done = 0;
    for (const cell of this.meadowCells) {
      if (cell.state === 'tall' && this.tractorHitsCell(cell.x, cell.y, cell.w, cell.h)) {
        cell.state = 'cut';
      }
      if (cell.state !== 'tall') done++;
    }
    this.missionProgress = done / this.meadowCells.length;
    this.updateHud();
    if (done >= this.meadowCells.length) this.completePhase();
  }

  private workRake(): void {
    let done = 0;
    for (const cell of this.meadowCells) {
      if (cell.state === 'cut' && this.tractorHitsCell(cell.x, cell.y, cell.w, cell.h)) {
        cell.state = 'windrow';
      }
      if (cell.state === 'windrow' || cell.state === 'baled' || cell.state === 'wrapped') done++;
    }
    this.missionProgress = done / this.meadowCells.length;
    this.updateHud();
    if (done >= this.meadowCells.length) this.completePhase();
  }

  private workBaleMeadow(): void {
    let done = 0;
    for (let i = 0; i < this.meadowCells.length; i++) {
      const cell = this.meadowCells[i];
      if (cell.state === 'windrow' && this.tractorHitsCell(cell.x, cell.y, cell.w, cell.h)) {
        cell.state = 'baled';
        // Sparse bales (~6) so wrapping stays fun for kids
        if (i % 3 === 0) {
          if (!this.bales.some((b) => Math.hypot(b.x - cell.x, b.y - cell.y) < 8)) {
            this.bales.push({ x: cell.x, y: cell.y, wrapped: false });
          }
        }
      }
      if (cell.state === 'baled' || cell.state === 'wrapped') done++;
    }
    this.missionProgress = done / this.meadowCells.length;
    this.updateHud();
    if (done >= this.meadowCells.length) {
      // Ensure at least a few bales exist
      if (this.bales.length === 0) {
        for (let i = 0; i < this.meadowCells.length; i += 3) {
          const c = this.meadowCells[i];
          this.bales.push({ x: c.x, y: c.y, wrapped: false });
        }
      }
      this.completePhase();
    }
  }

  private workPlantCorn(): void {
    let done = 0;
    for (const cell of this.cornCells) {
      if (cell.state === 'empty' && this.tractorHitsCell(cell.x, cell.y, cell.w, cell.h)) {
        cell.state = 'planted';
      }
      if (cell.state !== 'empty') done++;
    }
    this.missionProgress = done / this.cornCells.length;
    this.updateHud();
    if (done >= this.cornCells.length) this.completePhase();
  }

  private workChopCorn(): void {
    let done = 0;
    for (const cell of this.cornCells) {
      if (cell.state === 'planted' && this.tractorHitsCell(cell.x, cell.y, cell.w, cell.h)) {
        cell.state = 'chopped';
        this.silagePile.amount = Math.min(1, this.silagePile.amount + 1 / this.cornCells.length);
        this.spawnParticles(cell.x, cell.y, 10, ['#c8e66a', '#fdd835', '#8bc34a', '#fff59d'], 90);
        sfxChop();
      }
      if (cell.state === 'chopped') done++;
    }
    this.missionProgress = done / this.cornCells.length;
    this.updateHud();
    if (done >= this.cornCells.length) {
      this.silagePile.amount = 1;
      this.completePhase();
    }
  }

  private workFellTrees(): void {
    let done = 0;
    for (const t of this.trees) {
      if (!t.felled) {
        const d = Math.hypot(t.x - this.tractor.x, t.y - this.tractor.y);
        if (d < t.r + 55) {
          t.felled = true;
          t.logOnGround = true;
          this.spawnParticles(t.x, t.y, 14, ['#8d6e63', '#a1887f', '#d7ccc8', '#5d4037', '#2e7d32'], 110);
          sfxFell();
        }
      }
      if (t.felled) done++;
    }
    this.missionProgress = done / this.trees.length;
    this.updateHud();
    if (done >= this.trees.length) this.completePhase();
  }

  private workHaulLogs(): void {
    const need = this.trees.length;
    // Pick up logs near felled trees
    for (const t of this.trees) {
      if (t.logOnGround) {
        const d = Math.hypot(t.x - this.tractor.x, t.y - this.tractor.y);
        if (d < 70) {
          t.logOnGround = false;
          this.trailerLogs++;
        }
      }
    }
    // Unload at barn yard
    const yard = this.zones.find((z) => z.id === 'barnYard')!;
    const inYard =
      this.tractor.x > yard.x &&
      this.tractor.x < yard.x + yard.w &&
      this.tractor.y > yard.y &&
      this.tractor.y < yard.y + yard.h;
    if (inYard && this.trailerLogs > 0) {
      this.deliveredLogs += this.trailerLogs;
      this.trailerLogs = 0;
    }
    const progress = Math.min(need, this.deliveredLogs + this.trailerLogs * 0.35);
    this.missionProgress = progress / need;
    this.updateHud();
    if (this.deliveredLogs >= need) {
      this.missionProgress = 1;
      this.completePhase();
    }
  }

  /** Hay finale: load wrapped bales on trailer → barnYard. */
  private workHaulHayBales(): void {
    for (const b of this.bales) {
      if (!b.wrapped) continue;
      if ((b as { hauled?: boolean }).hauled) continue;
      const d = Math.hypot(b.x - this.tractor.x, b.y - this.tractor.y);
      if (d < 70 && this.trailerBales < 6) {
        (b as { hauled?: boolean }).hauled = true;
        this.trailerBales++;
      }
    }
    const yard = this.zones.find((z) => z.id === 'barnYard')!;
    const inYard =
      this.tractor.x > yard.x &&
      this.tractor.x < yard.x + yard.w &&
      this.tractor.y > yard.y &&
      this.tractor.y < yard.y + yard.h;
    if (inYard && this.trailerBales > 0) {
      this.deliveredBales += this.trailerBales;
      this.trailerBales = 0;
    }
    const need = Math.max(1, this.bales.filter((b) => b.wrapped).length);
    this.missionProgress = Math.min(1, (this.deliveredBales + this.trailerBales * 0.35) / need);
    this.updateHud();
    if (need > 0 && this.deliveredBales >= need) {
      this.missionProgress = 1;
      this.completePhase();
    }
  }

  private workWrapMeadow(): void {
    let wrapped = 0;
    for (const b of this.bales) {
      if (!b.wrapped) {
        const d = Math.hypot(b.x - this.tractor.x, b.y - this.tractor.y);
        if (d < 72) {
          b.wrapped = true;
          const cell = this.meadowCells.find(
            (c) => Math.hypot(c.x - b.x, c.y - b.y) < 8,
          );
          if (cell) cell.state = 'wrapped';
        }
      }
      if (b.wrapped) wrapped++;
    }
    this.missionProgress = wrapped / Math.max(1, this.bales.length);
    this.updateHud();
    if (this.bales.length > 0 && wrapped >= this.bales.length) this.completePhase();
  }

  private workFeed(): void {
    const barn = this.zones.find((z) => z.id === 'openBarn');
    let fed = 0;
    for (const a of this.animals) {
      if (!a.fed) {
        const d = Math.hypot(a.x - this.tractor.x, a.y - this.tractor.y);
        // Wide alley: feed when driving past (Y-aligned) or close enough — cows + sheep
        const alongAlley =
          !!barn &&
          this.tractor.x > barn.x + barn.w * 0.28 &&
          this.tractor.x < barn.x + barn.w * 0.72 &&
          Math.abs(a.y - this.tractor.y) < 70 &&
          Math.abs(a.x - this.tractor.x) < barn.w * 0.55;
        if (d < 120 || alongAlley) {
          a.fed = true;
          sfxFeed();
        }
      }
      if (a.fed) fed++;
    }
    this.missionProgress = fed / this.animals.length;
    this.updateHud();
    if (fed >= this.animals.length) this.completePhase();
  }

  private workWash(): void {
    const bay = this.zones.find((z) => z.id === 'washBay')!;
    const inPond =
      this.tractor.x > bay.x &&
      this.tractor.x < bay.x + bay.w &&
      this.tractor.y > bay.y &&
      this.tractor.y < bay.y + bay.h;
    if (inPond && this.moving) {
      this.tractorDirt = Math.max(0, this.tractorDirt - 0.014);
      if (this.washSfxCd <= 0) {
        sfxWash();
        this.washSfxCd = 0.22;
      }
    }
    this.missionProgress = 1 - this.tractorDirt;
    this.updateHud();
    if (this.tractorDirt <= 0.02) {
      this.tractorDirt = 0;
      this.missionProgress = 1;
      this.completePhase();
    }
  }

  /** Advance phase within mission, or finish the mission. */
  private completePhase(): void {
    if (this.celebrating) return;
    const m = this.currentMission();
    const p = this.currentPhase();
    const lastPhase = this.phaseIndex >= m.phases.length - 1;

    if (!lastPhase) {
      this.celebrating = true;
      this.missionProgress = 1;
      this.updateHud();
      const msg = p.phaseDone ?? 'Faza končana!';
      sfxSuccess();
      this.showToast(msg, 1800);
      speakSl(msg);
      window.setTimeout(() => {
        this.celebrating = false;
        this.phaseIndex++;
        this.missionProgress = 0;
        this.prepareImplementsForPhase();
        this.updateHud();
        this.announceMission();
      }, 1600);
      return;
    }

    this.completeMission();
  }

  private completeMission(): void {
    if (this.celebrating) return;
    this.celebrating = true;
    const m = this.currentMission();
    this.completedIds.add(m.id);
    this.completedMissions = this.completedIds.size;
    this.missionProgress = 1;
    this.updateHud();
    sfxSuccess();
    this.showToast(m.success);
    speakSl(m.success);

    window.setTimeout(() => {
      this.celebrating = false;
      // Prefer next incomplete mission; keep free-pick friendly.
      // Skip manualAccept (night/sheep) when other quests remain so finishing
      // near the paddock does not instantly dump into night / re-loop sheep.
      const prefer = (mm: Mission) => !mm.manualAccept || MISSIONS.every((x) => x.manualAccept || this.completedIds.has(x.id));
      const nextIdx = MISSIONS.findIndex(
        (mm, i) => i > this.missionIndex && !this.completedIds.has(mm.id) && prefer(mm),
      );
      const fallback = MISSIONS.findIndex((mm) => !this.completedIds.has(mm.id) && prefer(mm));
      const anyLeft = MISSIONS.findIndex((mm) => !this.completedIds.has(mm.id));
      const pick = nextIdx >= 0 ? nextIdx : fallback >= 0 ? fallback : anyLeft;
      if (pick >= 0) {
        // Don't call jumpToMission (would clear completedIds / reset world). Soft switch.
        this.missionIndex = pick;
        this.phaseIndex = 0;
        this.missionProgress = 0;
        this.prepareImplementsForPhase();
        this.updateHud();
        this.announceMission();
      } else {
        this.gameDone = true;
        this.completedMissions = MISSIONS.length;
        this.rebuildImplementBar();
        this.updateHud();
        sfxSuccess();
        this.showToast('Hura! Kmetija je urejena! 🌟', 4000);
        speakSl('Hura! Kmetija je urejena!');
      }
    }, 2300);
  }

  private draw(): void {
    const ctx = this.ctx;
    const w = this.cssW;
    const h = this.cssH;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#1a3d1f';
    ctx.fillRect(0, 0, w, h);

    if (!this.ready || !this.mapImg) {
      ctx.fillStyle = '#fff';
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Nalagam kmetijo…', w / 2, h / 2);
      this.drawJoystick(ctx);
      return;
    }

    const camX = this.cam.x + this.camNudge.x;
    const camY = this.cam.y + this.camNudge.y;
    const ox = w / 2 - camX * this.viewScale;
    const oy = h / 2 - camY * this.viewScale;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(this.viewScale, this.viewScale);

    // Full-bleed map art (2400×1600)
    ctx.drawImage(this.mapImg, 0, 0, MAP_W, MAP_H);
    this.drawExpandedZones(ctx);

    this.drawPondShimmer(ctx);
    this.drawWindGrass(ctx);
    this.drawFieldOverlay(ctx);
    this.drawMeadowOverlay(ctx);
    this.drawManureOverlay(ctx);
    this.drawCornOverlay(ctx);
    this.drawForest(ctx);
    this.drawWashBay(ctx);
    this.drawMudPath(ctx);
    this.drawYardDirt(ctx);
    this.drawOpenBarn(ctx);
    this.drawSilagePile(ctx);
    this.drawBarnYardLogs(ctx);
    this.drawNeighborYard(ctx);
    this.drawFenceCorridor(ctx);
    this.drawLostLamb(ctx);
    this.drawHay(ctx);
    this.drawBales(ctx);
    this.drawWanderers(ctx);
    this.drawAnimals(ctx);
    this.drawParticles(ctx);
    this.drawBirds(ctx);
    this.drawMissionHighlight(ctx);
    this.drawQuestMarkers(ctx);
    this.drawLostSheep(ctx);
    this.drawStuckTractor(ctx);
    this.drawTractor(ctx);
    this.drawNightOverlay(ctx);

    ctx.restore();

    this.drawJoystick(ctx);

    if (this.wrongEquipFlash > 0 && !this.hasCorrectImplement() && !this.gameDone) {
      const a = Math.min(1, this.wrongEquipFlash) * 0.35;
      ctx.fillStyle = `rgba(180, 40, 20, ${a})`;
      ctx.fillRect(0, 0, w, 6);
    }
  }

  private drawPondShimmer(ctx: CanvasRenderingContext2D): void {
    const pond = this.zones.find((z) => z.id === 'pond');
    if (!pond) return;
    const cx = pond.x + pond.w * 0.48;
    const cy = pond.y + pond.h * 0.52;
    const t = this.pulse;
    ctx.save();
    for (let i = 0; i < 5; i++) {
      const phase = t * (0.7 + i * 0.15) + i * 1.3;
      const rx = pond.w * (0.18 + i * 0.05) + Math.sin(phase) * 8;
      const ry = pond.h * (0.12 + i * 0.03) + Math.cos(phase * 0.9) * 5;
      const ox = Math.sin(phase * 0.8 + i) * 10;
      const oy = Math.cos(phase * 0.6 + i * 0.5) * 6;
      ctx.strokeStyle = `rgba(180, 230, 255, ${0.1 + (Math.sin(phase) * 0.5 + 0.5) * 0.18})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx + ox, cy + oy, rx, ry, Math.sin(phase) * 0.15, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Specular sparkles
    for (let i = 0; i < 8; i++) {
      const a = t * 1.4 + i * 0.9;
      const px = cx + Math.cos(a) * (pond.w * 0.22) + Math.sin(a * 2.1) * 18;
      const py = cy + Math.sin(a * 0.85) * (pond.h * 0.18);
      const flash = 0.25 + (Math.sin(t * 5 + i) * 0.5 + 0.5) * 0.55;
      ctx.fillStyle = `rgba(255, 255, 255, ${flash * 0.55})`;
      ctx.beginPath();
      ctx.arc(px, py, 1.5 + (i % 3) * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.6 + a * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawWanderers(ctx: CanvasRenderingContext2D): void {
    for (const a of this.wanderers) {
      const bounce = Math.sin(a.bob) * 2;
      if (a.kind === 'sheep') {
        this.drawSheep(ctx, a.x, a.y + bounce, a.angle);
        continue;
      }
      if (!this.cowImg) {
        // Tiny fallback cow blob
        ctx.fillStyle = '#f5f5f5';
        ctx.beginPath();
        ctx.ellipse(a.x, a.y + bounce, 22, 14, a.angle, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#212121';
        ctx.beginPath();
        ctx.ellipse(a.x - 6, a.y + bounce - 2, 6, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const size = COW_DRAW * 0.92;
      ctx.save();
      ctx.globalAlpha = 0.96;
      ctx.translate(a.x, a.y + bounce);
      ctx.rotate(a.angle + Math.PI / 2);
      ctx.drawImage(this.cowImg, -size / 2, -size / 2, size, size * 1.15);
      ctx.restore();
    }
  }

  private drawWindGrass(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = 'rgba(255, 255, 220, 0.12)';
    ctx.lineWidth = 1.5;
    for (const g of this.grassWaves) {
      const sway = Math.sin(this.pulse * 1.6 + g.phase) * 5;
      ctx.beginPath();
      ctx.moveTo(g.x, g.y);
      ctx.quadraticCurveTo(g.x + sway, g.y - 8, g.x + sway * 1.4, g.y - 14);
      ctx.stroke();
    }
  }

  private drawBirds(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = 'rgba(40, 40, 50, 0.45)';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    for (const b of this.birds) {
      const flap = Math.sin(b.phase) * 5;
      ctx.beginPath();
      ctx.moveTo(b.x - 7, b.y + flap * 0.3);
      ctx.quadraticCurveTo(b.x - 3, b.y - 4 - flap, b.x, b.y);
      ctx.quadraticCurveTo(b.x + 3, b.y - 4 - flap, b.x + 7, b.y + flap * 0.3);
      ctx.stroke();
    }
  }

  /** Reserved for light gameplay hints on expanded map (no pad strips — map art is full-bleed). */
  private drawExpandedZones(_ctx: CanvasRenderingContext2D): void {
    // Pad fills / dirt margins removed so the 2400×1600 mapa.png stays visible.
  }

  private drawCornOverlay(ctx: CanvasRenderingContext2D): void {
    const field = this.zones.find((z) => z.id === 'cornField');
    if (!field) return;
    ctx.fillStyle = 'rgba(90, 130, 50, 0.12)';
    ctx.fillRect(field.x, field.y, field.w, field.h);
    ctx.strokeStyle = 'rgba(200, 180, 60, 0.22)';
    ctx.lineWidth = 3;
    ctx.strokeRect(field.x + 2, field.y + 2, field.w - 4, field.h - 4);

    for (let i = 0; i < this.cornCells.length; i++) {
      const cell = this.cornCells[i];
      const rx = cell.x - cell.w / 2 + 2;
      const ry = cell.y - cell.h / 2 + 2;
      const rw = cell.w - 4;
      const rh = cell.h - 4;
      if (cell.state === 'empty') {
        const pulse = 0.4 + Math.sin(this.pulse * 2 + i) * 0.18;
        ctx.fillStyle = `rgba(140, 200, 80, ${pulse})`;
        ctx.fillRect(rx, ry, rw, rh);
      } else if (cell.state === 'planted') {
        ctx.fillStyle = 'rgba(70, 120, 40, 0.55)';
        ctx.fillRect(rx, ry, rw, rh);
        for (let k = 0; k < 3; k++) {
          const px = cell.x - 12 + k * 12;
          ctx.strokeStyle = '#7cb342';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(px, cell.y + 10);
          ctx.quadraticCurveTo(px + 3, cell.y - 8, px - 2, cell.y - 22);
          ctx.stroke();
          ctx.fillStyle = '#fdd835';
          ctx.beginPath();
          ctx.ellipse(px - 2, cell.y - 18, 3.5, 6, -0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = 'rgba(100, 80, 40, 0.45)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.fillStyle = 'rgba(180, 160, 70, 0.5)';
        ctx.beginPath();
        ctx.ellipse(cell.x, cell.y, cell.w * 0.28, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawForest(ctx: CanvasRenderingContext2D): void {
    const forest = this.zones.find((z) => z.id === 'forest');
    if (!forest) return;
    ctx.fillStyle = 'rgba(30, 70, 35, 0.08)';
    ctx.fillRect(forest.x, forest.y, forest.w, forest.h);
    for (const t of this.trees) {
      if (!t.felled) {
        // Soft canopy marker over painted forest (interactive target)
        ctx.fillStyle = 'rgba(20, 60, 30, 0.18)';
        ctx.beginPath();
        ctx.ellipse(t.x + 4, t.y + 10, t.r * 0.9, t.r * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4e342e';
        ctx.fillRect(t.x - 6, t.y - 6, 12, 26);
        ctx.fillStyle = '#1b5e20';
        ctx.beginPath();
        ctx.moveTo(t.x, t.y - t.r - 18);
        ctx.lineTo(t.x + t.r * 0.85, t.y + 4);
        ctx.lineTo(t.x - t.r * 0.85, t.y + 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#2e7d32';
        ctx.beginPath();
        ctx.moveTo(t.x, t.y - t.r - 4);
        ctx.lineTo(t.x + t.r * 0.65, t.y + 2);
        ctx.lineTo(t.x - t.r * 0.65, t.y + 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#66bb6a';
        ctx.beginPath();
        ctx.moveTo(t.x - 4, t.y - t.r * 0.55);
        ctx.lineTo(t.x + t.r * 0.35, t.y - 4);
        ctx.lineTo(t.x - t.r * 0.25, t.y - 2);
        ctx.closePath();
        ctx.fill();
      } else {
        // Cleared canopy disc so the map looks changed
        ctx.fillStyle = 'rgba(90, 70, 40, 0.28)';
        ctx.beginPath();
        ctx.ellipse(t.x, t.y + 2, t.r * 1.05, t.r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        // Stump with rings
        ctx.fillStyle = '#5d4037';
        ctx.beginPath();
        ctx.ellipse(t.x, t.y + 6, 14, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#a1887f';
        ctx.beginPath();
        ctx.ellipse(t.x, t.y + 4, 11, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#6d4c41';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(t.x, t.y + 4, 7, 3.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(t.x, t.y + 4, 3.5, 1.8, 0, 0, Math.PI * 2);
        ctx.stroke();
        // Side bark of stump
        ctx.fillStyle = '#4e342e';
        ctx.beginPath();
        ctx.ellipse(t.x, t.y + 10, 14, 4, 0, 0, Math.PI);
        ctx.fill();
        if (t.logOnGround) {
          // Fallen trunk — long bark cylinder + cut face
          const lx = t.x + 38;
          const ly = t.y + 16;
          ctx.fillStyle = 'rgba(30, 20, 10, 0.25)';
          ctx.beginPath();
          ctx.ellipse(lx + 4, ly + 8, 40, 10, -0.25, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#6d4c41';
          ctx.beginPath();
          ctx.ellipse(lx, ly, 40, 11, -0.25, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#8d6e63';
          ctx.beginPath();
          ctx.ellipse(lx - 2, ly - 2, 34, 8, -0.25, 0, Math.PI * 2);
          ctx.fill();
          // bark ridges
          ctx.strokeStyle = '#5d4037';
          ctx.lineWidth = 1.4;
          for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.ellipse(lx + i * 10, ly - 1, 6, 7, -0.25, -0.4, 0.4);
            ctx.stroke();
          }
          // cut face (lighter wood)
          ctx.fillStyle = '#d7ccc8';
          ctx.beginPath();
          ctx.ellipse(lx - 36, ly + 8, 7, 9, -0.15, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#8d6e63';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(lx - 36, ly + 8, 4, 5, -0.15, 0, Math.PI * 2);
          ctx.stroke();
          // leftover needles tuft
          ctx.fillStyle = '#2e7d32';
          ctx.beginPath();
          ctx.ellipse(lx + 28, ly - 8, 14, 8, -0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#66bb6a';
          ctx.beginPath();
          ctx.ellipse(lx + 32, ly - 10, 8, 5, -0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  private drawMudPath(ctx: CanvasRenderingContext2D): void {
    const mud = this.zones.find((z) => z.id === 'mudPath');
    if (!mud) return;
    ctx.fillStyle = 'rgba(90, 70, 45, 0.22)';
    ctx.beginPath();
    ctx.ellipse(mud.x + mud.w / 2, mud.y + mud.h / 2, mud.w * 0.48, mud.h * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(60, 45, 30, 0.18)';
    for (let i = 0; i < 5; i++) {
      const px = mud.x + 30 + i * 48;
      const py = mud.y + 40 + (i % 2) * 28;
      ctx.beginPath();
      ctx.ellipse(px, py, 18, 10, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawYardDirt(ctx: CanvasRenderingContext2D): void {
    for (const cell of this.yardCells) {
      if (!cell.dirty) continue;
      const rx = cell.x - cell.w / 2 + 3;
      const ry = cell.y - cell.h / 2 + 3;
      ctx.fillStyle = 'rgba(80, 60, 40, 0.35)';
      ctx.fillRect(rx, ry, cell.w - 6, cell.h - 6);
      // litter bits
      ctx.fillStyle = 'rgba(120, 100, 70, 0.55)';
      for (let i = 0; i < 4; i++) {
        const lx = cell.x - 12 + (i % 2) * 18;
        const ly = cell.y - 8 + Math.floor(i / 2) * 14;
        ctx.beginPath();
        ctx.ellipse(lx, ly, 5, 3, i * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255, 193, 7, 0.25)';
      ctx.beginPath();
      ctx.arc(cell.x, cell.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawNeighborYard(ctx: CanvasRenderingContext2D): void {
    const n = this.zones.find((z) => z.id === 'neighbor');
    if (!n) return;
    ctx.fillStyle = 'rgba(120, 160, 90, 0.12)';
    ctx.fillRect(n.x, n.y, n.w, n.h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(n.x + 4, n.y + 4, n.w - 8, n.h - 8);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SOSED', n.x + n.w / 2, n.y + 28);
    // delivered bale stack
    const shown = Math.min(this.deliveredBales, 6);
    for (let i = 0; i < shown; i++) {
      const bx = n.x + 50 + (i % 3) * 55;
      const by = n.y + 70 + Math.floor(i / 3) * 40;
      ctx.fillStyle = '#66bb6a';
      ctx.beginPath();
      ctx.ellipse(bx, by, 18, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawFenceCorridor(ctx: CanvasRenderingContext2D): void {
    const f = this.zones.find((z) => z.id === 'fenceCorridor');
    if (!f) return;
    // Top and bottom fence rails
    ctx.strokeStyle = 'rgba(90, 60, 30, 0.55)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(f.x + f.w, f.y);
    ctx.moveTo(f.x, f.y + f.h);
    ctx.lineTo(f.x + f.w, f.y + f.h);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120, 90, 50, 0.4)';
    ctx.lineWidth = 2;
    for (let x = f.x + 20; x < f.x + f.w; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x, f.y);
      ctx.lineTo(x, f.y + f.h);
      ctx.stroke();
    }
  }

  private drawLostLamb(ctx: CanvasRenderingContext2D): void {
    if (this.currentMission().id !== 'night') return;
    for (let i = 0; i < this.lostLambs.length; i++) {
      const lamb = this.lostLambs[i]!;
      const bob = Math.sin(this.pulse * 3 + i) * 2;
      const lit = !lamb.found && this.inHeadlightBeam(lamb.x, lamb.y);
      ctx.save();
      ctx.translate(lamb.x, lamb.y + bob);

      // Soft glow / sparkle when in headlight beam
      if (lit || lamb.sparkle > 0.05) {
        const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 38);
        const a = 0.25 + lamb.sparkle * 0.45;
        g.addColorStop(0, `rgba(255, 250, 200, ${a})`);
        g.addColorStop(0.45, `rgba(255, 230, 120, ${a * 0.45})`);
        g.addColorStop(1, 'rgba(255, 220, 80, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, 38, 0, Math.PI * 2);
        ctx.fill();
        // Tiny sparkles
        ctx.fillStyle = `rgba(255, 255, 220, ${0.5 + lamb.sparkle * 0.5})`;
        for (let s = 0; s < 5; s++) {
          const sa = this.pulse * 4 + s * 1.3 + i;
          const sr = 18 + Math.sin(sa) * 8;
          ctx.beginPath();
          ctx.arc(Math.cos(sa) * sr, Math.sin(sa * 1.4) * sr * 0.7, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // sheep / lamb body
      ctx.fillStyle = lamb.found ? '#fff8e1' : '#f5f5f5';
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#212121';
      ctx.beginPath();
      ctx.arc(12, -2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(13.5, -3, 1.5, 0, Math.PI * 2);
      ctx.fill();
      if (!lamb.found) {
        ctx.fillStyle = lit ? 'rgba(255, 255, 180, 0.95)' : 'rgba(255, 235, 59, 0.55)';
        ctx.font = '700 14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('?', 0, -20);
      } else {
        ctx.fillStyle = 'rgba(129, 199, 132, 0.95)';
        ctx.font = '700 14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('♥', 0, -18);
      }
      ctx.restore();
    }
  }

  private drawNightOverlay(ctx: CanvasRenderingContext2D): void {
    if (this.gameDone || this.nightVeil <= 0.01) return;
    const ang = this.tractor.angle;
    const tx = this.tractor.x;
    const ty = this.tractor.y;
    const veil = Math.min(1, this.nightVeil) * NIGHT_VEIL_ALPHA;
    // Soft night veil with clear headlight cone + cabin cut out (fades in).
    ctx.save();
    ctx.fillStyle = `rgba(4, 8, 22, ${veil})`;
    ctx.beginPath();
    ctx.rect(0, 0, MAP_W, MAP_H);
    // Wide outer cone hole
    ctx.moveTo(tx, ty);
    ctx.arc(tx, ty, 265, ang - 0.62, ang + 0.62);
    ctx.closePath();
    // Cabin hole
    ctx.moveTo(tx + 52, ty);
    ctx.arc(tx, ty, 52, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill('evenodd');
    ctx.restore();

    // Stars in sky / dark areas (clipped away from bright cone)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, MAP_W, MAP_H);
    ctx.moveTo(tx, ty);
    ctx.arc(tx, ty, 265, ang - 0.62, ang + 0.62);
    ctx.closePath();
    ctx.moveTo(tx + 52, ty);
    ctx.arc(tx, ty, 52, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip('evenodd');
    const starFade = Math.min(1, this.nightVeil);
    for (const st of this.nightStars) {
      const tw = (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.pulse * 2.2 + st.phase))) * starFade;
      ctx.fillStyle = `rgba(230, 240, 255, ${tw})`;
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Clear warm headlight beam (outer soft + bright core)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, this.nightVeil);
    const beam = ctx.createRadialGradient(tx, ty, 8, tx, ty, 250);
    beam.addColorStop(0, 'rgba(255, 250, 210, 0.42)');
    beam.addColorStop(0.35, 'rgba(255, 230, 150, 0.22)');
    beam.addColorStop(1, 'rgba(255, 210, 100, 0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.arc(tx, ty, 250, ang - 0.55, ang + 0.55);
    ctx.closePath();
    ctx.fill();
    // Narrow brighter core beam
    ctx.fillStyle = 'rgba(255, 255, 230, 0.2)';
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.arc(tx, ty, 200, ang - 0.22, ang + 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawWashBay(ctx: CanvasRenderingContext2D): void {
    const bay = this.zones.find((z) => z.id === 'washBay');
    if (!bay) return;
    const cx = bay.x + bay.w / 2;
    const cy = bay.y + bay.h / 2;
    // Painted wash on mapa is enough — no avtopralnica.png overlay.
    if (this.currentMission().id === 'wash' && this.tractorDirt > 0.02) {
      for (let i = 0; i < 6; i++) {
        const bx = cx - 50 + i * 20;
        const by = cy - 10 + Math.sin(this.pulse * 3 + i) * 8;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(bx, by, 5 + (i % 3), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawOpenBarn(ctx: CanvasRenderingContext2D): void {
    const barn = this.zones.find((z) => z.id === 'openBarn');
    if (!barn) return;
    // Roof shadow / open shed
    ctx.fillStyle = 'rgba(90, 70, 50, 0.06)';
    ctx.fillRect(barn.x, barn.y, barn.w, barn.h);
    // Alley
    ctx.fillStyle = 'rgba(180, 160, 110, 0.1)';
    ctx.fillRect(barn.x + barn.w * 0.32, barn.y + 28, barn.w * 0.36, barn.h - 36);
    // Side stalls (4 per side for govedo + ovce)
    ctx.strokeStyle = 'rgba(80, 55, 35, 0.28)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const yy = barn.y + 34 + i * ((barn.h - 48) / 4);
      ctx.strokeRect(barn.x + 8, yy, barn.w * 0.28, 42);
      ctx.strokeRect(barn.x + barn.w * 0.72 - 8, yy, barn.w * 0.28, 42);
    }
  }

  private drawBarnYardLogs(ctx: CanvasRenderingContext2D): void {
    if (this.deliveredLogs <= 0) return;
    const yard = this.zones.find((z) => z.id === 'barnYard');
    if (!yard) return;
    const n = Math.min(this.deliveredLogs, 8);
    for (let i = 0; i < n; i++) {
      const lx = yard.x + 40 + (i % 4) * 40;
      const ly = yard.y + 50 + Math.floor(i / 4) * 28;
      ctx.fillStyle = '#8d6e63';
      ctx.beginPath();
      ctx.ellipse(lx, ly, 20, 7, -0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5d4037';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }

  private drawSilagePile(ctx: CanvasRenderingContext2D): void {
    if (this.silagePile.amount <= 0.02) return;
    const a = this.silagePile.amount;
    const x = this.silagePile.x;
    const y = this.silagePile.y;
    ctx.fillStyle = `rgba(120, 140, 50, ${0.45 + a * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 40 + a * 30, 18 + a * 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(90, 110, 40, 0.6)';
    ctx.beginPath();
    ctx.ellipse(x, y - 6, 28 + a * 20, 10 + a * 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

    private drawFieldOverlay(ctx: CanvasRenderingContext2D): void {
    const field = this.zones.find((z) => z.id === 'rightField')!;
    const cols = 6;
    const rows = 5;
    const cw = field.w / cols;
    const ch = field.h / rows;

    for (let i = 0; i < this.fieldCells.length; i++) {
      const cell = this.fieldCells[i];
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = field.x + c * cw;
      const y = field.y + r * ch;
      const pad = 2;
      const rx = x + pad;
      const ry = y + pad;
      const rw = cw - pad * 2;
      const rh = ch - pad * 2;

      if (cell.sown) {
        // Tilled + sown: brown furrows with tiny sprout stems + leaves
        ctx.fillStyle = 'rgba(92, 58, 28, 0.48)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = 'rgba(55, 32, 14, 0.5)';
        ctx.lineWidth = 1.6;
        for (let k = 0; k < 3; k++) {
          const yy = y + 8 + k * (ch / 3);
          ctx.beginPath();
          ctx.moveTo(x + 4, yy);
          let step = 0;
          for (let px = x + 12; px < x + cw - 4; px += 10) {
            ctx.lineTo(px, yy + (step % 2 === 0 ? 1.2 : -1.2));
            step++;
          }
          ctx.lineTo(x + cw - 4, yy);
          ctx.stroke();
        }
        for (let k = 0; k < 3; k++) {
          const yy = y + 10 + k * (ch / 3);
          for (let sx = 6; sx < cw - 4; sx += 10) {
            const px = x + sx;
            // Stem
            ctx.strokeStyle = 'rgba(100, 160, 50, 0.85)';
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.moveTo(px, yy);
            ctx.lineTo(px, yy - 5);
            ctx.stroke();
            // Twin leaves
            ctx.fillStyle = 'rgba(180, 220, 70, 0.95)';
            ctx.beginPath();
            ctx.ellipse(px - 2.5, yy - 5, 2.4, 1.6, -0.5, 0, Math.PI * 2);
            ctx.ellipse(px + 2.5, yy - 5, 2.4, 1.6, 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (cell.tilled) {
        // Brown plowed soil with shadowed furrow ridges
        ctx.fillStyle = 'rgba(92, 58, 28, 0.55)';
        ctx.fillRect(rx, ry, rw, rh);
        for (let k = 0; k < 4; k++) {
          const yy = y + 6 + k * (ch / 4);
          ctx.strokeStyle = 'rgba(45, 28, 12, 0.55)';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(x + 4, yy + 1);
          ctx.lineTo(x + cw - 4, yy + 1);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(130, 90, 45, 0.4)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(x + 4, yy - 1.5);
          ctx.lineTo(x + cw - 4, yy - 1.5);
          ctx.stroke();
        }
      } else {
        // Untilled leftovers — brighter pulse so kids spot missing squares
        const pulse = 0.32 + Math.sin(this.pulse * 2.4 + i * 0.35) * 0.14;
        ctx.fillStyle = `rgba(120, 210, 90, ${pulse})`;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = `rgba(255, 255, 180, ${0.35 + pulse * 0.35})`;
        ctx.lineWidth = 2.2;
        ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
        // Soft grass blade hints
        ctx.strokeStyle = 'rgba(240, 255, 180, 0.55)';
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        for (let gx = 0; gx < 4; gx++) {
          for (let gy = 0; gy < 3; gy++) {
            const bx = rx + 8 + gx * (rw / 4);
            const by = ry + 10 + gy * (rh / 3);
            const sway = Math.sin(this.pulse * 1.8 + i + gx * 0.7 + gy) * 2;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.quadraticCurveTo(bx + sway, by - 6, bx + sway * 1.2, by - 11);
            ctx.stroke();
          }
        }
      }
    }
  }

  private drawMeadowOverlay(ctx: CanvasRenderingContext2D): void {
    const meadow = this.zones.find((z) => z.id === 'leftField')!;
    const cols = 5;
    const rows = 4;
    const cw = meadow.w / cols;
    const ch = meadow.h / rows;

    for (let i = 0; i < this.meadowCells.length; i++) {
      const cell = this.meadowCells[i];
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = meadow.x + c * cw;
      const y = meadow.y + r * ch;
      const pad = 2;
      const rx = x + pad;
      const ry = y + pad;
      const rw = cw - pad * 2;
      const rh = ch - pad * 2;

      if (cell.state === 'tall') {
        const pulse = 0.28 + Math.sin(this.pulse * 2.2 + i * 0.4) * 0.12;
        ctx.fillStyle = `rgba(70, 170, 70, ${pulse})`;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = `rgba(255, 255, 160, ${0.3 + pulse * 0.4})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
        ctx.strokeStyle = 'rgba(220, 255, 140, 0.55)';
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        for (let gx = 0; gx < 5; gx++) {
          for (let gy = 0; gy < 4; gy++) {
            const bx = rx + 6 + gx * (rw / 5);
            const by = ry + 8 + gy * (rh / 4);
            const sway = Math.sin(this.pulse * 1.7 + i + gx) * 2.5;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.quadraticCurveTo(bx + sway, by - 9, bx + sway * 1.2, by - 16);
            ctx.stroke();
          }
        }
      } else if (cell.state === 'cut') {
        // Short stubble — pulse if still waiting to be raked
        const pulse = 0.45 + Math.sin(this.pulse * 2.1 + i) * 0.15;
        ctx.fillStyle = `rgba(170, 200, 80, ${pulse})`;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = `rgba(255, 240, 150, ${0.25 + pulse * 0.35})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
        ctx.strokeStyle = 'rgba(90, 110, 40, 0.45)';
        ctx.lineWidth = 1.2;
        for (let gx = 0; gx < 6; gx++) {
          for (let gy = 0; gy < 4; gy++) {
            const bx = rx + 5 + gx * (rw / 6);
            const by = ry + 10 + gy * (rh / 4);
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + 0.5, by - 4);
            ctx.stroke();
          }
        }
      } else if (cell.state === 'windrow') {
        ctx.fillStyle = 'rgba(150, 165, 75, 0.35)';
        ctx.fillRect(rx, ry, rw, rh);
        // Windrow mound with straw strand hints
        ctx.fillStyle = '#c9b44a';
        ctx.beginPath();
        ctx.ellipse(cell.x, cell.y, cw * 0.42, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#a89430';
        ctx.beginPath();
        ctx.ellipse(cell.x, cell.y - 2.5, cw * 0.36, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(120, 100, 30, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        for (let s = -3; s <= 3; s++) {
          const sx = cell.x + s * (cw * 0.1);
          ctx.beginPath();
          ctx.moveTo(sx - 3, cell.y + 2);
          ctx.quadraticCurveTo(sx, cell.y - 3, sx + 4, cell.y + 1);
          ctx.stroke();
        }
      }
      // baled / wrapped drawn as bales
    }
  }

  /** Gnojnica splash overlay on manureField (separate from hay meadow). */
  private drawManureOverlay(ctx: CanvasRenderingContext2D): void {
    const field = this.zones.find((z) => z.id === 'manureField');
    if (!field) return;
    const cols = 5;
    const rows = 3;
    const cw = field.w / cols;
    const ch = field.h / rows;

    for (let i = 0; i < this.manureCells.length; i++) {
      const cell = this.manureCells[i];
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = field.x + c * cw;
      const y = field.y + r * ch;
      const pad = 2;
      const rx = x + pad;
      const ry = y + pad;
      const rw = cw - pad * 2;
      const rh = ch - pad * 2;

      if (cell.manured) {
        ctx.fillStyle = 'rgba(62, 48, 28, 0.42)';
        ctx.fillRect(rx, ry, rw, rh);
        const g = ctx.createRadialGradient(
          cell.x - 8,
          cell.y - 6,
          4,
          cell.x,
          cell.y,
          Math.max(rw, rh) * 0.55,
        );
        g.addColorStop(0, 'rgba(110, 90, 40, 0.35)');
        g.addColorStop(0.45, 'rgba(70, 90, 35, 0.28)');
        g.addColorStop(1, 'rgba(45, 55, 25, 0.12)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cell.x, cell.y, rw * 0.42, rh * 0.38, 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(55, 40, 22, 0.55)';
        for (let s = 0; s < 7; s++) {
          const sx = rx + 8 + ((s * 37 + i * 11) % Math.max(8, Math.floor(rw - 16)));
          const sy = ry + 8 + ((s * 53 + i * 17) % Math.max(8, Math.floor(rh - 16)));
          ctx.beginPath();
          ctx.ellipse(sx, sy, 3 + (s % 3), 2 + (s % 2), 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(140, 160, 70, 0.28)';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx + 2, ry + 2, rw - 4, rh - 4);
      } else if (this.currentMission().id === 'gnojnica' && !this.gameDone) {
        const pulse = 0.22 + Math.sin(this.pulse * 2.3 + i * 0.4) * 0.12;
        ctx.fillStyle = `rgba(160, 120, 60, ${pulse})`;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = `rgba(255, 230, 140, ${0.25 + pulse * 0.4})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
      }
    }
  }

  private drawHay(ctx: CanvasRenderingContext2D): void {
    for (const p of this.hayPatches) {
      if (p.baled) continue;
      ctx.fillStyle = '#c8b84a';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r, p.r * 0.65, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a89430';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 4, p.r * 0.7, p.r * 0.4, -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawBales(ctx: CanvasRenderingContext2D): void {
    for (const b of this.bales) {
      if ((b as { hauled?: boolean }).hauled) continue;
      ctx.fillStyle = b.wrapped ? '#43a047' : '#f0b429';
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, 26, 18, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = b.wrapped ? '#1b5e20' : '#c62828';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, 16, 11, 0.2, 0, Math.PI * 2);
      ctx.stroke();
      if (b.wrapped) {
        ctx.strokeStyle = '#a5d6a7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x - 20, b.y);
        ctx.lineTo(b.x + 20, b.y);
        ctx.stroke();
      }
    }
  }

  private drawAnimals(ctx: CanvasRenderingContext2D): void {
    for (const a of this.animals) {
      const bounce = Math.sin(a.bob) * 2.5;
      if (a.kind === 'sheep') {
        this.drawSheep(ctx, a.x, a.y + bounce, a.angle);
        if (a.fed) {
          ctx.font = '20px serif';
          ctx.fillStyle = '#e91e63';
          ctx.fillText('♥', a.x - 7, a.y - SHEEP_DRAW / 2 - 6);
        }
        continue;
      }
      if (!this.cowImg) continue;
      const size = COW_DRAW;
      ctx.save();
      ctx.translate(a.x, a.y + bounce);
      ctx.rotate(a.angle + Math.PI / 2);
      ctx.drawImage(this.cowImg, -size / 2, -size / 2, size, size * 1.15);
      ctx.restore();
      if (a.fed) {
        ctx.font = '22px serif';
        ctx.fillStyle = '#e91e63';
        ctx.fillText('♥', a.x - 8, a.y - size / 2 - 8);
      }
    }
  }

  /** Kids-readable top-down sheep: cream body, dark face. */
  private drawSheep(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
  ): void {
    const size = SHEEP_DRAW;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    // Soft ground oval under sheep
    ctx.fillStyle = 'rgba(20, 30, 20, 0.2)';
    ctx.beginPath();
    ctx.ellipse(0, 6, size * 0.34, size * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    // Fluffy cream body (top-down blob)
    ctx.fillStyle = '#f5f0e1';
    ctx.beginPath();
    ctx.ellipse(0, 2, size * 0.34, size * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ebe4d0';
    ctx.beginPath();
    ctx.ellipse(-size * 0.12, 0, size * 0.16, size * 0.14, -0.3, 0, Math.PI * 2);
    ctx.ellipse(size * 0.12, 0, size * 0.16, size * 0.14, 0.3, 0, Math.PI * 2);
    ctx.ellipse(0, -size * 0.1, size * 0.18, size * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    // Soft highlight on one flank
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.ellipse(-size * 0.1, -size * 0.04, size * 0.1, size * 0.08, -0.4, 0, Math.PI * 2);
    ctx.fill();
    // Dark face toward local +Y (forward)
    ctx.fillStyle = '#3e2723';
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.28, size * 0.14, size * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ears
    ctx.fillStyle = '#4e342e';
    ctx.beginPath();
    ctx.ellipse(-size * 0.16, -size * 0.26, size * 0.06, size * 0.04, -0.5, 0, Math.PI * 2);
    ctx.ellipse(size * 0.16, -size * 0.26, size * 0.06, size * 0.04, 0.5, 0, Math.PI * 2);
    ctx.fill();
    // Eyes
    ctx.fillStyle = '#fff8e1';
    ctx.beginPath();
    ctx.arc(-size * 0.05, -size * 0.3, 2.2, 0, Math.PI * 2);
    ctx.arc(size * 0.05, -size * 0.3, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#212121';
    ctx.beginPath();
    ctx.arc(-size * 0.05, -size * 0.3, 1.1, 0, Math.PI * 2);
    ctx.arc(size * 0.05, -size * 0.3, 1.1, 0, Math.PI * 2);
    ctx.fill();
    // Tiny legs hints (top-down)
    ctx.fillStyle = '#5d4037';
    for (const [lx, ly] of [
      [-size * 0.18, size * 0.18],
      [size * 0.18, size * 0.18],
      [-size * 0.2, size * 0.02],
      [size * 0.2, size * 0.02],
    ] as const) {
      ctx.beginPath();
      ctx.ellipse(lx, ly, 3.2, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** World anchor for a mission's WoW bang / query marker. */
  private missionMarkerPoint(m: Mission): { x: number; y: number } | null {
    if (m.id === 'rescue' && !this.stuckTractor.delivered) {
      return { x: this.stuckTractor.x, y: this.stuckTractor.y - 70 };
    }
    const z = this.zones.find((zz) => zz.id === m.markerZone);
    if (!z) return null;
    return { x: z.x + z.w / 2, y: z.y + 36 };
  }

  /** Approaching a yellow ! auto-accepts that location-tied mission (except manualAccept). */
  private updateQuestAutoAccept(): void {
    if (!this.ready || this.celebrating || this.gameDone) return;
    if (this.questAcceptCd > 0) return;
    const tx = this.tractor.x;
    const ty = this.tractor.y;
    for (let i = 0; i < MISSIONS.length; i++) {
      const m = MISSIONS[i];
      if (this.completedIds.has(m.id)) continue;
      if (i === this.missionIndex) continue; // already active
      const pt = this.missionMarkerPoint(m);
      if (!pt) continue;
      const d = Math.hypot(pt.x - tx, pt.y - ty);
      if (d >= 130) continue;
      // Night / sheep: never hard-accept on mere proximity (avoids sudden blackout).
      if (m.manualAccept) {
        if (this.questHintCd <= 0) {
          this.questHintCd = 4.5;
          this.showToast('Tapni ! ali izberi nalogo v meniju', 1800);
        }
        continue;
      }
      this.questAcceptCd = 2.2;
      this.jumpToMission(i);
      return;
    }
  }

  /** Screen (canvas CSS px) → world coordinates. */
  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const camX = this.cam.x + this.camNudge.x;
    const camY = this.cam.y + this.camNudge.y;
    const ox = this.cssW / 2 - camX * this.viewScale;
    const oy = this.cssH / 2 - camY * this.viewScale;
    return {
      x: (sx - ox) / this.viewScale,
      y: (sy - oy) / this.viewScale,
    };
  }

  /** Tap a yellow ! to accept (required for night/sheep; optional for others). */
  private tryAcceptQuestAtScreen(sx: number, sy: number): boolean {
    if (!this.ready || this.celebrating || this.gameDone) return false;
    const world = this.screenToWorld(sx, sy);
    let bestI = -1;
    let bestD = 78; // world px tap radius around marker
    for (let i = 0; i < MISSIONS.length; i++) {
      const m = MISSIONS[i];
      if (this.completedIds.has(m.id)) continue;
      if (i === this.missionIndex) continue;
      const pt = this.missionMarkerPoint(m);
      if (!pt) continue;
      const d = Math.hypot(pt.x - world.x, pt.y - world.y);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    if (bestI < 0) return false;
    this.questAcceptCd = 2.2;
    this.jumpToMission(bestI);
    return true;
  }

  /** WoW-style yellow ! (available) and ? (in progress). */
  private drawQuestMarkers(ctx: CanvasRenderingContext2D): void {
    if (this.gameDone) return;
    const bob = Math.sin(this.pulse * 3.2) * 6;
    for (let i = 0; i < MISSIONS.length; i++) {
      const m = MISSIONS[i];
      if (this.completedIds.has(m.id)) continue;
      const pt = this.missionMarkerPoint(m);
      if (!pt) continue;
      const active = i === this.missionIndex;
      const glyph = active ? '?' : '!';
      const x = pt.x;
      const y = pt.y + bob;
      ctx.save();
      // Stem / pin
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(x, y + 28, 10, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // Yellow disc
      ctx.fillStyle = '#ffd54f';
      ctx.strokeStyle = '#f9a825';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#5d4037';
      ctx.font = 'bold 28px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, x, y + 1);
      // Soft glow
      ctx.globalAlpha = 0.35 + 0.2 * Math.sin(this.pulse * 4);
      ctx.strokeStyle = '#fff59d';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, 28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawLostSheep(ctx: CanvasRenderingContext2D): void {
    if (this.currentMission().id !== 'sheep' && !this.lostSheep.some((s) => !s.found)) {
      // Still draw unfound sheep lightly if mission not active? Only when sheep mission or nearby.
    }
    const show = this.currentMission().id === 'sheep' || !this.completedIds.has('sheep');
    if (!show) return;
    for (const s of this.lostSheep) {
      if (s.found && this.currentMission().id !== 'sheep') continue;
      ctx.save();
      ctx.globalAlpha = s.found ? 0.35 : 1;
      this.drawSheep(ctx, s.x, s.y, 0.2 + Math.sin(this.pulse + s.x) * 0.05);
      if (!s.found) {
        ctx.fillStyle = 'rgba(255, 235, 59, 0.55)';
        ctx.beginPath();
        ctx.arc(s.x, s.y - 40, 8 + Math.sin(this.pulse * 4) * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawStuckTractor(ctx: CanvasRenderingContext2D): void {
    if (this.completedIds.has('rescue') && this.stuckTractor.delivered) return;
    const st = this.stuckTractor;
    if (st.delivered && this.currentMission().id !== 'rescue') return;
    ctx.save();
    ctx.translate(st.x, st.y);
    ctx.rotate(st.angle);
    const size = TRACTOR_DRAW * 0.92;
    // Simple red/orange "other" tractor (distinct from player sprites)
    ctx.fillStyle = '#ef6c00';
    roundRectPath(ctx, -size * 0.42, -size * 0.22, size * 0.84, size * 0.4, 8);
    ctx.fill();
    ctx.fillStyle = '#37474f';
    roundRectPath(ctx, -size * 0.12, -size * 0.42, size * 0.38, size * 0.28, 6);
    ctx.fill();
    ctx.fillStyle = '#212121';
    ctx.beginPath();
    ctx.ellipse(-size * 0.28, size * 0.22, size * 0.16, size * 0.16, 0, 0, Math.PI * 2);
    ctx.ellipse(size * 0.3, size * 0.22, size * 0.2, size * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    if (st.hooked) {
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(size * 0.45, 0);
      ctx.lineTo(size * 0.85, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawMissionHighlight(ctx: CanvasRenderingContext2D): void {
    if (this.gameDone) return;
    const target = this.missionArrowTarget();
    const alpha = 0.35 + 0.25 * Math.sin(this.pulse * 3.5);

    if (target?.kind === 'garage') {
      const g = this.zones.find((z) => z.id === 'garage');
      if (g) {
        ctx.strokeStyle = `rgba(100, 181, 246, ${alpha})`;
        ctx.lineWidth = 8;
        ctx.setLineDash([14, 10]);
        roundRectPath(ctx, g.x, g.y, g.w, g.h, 20);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(33, 150, 243, ${0.12 + 0.08 * Math.sin(this.pulse * 3.5)})`;
        roundRectPath(ctx, g.x, g.y, g.w, g.h, 20);
        ctx.fill();
        ctx.font = 'bold 22px system-ui, sans-serif';
        ctx.fillStyle = `rgba(227, 242, 253, ${0.75 + 0.2 * Math.sin(this.pulse * 3)})`;
        ctx.textAlign = 'center';
        ctx.fillText('GARAŽA', g.x + g.w / 2, g.y + 28);
      }
    } else {
      const zone = this.currentMissionZone();
      if (zone) {
        ctx.strokeStyle = `rgba(255, 235, 59, ${alpha})`;
        ctx.lineWidth = 8;
        ctx.setLineDash([18, 12]);
        roundRectPath(ctx, zone.x, zone.y, zone.w, zone.h, 24);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    this.drawMissionArrow(ctx);
  }

  /** World-space chevron from tractor toward zone (or garage if wrong tool). */
  private drawMissionArrow(ctx: CanvasRenderingContext2D): void {
    const target = this.missionArrowTarget();
    if (!target) return;
    const { x: tx, y: ty } = this.tractor;
    const dx = target.x - tx;
    const dy = target.y - ty;
    const dist = Math.hypot(dx, dy);
    if (dist < 70) return;

    const ang = Math.atan2(dy, dx);
    // Float just ahead of tractor toward goal
    const reach = Math.min(95, dist * 0.35);
    const ax = tx + Math.cos(ang) * reach;
    const ay = ty + Math.sin(ang) * reach;
    const pulse = 0.75 + 0.25 * Math.sin(this.pulse * 5);
    const toGarage = target.kind === 'garage';

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.globalAlpha = pulse;

    // Stem
    ctx.strokeStyle = toGarage ? '#64b5f6' : '#ffee58';
    ctx.fillStyle = toGarage ? '#42a5f5' : '#fdd835';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(10, 0);
    ctx.stroke();

    // Chevron head
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(2, -14);
    ctx.lineTo(2, -5);
    ctx.lineTo(-16, -5);
    ctx.lineTo(-16, 5);
    ctx.lineTo(2, 5);
    ctx.lineTo(2, 14);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = toGarage ? '#1565c0' : '#f9a825';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();

    // Small ring at destination
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.25 * Math.sin(this.pulse * 4);
    ctx.strokeStyle = toGarage ? '#64b5f6' : '#ffee58';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(target.x, target.y, 22 + Math.sin(this.pulse * 3) * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawTractor(ctx: CanvasRenderingContext2D): void {
    const { x, y, angle } = this.tractor;
    const size = TRACTOR_DRAW * this.tractorDrawScale();
    const bounce = this.moving ? Math.sin(this.bouncePhase) * 1.6 : 0;
    // Hitch pin on centerline, short gap behind rear axle (same math for all).
    const rear = -size * 0.42;

    // Soft ground shadow under chassis only (no body-covering blob).
    ctx.save();
    ctx.translate(x, y + 10);
    ctx.rotate(angle - Math.PI / 2);
    ctx.fillStyle = 'rgba(20, 30, 20, 0.22)';
    ctx.beginPath();
    ctx.ellipse(0, 2, size * 0.34, size * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y + bounce);
    // Travel angle → local +Y forward.
    ctx.rotate(angle - Math.PI / 2);

    // Hitch behind on local −Y (centered); drawn under tractor body.
    this.drawImplement(ctx, size, rear);

    if (this.tractorImg) {
      ctx.save();
      // Iso / three-quarter hood → local +Y forward.
      const spriteBaseRot = Math.PI / 2;
      ctx.rotate(spriteBaseRot);
      const iw = this.tractorImg.width || size;
      const ih = this.tractorImg.height || size;
      const aspect = iw / Math.max(1, ih);
      const drawH = size * 1.02;
      const drawW = drawH * Math.min(1.28, Math.max(1.0, aspect));
      ctx.drawImage(this.tractorImg, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    } else {
      // Fallback clear Deutz green (no covering blob).
      const green = '#3f8f3a';
      const dark = '#2a6628';
      ctx.fillStyle = green;
      roundRectPath(ctx, -26, -40, 52, 78, 8);
      ctx.fill();
      ctx.fillStyle = dark;
      roundRectPath(ctx, -26, -40, 10, 78, 4);
      ctx.fill();
      ctx.fillStyle = '#f5f5f5';
      roundRectPath(ctx, -18, -6, 36, 10, 3);
      ctx.fill();
      ctx.fillStyle = '#263238';
      roundRectPath(ctx, -20, -2, 40, 34, 5);
      ctx.fill();
      ctx.fillStyle = '#81d4fa';
      roundRectPath(ctx, -16, 4, 32, 18, 3);
      ctx.fill();
      // wheels hint
      ctx.fillStyle = '#212121';
      ctx.beginPath();
      ctx.ellipse(-28, 18, 10, 14, 0, 0, Math.PI * 2);
      ctx.ellipse(28, 18, 10, 14, 0, 0, Math.PI * 2);
      ctx.ellipse(-24, -22, 7, 10, 0, 0, Math.PI * 2);
      ctx.ellipse(24, -22, 7, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Dirt: subtle mud ONLY near wheels (α ≤ 0.12) — never cabin/hood blob.
    if (this.tractorDirt > 0.02) {
      const a = Math.min(0.12, 0.03 + this.tractorDirt * 0.08);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = '#5d4037';
      ctx.beginPath();
      // rear wheels (local −Y = hitch/rear)
      ctx.ellipse(-size * 0.28, -size * 0.16, 9, 5, 0.2, 0, Math.PI * 2);
      ctx.ellipse(size * 0.28, -size * 0.16, 9, 5, -0.2, 0, Math.PI * 2);
      ctx.ellipse(-size * 0.22, -size * 0.26, 7, 4, 0.1, 0, Math.PI * 2);
      ctx.ellipse(size * 0.22, -size * 0.26, 7, 4, -0.1, 0, Math.PI * 2);
      // front wheels (local +Y)
      ctx.ellipse(-size * 0.2, size * 0.28, 6.5, 3.8, 0.15, 0, Math.PI * 2);
      ctx.ellipse(size * 0.2, size * 0.28, 6.5, 3.8, -0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  /** Hitch implement behind tractor (local −Y) or FRONT for metla (+Y). */
  private drawImplement(ctx: CanvasRenderingContext2D, size: number, rear = -size * 0.42): void {
    const id = this.selectedImplement;
    if (!id) return;
    const tune = this.hitchTune[id];
    const front = !!tune.front;
    const pin = front ? size * 0.48 : rear;

    ctx.save();
    ctx.globalAlpha = 0.98;

    // Soft shadow under implement only (ground contact).
    ctx.save();
    ctx.fillStyle = 'rgba(20, 30, 20, 0.16)';
    const shadowLen =
      id === 'kombajn'
        ? size * 1.0
        : id === 'prikolica' || id === 'gnojnica'
          ? size * 0.65
          : size * 0.4;
    const shadowW =
      id === 'kosilnica' || id === 'kombajn' ? size * 0.32 : size * 0.24;
    ctx.beginPath();
    ctx.ellipse(0, pin - (front ? -1 : 1) * shadowLen * 0.4, shadowW, size * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Short centerline tongue (rear only); front mounts sit on nose pin
    if (!front) {
      ctx.strokeStyle = '#455a64';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.02);
      ctx.lineTo(0, pin);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(176, 190, 197, 0.5)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(-1.1, -size * 0.015);
      ctx.lineTo(-1.1, pin + 1);
      ctx.stroke();
    }
    // Hitch pin on centerline
    ctx.fillStyle = '#78909c';
    ctx.beginPath();
    ctx.arc(0, pin, 3.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#37474f';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.arc(0, pin, 3.0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#cfd8dc';
    ctx.beginPath();
    ctx.arc(0, pin, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // Implement relative to hitch pin
    ctx.translate(0, pin);

    const s = tune.scale;
    const longAxis = size * s;
    ctx.rotate(tune.rot);
    ctx.translate((tune.offsetX ?? 0) * longAxis, tune.offsetY * longAxis);

    const img = this.implementImgs[id];
    if (img) {
      // Real photo sprites: image +X → local +Y (toward tractor) via +90°.
      // Hitch must sit on pin: hitch-RIGHT PNGs use -drawW origin; hitch-LEFT + flip use +x extent.
      if (tune.flip) ctx.scale(-1, 1);
      ctx.rotate(Math.PI / 2);
      if (front) ctx.rotate(Math.PI);
      const iw = img.width || 1;
      const ih = img.height || 1;
      const maxDim = Math.max(iw, ih);
      const drawW = size * s * (iw / maxDim) * 1.25;
      const drawH = size * s * (ih / maxDim) * 1.25;
      if (tune.flip) {
        // After scale(-1,1), +x draw puts PNG left (hitch) on pin and body in −Y / forward.
        ctx.drawImage(img, -size * 0.06, -drawH / 2, drawW, drawH);
      } else {
        ctx.drawImage(img, -drawW + size * 0.06, -drawH / 2, drawW, drawH);
      }
    } else {
      ctx.scale(s, s);
      if (front) ctx.rotate(Math.PI);
      this.drawFallbackImplement(ctx, id);
    }

    ctx.restore();
  }

  /**
   * Kids-game canvas icons when no PNG is available.
   * Hitch pin at (0,0); tongue toward +Y (tractor); body trails in -Y.
   * Drawn at ~unit size; hitchTune.scale applied by caller.
   */
  private drawFallbackImplement(ctx: CanvasRenderingContext2D, id: ImplementId): void {
    // Short A-frame at hitch pin (toward tractor = +Y, body = −Y)
    ctx.strokeStyle = "#37474f";
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(0, -6);
    ctx.stroke();
    ctx.fillStyle = "#607d8b";
    ctx.beginPath();
    ctx.moveTo(0, 3);
    ctx.lineTo(-8, -8);
    ctx.lineTo(8, -8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#b0bec5";
    ctx.beginPath();
    ctx.arc(0, 4, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#546e7a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-7, 2);
    ctx.lineTo(-4, -8);
    ctx.moveTo(7, 2);
    ctx.lineTo(4, -8);
    ctx.stroke();

    const wheel = (x: number, y: number, r: number) => {
      ctx.fillStyle = "#212121";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#37474f";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = "#90a4ae";
      ctx.beginPath();
      ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#546e7a";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.6, y);
      ctx.lineTo(x + r * 0.6, y);
      ctx.moveTo(x, y - r * 0.6);
      ctx.lineTo(x, y + r * 0.6);
      ctx.stroke();
    };
    if (id === "krmilnik") {
      ctx.fillStyle = "#5d4037";
      roundRectPath(ctx, -30, -44, 60, 32, 6);
      ctx.fill();
      ctx.fillStyle = "#8d6e63";
      roundRectPath(ctx, -28, -42, 56, 8, 3);
      ctx.fill();
      ctx.strokeStyle = "#3e2723";
      ctx.lineWidth = 2;
      roundRectPath(ctx, -30, -44, 60, 32, 6);
      ctx.stroke();
      ctx.fillStyle = "#6d4c41";
      roundRectPath(ctx, -30, -44, 5, 32, 2);
      ctx.fill();
      roundRectPath(ctx, 25, -44, 5, 32, 2);
      ctx.fill();
      ctx.fillStyle = "#c5e1a5";
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.ellipse(i * 10, -28, 8, 5, -0.1 * i, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#ffeb3b";
      for (const [cx, cy] of [[-14, -34], [-2, -36], [10, -33], [18, -35]] as const) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, 3.2, 2.2, 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      wheel(-18, -8, 7.5);
      wheel(18, -8, 7.5);
      return;
    }
    if (id === "sejalnik") {
      ctx.fillStyle = "#b71c1c";
      roundRectPath(ctx, -26, -16, 52, 18, 4);
      ctx.fill();
      ctx.fillStyle = "#c62828";
      ctx.beginPath();
      ctx.moveTo(-18, -14);
      ctx.lineTo(-12, -40);
      ctx.lineTo(12, -40);
      ctx.lineTo(18, -14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ef5350";
      ctx.beginPath();
      ctx.moveTo(-10, -40);
      ctx.lineTo(-6, -48);
      ctx.lineTo(6, -48);
      ctx.lineTo(10, -40);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffcdd2";
      roundRectPath(ctx, -8, -46, 16, 4, 2);
      ctx.fill();
      ctx.fillStyle = "#fdd835";
      roundRectPath(ctx, -22, -18, 44, 5, 2);
      ctx.fill();
      for (let i = -2; i <= 2; i++) {
        const x = i * 9;
        ctx.strokeStyle = "#37474f";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, -2);
        ctx.lineTo(x, 10);
        ctx.stroke();
        ctx.fillStyle = "#78909c";
        ctx.beginPath();
        ctx.arc(x, 12, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffeb3b";
        ctx.beginPath();
        ctx.arc(x, 12, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      wheel(-20, -2, 6.5);
      wheel(20, -2, 6.5);
      return;
    }
    if (id === "kosilnica") {
      ctx.fillStyle = "#1b5e20";
      roundRectPath(ctx, -36, -26, 72, 20, 5);
      ctx.fill();
      ctx.fillStyle = "#43a047";
      roundRectPath(ctx, -34, -24, 68, 10, 3);
      ctx.fill();
      ctx.fillStyle = "#fdd835";
      roundRectPath(ctx, -10, -28, 20, 5, 2);
      ctx.fill();
      for (let i = -2; i <= 2; i++) {
        const bx = i * 13;
        ctx.fillStyle = "#90a4ae";
        ctx.beginPath();
        ctx.arc(bx, -6, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#cfd8dc";
        ctx.beginPath();
        ctx.arc(bx, -6, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#eceff1";
        ctx.beginPath();
        ctx.moveTo(bx, -6);
        ctx.lineTo(bx + 10, -3);
        ctx.lineTo(bx + 3, 1);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(bx, -6);
        ctx.lineTo(bx - 10, 0);
        ctx.lineTo(bx - 3, -3);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#37474f";
        ctx.beginPath();
        ctx.arc(bx, -6, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#263238";
      roundRectPath(ctx, -38, 2, 12, 4, 2);
      ctx.fill();
      roundRectPath(ctx, 26, 2, 12, 4, 2);
      ctx.fill();
      wheel(-22, -4, 5.5);
      wheel(22, -4, 5.5);
      return;
    }
    if (id === "zgrabljalnik") {
      ctx.fillStyle = "#b71c1c";
      roundRectPath(ctx, -6, -34, 12, 28, 3);
      ctx.fill();
      ctx.fillStyle = "#fdd835";
      roundRectPath(ctx, -16, -36, 32, 9, 3);
      ctx.fill();
      ctx.strokeStyle = "#c62828";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, -2, 26, Math.PI * 0.08, Math.PI * 0.92);
      ctx.stroke();
      ctx.strokeStyle = "#ffc107";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, -2, 17, Math.PI * 0.12, Math.PI * 0.88);
      ctx.stroke();
      for (let i = 0; i < 11; i++) {
        const a = Math.PI * 0.12 + i * 0.07;
        const x0 = Math.cos(a) * 15;
        const y0 = -2 + Math.sin(a) * 15;
        const x1 = Math.cos(a) * 28;
        const y1 = -2 + Math.sin(a) * 28;
        ctx.strokeStyle = "#8e0000";
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.fillStyle = "#ffe082";
        ctx.beginPath();
        ctx.arc(x1, y1, 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#37474f";
      ctx.beginPath();
      ctx.arc(0, -2, 5, 0, Math.PI * 2);
      ctx.fill();
      wheel(-12, 2, 5.5);
      wheel(12, 2, 5.5);
      return;
    }
    if (id === "metla") {
      // Rotary broom: yellow brush cylinder + dark hood
      ctx.fillStyle = "#263238";
      roundRectPath(ctx, -28, -18, 56, 14, 4);
      ctx.fill();
      ctx.fillStyle = "#fdd835";
      roundRectPath(ctx, -30, -8, 60, 16, 6);
      ctx.fill();
      for (let i = -6; i <= 6; i++) {
        ctx.strokeStyle = i % 2 === 0 ? "#f9a825" : "#ffee58";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(i * 4.2, -6);
        ctx.lineTo(i * 4.2, 10);
        ctx.stroke();
      }
      ctx.fillStyle = "#455a64";
      ctx.fillRect(-4, -34, 8, 18);
      wheel(-16, 8, 5);
      wheel(16, 8, 5);
      wheel(0, 10, 4.5);
      return;
    }
    if (id === "silazer") {
      ctx.fillStyle = "#33691e";
      roundRectPath(ctx, -30, -42, 60, 30, 6);
      ctx.fill();
      ctx.fillStyle = "#fdd835";
      roundRectPath(ctx, -12, -48, 24, 8, 3);
      ctx.fill();
      wheel(-18, 2, 7);
      wheel(18, 2, 7);
      return;
    }
    if (id === "kombajn") {
      const fill = Math.max(0, Math.min(1, this.silagePile.amount));
      ctx.fillStyle = "#37474f";
      roundRectPath(ctx, -42, -30, 84, 18, 4);
      ctx.fill();
      for (let i = -3; i <= 3; i++) {
        ctx.fillStyle = "#90a4ae";
        ctx.beginPath();
        ctx.arc(i * 11, -21, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#263238";
        ctx.beginPath();
        ctx.arc(i * 11, -21, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#2e7d32";
      roundRectPath(ctx, -34, -66, 68, 38, 8);
      ctx.fill();
      ctx.fillStyle = "#1b5e20";
      roundRectPath(ctx, -34, -66, 10, 38, 4);
      ctx.fill();
      ctx.fillStyle = "#cfd8dc";
      roundRectPath(ctx, -14, -80, 26, 16, 4);
      ctx.fill();
      ctx.fillStyle = "#81d4fa";
      roundRectPath(ctx, -10, -76, 18, 10, 3);
      ctx.fill();
      ctx.fillStyle = "#fdd835";
      roundRectPath(ctx, -30, -68, 14, 5, 2);
      ctx.fill();
      roundRectPath(ctx, 16, -68, 14, 5, 2);
      ctx.fill();
      ctx.strokeStyle = "#f9a825";
      ctx.lineWidth = 5.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(16, -50);
      ctx.quadraticCurveTo(48, -74, 12, -104);
      ctx.stroke();
      ctx.fillStyle = "#ffee58";
      ctx.beginPath();
      ctx.moveTo(4, -100);
      ctx.lineTo(20, -110);
      ctx.lineTo(2, -114);
      ctx.closePath();
      ctx.fill();
      wheel(-22, -14, 8);
      wheel(22, -14, 8);
      wheel(-16, -42, 6);
      wheel(16, -42, 6);
      ctx.strokeStyle = "#455a64";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, -66);
      ctx.lineTo(0, -98);
      ctx.stroke();
      ctx.fillStyle = "#90a4ae";
      ctx.beginPath();
      ctx.arc(0, -100, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(0, -132);
      ctx.fillStyle = "#f9a825";
      roundRectPath(ctx, -38, -24, 76, 38, 6);
      ctx.fill();
      ctx.fillStyle = "#2e7d32";
      roundRectPath(ctx, -36, -22, 72, 8, 3);
      ctx.fill();
      ctx.fillStyle = "#5d4037";
      roundRectPath(ctx, -32, -12, 64, 22, 3);
      ctx.fill();
      if (fill > 0.02) {
        const fh = 4 + fill * 18;
        ctx.fillStyle = "#c0ca33";
        roundRectPath(ctx, -30, -12 + (22 - fh), 60, fh, 2);
        ctx.fill();
      }
      wheel(-24, 18, 7.5);
      wheel(24, 18, 7.5);
      ctx.restore();
      return;
    }
    if (id === "vitla") {
      // Forestry winch (vitla) — frame + drum, chainsaw (žaga) mounted on top
      ctx.fillStyle = "#455a64";
      roundRectPath(ctx, -18, -42, 36, 28, 4);
      ctx.fill();
      // winch drum
      ctx.fillStyle = "#78909c";
      roundRectPath(ctx, -14, -38, 28, 18, 8);
      ctx.fill();
      ctx.strokeStyle = "#37474f";
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(-12, -36 + i * 3.5);
        ctx.lineTo(12, -36 + i * 3.5);
        ctx.stroke();
      }
      // cable fairlead toward hitch (+Y)
      ctx.strokeStyle = "#263238";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(0, -6);
      ctx.stroke();
      ctx.fillStyle = "#90a4ae";
      ctx.beginPath();
      ctx.arc(0, -6, 2.5, 0, Math.PI * 2);
      ctx.fill();
      // Deutz-ish green chassis stripe
      ctx.fillStyle = "#2e7d32";
      roundRectPath(ctx, -16, -44, 32, 5, 2);
      ctx.fill();
      // chainsaw / žaga mounted on top of winch
      ctx.fillStyle = "#ef6c00";
      roundRectPath(ctx, -8, -58, 16, 14, 3);
      ctx.fill();
      ctx.fillStyle = "#37474f";
      roundRectPath(ctx, -3, -72, 6, 16, 1);
      ctx.fill();
      ctx.strokeStyle = "#212121";
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(-2, -70 + i * 3.5);
        ctx.lineTo(2, -68 + i * 3.5);
        ctx.stroke();
      }
      // orange handle bar
      ctx.strokeStyle = "#bf360c";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-10, -52);
      ctx.lineTo(10, -52);
      ctx.stroke();
      wheel(-16, -8, 6);
      wheel(16, -8, 6);
      return;
    }
    if (id === "prikolica") {
      ctx.fillStyle = "#4e342e";
      roundRectPath(ctx, -34, -48, 68, 30, 5);
      ctx.fill();
      ctx.fillStyle = "#795548";
      roundRectPath(ctx, -32, -46, 64, 10, 3);
      ctx.fill();
      for (const x of [-28, -10, 10, 28]) {
        ctx.fillStyle = "#37474f";
        roundRectPath(ctx, x - 2, -52, 4, 14, 1);
        ctx.fill();
      }
      const n = Math.min(4, this.trailerLogs);
      for (let i = 0; i < Math.max(1, n); i++) {
        ctx.fillStyle = i < n ? "#a1887f" : "rgba(161,136,127,0.25)";
        ctx.beginPath();
        ctx.ellipse(-18 + i * 12, -32, 15, 5.5, -0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#5d4037";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      wheel(-22, -8, 7.5);
      wheel(22, -8, 7.5);
      return;
    }
    if (id === "gnojnica") {
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      ctx.ellipse(0, -28, 30, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      // splash pipes (trailing −Y)
      ctx.fillStyle = "#546e7a";
      roundRectPath(ctx, -28, -78, 56, 10, 3);
      ctx.fill();
      for (let i = -2; i <= 2; i++) {
        const x = i * 11;
        ctx.strokeStyle = "#78909c";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, -72);
        ctx.lineTo(x, -92);
        ctx.stroke();
        ctx.fillStyle = "#5d4037";
        ctx.beginPath();
        ctx.ellipse(x, -94, 3.5, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // red tanker body
      const tank = ctx.createLinearGradient(-28, -70, 28, -10);
      tank.addColorStop(0, "#b71c1c");
      tank.addColorStop(0.4, "#e53935");
      tank.addColorStop(1, "#8e0000");
      ctx.fillStyle = tank;
      roundRectPath(ctx, -28, -68, 56, 48, 14);
      ctx.fill();
      ctx.fillStyle = "#ef5350";
      roundRectPath(ctx, -22, -62, 24, 12, 8);
      ctx.fill();
      // green farm stripe
      ctx.fillStyle = "#2e7d32";
      roundRectPath(ctx, -24, -42, 48, 8, 3);
      ctx.fill();
      ctx.fillStyle = "#81c784";
      roundRectPath(ctx, -22, -40, 18, 4, 2);
      ctx.fill();
      ctx.fillStyle = "#fdd835";
      roundRectPath(ctx, -22, -28, 44, 5, 2);
      ctx.fill();
      // hatch
      ctx.fillStyle = "#455a64";
      ctx.beginPath();
      ctx.arc(0, -52, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#90a4ae";
      ctx.beginPath();
      ctx.arc(0, -52, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#37474f";
      roundRectPath(ctx, -24, -22, 48, 10, 3);
      ctx.fill();
      wheel(-16, -8, 8);
      wheel(16, -8, 8);
      return;
    }
    if (id === "plug") {
      ctx.strokeStyle = "#455a64";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -16);
      ctx.stroke();
      // Soft body shadow
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      ctx.ellipse(0, -28, 26, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      const beam = ctx.createLinearGradient(-24, -50, 24, -30);
      beam.addColorStop(0, "#8e0000");
      beam.addColorStop(0.45, "#e53935");
      beam.addColorStop(1, "#b71c1c");
      ctx.fillStyle = beam;
      roundRectPath(ctx, -24, -46, 48, 20, 4);
      ctx.fill();
      ctx.fillStyle = "#ff8a80";
      roundRectPath(ctx, -20, -44, 18, 6, 2);
      ctx.fill();
      ctx.fillStyle = "#fdd835";
      roundRectPath(ctx, -20, -40, 40, 5, 2);
      ctx.fill();
      for (const x of [-16, -5, 5, 16]) {
        const share = ctx.createLinearGradient(x - 8, -62, x + 8, -40);
        share.addColorStop(0, "#eceff1");
        share.addColorStop(1, "#90a4ae");
        ctx.fillStyle = share;
        ctx.beginPath();
        ctx.moveTo(x - 2, -40);
        ctx.quadraticCurveTo(x - 14, -54, x + 2, -64);
        ctx.quadraticCurveTo(x + 12, -50, x + 3, -40);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#546e7a";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      wheel(-12, -20, 6.5);
      wheel(12, -20, 6.5);
      return;
    }
    if (id === "balirka") {
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      ctx.ellipse(0, -18, 28, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1b5e20";
      roundRectPath(ctx, -24, -12, 48, 14, 3);
      ctx.fill();
      ctx.fillStyle = "#43a047";
      roundRectPath(ctx, -22, -10, 20, 5, 2);
      ctx.fill();
      for (let i = -3; i <= 3; i++) {
        ctx.strokeStyle = "#81c784";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(i * 5.5, -6);
        ctx.lineTo(i * 5.5 + 2, 5);
        ctx.stroke();
      }
      const chamber = ctx.createRadialGradient(-6, -34, 4, 0, -30, 26);
      chamber.addColorStop(0, "#66bb6a");
      chamber.addColorStop(0.55, "#2e7d32");
      chamber.addColorStop(1, "#1b5e20");
      ctx.fillStyle = chamber;
      ctx.beginPath();
      ctx.ellipse(0, -30, 26, 24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#f9a825";
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.ellipse(0, -30, 17, 15, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#fdd835";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, -30, 10, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#fdd835";
      roundRectPath(ctx, -14, -54, 28, 6, 2);
      ctx.fill();
      ctx.fillStyle = "#1b5e20";
      roundRectPath(ctx, -28, -42, 9, 18, 2);
      ctx.fill();
      wheel(-16, -2, 8);
      wheel(16, -2, 8);
      return;
    }
    if (id === "ovijalka") {
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      ctx.ellipse(0, -20, 28, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      const frame = ctx.createLinearGradient(-26, -48, 26, -12);
      frame.addColorStop(0, "#43a047");
      frame.addColorStop(0.5, "#2e7d32");
      frame.addColorStop(1, "#1b5e20");
      ctx.fillStyle = frame;
      roundRectPath(ctx, -26, -48, 52, 32, 7);
      ctx.fill();
      ctx.fillStyle = "#fdd835";
      roundRectPath(ctx, -22, -45, 44, 7, 2);
      ctx.fill();
      ctx.fillStyle = "#66bb6a";
      ctx.beginPath();
      ctx.ellipse(0, -28, 18, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#c8e6c9";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, -28, 14, 9, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#1b5e20";
      ctx.beginPath();
      ctx.arc(22, -40, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#a5d6a7";
      ctx.beginPath();
      ctx.arc(22, -40, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#c8e6c9";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(14, -36);
      ctx.quadraticCurveTo(2, -20, 8, -12);
      ctx.stroke();
      ctx.fillStyle = "#c62828";
      roundRectPath(ctx, -20, -12, 40, 8, 2);
      ctx.fill();
      ctx.fillStyle = "#ef9a9a";
      roundRectPath(ctx, -16, -10, 14, 3, 1);
      ctx.fill();
      wheel(-14, -2, 7);
      wheel(14, -2, 7);
      return;
    }
    ctx.fillStyle = "#78909c";
    roundRectPath(ctx, -18, -30, 36, 24, 5);
    ctx.fill();
    wheel(-12, 0, 5);
    wheel(12, 0, 5);
  }

  private drawJoystick(ctx: CanvasRenderingContext2D): void {
    const { baseX, baseY, knobX, knobY, radius } = this.joy;

    ctx.save();
    ctx.beginPath();
    ctx.arc(baseX, baseY, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20, 28, 24, 0.38)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(baseX, baseY, radius * 0.72, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const kr = radius * 0.38;
    ctx.beginPath();
    ctx.arc(knobX, knobY, kr, 0, Math.PI * 2);
    ctx.fillStyle = this.joy.active
      ? 'rgba(245, 245, 240, 0.92)'
      : 'rgba(235, 235, 230, 0.78)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}


/** Copy image to canvas (already-transparent sprites). */
function canvasFromImage(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c;
}

/** Trim fully-transparent padding after chroma key. */
function cropTransparent(src: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = src.getContext('2d')!;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return src;
  const pad = 2;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(src, minX, minY, w, h, 0, 0, w, h);
  return out;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
