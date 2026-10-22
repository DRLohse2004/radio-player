# Technische Informationen

Für Nutzer siehe [README.md](README.md). Diese Datei richtet sich an alle, die das Radio weiterentwickeln oder selbst bauen wollen.

## Überblick

| Bereich | Technik |
|---|---|
| Desktop-Hülle | Electron 38 (electron-builder baut den App-Ordner), eigener Starter für die portable `.exe` |
| Oberfläche | React 18 + TypeScript, gebaut mit Vite 5 |
| Webradio | `<audio>`-Element über einen lokalen Stream-Proxy (ICY-Metadaten) |
| Senderdaten | Radio-Browser-Datenbank (radio-browser.info) |
| Cover | iTunes Search API |
| Wetter | Open-Meteo |
| YouTube | [yt-dlp](https://github.com/yt-dlp/yt-dlp) als Hilfsprozess, Livestreams über hls.js |
| Spotify Connect | [go-librespot](https://github.com/devgianlu/go-librespot) v0.10.3 als Hilfsprozess |
| AirPlay-Empfang | eigener AirPlay-1-Empfänger (RAOP) in `electron/airplay/`, Bonjour über `multicast-dns` |
| Fernbedienung | Webserver im Hauptprozess (Port 80), Handy-Seite ohne Build, Server-Sent Events, QR per `qrcode` |
| Bluetooth-Empfang | eigenes C#-Hilfsprogramm `bt-receiver.exe` (Windows-API `AudioPlaybackConnection`) |

## Entwicklung

Voraussetzung: Node.js (getestet mit v24) unter Windows.

```
npm install
```

| Befehl | Zweck |
|---|---|
| `npm start` | Oberfläche bauen und als Desktop-App starten |
| `npm run dist` | Portable `.exe` nach `release/` bauen (braucht zusätzlich das .NET SDK für den Starter) |
| `npm run build:ico` | `build/icon.ico` (für den Starter) aus `build/icon.png` erzeugen |
| `npm test` | Unit-Tests (Vitest) für Titel-Erkennung, Sender-Store und ICY-Parser |
| `npm run typecheck` | TypeScript prüfen |
| `npm run dev` | Nur die Oberfläche im Browser (ohne Titel, Cover, Spotify; Sender im localStorage) |
| `npm run build:bt` | Bluetooth-Hilfsprogramm neu bauen (braucht .NET 9 SDK) |
| `npx electron scripts/make-icon.cjs` | `build/icon.png` neu aus `public/icon.svg` erzeugen |

Bei jedem Push und Pull Request laufen Typprüfung, Tests und Build automatisch auf GitHub Actions (`.github/workflows/ci.yml`, Ubuntu – die Windows-Teile werden dort nicht getestet).

## Aufbau

```
electron/main.cjs      Hauptprozess: Fenster, Stream-Proxy, Cover-/Logo-Suche, Sender-Store, Wetter,
                       Einstellungen speichern, Autostart
electron/icy.cjs       Trennt ICY-Metadaten (StreamTitle) vom Audiostrom
electron/spotify.cjs   Startet/überwacht go-librespot und schreibt dessen Konfiguration
electron/bluetooth.cjs Startet bt-receiver.exe und reicht dessen Ereignisse weiter
electron/remote.cjs    Webserver der Fernbedienung: API, Live-Zustand, Admin-PIN, Rechte
electron/remote/       index.html – die Handy-Seite (reines HTML/JS, kein Build)
electron/room.cjs      Rooms (Gast): andere Radios im Netz finden, Verbindung zum Host halten
electron/youtube.cjs   Ruft yt-dlp auf (Infos, Playlists, Audio-Adresse) und aktualisiert es
electron/airplay.cjs   Startet/stoppt den AirPlay-Empfänger und reicht Ton und Titelinfos weiter
electron/airplay/      raop.cjs (RTSP/RTP, Krypto), mdns.cjs (Bonjour), alac.cjs (Apple-Lossless-Decoder),
                       airport-key.cjs (öffentlich bekannter AirPort-Schlüssel)
electron/preload.cjs   Schnittstelle window.radioApi für die Oberfläche
src/App.tsx            Wiedergabe-Logik, Reiter, welche Quelle in der Mitte steht, Layout
src/layout.css         Schwebende Seitenleiste, YouTube-Liste
src/components/        Senderliste, Editor, Store, Player-Bausteine, Vollbild, Einstellungen; je Quelle eine
                       Seitenleiste (*Sidebar) und eine Ansicht für die Mitte (*Stage)
src/metadata.ts        Titel zerlegen, Inhaltsart erkennen (Musik/Nachrichten/Werbung/…)
src/store.ts           Genres, Betreiber-Zuordnung (nach Stream-Domain), Namensbereinigung
src/spotify.ts         React-Hook für die go-librespot-API (REST + WebSocket)
src/logo.ts            Logo-Kandidaten prüfen (Größe, Seitenverhältnis)
vendor/go-librespot/   go-librespot.exe + benötigte DLLs (Herkunft siehe HERKUNFT.md)
vendor/bt-receiver/    gebautes Bluetooth-Hilfsprogramm (Quelle: native/bt-receiver)
native/bt-receiver/    C#-Quellcode des Bluetooth-Hilfsprogramms
native/launcher/       C#-Starter der portablen .exe (.NET Framework 4.8, in Windows enthalten)
scripts/build-portable.cjs  Baut App-Ordner, ZIP und hängt es an den Starter
src/bluetooth.ts       React-Hook für den Bluetooth-Empfang
src/airplay.ts         React-Hook und AudioWorklet-Wiedergabe für AirPlay
src/remote.ts          React-Hook der Fernbedienung: Befehle ausführen, Wunschliste, Zustand senden
src/room.ts            React-Hooks für Rooms: Verbindung zum Host, Mithören (Radio/YouTube)
src/youtube.ts         React-Hook für YouTube: Warteschlange, hls.js, Vorab-Auflösen, Wiederaufnahme
vendor/yt-dlp/         yt-dlp.exe (Herkunft siehe HERKUNFT.md)
docs/screenshots/      Bilder für die README
```

### Stream-Proxy und Metadaten

Das `<audio>`-Element spielt `http://127.0.0.1:<port>/stream?url=…`. Der Proxy im Hauptprozess fordert den Sender mit
`Icy-MetaData: 1` an, filtert die Metadatenblöcke aus dem Audiostrom und meldet `StreamTitle`-Wechsel per IPC an die
Oberfläche. So braucht jeder Sender nur eine Verbindung, und der Proxy sendet `Access-Control-Allow-Origin: *`, damit die
WebAudio-Analyse für den Visualizer funktioniert.

### Inhaltserkennung

`parseStreamTitle()` in `src/metadata.ts` zerlegt „Interpret - Titel“ und ordnet per Schlüsselwörtern ein (Nachrichten,
Verkehr & Wetter, Werbung, Moderation). Eindeutige deutsche Begriffe gelten immer, mehrdeutige englische („News“, „Spot“)
nur, wenn der Text nicht wie ein Songtitel aussieht. Erwähnt der Text den Sendernamen, gilt er als Eigenwerbung.

### Reiter und Quellen

Der Reiter bestimmt nur die Seitenleiste. Die Mitte zeigt die zuletzt gestartete Quelle (`source` in `App.tsx`),
solange sie aktiv ist (Radio spielt, YouTube spielt/lädt, Spotify-Sitzung, AirPlay-Sitzung, Bluetooth verbunden) –
sonst die Quelle des offenen Reiters. Startet eine Quelle, halten die anderen an. Steuerung, Medientasten,
Windows-Medienanzeige und Vollbild folgen immer der Mitte.

### YouTube

`electron/youtube.cjs` ruft `yt-dlp.exe` auf: `--flat-playlist -J` für Infos und Playlists,
`-f bestaudio/best -J` für die Audio-Adresse eines Videos. YouTube verlangt inzwischen eine JavaScript-Laufzeit; dafür
dient die App selbst (`--js-runtimes node:<Radio.exe>` mit `ELECTRON_RUN_AS_NODE=1`).

- Die Oberfläche spielt die googlevideo-Adresse in einem zweiten `<audio>`-Element, das in dieselbe WebAudio-Kette
  (Lautstärke, Visualizer) hängt. Dafür setzt der Hauptprozess per `webRequest.onHeadersReceived` CORS-Header für
  `*.googlevideo.com`.
- Livestreams liefern HLS (`m3u8`) und laufen über hls.js.
- Adressen laufen nach einigen Stunden ab: Der nächste Playlist-Titel wird vorab aufgelöst (max. 1 h im Cache), bei
  einem Fehler wird einmal neu aufgelöst und an derselben Stelle weitergespielt.
- yt-dlp wird beim ersten Gebrauch nach `%LOCALAPPDATA%\RadioPlayer\yt-dlp` kopiert; „YouTube-Modul aktualisieren“
  führt dort `yt-dlp -U` aus. Ist die mitgelieferte Fassung neuer, ersetzt sie die Kopie.

### Fernbedienung

`electron/remote.cjs` startet einen HTTP-Server auf Port 80 (sonst 8080/8000) – WLANs, die Geräte voneinander
abschotten, lassen oft nur diesen Port durch. Die App bleibt die Quelle der Wahrheit:

- Die Oberfläche schickt ihren Zustand (`remote:state`: läuft gerade, Lautstärke, Sender, Wunschliste, Regeln) an den
  Hauptprozess, der ihn per Server-Sent Events (`/api/events`) an alle Handys verteilt.
- Befehle (`/api/command`, `/api/wish`) gehen als `remote:command` an die Oberfläche, die mit `remote:reply` antwortet.
  Die Wunsch-Regeln (pro Person, Höchstlänge, doppelte Songs) prüft `src/remote.ts`, die Gast-Rechte der Server.
- Zugang: Schlüssel `k` aus dem QR-Code (Einstellung `remote.key`, „Neuen QR-Code erzeugen“ wechselt ihn). Admin per
  PIN (`/api/admin`, max. 5 Versuche pro Minute und IP) – das Token gilt bis zum Neustart oder bis die PIN wechselt.
- Suche: `yt-dlp ytsearch12:`; Treffer werden zwischengespeichert, damit ein Wunsch ohne zweiten Abruf sofort steht.
- Wünsche spielen über `useYouTube({ nextWish })`: nach dem aktuellen Titel, danach geht die Playlist bzw. der
  Livestream weiter. Läuft gar nichts (auch kein pausierter YouTube-Titel), startet ein Wunsch sofort.
- Die Handy-Seite setzt alle Texte per `textContent` (keine HTML-Einschleusung über Songtitel oder Namen).

### Rooms

Ein Room ist die Fernbedienung für andere Radios – dieselbe HTTP-Schnittstelle wie fürs Handy, nur dass ein Radio sie
anspricht. So kommt sie auch durch Netze, in denen nur Port 80 offen ist.

- **Host:** `room.open` startet den Webserver der Fernbedienung (auch ohne Handy-Fernbedienung). `GET /api/room`
  (ohne Schlüssel) liefert `{ app: 'radio', name, version, open, listeners }` und – nur wenn der Room freigegeben ist –
  den Schlüssel. Radios melden sich mit `x-kind: radio` und erscheinen getrennt von Handys.
- **Finden:** `electron/room.cjs` fragt im eigenen /24-Netz jeder Netzwerkkarte `/api/room` auf Port 80 und 8080 ab
  (160 parallel, 0,8 s Zeitlimit, ca. 3 s). Andere Netze: Adresse von Hand.
- **Gast:** Der Hauptprozess hält die Server-Sent-Events-Verbindung (`room:event`), reicht Befehle, Suche, Wünsche und
  Admin-PIN weiter (`room:request`, nur `/api/command|search|wish|admin|state`) und verbindet bei Abbruch nach 3 s neu.
  Die Oberfläche zeigt dann `RoomView` statt der eigenen Quellen; die eigene Wiedergabe wird beendet.
- **Mithören:** Der Host schickt im Zustand `listen` mit: `{ kind: 'radio', url }` oder
  `{ kind: 'youtube', url, live, position, at }` (Sekunden bzw. Zeitstempel). Der Gast spielt den Sender über den eigenen
  Stream-Proxy (Session 0) bzw. löst das Video selbst mit yt-dlp auf und springt an `position + (jetzt − at)`; weicht
  er um mehr als 4 s ab, zieht er nach. Spotify, AirPlay und Bluetooth: `{ kind: 'none', reason }`.
- Ein pausierter YouTube-Titel zählt als aktive Quelle – „Play“ vom Handy oder Gast setzt ihn fort, statt das Radio zu
  starten.

### Portable .exe und Starter

Die Portable-Vorlage von electron-builder entpackt die App bei **jedem** Start neu in einen Temp-Ordner (~6 s, ohne
Anzeige). Deshalb baut `npm run dist` die portable .exe selbst:

1. electron-builder baut nur den App-Ordner (`--win dir`, Ausgabe außerhalb von OneDrive unter `%LOCALAPPDATA%\RadioBuild`).
2. Der Ordner wird als ZIP an den Starter `native/launcher` gehängt; am Dateiende stehen Version + Prüfsumme und die
   Startposition des ZIPs (Kennung `RADIOPK1`).
3. Der Starter entpackt einmalig nach `%LOCALAPPDATA%\RadioPlayer\app\<version>-<prüfsumme>` (mit Ladefenster), setzt
   `PORTABLE_EXECUTABLE_DIR/FILE` wie electron-builder und startet `Radio.exe`. Alte, nicht laufende Fassungen löscht er.

Gemessen: bisher 6,6 s bis zur fertigen Oberfläche bei jedem Start; jetzt 4,7 s beim ersten Start einer Version und
1,1 s danach. Zusätzlich zeigt `index.html` sofort einen Ladebildschirm und die App unten rechts, welche Dienste noch
starten (`StartupStatus`). `Radio.exe --splash-preview <datei.png>` zeichnet das Ladefenster des Starters in ein Bild.

### Automatische Updates

`electron/updater.cjs` fragt 15 s nach dem Start und danach alle 6 Stunden
`https://api.github.com/repos/DRLohse2004/radio-player/releases/latest` ab (öffentliches Repo, kein Token).

- Ist der Tag (`vX.Y.Z`) neuer als `app.getVersion()` und hängt eine Datei `Radio-portable.exe` am Release, lädt das
  Radio sie als `<exe>.update` neben die laufende .exe und prüft die Kennung `RADIOPK1` am Dateiende.
- „Jetzt neu starten“: alte .exe → `.old`, `.update` → .exe, neue .exe starten, App beenden. Der Starter läuft da
  längst nicht mehr, die .exe ist also nicht gesperrt. `.old` wird beim nächsten Start gelöscht.
- Nur als portable .exe (`PORTABLE_EXECUTABLE_FILE`); in der Entwicklung zeigt das Radio nur den Link zum Release.
- Test ohne GitHub: `RADIO_UPDATE_FEED=<url>` auf einen eigenen Server zeigen lassen, der dieselbe JSON-Form liefert.

### Spotify Connect

`electron/spotify.cjs` startet `go-librespot.exe` mit einer generierten `config.yml` (Zeroconf, optional Kopplung per
`device_auth`, lokale API auf zufälligem Port, Ton direkt über WASAPI). Die Oberfläche spricht anschließend direkt mit der
API: `/status`, `/player/*`, `/auth/code` und die WebSocket-Ereignisse unter `/events`.

- Konfiguration und Zugangsdaten liegen unter `%LOCALAPPDATA%\RadioPlayer\spotify` – bewusst nicht neben der .exe,
  damit sie nicht über Cloud-Ordner synchronisiert werden.
- Zum Testen ohne Spotify-Konto kann in der Entwicklung `RADIO_SPOTIFY_FAKE_PORT=<port>` gesetzt werden; die App
  verbindet sich dann mit einem Test-Dienst statt go-librespot zu starten.
- go-librespot ist GPL-3.0 lizenziert und wird unverändert als eigenständiges Programm mitgeliefert.

### AirPlay-Empfang

Ein klassischer AirPlay-1-Empfänger (RAOP), wie ihn auch shairport-sync im „classic“-Modus umsetzt:

- **Bonjour** (`electron/airplay/mdns.cjs`): kündigt `_raop._tcp` mit dem Namen `<Hardware-Adresse>@<Name>` an und
  beantwortet Anfragen (auch „Legacy-Unicast“ von anderen Ports). Bewusst ohne strenge Namenskonflikt-Prüfung:
  Bonjour-Gateways in größeren Netzwerken spiegeln Prüfanfragen sofort zurück, strenge Bibliotheken (z. B. `ciao`)
  benennen sich dann endlos um. Angekündigt wird über alle echten Netzwerkkarten (z. B. Kabel und WLAN). Feste Ports wie bei echten
  AirPlay-Geräten (TCP 7000, ersatzweise 5000; UDP 6001–6003), weil größere Netzwerke zwischen WLAN und LAN oft nur diese
  durchlassen.
- **RTSP** (`raop.cjs`): `OPTIONS` mit Apple-Challenge (Antwort = Challenge + lokale IP + Hardware-Adresse, mit dem
  AirPort-Schlüssel per RSA-PKCS#1 signiert), `ANNOUNCE` (SDP: ALAC-Parameter, RSA-OAEP-verschlüsselter AES-Schlüssel),
  `SETUP` (UDP-Ports), `RECORD`, `SET_PARAMETER` (Lautstärke, DMAP-Titelinfos, Cover, Fortschritt), `FLUSH`,
  `TEARDOWN`. AirPlay-2-Anfragen wie `GET /info` werden mit 404 beantwortet, damit Sender auf AirPlay 1 zurückfallen.
- **Audio**: RTP über UDP, pro Paket AES-128-CBC (nur volle 16-Byte-Blöcke, IV pro Paket neu), danach ALAC-Dekodierung
  (`alac.cjs`, Port von alac.js/Apple, Apache-2.0) zu 16-Bit-PCM. Die Oberfläche spielt das über ein AudioWorklet mit
  ca. 0,35 s Vorpuffer ab (`src/airplay.ts`); `window.radioAirplayDiagnostics.stats` zeigt Puffer und Aussetzer.
- **Nicht umgesetzt**: Fernsteuerung des iPhones (DACP) – Play/Pause/Weiter bleiben am iPhone; AirPlay 2 (Multiroom).
- **Getestet** mit pyatv als Sender (unverschlüsseltes PCM), einem Node-Simulator wie iOS (Apple-Challenge,
  RSA/AES, ALAC, DMAP mit Umlauten) und bitgenauem Vergleich komprimierter ALAC-Frames aus dem Windows-ALAC-Encoder.

### Bluetooth-Empfang

`native/bt-receiver` ist ein kleines .NET-9-Konsolenprogramm (eigenständig, getrimmt, ca. 11 MB). Es nutzt
`Windows.Media.Audio.AudioPlaybackConnection` (ab Windows 10 2004), um den PC als Bluetooth-Lautsprecher (A2DP-Senke)
bereitzustellen:

- Für jedes gekoppelte Gerät, das Audio senden kann, ruft es `StartAsync()` auf – damit kann sich das Handy von sich
  aus verbinden. `OpenAsync()` baut die Verbindung vom PC aus auf (Button „Verbinden“).
- Über `GlobalSystemMediaTransportControlsSessionManager` liest es Titel, Interpret, Album und Cover aller
  Windows-Medienquellen; die Oberfläche wählt die Bluetooth-Quelle aus (eigene Quelle „Radio/Electron“ ausgenommen).
- Kommunikation: JSON-Zeilen über stdin/stdout (Ereignisse `devices`, `state`, `media`, `sessions`; Befehle
  `connect`, `disconnect`, `media`, `quit`). Gekoppelte Handys erscheinen erst, wenn Windows ihre
  A2DP-Schnittstelle aktiviert – meist sobald das Handy in Reichweite ist bzw. sich verbindet.
- Zusätzlich meldet es das Standard-Ausgabegerät (`MediaDevice.GetDefaultAudioRenderId`, Ereignis `output`); die
  Oberfläche warnt bei Funk-Headsets (`isWirelessOutput()` in `src/bluetooth.ts`).
- Die Tonqualität liegt allein bei Windows: Der Audiostrom läuft vom Bluetooth-Stack direkt in die Audio-Engine, das
  Hilfsprogramm öffnet nur die Verbindung. Aussetzer auf manchen Notebooks (z. B. Intel-Chips mit „Smart Sound
  Technologie für Bluetooth-Audio“) treten auch ohne die Radio-App auf.
- Wegen Trimming nur trimm-sichere `System.Text.Json`-Aufrufe verwenden (z. B. `JsonValue.Create`, Cast auf
  `JsonNode` bei `JsonArray.Add`).

### Speicherorte

| Was | Wo |
|---|---|
| Sender, Einstellungen, Verlauf, Merkliste | `RadioPlayer-Daten/radio-settings.json` neben der portablen .exe (Ausweichort: `%APPDATA%\Radio`) |
| Spotify-Konfiguration und -Zugangsdaten | `%LOCALAPPDATA%\RadioPlayer\spotify` |
| Gespeicherte YouTube-Links | in `radio-settings.json` (Feld `youtube`) |
| Aktualisierbare yt-dlp-Kopie | `%LOCALAPPDATA%\RadioPlayer\yt-dlp` |
| Entpackte App (vom Starter) | `%LOCALAPPDATA%\RadioPlayer\app\<version>-<prüfsumme>` |
| Fernbedienung (Schlüssel, PIN, Regeln) | in `radio-settings.json` (Feld `prefs.remote`) |

## Release veröffentlichen

1. Version in `package.json` erhöhen.
2. `npm run dist` – erzeugt `release/Radio-<version>-portable.exe` (Starter + App).
3. Für einen festen Download-Link die Datei als `Radio-portable.exe` an ein GitHub-Release hängen, z. B.:

   ```
   copy release\Radio-1.1.0-portable.exe %TEMP%\Radio-portable.exe
   gh release create v1.1.0 %TEMP%\Radio-portable.exe --title "Radio 1.1.0" --notes "…"
   ```

   Der Link `releases/latest/download/Radio-portable.exe` in der README zeigt dann automatisch auf die neueste Version.
   **Wichtig für die automatischen Updates:** Tag im Format `vX.Y.Z` (passend zu `package.json`) und die Datei genau
   `Radio-portable.exe` nennen – daran erkennen installierte Radios die neue Version.

## Bekannte Eigenheiten

- **OneDrive:** Liegt das Projekt in OneDrive, kann `npm install` mit `EPERM`- oder `UNKNOWN: read`-Fehlern abbrechen,
  weil OneDrive frisch geschriebene Dateien kurz sperrt. Erneut ausführen oder die Synchronisierung kurz pausieren.
  `npm run dist` baut deshalb außerhalb von OneDrive (`%LOCALAPPDATA%\RadioBuild`).
- **Firewall:** Die entpackte App liegt pro Version in einem neuen Ordner – Windows fragt dann einmal neu nach der
  Freigabe für eingehende Verbindungen (Fernbedienung, AirPlay, Spotify Connect).
- **Nur eine Instanz:** Läuft die Entwicklungsfassung (`npm start`), beendet sich eine gleichzeitig gestartete
  gepackte App sofort wieder.
- **Windows-Rendering:** Die App schaltet die Hintergrund-Drosselung und die Verdeckungserkennung von Chromium ab
  (`backgroundThrottling: false`, `CalculateNativeWinOcclusion`), damit ein Dauer-Display auf einem Zweitmonitor
  zuverlässig aktualisiert wird.
- **HLS-Streams** (`.m3u8`) spielt der Radio-Player nicht ab; der Sender-Store blendet sie aus. (YouTube-Livestreams
  laufen über hls.js im YouTube-Player.)
- Die `.exe` ist nicht signiert, daher die SmartScreen-Warnung beim ersten Start.

## Fremdcode und Lizenzen

| Was | Herkunft | Lizenz |
|---|---|---|
| ALAC-Decoder (`electron/airplay/alac.cjs`) | alac.js (audiocogs/OFMLabs), basierend auf Apples ALAC-Referenz | Apache 2.0 (`electron/airplay/LICENSE-alac-Apache-2.0.txt`) |
| AirPort-Schlüssel (`electron/airplay/airport-key.cjs`) | öffentlich bekannt, u. a. in shairport-sync | – |
| go-librespot + DLLs | siehe `vendor/go-librespot/HERKUNFT.md` | GPL-3.0 u. a. |
| multicast-dns, dns-packet | npm | MIT |
| qrcode | npm | MIT |
| hls.js | npm | Apache 2.0 |
| yt-dlp | siehe `vendor/yt-dlp/HERKUNFT.md` | Unlicense |
| Schriften der Designs (Archivo, IBM Plex Mono, VT323, Saira Condensed, Share Tech Mono, Anton, Work Sans, Syne, Instrument Sans, Barlow, Barlow Condensed) | npm `@fontsource/*`, beim Build eingebettet | SIL Open Font License 1.1 |

## Externe Dienste

| Dienst | Wofür | Übertragene Daten |
|---|---|---|
| iTunes Search API (Apple) | Album-Cover | Interpret und Titel |
| radio-browser.info | Sender-Store, Logos | Suchbegriffe, Sendername, Stream-Adresse |
| Webseiten der Sender | Logos | normaler Seitenabruf |
| Open-Meteo | Wetter | eingestellter Ort |
| Spotify (über go-librespot) | Spotify Connect | Spotify-Anmeldung und Wiedergabe |
| YouTube (über yt-dlp) | YouTube-Reiter | gespeicherte Links, Abruf von Infos und Audio (ohne Anmeldung) |
