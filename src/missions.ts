export type MissionId =
  | 'grain'
  | 'hay'
  | 'gnojnica'
  | 'fill_cistern'
  | 'koruza'
  | 'gozd'
  | 'feed'
  | 'wash'
  | 'yard'
  | 'night'
  | 'sheep'
  | 'rescue'
  | 'neighbor';

export type ImplementId =
  | 'plug'
  | 'sejalnik'
  | 'kosilnica'
  | 'zgrabljalnik'
  | 'balirka'
  | 'ovijalka'
  | 'gnojnica'
  | 'silazer'
  | 'kombajn'
  | 'vitla'
  | 'prikolica'
  | 'krmilnik'
  | 'metla';

export interface MissionPhase {
  /** Required hitch; null = no implement (wash bay). */
  implement: ImplementId | null;
  /** Short phase label shown in HUD hint. */
  hint: string;
  /** Optional toast when this phase finishes (before mission success). */
  phaseDone?: string;
}

export interface Mission {
  id: MissionId;
  title: string;
  /** Overall success when all phases done. */
  success: string;
  phases: MissionPhase[];
  /**
   * Primary map zone id for WoW ! / ? markers (location-tied).
   * Secondary zones may be used mid-mission in game logic.
   */
  markerZone: string;
  /**
   * If true, driving near the ! does NOT auto-accept.
   * Player must tap the ! or pick the mission from the menu
   * (used for night/sheep so the dark overlay is never a surprise).
   */
  manualAccept?: boolean;
}

export const IMPLEMENTS: {
  id: ImplementId;
  label: string;
  /** Short label for compact phone/tablet toolbar. */
  shortLabel: string;
  emoji: string;
}[] = [
  { id: 'plug', label: 'Plug', shortLabel: 'Plug', emoji: '🪓' },
  { id: 'sejalnik', label: 'Sejalnik', shortLabel: 'Sejal.', emoji: '🌱' },
  { id: 'kosilnica', label: 'Kosilnica', shortLabel: 'Kosil.', emoji: '🌾' },
  { id: 'zgrabljalnik', label: 'Zgrabljalnik', shortLabel: 'Zgrabl.', emoji: '🧹' },
  { id: 'balirka', label: 'Balirka', shortLabel: 'Balir.', emoji: '🟡' },
  { id: 'ovijalka', label: 'Ovijalka', shortLabel: 'Ovija.', emoji: '🟢' },
  { id: 'gnojnica', label: 'Gnojnica', shortLabel: 'Gnojn.', emoji: '🟤' },
  { id: 'kombajn', label: 'Kombajn', shortLabel: 'Komb.', emoji: '🚜' },
  { id: 'vitla', label: 'Vitla', shortLabel: 'Vitla', emoji: '🪵' },
  { id: 'prikolica', label: 'Prikolica', shortLabel: 'Prikol.', emoji: '🪵' },
  { id: 'krmilnik', label: 'Mešalnik', shortLabel: 'Mešal.', emoji: '🐄' },
  { id: 'metla', label: 'Metla', shortLabel: 'Metla', emoji: '🟡' },
];

