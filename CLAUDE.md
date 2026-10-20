# CLAUDE.md

Koop-Kletterspiel für den Smartphone-Browser (Vite + TypeScript + Matter.js, PeerJS). Überblick in `README.md`, Spielregeln und Entscheidungen in `docs/GAME_DESIGN.md` – dort neue Entscheidungen nachtragen.

## Vor jedem PR

```bash
npm run build          # Typecheck + Build
npm test               # Unit-Tests (Vitest, tests/unit)
npm run test:e2e       # E2E (Playwright, tests/e2e) – startet Preview-Server und lokalen PeerServer selbst
npm run check:levels   # nur nötig bei Änderungen an world.ts / jumpsim.ts / Physik-Konstanten
```

Die CI (`.github/workflows/ci.yml`) führt alles bei jedem PR aus. Ein Push auf `master` deployt auf GitHub Pages.

## Regeln

- **Determinismus**: Weltgenerator (`world.ts`, `jumpsim.ts`, `rng.ts`) darf nur `+ − × ÷`, `Math.sqrt` und `Rng` verwenden – keine `Math.sin/cos/random/hypot`. Host und Gast erzeugen die Welt getrennt aus demselben Seed.
- **Simulation nur über Commands** (`grip`/`jump`) in festen Ticks; im Online-Modus simuliert nur der Host.
- **Physik-Änderungen** (Sprungkraft, Seil, Tiergröße, Materialien) können generierte Sprünge ungültig machen: danach `npm run check:levels` laufen lassen und ggf. Konstanten in `jumpsim.ts` nachkalibrieren.
- **UI ohne Text**: nur Emojis/Icons; Buttons bekommen ein `aria-label`.

## Tests schreiben

- Spielzustand ist für Tests über `window.__game()` / `window.__renderer` erreichbar (siehe `main.ts`); Hilfsfunktionen in `tests/e2e/helpers.ts`.
- E2E prüft Zustände statt Pixel und setzt Situationen gezielt auf (z. B. `drown()`), statt zu spielen. Tests nicht von einem bestimmten Level-Layout abhängig machen.
- Online-E2E läuft mit `?peer=127.0.0.1:9000` gegen `scripts/peer-server.mjs`.
