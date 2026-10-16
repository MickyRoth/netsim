# NetSim

Webbasierte Netzwerksimulation nach dem Vorbild von Cisco Packet Tracer – reines HTML/CSS/JavaScript ohne Build-Schritt und ohne externe Bibliotheken.

**Online ausprobieren:** https://mickyroth.github.io/netsim/

## Starten

- **Direkt aus dem Dateisystem:** `index.html` im Browser öffnen (Doppelklick).
- **Auf einem Webserver:** den ganzen Ordner hochladen – oder lokal z. B. `python -m http.server 8765` ausführen.

## Funktionen (erster Entwurf)

| Gerät | Konfiguration |
|---|---|
| PC, Server | IP / Subnetzmaske / Gateway oder DHCP, Terminal (`ping`, `tracert`, `ipconfig`) |
| Server | zusätzlich DHCP-Server (Pool, Gateway, Anzahl) |
| Switch (8 Port) | VLANs anlegen/löschen, Ports als Access (mit VLAN) oder Trunk |
| Router (3 Port) | IP/Maske je Port, Port aktiv/deaktiviert, statische Routen, CLI (`ping`, `traceroute`, `show ip route`, `show ip interface brief`, `show running-config`) |

Außerdem: Drag & Drop, Verkabeln per Maus, Zoom/Verschieben, Rückgängig/Wiederholen, Speichern/Öffnen (`.netsim`, JSON), Grafik in die Zwischenablage kopieren, PNG-/SVG-Export, automatisches Zwischenspeichern im Browser.

## Aufbau

| Datei | Inhalt |
|---|---|
| `js/util.js` | IPv4-Hilfsfunktionen |
| `js/model.js` | Gerätetypen (`DEVICE_TYPES`), Datenmodell, Laden/Speichern |
| `js/icons.js` | Gerätesymbole (SVG) und Symbole der Werkzeugleiste |
| `js/sim.js` | Simulation: Schicht 2 mit VLANs, Routing, ARP, DHCP, Ping |
| `js/canvas.js` | Arbeitsfläche: Darstellung, Maus, Zoom, Export, Paketanimation |
| `js/terminal.js` | PC-Eingabeaufforderung und Router-CLI |
| `js/windows.js` | Gerätefenster mit Reitern (`PANELS`) |
| `js/app.js` | Werkzeugleiste, Palette, Dateien, Rückgängig, Beispielnetz |

## Neues Gerät hinzufügen

1. `DEVICE_TYPES` in `model.js`: Größe und Anschlüsse; Standardwerte in `Model.defaults`.
2. Symbol in `icons.js` (Funktion mit dem Typnamen).
3. Reiter in `PANELS` (`windows.js`), Eintrag in `PALETTE` (`app.js`).
4. Verhalten in `sim.js` (z. B. `forward`, `l2Reach`).
