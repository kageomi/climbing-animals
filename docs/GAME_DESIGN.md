# 🐸 Huckepack-Seil – Game Design (Basis)

> Arbeitstitel. Ergebnis des Basis-Interviews. Punkte mit **(offen)** sind noch zu entscheiden bzw. per Playtest zu prüfen.

## 1. Kernidee

Physikbasiertes 2-Spieler-Koop-Kletterspiel im Smartphone-Browser. Zwei Tier-Emojis sind durch ein elastisches Seil verbunden und klettern gemeinsam einen endlosen, nach oben wachsenden Turm hinauf.

## 2. Plattform & Multiplayer

| Thema | Entscheidung |
|---|---|
| Plattform | Mobiler Browser, veröffentlicht über **GitHub Pages** (automatisches Deploy) |
| Multiplayer | **Online, 2 Geräte** – jeder Spieler steuert sein eigenes Tier |
| Verbindung | **WebRTC P2P** (z. B. PeerJS mit öffentlichem Signaling-Server), kein eigenes Backend |
| Matchmaking | **Einladungs-Link / QR-Code**: Host erstellt Raum, teilt Link, Gast öffnet ihn |
| Physik-Autorität | **Host simuliert alles**; Gast sendet nur Eingaben und erhält Zustände (mit Interpolation) |
| Solo-Modus | Trainings-/Dev-Modus: 1 Gerät steuert beide Tiere |
| UI-Sprache | **Fast textlos** – Emojis/Icons statt Text |

## 3. Steuerung

Keine Buttons. Ein Finger pro Spieler (auf dem eigenen Gerät).

- **Finger halten** (irgendwo auf dem Bildschirm) → Tier **krallt sich fest** (Anker).
- **Finger ziehen** → Ziel-Pfeil erscheint (Slingshot). Das Tier bleibt dabei festgekrallt.
  - Richtung = Absprungwinkel (entgegen der Zugrichtung)
  - Zuglänge = Sprungkraft (mit Maximum)
- **Loslassen** → Sprung.
- **Kein Finger** → Tier steht dank Reibung normal, wird aber vom Seil weggezogen, wenn der Partner zieht/fällt.
- **Springen nur mit Halt** (auf Plattform/Wand). Frei am Seil hängend kann man nicht springen – der Partner muss ziehen.
- **Keine Steuerung in der Luft.**

## 4. Seil

- **Elastisch mit Maximallänge**: locker bis Länge L, darüber Gummiband-Dehnung mit Rückstellkraft (Katapult-Effekt).
- **Kollidiert mit Plattformen**: Seil aus Gliedern (Matter.js-Constraints), kann über Kanten hängen → Partner über Kante ziehen.
- Maximallänge so gewählt, dass beide Tiere immer gemeinsam ins Bild passen.

## 5. Tiere

- **Freie Wahl** des Emojis (🐸🐵🐱🐨🐧🐍🐡 …).
- **Die Form des Emojis bestimmt die Physik**: Das Emoji wird offscreen gerendert, die Silhouette (Alpha-Kanal) wird zu einem Kollisionskörper vereinfacht; die Masse ergibt sich aus der Fläche.
  - Beispiel: 🐍 lang & dünn, 🐡 rund & rollt.
- **(offen)** Grenzen/Normalisierung, damit kein Emoji unspielbar oder übermächtig wird.

## 6. Welt

- **Endlos vertikal**, Kamera hält **beide Tiere im Bild** (gleiche Ansicht auf beiden Geräten).
- **Prozedural mit gemeinsamem Seed** → beide Geräte erzeugen dieselbe Welt.
- **Zonen nach Höhe**: Teich 🌊🪷 → Wald 🌲🍄 → Berg 🪨❄️ → Himmel ☁️⭐🌙 (→ Weltraum 🚀🪐 als spätere Erweiterung).
- **Plattformen aus Emoji-Kacheln** (🪨 Fels, 🪵 Holz, 🧊 Eis, ☁️ Wolke).

### Elemente (Basis-Version)

