import { IMPLEMENTS, MISSIONS, type ImplementId, type Mission } from './missions';
import { speakSl, unlockSpeech } from './speech';

interface Zone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Animal {
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
  tilled: boolean;
}

interface Bird {
  x: number;
  y: number;
  vx: number;
  phase: number;
}

/** Map intrinsic size (mapa.png). */
const MAP_W = 1536;
const MAP_H = 1024;
const TRACTOR_DRAW = 88;
const COW_DRAW = 72;
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

export class FarmGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private missionTitleEl: HTMLElement;
  private missionHintEl: HTMLElement;
  private progressFill: HTMLElement;
  private starsCountEl: HTMLElement;
  private toastEl: HTMLElement;
  private implementBar: HTMLElement;

  private mapImg: HTMLImageElement | null = null;
  private tractorImg: HTMLCanvasElement | HTMLImageElement | null = null;
  private cowImg: HTMLCanvasElement | HTMLImageElement | null = null;
  /** Chroma-keyed implement sprites (plug/balirka/ovijalka). */
  private implementImgs: Partial<Record<ImplementId, HTMLCanvasElement>> = {};
  /**
   * Extra rotation so hitch ring faces +Y in sprite space.
   * Tractor rear is -Y; hitch must point toward tractor (+Y from implement).
   * Canvas +angle = clockwise (Y-down).
   */
  private implementHitchRot: Partial<Record<ImplementId, number>> = {
    plug: Math.PI / 2,
    balirka: Math.PI / 2,
    ovijalka: -Math.PI / 2,
  };
  private ready = false;

  private zones: Zone[] = [];
  private fieldCells: FieldCell[] = [];
  private hayPatches: HayPatch[] = [];
  private animals: Animal[] = [];
  private bales: { x: number; y: number; wrapped: boolean }[] = [];
  private birds: Bird[] = [];
  private grassWaves: { x: number; y: number; phase: number }[] = [];

  private tractor = { x: 720, y: 520, angle: -Math.PI / 2 };
  private speed = TRACTOR_SPEED;
  private bouncePhase = 0;
  private moving = false;

  /** World-space camera center (smooth follow). */
  private cam = { x: 720, y: 520 };
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
      const [map, tractor, cow, plug, balirka, ovijalka] = await Promise.all([
        loadImage('./mapa.png'),
        loadImage('./traktor.png'),
        loadImage('./krava.png'),
        loadImage('./plug.png'),
        loadImage('./balirka.png'),
        loadImage('./ovijalka.png'),
      ]);
      this.mapImg = map;
      this.tractorImg = chromaKeyGreen(tractor);
      this.cowImg = chromaKeyGreen(cow);
      this.implementImgs.plug = cropTransparent(chromaKeyGreen(plug));
      this.implementImgs.balirka = cropTransparent(chromaKeyGreen(balirka));
      this.implementImgs.ovijalka = cropTransparent(chromaKeyGreen(ovijalka));
      try {
        const krm = await loadImage('./krmilnik.png');
        this.implementImgs.krmilnik = cropTransparent(chromaKeyGreen(krm));
        this.implementHitchRot.krmilnik = Math.PI / 2;
      } catch {
        /* keep drawn trough icon */
      }
      this.ready = true;
      this.refreshImplementBarIcons();
      this.equipForMission();
      this.updateHud();
      this.announceMission();
    } catch (err) {
      console.error(err);
      this.missionTitleEl.textContent = 'Napaka pri nalaganju';
      this.missionHintEl.textContent = 'Preveri slike v public/';
    }
  }

  private buildWorld(): void {
    this.zones = [
      { id: 'pond', x: 60, y: 40, w: 380, h: 320 },
      { id: 'leftField', x: 70, y: 520, w: 420, h: 280 },
      { id: 'rightField', x: 980, y: 160, w: 420, h: 300 },
      { id: 'barn', x: 1080, y: 620, w: 400, h: 340 },
      { id: 'hay', x: 980, y: 700, w: 200, h: 180 },
      { id: 'trough', x: 700, y: 420, w: 160, h: 120 },
    ];

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
          tilled: false,
        });
      }
    }

    this.hayPatches = [
      { x: 1040, y: 780, r: 36, baled: false },
      { x: 1120, y: 820, r: 34, baled: false },
      { x: 1070, y: 860, r: 32, baled: false },
      { x: 1180, y: 760, r: 34, baled: false },
    ];

    this.animals = [
      this.makeCow(780, 460, 0.4, 0),
      this.makeCow(860, 520, -0.3, 1.4),
      this.makeCow(740, 560, 1.1, 2.2),
    ];

    this.birds = [];
    for (let i = 0; i < 5; i++) {
      this.birds.push({
        x: 200 + Math.random() * 1100,
        y: 80 + Math.random() * 280,
        vx: 28 + Math.random() * 40,
        phase: Math.random() * Math.PI * 2,
      });
    }

    this.grassWaves = [];
    for (let i = 0; i < 40; i++) {
      this.grassWaves.push({
        x: 80 + Math.random() * (MAP_W - 160),
        y: 100 + Math.random() * (MAP_H - 200),
        phase: Math.random() * Math.PI * 2,
      });
    }

    this.tractor = { x: 720, y: 520, angle: -Math.PI / 2 };
    this.cam = { x: this.tractor.x, y: this.tractor.y };
    this.camNudge = { x: 0, y: 0 };
  }

  private makeCow(x: number, y: number, angle: number, bob: number): Animal {
    return {
      x,
      y,
      angle,
      fed: false,
      bob,
      homeX: x,
      homeY: y,
      tx: x + (Math.random() - 0.5) * 60,
      ty: y + (Math.random() - 0.5) * 40,
      wait: Math.random() * 2,
    };
  }

  private buildImplementBar(): void {
    this.implementBar.innerHTML = '';
    for (const item of IMPLEMENTS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'impl-btn';
      btn.dataset.id = item.id;
      btn.setAttribute('aria-label', item.label);
      btn.innerHTML = `<span class="impl-icon" aria-hidden="true">${item.emoji}</span><span class="impl-label">${item.label}</span>`;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        unlockSpeech();
        this.selectImplement(item.id);
      });
      this.implementBar.appendChild(btn);
    }
    this.refreshImplementBar();
    this.refreshImplementBarIcons();
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
    const label = IMPLEMENTS.find((i) => i.id === id)?.label ?? id;
    const needed = this.currentMission().implement;
    if (id === needed) {
      this.showToast(`${label} priklopljen!`, 1400);
    } else {
      this.wrongEquipFlash = 1.2;
      this.showToast(`Za nalogo rabiš drug priključek`, 1800);
    }
  }

  private equipForMission(): void {
    this.selectedImplement = this.currentMission().implement;
    this.refreshImplementBar();
  }

  private refreshImplementBar(): void {
    const needed = this.currentMission().implement;
    const buttons = this.implementBar.querySelectorAll<HTMLButtonElement>('.impl-btn');
    buttons.forEach((btn) => {
      const id = btn.dataset.id as ImplementId;
      btn.classList.toggle('active', id === this.selectedImplement);
      btn.classList.toggle('needed', id === needed && !this.gameDone);
    });
  }

  private hasCorrectImplement(): boolean {
    return this.selectedImplement === this.currentMission().implement;
  }

  private currentMission(): Mission {
    return MISSIONS[Math.min(this.missionIndex, MISSIONS.length - 1)];
  }

  private announceMission(): void {
    const m = this.currentMission();
    speakSl(`${m.title}. ${m.hint}`);
  }

  private updateHud(): void {
    const m = this.currentMission();
    if (this.gameDone) {
      this.missionTitleEl.textContent = 'Vse naloge so končane! 🎉';
      this.missionHintEl.textContent = 'Odlično delo, kmetiček!';
    } else {
      this.missionTitleEl.textContent = m.title;
      this.missionHintEl.textContent = m.hint;
    }

    this.starsCountEl.textContent = String(this.completedMissions);

    const local = this.gameDone ? 1 : this.missionProgress;
    this.progressFill.style.width = `${Math.round(local * 100)}%`;
    this.refreshImplementBar();
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

    this.updateAnimals(dt);
    this.updateBirds(dt);

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
          const rad = 25 + Math.random() * 55;
          a.tx = a.homeX + Math.cos(ang) * rad;
          a.ty = a.homeY + Math.sin(ang) * rad * 0.7;
          a.tx = Math.max(a.homeX - 90, Math.min(a.homeX + 90, a.tx));
          a.ty = Math.max(a.homeY - 70, Math.min(a.homeY + 70, a.ty));
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

  private doMissionWork(): void {
    if (this.celebrating || this.gameDone) return;
    if (!this.hasCorrectImplement()) {
      if (this.wrongEquipFlash <= 0) this.wrongEquipFlash = 0.8;
      return;
    }
    const m = this.currentMission();
    switch (m.id) {
      case 'plow':
        this.workPlow();
        break;
      case 'bale':
        this.workBale();
        break;
      case 'feed':
        this.workFeed();
        break;
      case 'wrap':
        this.workWrap();
        break;
    }
  }

  private workPlow(): void {
    let done = 0;
    for (const cell of this.fieldCells) {
      const d = Math.hypot(cell.x - this.tractor.x, cell.y - this.tractor.y);
      if (d < 70) cell.tilled = true;
      if (cell.tilled) done++;
    }
    this.missionProgress = done / this.fieldCells.length;
    this.updateHud();
    if (this.missionProgress >= 0.92) {
      this.missionProgress = 1;
      this.completeMission();
    }
  }

  private workBale(): void {
    let done = 0;
    for (const patch of this.hayPatches) {
      if (!patch.baled) {
        const d = Math.hypot(patch.x - this.tractor.x, patch.y - this.tractor.y);
        if (d < 58) {
          patch.baled = true;
          this.bales.push({ x: patch.x, y: patch.y, wrapped: false });
        }
      }
      if (patch.baled) done++;
    }
    this.missionProgress = done / this.hayPatches.length;
    this.updateHud();
    if (done >= this.hayPatches.length) this.completeMission();
  }

  private workFeed(): void {
    let fed = 0;
    for (const a of this.animals) {
      if (!a.fed) {
        const d = Math.hypot(a.x - this.tractor.x, a.y - this.tractor.y);
        if (d < 75) a.fed = true;
      }
      if (a.fed) fed++;
    }
    this.missionProgress = fed / this.animals.length;
    this.updateHud();
    if (fed >= this.animals.length) this.completeMission();
  }

  private workWrap(): void {
    if (this.bales.length === 0) {
      for (const patch of this.hayPatches) {
        this.bales.push({ x: patch.x, y: patch.y, wrapped: false });
        patch.baled = true;
      }
    }
    let wrapped = 0;
    for (const b of this.bales) {
      if (!b.wrapped) {
        const d = Math.hypot(b.x - this.tractor.x, b.y - this.tractor.y);
        if (d < 55) b.wrapped = true;
      }
      if (b.wrapped) wrapped++;
    }
    this.missionProgress = wrapped / Math.max(1, this.bales.length);
    this.updateHud();
    if (wrapped >= this.bales.length) this.completeMission();
  }

  private completeMission(): void {
    if (this.celebrating) return;
    this.celebrating = true;
    const m = this.currentMission();
    this.completedMissions = Math.min(MISSIONS.length, this.missionIndex + 1);
    this.missionProgress = 1;
    this.updateHud();
    this.showToast(m.success);
    speakSl(m.success);

    window.setTimeout(() => {
      this.celebrating = false;
      if (this.missionIndex < MISSIONS.length - 1) {
        this.missionIndex++;
        this.missionProgress = 0;
        this.equipForMission();
        this.updateHud();
        this.announceMission();
      } else {
        this.gameDone = true;
        this.completedMissions = MISSIONS.length;
        this.updateHud();
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

    // Painted map in world space via camera
    ctx.drawImage(
      this.mapImg,
      ox,
      oy,
      MAP_W * this.viewScale,
      MAP_H * this.viewScale,
    );

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(this.viewScale, this.viewScale);

    this.drawWindGrass(ctx);
    this.drawFieldOverlay(ctx);
    this.drawHay(ctx);
    this.drawBales(ctx);
    this.drawAnimals(ctx);
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

  private drawFieldOverlay(ctx: CanvasRenderingContext2D): void {
    const field = this.zones.find((z) => z.id === 'rightField')!;
    const cols = 6;
    const rows = 5;
    const cw = field.w / cols;
    const ch = field.h / rows;

    for (let i = 0; i < this.fieldCells.length; i++) {
      const cell = this.fieldCells[i];
      if (!cell.tilled) continue;
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = field.x + c * cw;
      const y = field.y + r * ch;
      ctx.fillStyle = 'rgba(92, 58, 28, 0.55)';
      ctx.fillRect(x + 2, y + 2, cw - 4, ch - 4);
      ctx.strokeStyle = 'rgba(60, 35, 15, 0.45)';
      ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        const yy = y + 8 + k * (ch / 3);
        ctx.beginPath();
        ctx.moveTo(x + 4, yy);
        ctx.lineTo(x + cw - 4, yy);
        ctx.stroke();
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
    if (!this.cowImg) return;
    for (const a of this.animals) {
      const bounce = Math.sin(a.bob) * 2.5;
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

  private drawMissionHighlight(ctx: CanvasRenderingContext2D): void {
    if (this.gameDone) return;
    const m = this.currentMission();
    let zone: Zone | undefined;
    if (m.id === 'plow') zone = this.zones.find((z) => z.id === 'rightField');
    else if (m.id === 'bale' || m.id === 'wrap')
      zone = this.zones.find((z) => z.id === 'hay');
    else if (m.id === 'feed') zone = this.zones.find((z) => z.id === 'trough');

    if (!zone) return;
    const alpha = 0.35 + 0.25 * Math.sin(this.pulse * 3.5);
    ctx.strokeStyle = `rgba(255, 235, 59, ${alpha})`;
    ctx.lineWidth = 8;
    ctx.setLineDash([18, 12]);
    roundRectPath(ctx, zone.x, zone.y, zone.w, zone.h, 24);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawTractor(ctx: CanvasRenderingContext2D): void {
    const { x, y, angle } = this.tractor;
    const size = TRACTOR_DRAW;
    // Tiny bounce while rolling — no fake spinning wheels on baked sprite
    const bounce = this.moving ? Math.sin(this.bouncePhase) * 1.6 : 0;
    ctx.save();
    ctx.translate(x, y + bounce);
    // Sprite faces +Y (down / front). atan2 travel → rotate by angle - PI/2
    ctx.rotate(angle - Math.PI / 2);

    // Hitch implement BEHIND tractor (sprite rear = -Y)
    this.drawImplement(ctx, size);

    if (this.tractorImg) {
      ctx.drawImage(this.tractorImg, -size / 2, -size / 2, size, size * 1.05);
    } else {
      ctx.fillStyle = '#e53935';
      ctx.fillRect(-30, -20, 60, 40);
    }

    ctx.restore();
  }

  private drawImplement(ctx: CanvasRenderingContext2D, size: number): void {
    const id = this.selectedImplement;
    const rear = -size * 0.62;
    const img = this.implementImgs[id];

    ctx.save();
    ctx.globalAlpha = 0.98;

    ctx.strokeStyle = '#455a64';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.32);
    ctx.lineTo(0, rear + size * 0.08);
    ctx.stroke();

    if (img) {
      const hitchRot = this.implementHitchRot[id] ?? 0;
      const iw = img.width;
      const ih = img.height;
      const maxDim = Math.max(iw, ih);
      const drawW = size * 0.95 * (iw / maxDim);
      const drawH = size * 0.95 * (ih / maxDim);
      ctx.translate(0, rear);
      ctx.rotate(hitchRot);
      const hitchNudge = drawH * 0.42;
      ctx.drawImage(img, -drawW / 2, -drawH / 2 + hitchNudge * 0.15, drawW, drawH);
    } else if (id === 'krmilnik') {
      const hitchY = rear;
      ctx.fillStyle = '#8d6e63';
      roundRectPath(ctx, -24, hitchY - 4, 48, 22, 6);
      ctx.fill();
      ctx.fillStyle = '#c8e6c9';
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.ellipse(i * 9, hitchY + 4, 5, 3, -0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffeb3b';
      ctx.beginPath();
      ctx.arc(-10, hitchY, 3, 0, Math.PI * 2);
      ctx.arc(0, hitchY - 1, 3, 0, Math.PI * 2);
      ctx.arc(10, hitchY + 1, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const hitchY = rear;
      ctx.fillStyle = '#78909c';
      ctx.fillRect(-18, hitchY - 6, 36, 24);
    }

    ctx.restore();
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
