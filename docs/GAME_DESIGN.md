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

- **Material-Effekte**: 🧊 Eis = rutschig, 🍄 Pilz = Trampolin, ☁️ Wolke = von unten durchspringbar.
- **Gefahren**: 🌵 Kaktus, 🐝 Biene – stoßen das Tier weg.
- Später: bewegliche Plattformen, Sammelobjekte.

## 7. Scheitern, Checkpoints, Score

- **Boden = Wasser 🌊**, bleibt zunächst **unten** (statisch).
  - **(offen)** Wenn es sich besser anfühlt: steigendes Wasser als Zeitdruck.
- Fällt **ein** Tier ins Wasser, gibt es noch eine Chance (der Partner kann es herausziehen).
- **Berühren beide das Wasser → Game Over.**
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
- ⬜ Balancing per Playtest