- **Material-Effekte**: 🧊 Eis = rutschig (kein Festhalten, man rutscht nach), 🍄 Pilz = Sprungplattform (Landung federt ab und beruhigt sich, Sprung vom Pilz ist 40 % stärker), ☁️ Wolke = von unten durchspringbar.
- **Gefahren**: 🌵 Kaktus, 🐝 Biene – stoßen das Tier weg.
- Später: bewegliche Plattformen, Sammelobjekte.

### Leveldesign: garantiert kletterbar, schwerer mit der Höhe

Der Generator (`src/world.ts`) baut einen **Hauptweg** und prüft jeden Schritt mit einem Sprung-Simulator (`src/jumpsim.ts`), der die Spielphysik nachbildet:

- Ein Schritt wird nur angenommen, wenn es einen Sprung dorthin gibt – mit der Tiergröße (inkl. Drehung), dem festhaltenden Partner daneben als Hindernis, der Seil-Reichweite, Abstand zu 🌵/🐝, Sicherheitsabstand über der Zielkante und auf 🧊/🍄 einer sicheren Landung bei lockerem Seil.
- **Vorausschau**: Von der neuen Plattform muss es mindestens einen weiteren Schritt geben; dieser wird gemerkt und dient als garantierte Notlösung.
- **Abzweigungen, Kakteen, Bienen** kommen nur dazu, wenn sie keinen der letzten Sprünge und nicht den Weg nach oben blockieren (betroffene Sprünge werden wenn möglich umgeplant).
- Der Simulator nutzt nur exakt definierte Rechenoperationen → Host und Gast erzeugen auch auf verschiedenen Browsern dieselbe Welt.
- Der Generator läuft in einem **Web Worker** und hält ~150 m Welt im Voraus bereit; ein Schritt kostet auf langsamen Handys bis ~100 ms, das Spiel ruckelt dadurch nicht.

**Schwierigkeit** steigt bis 300 m und bleibt dann konstant:

| | unten | ab 300 m |
|---|---|---|
| Plattformbreite (Hauptweg) | 3–5 Kacheln | 3 Kacheln |
| Höhenabstand | 70–95 | 100–150 |
| erlaubte Sprungkraft | ≤ 70 % | ≤ 92 % |
| Abzweigungen | 50 % der Schritte | 25 % |
| 🧊/🌵/🐝 | je nach Zone (Berg/Himmel mehr) | |

**Prüfung**: `npm run check:levels` erzeugt 200 Welten bis 500 m und prüft jeden Schritt erneut (läuft in der CI bei jedem PR). Zusätzlich wurden die gefundenen Sprünge in der echten Matter.js-Physik nachgespielt (Partner hält fest, Springer greift nach der Landung zu).

## 7. Scheitern, Checkpoints, Score

- **Boden = Wasser 🌊**, bleibt zunächst **unten** (statisch).
  - **(offen)** Wenn es sich besser anfühlt: steigendes Wasser als Zeitdruck.
- **Berührt ein Tier das Wasser → Game Over.** (Ursprünglich: erst wenn beide im Wasser sind – nach dem ersten Playtest verschärft.)
- **Checkpoints 🚩**: Flagge auf breiter Plattform alle ~X Meter.
  - **(offen)** Wert X; ob das Wasser unter dem Checkpoint mit nachrückt; ob es begrenzte Leben ❤️ gibt.
- **Score: maximale Höhe in Metern.**

## 8. Technik

**Empfehlung:** Vite + TypeScript + Matter.js (direkt, ohne Phaser) + PeerJS, Rendering per Canvas 2D.

Begründung:

- Host-autoritative Netzwerk-Physik braucht volle Kontrolle über den Fixed-Timestep-Loop und die Zustands-Serialisierung.
- Alles wird als Emoji gezeichnet – dafür reicht Canvas 2D.
- Die Emoji-Silhouette→Körper-Pipeline braucht direkten Matter.js-Zugriff.
- Kleines Bundle, schneller Start auf dem Handy.
- Deploy per GitHub Actions auf GitHub Pages.

Alternative: Phaser 3 (Game-Framework mit eingebautem Matter.js) – lohnt eher bei vielen Sprites, Animationen und Menüs.

