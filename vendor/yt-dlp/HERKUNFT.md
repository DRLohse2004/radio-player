# Herkunft der Dateien in diesem Ordner

Drittsoftware für den YouTube-Reiter. Sie wird beim Bauen unverändert in die App kopiert (`extraResources` in `package.json`).

## yt-dlp.exe

- Projekt: https://github.com/yt-dlp/yt-dlp (Lizenz: Unlicense / gemeinfrei, siehe `LICENSE-yt-dlp.txt`)
- Version: 2026.08.19, Datei `yt-dlp.exe` aus den GitHub-Releases
- SHA256: `66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a` (mit `SHA2-256SUMS` des Releases abgeglichen)

## Hinweis

YouTube ändert öfter etwas an der Seite. Die App kopiert yt-dlp beim ersten Gebrauch nach
`%LOCALAPPDATA%\RadioPlayer\yt-dlp` und kann diese Kopie im YouTube-Reiter selbst aktualisieren
(„YouTube-Modul aktualisieren“). Ist die mitgelieferte Fassung neuer, ersetzt sie die Kopie.