export const MISSIONS: Mission[] = [
  {
    id: 'grain',
    title: 'Oranje in sejanje žita',
    success: 'Njiva je zorana in posejana!',
    markerZone: 'rightField',
    phases: [
      {
        implement: 'plug',
        hint: 'Priklopi Plug in prevozi zgornjo njivo žita — trava postane rjava zemlja.',
        phaseDone: 'Njiva je zorana! Zdaj posejemo.',
      },
      {
        implement: 'sejalnik',
        hint: 'Priklopi Sejalnik in posej zorane celice.',
      },
    ],
  },
  {
    id: 'hay',
    title: 'Cel dan sena',
    success: 'Seno je pokošeno, balirano, ovito in na dvorišču!',
    markerZone: 'leftField',
    phases: [
      {
        implement: 'kosilnica',
        hint: 'Kosilnica: pokosi visoko travo na senenem travniku (levo).',
        phaseDone: 'Trava je pokošena!',
      },
      {
        implement: 'zgrabljalnik',
        hint: 'Zgrabljalnik: zgrabi pokošeno travo v vrste.',
        phaseDone: 'Trava je v vrstah!',
      },
      {
        implement: 'balirka',
        hint: 'Balirka: naredi rumene bale iz vrst.',
        phaseDone: 'Bale so pripravljene!',
      },
      {
        implement: 'ovijalka',
        hint: 'Ovijalka: ovij bale v zeleno folijo.',
        phaseDone: 'Bale so ovite! Naloži jih na prikolico.',
      },
      {
        implement: 'prikolica',
        hint: 'Prikolica: naloži ovite bale in jih pelji na dvorišče pri hlevu.',
      },
    ],
  },
  {
    id: 'gnojnica',
    title: 'Vožnja gnojnice na travnik',
    success: 'Travnik je pognojen z gnojnico!',
    markerZone: 'manureField',
    phases: [
      {
        implement: 'gnojnica',
        hint: 'Gnojnica: razvoz gnojnice po spodnjem travniku (temnejša trava, cisterna).',
      },
    ],
  },
  {
    id: 'fill_cistern',
    title: 'Napolni cisterno',
    success: 'Cisterna je polna in travnik pognojen!',
    markerZone: 'slurryTank',
    phases: [
      {
        implement: 'gnojnica',
        hint: 'Gnojnica: pelji do cisterne/gnojniškega zbiralnika in napolni rezervoar.',
        phaseDone: 'Cisterna je polna! Zdaj razvozimo po travniku.',
      },
      {
        implement: 'gnojnica',
        hint: 'Gnojnica: razvoz gnojnice po travniku (manureField).',
      },
    ],
  },
  {
    id: 'koruza',
    title: 'Koruza + silos',
    success: 'Koruza je požeta in silaža je na kupu!',
    markerZone: 'cornField',
    phases: [
      {
        implement: 'sejalnik',
        hint: 'Sejalnik: posej koruzo na koruznem polju (zgoraj desno, ob gozdu).',
        phaseDone: 'Koruza raste! Zdaj jo požanjemo za silažo.',
      },
      {
        implement: 'kombajn',
        hint: 'Kombajn: požanjite koruzo — silaža gre na kup pri hlevu.',
      },
    ],
  },
  {
    id: 'gozd',
    title: 'Gozdna veriga',
    success: 'Hlodi so na skladišču pri hlevu!',
    markerZone: 'forest',
    phases: [
      {
        implement: 'vitla',
        hint: 'Vitla: podri nekaj dreves v gozdu (žaga na vitli).',
        phaseDone: 'Drevesa so podrta! Naloži hlode na prikolico.',
      },
      {
        implement: 'prikolica',
        hint: 'Prikolica: naloži hlode in jih pelji na skladišče (dvorišče pri hlevu).',
      },
    ],
  },
  {
    id: 'feed',
    title: 'Mešalnik krme',
    success: 'Bravo! Govedo in ovce so siti!',
    markerZone: 'openBarn',
    phases: [
      {
        implement: 'krmilnik',
        hint: 'Mešalnik (Trioliet): pelji po hlevskem hodniku — živali so levo in desno.',
      },
    ],
  },
  {
    id: 'yard',
    title: 'Čiščenje dvorišča',
    success: 'Dvorišče je čisto!',
    markerZone: 'barnYard',
    phases: [
      {
        implement: 'metla',
        hint: 'Metla: počisti dvorišče pri hlevu (umazano zemljo).',
      },
    ],
  },
  {
    id: 'wash',
    title: 'Čiščenje traktorja',
    success: 'Traktor je čist!',
    markerZone: 'washBay',
    phases: [
      {
        implement: null,
        hint: 'Pelji na avtopralnico (brez priključka) — milo in voda očistita traktor.',
      },
    ],
  },
  {
    id: 'night',
    title: 'Nočna vožnja',
    success: 'Našli ste vsa izgubljena jagnjeta!',
    markerZone: 'nightPaddock',
    manualAccept: true,
    phases: [
      {
        implement: 'prikolica',
        hint: 'Noč je! Priklopi prikolico in s žarometi poišči 3 jagnjeta v nočni ogradi (desno spodaj).',
      },
    ],
  },
  {
    id: 'sheep',
    title: 'Najdi 3 ovce',
    success: 'Našli ste vse tri ovce!',
    markerZone: 'nightPaddock',
    manualAccept: true,
    phases: [
      {
        implement: null,
        hint: 'Poišči 3 ovce na pašniku/ogradi (desno spodaj) — pelji blizu vsake.',
      },
    ],
  },
  {
    id: 'rescue',
    title: 'Reši traktor',
    success: 'Stuck traktor je varno na dvorišču!',
    markerZone: 'stuckTractor',
    phases: [
      {
        implement: 'prikolica',
        hint: 'Prikolica ali vitla: pelji do zataknjenega traktorja, priklopi in ga vleči na dvorišče pri garaži.',
      },
    ],
  },
  {
    id: 'neighbor',
    title: 'Dostava sosedu',
    success: 'Ovite bale so pri sosedu!',
    markerZone: 'neighbor',
    phases: [
      {
        implement: 'prikolica',
        hint: 'Naloži ovite bale in pelji po ozki poti do sosedove hiše (spodaj levo) — ne trči v ograjo!',
      },
    ],
  },
];