### Grafik: Skins statt fest verdrahteter Emojis

Emoji-Kacheln wirken als Bühne unruhig. Damit Grafiken später separat erzeugt und ausgetauscht werden können (geplant: Pixel-Art), kennt das Spiel nur **Asset-IDs**; was gezeichnet wird, legt ein **Skin** fest (`src/assets.ts`).

- Welt und Generator enthalten keine Grafik mehr: Plattformen haben ein Material (`log`, `ice` …), Wände eine `WallId` (`reeds`, `forest`, `mountain`, `sky`).
- Ein Skin ist ein Ordner `public/skins/<name>/` mit `skin.json` und Bilddateien (SVG oder PNG). Geladen wird `DEFAULT_SKIN`, zum Ausprobieren `?skin=<name>`.
- **Fehlt eine Grafik oder lädt sie nicht, wird das Emoji gezeichnet** – ein Skin kann also schrittweise gefüllt werden.
- `"pixelated": true` schaltet die Bildglättung ab (scharfe Pixel-Art bei jeder Skalierung).
- Plattformen werden als Reihe gezeichnet: optional mit eigener linker/rechter Endkappe, damit sie wie ein Stück aussehen.
- Jede Grafik füllt genau ihre Kachel (`tile` = 28 Welteinheiten breit, Höhe nach Seitenverhältnis), Flaggen 1,2 Kacheln.
- **Tiere bleiben Emojis**: Ihre Silhouette ist ihr Kollisionskörper; eigene Tiergrafiken würden die Physik ändern (danach `npm run check:levels`).

```json
{
  "pixelated": true,
  "assets": {
    "platform.log": { "left": "log-left.png", "mid": "log.png", "right": "log-right.png" },
    "platform.ice": "ice.png",
    "wall.forest": "forest-wall.png",
    "hazard.bee": "bee.png"
  }
}
```

| Asset-ID | Fallback |
|---|---|
| `platform.log` / `lotus` / `leaf` / `mushroom` / `rock` / `ice` / `cloud` / `star` | 🪵 🪷 🍃 🍄 🪨 🧊 ☁️ 🌟 |
| `wall.reeds` / `forest` / `mountain` / `sky` | 🌾 🌲 🪨 ☁️ |
| `hazard.bee` / `hazard.cactus` | 🐝 🌵 |
| `flag` / `flag.reached` | 🚩 🏁 |
| `water.wave` | 🌊 |

## 9. Offene Punkte für Playtests

- Sprungkraft, Seillänge, Elastizität, Reibung
- Checkpoint-Abstand
- Statisches vs. steigendes Wasser
- Normalisierung der Emoji-Formen
- Netzwerk-Latenz-Gefühl beim Gast (ggf. Client-Prediction für das eigene Tier)

## 10. Umsetzungsstand

- ✅ Solo-Prototyp: Steuerung, Seil (Glieder, elastisch, kollidiert mit Plattformen), Festhalten, Emoji-Form-Physik, Zonen, Materialien, Gefahren, Wasser, Checkpoints, Höhen-Score + lokaler Highscore
- ✅ GitHub-Pages-Deploy per Actions
- ✅ Online-Koop: WebRTC/PeerJS, Einladungslink + QR + Raum-Code, Host-Autorität mit Snapshot-Interpolation, Heartbeat/Disconnect-Erkennung
- ⬜ Client-Prediction für das eigene Tier des Gastes (falls sich die Latenz schlecht anfühlt)
- ⬜ TURN-Fallback prüfen, falls sich manche Handys nicht verbinden können
- ✅ Leveldesign: garantiert kletterbarer Hauptweg mit Schwierigkeitskurve bis 300 m
- ⬜ Koop-Stellen, die nur mit Seil/Partner schaffbar sind (ab mittlerer Höhe) – braucht eine Seil-Simulation im Generator
- ⬜ Balancing per Playtest
- ✅ Skin-System für Grafiken (Asset-IDs, `skin.json`, Emoji-Fallback, Pixel-Art-Modus)
- ⬜ Erster eigener Skin (Pixel-Art) für Plattformen, Wände, Wasser, Gefahren
