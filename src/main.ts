import { FarmGame } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Manjka platno #game');
}

new FarmGame(canvas);
