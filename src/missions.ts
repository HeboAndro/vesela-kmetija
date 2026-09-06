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
    title: 'Oranje in sejanje',
    success: 'Super! Njiva je zorana in posejana!',
    markerZone: 'rightField',
    phases: [
      {
        implement: 'plug',
        hint: 'Priklopi plug in prevozi zgornjo njivo. Trava postane rjava zemlja.',
        phaseDone: 'Njiva je zorana! Zdaj sejemo.',
      },
      {
        implement: 'sejalnik',
        hint: 'Priklopi sejalnik in posej zorano zemljo.',
      },
    ],
  },
  {
    id: 'hay',
    title: 'Cel dan sena',
    success: 'Bravo! Seno je na dvorišču!',
    markerZone: 'leftField',
    phases: [
      {
        implement: 'kosilnica',
        hint: 'Priklopi kosilnico in pokosi visoko travo na levem travniku.',
        phaseDone: 'Trava je pokošena!',
      },
      {
        implement: 'zgrabljalnik',
        hint: 'Zgrabi pokošeno travo v vrste.',
        phaseDone: 'Trava je v vrstah!',
      },
      {
        implement: 'balirka',
        hint: 'Naredi rumene bale iz vrst.',
        phaseDone: 'Bale so pripravljene!',
      },
      {
        implement: 'ovijalka',
        hint: 'Ovij bale v zeleno folijo.',
        phaseDone: 'Bale so ovite! Naloži jih na prikolico.',
      },
      {
        implement: 'prikolica',
        hint: 'Naloži ovite bale in pelji na dvorišče pri hlevu.',
      },
    ],
  },
  {
    id: 'gnojnica',
    title: 'Razvoz gnojnice',
    success: 'Travnik je pognojen!',
    markerZone: 'manureField',
    phases: [
      {
        implement: 'gnojnica',
        hint: 'Priklopi gnojnico in razvozi gnojnico po spodnjem travniku.',
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
        hint: 'Pelji do cisterne in napolni rezervoar.',
        phaseDone: 'Cisterna je polna! Zdaj razvozimo po travniku.',
      },
      {
        implement: 'gnojnica',
        hint: 'Razvozi gnojnico po travniku.',
      },
    ],
  },
  {
    id: 'koruza',
    title: 'Koruza in silos',
    success: 'Koruza je požeta in silaža je na kupu!',
    markerZone: 'cornField',
    phases: [
      {
        implement: 'sejalnik',
        hint: 'Posej koruzo na polju zgoraj desno, ob gozdu.',
        phaseDone: 'Koruza raste! Zdaj jo požanjemo za silažo.',
      },
      {
        implement: 'kombajn',
        hint: 'Požanji koruzo. Silaža gre na kup pri hlevu.',
      },
    ],
  },
  {
    id: 'gozd',
    title: 'Delo v gozdu',
    success: 'Hlodi so na skladišču pri hlevu!',
    markerZone: 'forest',
    phases: [
      {
        implement: 'vitla',
        hint: 'Priklopi vitlo in podri nekaj dreves v gozdu.',
        phaseDone: 'Drevesa so podrta! Naloži hlode na prikolico.',
      },
      {
        implement: 'prikolica',
        hint: 'Naloži hlode in pelji na skladišče pri hlevu.',
      },
    ],
  },
  {
    id: 'feed',
    title: 'Nahrani živali',
    success: 'Bravo! Govedo in ovce so siti!',
    markerZone: 'openBarn',
    phases: [
      {
        implement: 'krmilnik',
        hint: 'Priklopi mešalnik in pelji po hlevskem hodniku. Živali so levo in desno.',
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
        hint: 'Priklopi metlo in počisti dvorišče pri hlevu.',
      },
    ],
  },
  {
    id: 'wash',
    title: 'Umij traktor',
    success: 'Traktor je čist!',
    markerZone: 'washBay',
    phases: [
      {
        implement: null,
        hint: 'Odklopí priključek in pelji na pralnico. Milo in voda očistita traktor.',
      },
    ],
  },
  {
    id: 'night',
    title: 'Nočna vožnja',
    success: 'Našel si vsa izgubljena jagnjeta!',
    markerZone: 'nightPaddock',
    manualAccept: true,
    phases: [
      {
        implement: 'prikolica',
        hint: 'Noč je! Priklopi prikolico in s žarometi poišči 3 jagnjeta v ogradi spodaj desno.',
      },
    ],
  },
  {
    id: 'sheep',
    title: 'Najdi 3 ovce',
    success: 'Našel si vse tri ovce!',
    markerZone: 'nightPaddock',
    manualAccept: true,
    phases: [
      {
        implement: null,
        hint: 'Poišči 3 ovce na pašniku spodaj desno. Pelji blizu vsake.',
      },
    ],
  },
  {
    id: 'rescue',
    title: 'Reši traktor',
    success: 'Zataknjeni traktor je varno na dvorišču!',
    markerZone: 'stuckTractor',
    phases: [
      {
        implement: 'prikolica',
        hint: 'Priklopi prikolico ali vitlo, vleci zataknjeni traktor na dvorišče pri garaži.',
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
        hint: 'Naloži ovite bale in pelji po ozki poti do sosedove hiše spodaj levo. Pazi na ograjo!',
      },
    ],
  },
];
