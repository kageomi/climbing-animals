# 🐸〰️🐵 Huckepack-Seil (climbing-animals)

Physikbasiertes Koop-Kletterspiel für den Smartphone-Browser: Zwei Tier-Emojis hängen an einem elastischen Seil und klettern gemeinsam einen endlosen Turm hinauf.

Game Design: [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md)

## Status: Solo-Prototyp

Ein Gerät steuert beide Tiere (Online-Koop folgt später).

| Geste | Wirkung |
|---|---|
| Finger halten | Das nächstgelegene Tier krallt sich fest (nicht auf 🧊 / 🍄) |
| Finger ziehen | Zielen – Sprung geht entgegen der Zugrichtung, Länge = Kraft |
| Loslassen | Springen (nur mit Halt, nicht aus dem Wasser) |
| Zwei Finger | Jeder Finger steuert ein Tier |

- Die **Form des Emojis** wird zum Kollisionskörper (konvexe Hülle der Silhouette).
- Zonen: Teich 🪷 → Wald 🌲 → Berg 🪨 → Himmel ☁️
- 🍄 Trampolin, 🧊 rutschig, ☁️ von unten durchspringbar, 🐝 / 🌵 stoßen weg
- 🚩 Checkpoint alle 50 m. Liegen beide Tiere im Wasser 🌊 → Game Over → Neustart am Checkpoint
- `?seed=123` in der URL fixiert die Welt (zum Debuggen)

## Entwicklung

```bash
npm install
npm run dev        # Dev-Server (auch im LAN erreichbar → mit dem Handy testen)
npm run build      # Typecheck + Produktions-Build nach dist/
```

Stack: Vite + TypeScript + [Matter.js](https://brm.io/matter-js/), Rendering mit Canvas 2D.

```
src/
  config.ts   Tuning-Werte (Sprungkraft, Seil, Wasser …)
  game.ts     Simulation (Matter.js), Commands, Seil, Festhalten, Gefahren
  world.ts    Prozedurale Welt aus Seed, Zonen & Materialien
  emoji.ts    Emoji-Sprites und Silhouette → Kollisionskörper
  render.ts   Canvas-Rendering, Kamera, Zielvorschau
  input.ts    Slingshot-Touch-Steuerung (Solo)
  main.ts     Menü, Game-Loop (fester 60-Hz-Takt)
```

Die Simulation wird nur über `Command`s verändert (`grip` / `jump`) und läuft im festen Takt – so kann der Host im Online-Modus später die Commands des Gastes einfach mit anwenden.

## Deployment

`.github/workflows/deploy.yml` baut bei jedem Push auf `master` und veröffentlicht auf GitHub Pages.
Einmalig nötig: **Settings → Pages → Source: „GitHub Actions“**.
