# 🐸〰️🐵 Huckepack-Seil (climbing-animals)

Physikbasiertes Koop-Kletterspiel für den Smartphone-Browser: Zwei Tier-Emojis hängen an einem elastischen Seil und klettern gemeinsam einen endlosen Turm hinauf.

Game Design: [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md)

## Spielmodi

- **▶️ Solo**: Ein Gerät steuert beide Tiere.
- **👥 Online zu zweit**: Jeder spielt auf seinem eigenen Handy.
  1. Spieler A tippt 👥 → es erscheinen QR-Code, Raum-Code und 📤 (Link teilen).
  2. Spieler B scannt den QR-Code oder öffnet den Link, wählt sein Tier und tippt ▶️.
  3. Das Spiel startet auf beiden Geräten. ▼ markiert das eigene Tier; jede Berührung steuert nur das eigene Tier.

| Geste | Wirkung |
|---|---|
| Finger halten | Das nächstgelegene Tier krallt sich fest (nicht auf 🧊) |
| Finger ziehen | Zielen – Sprung geht entgegen der Zugrichtung, Länge = Kraft |
| Loslassen | Springen (nur mit Halt, nicht aus dem Wasser) |
| Zwei Finger (Solo) | Jeder Finger steuert ein Tier |

- Die **Form des Emojis** wird zum Kollisionskörper (konvexe Hülle der Silhouette).
- Zonen: Teich 🪷 → Wald 🌲 → Berg 🪨 → Himmel ☁️
- 🍄 Sprungplattform (+40 % Sprungkraft), 🧊 rutschig, ☁️ von unten durchspringbar, 🐝 / 🌵 stoßen weg
- 🚩 Checkpoint alle 50 m. Berührt ein Tier das Wasser 🌊 → Game Over → 🚩 Neustart am Checkpoint oder 🎲 neue Stage (online ohne neu verbinden, jeder der beiden kann wählen)
- Jede Welt ist **garantiert kletterbar** und wird bis 300 m schwerer (siehe [Leveldesign](docs/GAME_DESIGN.md#leveldesign-garantiert-kletterbar-schwerer-mit-der-höhe))

## Entwicklung

```bash
npm install
npm run dev        # Dev-Server (auch im LAN erreichbar → mit dem Handy testen)
npm run build      # Typecheck + Produktions-Build nach dist/
npm run check:levels   # 200 Welten erzeugen und prüfen, dass jeder Schritt schaffbar ist
```

Stack: Vite + TypeScript + [Matter.js](https://brm.io/matter-js/), Rendering mit Canvas 2D.

```
src/
  config.ts   Tuning-Werte (Sprungkraft, Seil, Wasser …)
  game.ts     Simulation (Matter.js), Commands, Seil, Festhalten, Gefahren
  world.ts    Prozedurale Welt aus Seed: verifizierter Hauptweg, Zonen & Materialien
  jumpsim.ts  Sprung-Simulator für den Generator (Spielphysik nachgebildet)
  worldWorker.ts / workerFeed.ts  Generator läuft in einem Web Worker (kein Ruckeln)
  emoji.ts    Emoji-Sprites und Silhouette → Kollisionskörper
  render.ts   Canvas-Rendering, Kamera, Zielvorschau
  input.ts    Slingshot-Touch-Steuerung (Solo: beide Tiere, online: eigenes Tier)
  net.ts      Online-Verbindung (PeerJS/WebRTC), Heartbeat, Snapshot-Interpolation
  main.ts     Menü, Lobby, Game-Loop (fester 60-Hz-Takt)
```

### Online-Architektur

- **Verbindung**: WebRTC Peer-to-Peer über [PeerJS](https://peerjs.com/). Der kostenlose öffentliche PeerJS-Server vermittelt nur den Verbindungsaufbau; danach laufen die Daten direkt zwischen den Handys.
- **Host-Autorität**: Das einladende Gerät (Tier 0) simuliert die Physik. Der Gast schickt nur seine `Command`s (`grip` / `jump`) für Tier 1 und bekommt ~30 Snapshots pro Sekunde zurück.
- **Gleiche Welt**: Beide erzeugen die Welt aus demselben Seed; synchronisiert werden nur Tiere, Seil, Tick, Checkpoint und Spielstatus.
- **Glättung**: Der Gast rendert ~100 ms in der Vergangenheit und interpoliert zwischen Snapshots.
- **Verbindungsabbruch**: Ping jede Sekunde; nach 6 s Stille oder beim Schließen der Seite sieht der Partner 🔌.

Debug-Parameter: `?seed=123` fixiert die Welt, `?peer=127.0.0.1:9000` nutzt einen eigenen PeerServer (z. B. `npx peerjs --port 9000`).

## Deployment

`.github/workflows/deploy.yml` baut bei jedem Push auf `master` und veröffentlicht auf GitHub Pages.
Einmalig nötig: **Settings → Pages → Source: „GitHub Actions“**.
