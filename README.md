# Kmetija – Traktor igra

Preprosta igra za otroke (približno 5–10 let): vozi rdeči traktor po kmetiji in opravi naloge.

## Kaj potrebuješ

- Nameščen Node.js (priporočeno LTS) s https://nodejs.org/
- Spletni brskalnik (Chrome ali Safari na telefonu)

## Zagon na računalniku

V mapi projekta zaženi:

```bash
npm install
npm run dev
```

Odpri naslov, ki ga pokaže Vite (običajno `http://localhost:5173`).

Na telefonu v istem omrežju odpri IP naslov računalnika z istim vratom.

## Gradnja za produkcijo

```bash
npm install
npm run build
```

Datoteke bodo v mapi `dist/`. Lahko jih strežeš s katerimkoli statičnim strežnikom, npr.:

```bash
npx --yes serve dist -l 5173
```

## Kako igrati

1. **Tapni traktor** (rdeč) – izbereš ga (rumeni krog).
2. **Tapni cilj** na zemljevidu – traktor se pelje tja.
3. Opravi naloge po vrsti:
   - Orij / seji pšenico na njivi
   - Baliraj seno
   - Nahrani krave in ovce pri hlevu
   - Ovij bale
4. Ob uspehu se sliši sporočilo (če brskalnik podpira govor v slovenščini).

## Tehnologija

- Vite + TypeScript
- HTML Canvas (risanje oblik, brez velikih slik)
- Web Speech API (`sl-SI` / `sl`) za govor

Ni prijave, ni strežnika v ozadju igre, ni bojev.

## Avtor

Družinska prototipna igra za Hebojeve otroke.
