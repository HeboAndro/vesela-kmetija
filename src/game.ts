import { IMPLEMENTS, MISSIONS, type ImplementId, type Mission } from './missions';
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

/** Meadow / hay workflow on leftField. */
type MeadowState = 'tall' | 'cut' | 'windrow' | 'baled' | 'wrapped';

interface MeadowCell {
  x: number;
  y: number;
  w: number;
  h: number;
  state: MeadowState;
  /** Slurry / gnojnica wet manure splash. */
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
const MAP_W = 1920;
const MAP_H = 1280;
const TRACTOR_DRAW = 88;
/** Half tractor footprint — expand cell hit boxes so driving across always marks. */
const CELL_HIT_EXPAND = TRACTOR_DRAW * 0.5;
const COW_DRAW = 72;
const SHEEP_DRAW = 58;
const TRACTOR_SPEED = 220;
/** How much of the map height a phone should see (~55–70%). */
const VIEW_FRAC = 0.62;
const CAM_LERP = 5.5;

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

/** Chroma-key near-black background (for Deutz green tractor on black). */
function chromaKeyBlack(img: HTMLImageElement): HTMLCanvasElement {
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
    const maxc = Math.max(r, g, b);
    const mean = (r + g + b) / 3;
    // Pure / near-black studio backdrop
    if (maxc < 28 || (mean < 22 && maxc < 40)) {
      d[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return c;
}

export class FarmGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private missionTitleEl: HTMLElement;
  private missionHintEl: HTMLElement;
  private progressFill: HTMLElement;
  private starsCountEl: HTMLElement;
  private toastEl: HTMLElement;
  private implementBar: HTMLElement;
  private restartBtn: HTMLButtonElement;
  private garageBtn: HTMLButtonElement;
  private missionNeedIcon: HTMLElement;
  private missionNeedLabel: HTMLElement;
  private nearGarage = false;

  private mapImg: HTMLImageElement | null = null;
  private tractorImg: HTMLCanvasElement | HTMLImageElement | null = null;
  private cowImg: HTMLCanvasElement | HTMLImageElement | null = null;
  /** Chroma-keyed implement sprites (plug/balirka/ovijalka; black bg). */
  private implementImgs: Partial<Record<ImplementId, HTMLCanvasElement>> = {};
  /**
   * Per-implement hitch tune (after translate to rear pin).
   * Sprites: hitch ring faces local +Y (toward tractor); body trails in -Y.
   * plug/balirka hitch on image RIGHT → +PI/2; ovijalka hitch on LEFT → -PI/2.
   * offsetX/offsetY are fractions of longAxis in *image* space after rot:
   *   offsetX pulls hitch eye onto the pin along the tongue (side-hitch PNGs).
   *   offsetY fine-tunes lateral so visual mass sits on tractor centerline (x=0).
   * Canvas fallbacks use rot=0 with hitch already at (0,0); trail in -Y.
   * Canvas +angle = clockwise (Y-down).
   */
  private hitchTune: Record<
    ImplementId,
    { rot: number; offsetY: number; offsetX?: number; scale: number }
  > = {
    // PNG hitch eye calibrated from cropped alpha tip (longAxis fractions)
    plug: { rot: Math.PI / 2, offsetX: -0.44, offsetY: 0.0, scale: 1.28 },
    sejalnik: { rot: Math.PI / 2, offsetX: -0.44, offsetY: 0.0, scale: 1.34 },
    kosilnica: { rot: Math.PI / 2, offsetX: -0.44, offsetY: 0.0, scale: 1.36 },
    zgrabljalnik: { rot: Math.PI / 2, offsetX: -0.44, offsetY: 0.0, scale: 1.34 },
    balirka: { rot: Math.PI / 2, offsetX: -0.44, offsetY: 0.0, scale: 1.32 },
    ovijalka: { rot: -Math.PI / 2, offsetX: 0.44, offsetY: 0.0, scale: 1.32 },
    gnojnica: { rot: Math.PI / 2, offsetX: -0.44, offsetY: 0.0, scale: 1.38 },
    krmilnik: { rot: 0, offsetX: 0, offsetY: 0.02, scale: 1.48 },
    krtaca: { rot: 0, offsetX: 0, offsetY: 0.02, scale: 1.4 },
    silazer: { rot: 0, offsetX: 0, offsetY: 0.02, scale: 1.5 },
    kombajn: { rot: 0, offsetX: 0, offsetY: 0.02, scale: 1.62 },
    zaga: { rot: 0, offsetX: 0, offsetY: 0.02, scale: 1.35 },
    prikolica: { rot: 0, offsetX: 0, offsetY: 0.02, scale: 1.55 },
  };
  private ready = false;

  private zones: Zone[] = [];
  private fieldCells: FieldCell[] = [];
  private meadowCells: MeadowCell[] = [];
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
  /** Silage mound after corn harvest. */
  private silagePile = { x: 1100, y: 980, amount: 0 };
  /** 1 = dirty, 0 = clean. Washes off at washBay during wash mission. */
  private tractorDirt = 1;
  /** Cooldown so wash splash beep is not every frame. */
  private washSfxCd = 0;
  /** Cooldown so slurry splash beep is not every frame. */
  private slurrySfxCd = 0;

  private tractor = { x: 680, y: 860, angle: -Math.PI / 2 };
  private speed = TRACTOR_SPEED;
  private bouncePhase = 0;
  private moving = false;

  /** World-space camera center (smooth follow). */
  private cam = { x: 680, y: 860 };
  /** Optional nudge from one-finger drag on empty map. */
  private camNudge = { x: 0, y: 0 };
  private pan = {
    active: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
  };

  private selectedImplement: ImplementId = 'plug';
  private wrongEquipFlash = 0;

  private missionIndex = 0;
  private phaseIndex = 0;
  private missionProgress = 0;
  private completedMissions = 0;
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
    this.missionHintEl = document.getElementById('mission-hint')!;
    this.progressFill = document.getElementById('progress-fill')!;
    this.starsCountEl = document.getElementById('stars-count')!;
    this.toastEl = document.getElementById('toast')!;
    this.implementBar = document.getElementById('implement-bar')!;
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
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    void this.loadAssets();
    requestAnimationFrame((t) => this.loop(t));
  }

  private async loadAssets(): Promise<void> {
    try {
      const [map, tractor, cow, plug, balirka, ovijalka, gnojnica, sejalnik, kosilnica, zgrabljalnik] =
        await Promise.all([
          loadImage('./mapa.png'),
          loadImage('./traktor.png'),
          loadImage('./krava.png'),
          loadImage('./plug.png'),
          loadImage('./balirka.png'),
          loadImage('./ovijalka.png'),
          loadImage('./gnojnica.png'),
          loadImage('./sejalnik.png'),
          loadImage('./kosilnica.png'),
          loadImage('./zgrabljalnik.png'),
        ]);
      this.mapImg = map;
      this.tractorImg = cropTransparent(chromaKeyBlack(tractor));
      this.cowImg = chromaKeyGreen(cow);
      const keyCrop = (img: HTMLImageElement) => cropTransparent(chromaKeyBlack(img));
      this.implementImgs.plug = keyCrop(plug);
      this.implementImgs.balirka = keyCrop(balirka);
      this.implementImgs.ovijalka = keyCrop(ovijalka);
      this.implementImgs.gnojnica = keyCrop(gnojnica);
      this.implementImgs.sejalnik = keyCrop(sejalnik);
      this.implementImgs.kosilnica = keyCrop(kosilnica);
      this.implementImgs.zgrabljalnik = keyCrop(zgrabljalnik);
      try {
        const krm = await loadImage('./krmilnik.png');
        this.implementImgs.krmilnik = cropTransparent(chromaKeyGreen(krm));
      } catch {
        /* keep drawn trough icon */
      }
      this.ready = true;
      this.refreshImplementBarIcons();
      this.rebuildImplementBar();
      this.refreshImplementBar();
      this.updateHud();
      this.announceMission();
    } catch (err) {
      console.error(err);
      this.missionTitleEl.textContent = 'Napaka pri nalaganju';
      this.missionHintEl.textContent = 'Preveri slike v public/';
    }
  }

  private buildWorld(): void {
    // Calibrated to painted features on mapa.png (1920×1280)
    this.zones = [
      { id: 'pond', x: 90, y: 60, w: 460, h: 340 },
      { id: 'leftField', x: 50, y: 540, w: 600, h: 520 },
      { id: 'rightField', x: 880, y: 70, w: 640, h: 280 },
      { id: 'cornField', x: 1550, y: 20, w: 350, h: 340 },
      { id: 'forest', x: 1400, y: 640, w: 500, h: 620 },
      { id: 'barn', x: 1100, y: 480, w: 360, h: 380 },
      // Equipment shed below red barn
      { id: 'garage', x: 1080, y: 880, w: 280, h: 190 },
      { id: 'hay', x: 980, y: 700, w: 200, h: 180 },
      // Open barn / feed alley — left of red barn
      { id: 'openBarn', x: 720, y: 480, w: 340, h: 380 },
      { id: 'trough', x: 820, y: 560, w: 140, h: 120 },
      // Wash station below open barn
      { id: 'washBay', x: 740, y: 880, w: 240, h: 180 },
      // Log drop yard between wash / garage / forest
      { id: 'barnYard', x: 980, y: 1000, w: 340, h: 200 },
    ];
    this.resetWorldState();
  }

  /** Reset fields, meadow, animals, tractor — safe to call on restart without rebinding input. */
  private resetWorldState(): void {
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

    // Forest trees (right pad)
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
    this.silagePile = { x: 1220, y: 920, amount: 0 };
    this.particles = [];

    // Legacy barn-side hay (hidden — meadow workflow uses leftField)
    this.hayPatches = [
      { x: 1040, y: 780, r: 36, baled: true },
      { x: 1120, y: 820, r: 34, baled: true },
      { x: 1070, y: 860, r: 32, baled: true },
      { x: 1180, y: 760, r: 34, baled: true },
    ];
    this.bales = [];
    this.tractorDirt = 1;
    this.washSfxCd = 0;
    this.slurrySfxCd = 0;

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

    // Path between open barn and wash / garage
    this.tractor = { x: 680, y: 860, angle: -Math.PI / 2 };
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

  /** Show all implements; player must pick the correct one for the phase. */
  private rebuildImplementBar(): void {
    this.implementBar.innerHTML = '';
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
      const id = btn.dataset.id as ImplementId;
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

  private selectImplement(id: ImplementId): void {
    this.selectedImplement = id;
    this.refreshImplementBar();
    this.refreshGarageButton();
    const label = IMPLEMENTS.find((i) => i.id === id)?.label ?? id;
    const needed = this.currentImplement();
    if (id === needed) {
      this.showToast(`${label} priklopljen!`, 1400);
    } else {
      this.wrongEquipFlash = 1.2;
      sfxWrong();
      this.showToast(`Pelji v garažo po pravi priključek`, 1800);
    }
  }

  /** On phase/mission start: rebuild all tools + soft needed hint; keep prior selection. */
  private prepareImplementsForPhase(): void {
    this.rebuildImplementBar();
    this.refreshImplementBar();
  }

  /** Full game restart after completion. */
  private restartGame(): void {
    this.missionIndex = 0;
    this.phaseIndex = 0;
    this.missionProgress = 0;
    this.completedMissions = 0;
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

  private refreshImplementBar(): void {
    const needed = this.currentImplement();
    const buttons = this.implementBar.querySelectorAll<HTMLButtonElement>('.impl-btn');
    buttons.forEach((btn) => {
      const id = btn.dataset.id as ImplementId;
      btn.classList.toggle('active', id === this.selectedImplement);
      btn.classList.toggle('needed', id === needed && !this.gameDone);
    });
  }

  private hasCorrectImplement(): boolean {
    return this.selectedImplement === this.currentImplement();
  }

  private currentMission(): Mission {
    return MISSIONS[Math.min(this.missionIndex, MISSIONS.length - 1)];
  }

  private currentPhase() {
    const m = this.currentMission();
    return m.phases[Math.min(this.phaseIndex, m.phases.length - 1)];
  }

  private currentImplement(): ImplementId {
    return this.currentPhase().implement;
  }

  private announceMission(): void {
    const m = this.currentMission();
    const p = this.currentPhase();
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
      this.missionHintEl.textContent = p.hint;
      this.restartBtn.classList.remove('visible');
      this.restartBtn.hidden = true;
      this.refreshMissionNeed();
    }

    this.starsCountEl.textContent = String(this.completedMissions);

    const local = this.gameDone ? 1 : this.missionProgress;
    this.progressFill.style.width = `${Math.round(local * 100)}%`;
    this.refreshImplementBar();
    this.refreshGarageButton();
  }

  /** HUD chip: required implement emoji/sprite + name for current phase. */
  private refreshMissionNeed(): void {
    const id = this.currentImplement();
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
      const label = IMPLEMENTS.find((i) => i.id === needed)?.label ?? needed;
      this.showToast(`${label} je že priklopljen`, 1200);
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
      const label = IMPLEMENTS.find((i) => i.id === needed)?.label ?? needed;
      const already = this.selectedImplement === needed;
      this.garageBtn.textContent = already
        ? `Priklop: ${label} ✓`
        : `Zamenjaj priključek → ${label}`;
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
    const zone = this.currentMissionZone();
    if (!zone) return null;
    return { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2, kind: 'zone' };
  }

  private currentMissionZone(): Zone | undefined {
    const m = this.currentMission();
    if (m.id === 'grain') return this.zones.find((z) => z.id === 'rightField');
    if (m.id === 'hay') return this.zones.find((z) => z.id === 'leftField');
    if (m.id === 'gnojnica') return this.zones.find((z) => z.id === 'leftField');
    if (m.id === 'koruza') return this.zones.find((z) => z.id === 'cornField');
    if (m.id === 'gozd') {
      if (this.currentImplement() === 'prikolica' && this.trailerLogs > 0) {
        return this.zones.find((z) => z.id === 'barnYard');
      }
      return this.zones.find((z) => z.id === 'forest');
    }
    if (m.id === 'feed') return this.zones.find((z) => z.id === 'openBarn');
    if (m.id === 'wash') return this.zones.find((z) => z.id === 'washBay');
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
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = w;
    this.cssH = h;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Zoom so viewport shows a fraction of the world (map larger than screen).
    const scaleH = h / (MAP_H * VIEW_FRAC);
    const scaleW = w / (MAP_W * VIEW_FRAC);
    this.viewScale = Math.max(scaleH, scaleW);
    // Cap so we never zoom out past "fit entire map"
    const fit = Math.min(w / MAP_W, h / MAP_H);
    this.viewScale = Math.max(this.viewScale, fit * 1.15);

    const margin = Math.max(18, Math.min(w, h) * 0.04);
    this.joy.radius = Math.max(52, Math.min(72, Math.min(w, h) * 0.11));
    this.joy.baseX = margin + this.joy.radius + 8;
    this.joy.baseY = h - margin - this.joy.radius - 12;
    if (!this.joy.active) {
      this.joy.knobX = this.joy.baseX;
      this.joy.knobY = this.joy.baseY;
    }
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

    this.updateAnimals(dt);
    this.updateWanderers(dt);
    this.updateBirds(dt);
    this.updateParticles(dt);
    this.updateGarageProximity();

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
        break;
      case 'gnojnica':
        if (impl === 'gnojnica') this.workSlurry();
        break;
      case 'koruza':
        if (impl === 'sejalnik') this.workPlantCorn();
        else if (impl === 'kombajn') this.workChopCorn();
        break;
      case 'gozd':
        if (impl === 'zaga') this.workFellTrees();
        else if (impl === 'prikolica') this.workHaulLogs();
        break;
      case 'feed':
        this.workFeed();
        break;
      case 'wash':
        this.workWash();
        break;
    }
  }

  /** Spread slurry (gnojnica) over leftField meadow cells. */
  private workSlurry(): void {
    let done = 0;
    let justHit = false;
    for (const cell of this.meadowCells) {
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
    this.missionProgress = done / this.meadowCells.length;
    this.updateHud();
    if (done >= this.meadowCells.length) {
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
    this.completedMissions = Math.min(MISSIONS.length, this.missionIndex + 1);
    this.missionProgress = 1;
    this.updateHud();
    sfxSuccess();
    this.showToast(m.success);
    speakSl(m.success);

    window.setTimeout(() => {
      this.celebrating = false;
      if (this.missionIndex < MISSIONS.length - 1) {
        this.missionIndex++;
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

    // Full-bleed map art (1920×1280)
    ctx.drawImage(this.mapImg, 0, 0, MAP_W, MAP_H);
    this.drawExpandedZones(ctx);

    this.drawPondShimmer(ctx);
    this.drawWindGrass(ctx);
    this.drawFieldOverlay(ctx);
    this.drawMeadowOverlay(ctx);
    this.drawCornOverlay(ctx);
    this.drawForest(ctx);
    this.drawWashBay(ctx);
    this.drawOpenBarn(ctx);
    this.drawSilagePile(ctx);
    this.drawBarnYardLogs(ctx);
    this.drawHay(ctx);
    this.drawBales(ctx);
    this.drawWanderers(ctx);
    this.drawAnimals(ctx);
    this.drawParticles(ctx);
    this.drawBirds(ctx);
    this.drawMissionHighlight(ctx);
    this.drawTractor(ctx);

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
    // Pad fills / dirt margins removed so the 1920×1280 mapa.png stays visible.
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

  private drawWashBay(ctx: CanvasRenderingContext2D): void {
    const bay = this.zones.find((z) => z.id === 'washBay');
    if (!bay) return;
    ctx.fillStyle = 'rgba(80, 100, 120, 0.1)';
    ctx.fillRect(bay.x, bay.y, bay.w, bay.h);
    ctx.strokeStyle = 'rgba(180, 220, 255, 0.35)';
    ctx.lineWidth = 4;
    ctx.strokeRect(bay.x + 4, bay.y + 4, bay.w - 8, bay.h - 8);
    // Soap bubbles / water
    const cx = bay.x + bay.w / 2;
    const cy = bay.y + bay.h / 2;
    ctx.fillStyle = 'rgba(100, 180, 255, 0.18)';
    ctx.fillRect(bay.x + 20, bay.y + 40, bay.w - 40, 40);
    for (let i = 0; i < 6; i++) {
      const bx = cx - 50 + i * 20;
      const by = cy - 20 + Math.sin(this.pulse * 3 + i) * 6;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx, by, 6 + (i % 3), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PRALNICA', cx, bay.y + 28);
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

      // Gnojnica wet manure splash (brown-green sheen) — on top of hay states
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
        // Wet speckles
        ctx.fillStyle = 'rgba(55, 40, 22, 0.55)';
        for (let s = 0; s < 7; s++) {
          const sx = rx + 8 + ((s * 37 + i * 11) % Math.max(8, Math.floor(rw - 16)));
          const sy = ry + 8 + ((s * 53 + i * 17) % Math.max(8, Math.floor(rh - 16)));
          ctx.beginPath();
          ctx.ellipse(sx, sy, 3 + (s % 3), 2 + (s % 2), 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
        // Glossy wet edge
        ctx.strokeStyle = 'rgba(140, 160, 70, 0.28)';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx + 2, ry + 2, rw - 4, rh - 4);
      } else if (this.currentMission().id === 'gnojnica' && !this.gameDone) {
        // Highlight remaining dry cells during slurry mission
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
    const size = TRACTOR_DRAW;
    const bounce = this.moving ? Math.sin(this.bouncePhase) * 1.6 : 0;
    const hitchExtra =
      this.selectedImplement === 'kombajn'
        ? size * 1.55
        : this.selectedImplement === 'prikolica'
          ? size * 0.95
          : size * 0.75;

    // Soft elliptical ground shadow ONLY (under body; never on roof / no skew)
    ctx.save();
    ctx.translate(x, y + 10);
    ctx.rotate(angle - Math.PI / 2);
    // Mild oval ground contact under tractor
    ctx.fillStyle = 'rgba(20, 30, 20, 0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 5, size * 0.44, size * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(20, 30, 20, 0.16)';
    ctx.beginPath();
    ctx.ellipse(0, -hitchExtra * 0.45, size * 0.36, size * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    if (this.selectedImplement === 'kombajn') {
      ctx.beginPath();
      ctx.ellipse(0, -hitchExtra * 0.95, size * 0.38, size * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(x, y + bounce);
    // Travel angle -> sprite local +Y is forward. No isometric skew.
    ctx.rotate(angle - Math.PI / 2);

    // Hitch behind (local -Y). Art has hood at PNG top; we flip Y when drawing body.
    this.drawImplement(ctx, size);

    if (this.tractorImg) {
      ctx.save();
      // PNG top = hood/front → flip so hood maps to local +Y (forward).
      ctx.scale(1, -1);
      ctx.drawImage(this.tractorImg, -size / 2, -size / 2, size, size * 1.05);
      ctx.restore();
    } else {
      // Fallback Deutz-ish green body (clean - no roof-darkening overlay)
      ctx.fillStyle = '#3f8f3a';
      ctx.fillRect(-28, -36, 56, 72);
      ctx.fillStyle = '#2a6628';
      ctx.fillRect(-28, -36, 10, 72);
      ctx.fillStyle = '#263238';
      ctx.fillRect(-20, -8, 40, 36);
    }

    // Dirt overlay (washes off in pond)
    if (this.tractorDirt > 0.02) {
      const a = 0.18 + this.tractorDirt * 0.42;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = '#5d4037';
      roundRectPath(ctx, -size * 0.38, -size * 0.42, size * 0.76, size * 0.85, 10);
      ctx.fill();
      ctx.fillStyle = '#3e2723';
      ctx.beginPath();
      ctx.ellipse(-size * 0.12, size * 0.05, 8, 5, 0.3, 0, Math.PI * 2);
      ctx.ellipse(size * 0.14, -size * 0.08, 7, 4, -0.2, 0, Math.PI * 2);
      ctx.ellipse(0, size * 0.22, 10, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  /** Hitch implement behind tractor (local −Y). */
  private drawImplement(ctx: CanvasRenderingContext2D, size: number): void {
    const id = this.selectedImplement;
    // Behind tractor in local space (art rear after Y-flip of body).
    const rear = -size * 0.58;
    const img = this.implementImgs[id];
    const tune = this.hitchTune[id];

    ctx.save();
    ctx.globalAlpha = 0.98;

    // Soft drop shadow under hitch implement (local space)
    ctx.save();
    ctx.fillStyle = 'rgba(20, 30, 20, 0.22)';
    const shadowLen =
      id === 'kombajn'
        ? size * 1.45
        : id === 'prikolica' || id === 'gnojnica'
          ? size * 0.85
          : size * 0.55;
    ctx.beginPath();
    ctx.ellipse(0, rear - shadowLen * 0.35, size * 0.32, size * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    if (id === 'kombajn') {
      ctx.beginPath();
      ctx.ellipse(0, rear - shadowLen * 0.85, size * 0.36, size * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Short hitch tongue from under body to rear pin
    ctx.strokeStyle = '#37474f';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.12);
    ctx.lineTo(0, rear);
    ctx.stroke();
    // Hitch pin
    ctx.fillStyle = '#90a4ae';
    ctx.beginPath();
    ctx.arc(0, rear, 3.5, 0, Math.PI * 2);
    ctx.fill();
    // Soft highlight on one side of hitch metal only (not cabin/roof)
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(2.0, -size * 0.1);
    ctx.lineTo(2.0, rear + 1);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-2.0, -size * 0.1);
    ctx.lineTo(-2.0, rear + 1);
    ctx.stroke();

    // All implement drawing is relative to hitch pin
    ctx.translate(0, rear);

    if (img) {
      const iw = img.width;
      const ih = img.height;
      const maxDim = Math.max(iw, ih);
      const scale = tune.scale;
      const drawW = size * scale * (iw / maxDim);
      const drawH = size * scale * (ih / maxDim);
      // Long axis ≈ hitch↔body for horizontal sprites
      const longAxis = Math.max(drawW, drawH);
      ctx.rotate(tune.rot);
      // Both offsets are longAxis fractions (image space after rot)
      ctx.translate((tune.offsetX ?? 0) * longAxis, tune.offsetY * longAxis);
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    } else {
      // Canvas icons: hitch at (0,0), body −Y; same offset fractions
      const s = tune.scale;
      const longAxis = size * s;
      ctx.rotate(tune.rot);
      ctx.translate((tune.offsetX ?? 0) * longAxis, tune.offsetY * longAxis);
      ctx.scale(s, s);
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
    ctx.strokeStyle = "#37474f";
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.lineTo(0, -8);
    ctx.stroke();
    ctx.fillStyle = "#607d8b";
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(-9, -10);
    ctx.lineTo(9, -10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#b0bec5";
    ctx.beginPath();
    ctx.arc(0, 5, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#546e7a";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-8, 2);
    ctx.lineTo(-5, -10);
    ctx.moveTo(8, 2);
    ctx.lineTo(5, -10);
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
      wheel(-20, 0, 6.5);
      wheel(20, 0, 6.5);
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
      wheel(-22, 8, 5.5);
      wheel(22, 8, 5.5);
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
      wheel(-12, 10, 5.5);
      wheel(12, 10, 5.5);
      return;
    }
    if (id === "krtaca") {
      ctx.fillStyle = "#01579b";
      roundRectPath(ctx, -22, -28, 44, 20, 6);
      ctx.fill();
      ctx.fillStyle = "#0288d1";
      roundRectPath(ctx, -20, -26, 40, 9, 4);
      ctx.fill();
      for (let i = -5; i <= 5; i++) {
        ctx.fillStyle = i % 2 === 0 ? "#4fc3f7" : "#b3e5fc";
        roundRectPath(ctx, i * 3.6 - 1.4, -10, 2.8, 16, 1);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(227, 242, 253, 0.85)";
      ctx.lineWidth = 1.3;
      for (const [bx, by, br] of [[-10, -30, 3.2], [3, -34, 2.6], [14, -28, 2.8]] as const) {
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath();
        ctx.arc(bx - br * 0.3, by - br * 0.3, br * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
      wheel(-14, 6, 5);
      wheel(14, 6, 5);
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
    if (id === "zaga") {
      ctx.fillStyle = "#37474f";
      roundRectPath(ctx, -12, -38, 24, 24, 4);
      ctx.fill();
      ctx.fillStyle = "#ef6c00";
      roundRectPath(ctx, -10, -36, 20, 12, 3);
      ctx.fill();
      ctx.fillStyle = "#90a4ae";
      roundRectPath(ctx, -5, -60, 10, 26, 2);
      ctx.fill();
      ctx.strokeStyle = "#263238";
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(-3, -56 + i * 4);
        ctx.lineTo(3, -54 + i * 4);
        ctx.stroke();
      }
      wheel(-14, -6, 5.5);
      wheel(14, -6, 5.5);
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
      wheel(-16, 5, 8);
      wheel(16, 5, 8);
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
      wheel(-14, 3, 7);
      wheel(14, 3, 7);
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
