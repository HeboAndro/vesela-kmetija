export type MissionId =
  | 'grain'
  | 'hay'
  | 'gnojnica'
  | 'koruza'
  | 'gozd'
  | 'feed'
  | 'wash';

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
  | 'krtaca';

export interface MissionPhase {
  implement: ImplementId;
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
  { id: 'krmilnik', label: 'Krmilnik', shortLabel: 'Krmil.', emoji: '🐄' },
  { id: 'krtaca', label: 'Krtača', shortLabel: 'Krtača', emoji: '🧽' },
];

export const MISSIONS: Mission[] = [
  {
    id: 'grain',
    title: 'Oranje in sejanje žita',
    success: 'Njiva je zorana in posejana!',
    phases: [
      {
        implement: 'plug',
        hint: 'Priklopi Plug in prevozi desno njivo — trava postane rjava zemlja.',
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
    title: 'Seno / trava',
    success: 'Seno je pokošeno, zgrabljeno, balirano in ovito!',
    phases: [
      {
        implement: 'kosilnica',
        hint: 'Kosilnica: pokosi visoko travo na levem travniku.',
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
      },
    ],
  },
  {
    id: 'gnojnica',
    title: 'Vožnja gnojnice na travnik',
    success: 'Travnik je pognojen z gnojnico!',
    phases: [
      {
        implement: 'gnojnica',
        hint: 'Gnojnica: razvoz gnojnice po travniku.',
      },
    ],
  },
  {
    id: 'koruza',
    title: 'Koruza za silažo',
    success: 'Koruza je posejana in narejena silaža!',
    phases: [
      {
        implement: 'sejalnik',
        hint: 'Sejalnik: posej koruzo na koruznem polju (desno zgoraj).',
        phaseDone: 'Koruza raste! Zdaj jo požanjemo za silažo.',
      },
      {
        implement: 'kombajn',
        hint: 'Kombajn + prikolica: požanjite koruzo za silažo.',
      },
    ],
  },
  {
    id: 'gozd',
    title: 'Delo v gozdu',
    success: 'Hlodi so na dvorišču pri hlevu!',
    phases: [
      {
        implement: 'vitla',
        hint: 'Vitla: podri nekaj dreves v gozdu (žaga na vitli).',
        phaseDone: 'Drevesa so podrta! Naloži hlode na prikolico.',
      },
      {
        implement: 'prikolica',
        hint: 'Prikolica: naloži hlode in jih pelji na dvorišče pri hlevu.',
      },
    ],
  },
  {
    id: 'feed',
    title: 'Krmljenje živali',
    success: 'Bravo! Govedo in ovce so srečne!',
    phases: [
      {
        implement: 'krmilnik',
        hint: 'Krmilnik: pelji po hlevskem hodniku — govedo in ovce so levo in desno.',
      },
    ],
  },
  {
    id: 'wash',
    title: 'Čiščenje traktorja',
    success: 'Traktor je čist!',
    phases: [
      {
        implement: 'krtaca',
        hint: 'Pelji skozi avtopralnico pri hlevu (milo in voda).',
      },
    ],
  },
];
