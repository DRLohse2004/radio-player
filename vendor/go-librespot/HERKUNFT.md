# Herkunft der Dateien in diesem Ordner

Diese Dateien sind nicht selbst geschrieben, sondern Drittsoftware für die Spotify-Connect-Funktion.
Sie werden beim Bauen unverändert in die App kopiert (`extraResources` in `package.json`).

## go-librespot.exe

- Projekt: https://github.com/devgianlu/go-librespot (Lizenz: GPL-3.0, siehe `LICENSE-go-librespot.txt`)
- Version: v0.10.3 vom 03.10.2026, Datei `go-librespot_windows_amd64.tar.gz` aus den GitHub-Releases
- SHA256 des Archivs: `d58659bbd66fc3c57029c7cc5d9c1a6d7d866bc1026f819bd95bc964d3e7872a`
- Quellcode zu genau dieser Version: https://github.com/devgianlu/go-librespot/tree/v0.10.3

## DLLs (Audio-Decoder und Laufzeit)

Der Windows-Build von go-librespot lädt diese Bibliotheken zur Laufzeit; sie stammen aus dem
offiziellen MSYS2-Paketarchiv https://repo.msys2.org/mingw/mingw64/ (Prüfsummen laut Paketdatenbank geprüft):

| Paket | Version | SHA256 |
|---|---|---|
| mingw-w64-x86_64-libvorbis | 1.3.7-3 | 3d68dc3ccb32f0ea230a4bbc19c8fd440893058437c49864c4e26b12d6cb078a |
| mingw-w64-x86_64-libogg | 1.3.6-1 | 7ef9ec16403e1489a37c3a5ce58b083408ba694c6882e673639e2250df98bb8b |
| mingw-w64-x86_64-flac | 1.5.0-2 | cf1713c63bd34a6ca24b231bee194c6ac319dcefa4cd41bb9fbb44c941bc6870 |
| mingw-w64-x86_64-mpg123 | 1.33.7-1 | 2928cf82017d27d394f383abadbae3137e3c0123a0c635b81f8192b62b8c1745 |
| mingw-w64-x86_64-libgcc | 16.2.0-6 | e0815432c4225892b0eef57055fe507fa0b9a036436f046605f6629696bd1b88 |
| mingw-w64-x86_64-libwinpthread | 14.0.0.r495.g63ebe6cdb-1 | 89cc97eb3c3a2d4f8a860e8b74eb396ce42e03dbb471dee9b2d6eaf23f72ef25 |

Lizenzen: libvorbis/libogg/FLAC (BSD-artig), mpg123 (LGPL-2.1), libgcc/libwinpthread (GPL mit Laufzeit-Ausnahme bzw. MIT/BSD).

## Hinweis

go-librespot ist ein inoffizieller Spotify-Connect-Client. Er benötigt Spotify Premium und kann jederzeit durch
Änderungen bei Spotify funktionsunfähig werden.
