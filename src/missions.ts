export type MissionId = 'plow' | 'bale' | 'feed' | 'wrap';

export type ImplementId = 'plug' | 'balirka' | 'ovijalka' | 'krmilnik';

export interface Mission {
  id: MissionId;
  title: string;
  hint: string;
  success: string;
  workNeeded: number;
  /** Required hitch / priključek for this chore. */
  implement: ImplementId;
}

export const IMPLEMENTS: {
  id: ImplementId;
  label: string;
  emoji: string;
}[] = [
  { id: 'plug', label: 'Plug', emoji: '🪓' },
  { id: 'balirka', label: 'Balirka', emoji: '🟡' },
  { id: 'ovijalka', label: 'Ovijalka', emoji: '🟢' },
  { id: 'krmilnik', label: 'Krmilnik', emoji: '🌾' },
];

export const MISSIONS: Mission[] = [
  {
    id: 'plow',
    title: 'Oranje njive',
    hint: 'Izberi Plug in prevozi desno njivo. Zemlja postane rjava.',
    success: 'Super! Njiva je zorana!',
    workNeeded: 1,
    implement: 'plug',
  },
  {
    id: 'bale',
    title: 'Baliranje sena',
    hint: 'Izberi Balirko in pelji traktor čez seno pri hlevu.',
    success: 'Odlično! Bale so pripravljene!',
    workNeeded: 1,
    implement: 'balirka',
  },
  {
    id: 'feed',
    title: 'Nahrani krave',
    hint: 'Izberi Krmilnik in pelji blizu krav.',
    success: 'Bravo! Krave so srečne!',
    workNeeded: 1,
    implement: 'krmilnik',
  },
  {
    id: 'wrap',
    title: 'Ovijanje bal',
    hint: 'Izberi Ovijalko in ovij bale pri hlevu.',
    success: 'Fantastično! Kmetija je urejena!',
    workNeeded: 1,
    implement: 'ovijalka',
  },
];
