// Baut die portable Radio.exe: eigener Starter (native/launcher) + App als ZIP dahinter.
// Der Starter entpackt die App nur einmal pro Version – danach startet das Radio sofort
// (die Portable-Vorlage von electron-builder entpackt bei jedem Start ~250 MB neu).
//
// Aufruf: npm run dist   (vorher baut "npm run build" die Oberfläche)

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
// Außerhalb von OneDrive bauen: OneDrive sperrt frisch entpackte Ordner (EPERM beim Umbenennen)
const out = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'RadioBuild');
const unpacked = path.join(out, 'win-unpacked');
const zipFile = path.join(out, 'app.zip');
const launcherDir = path.join(out, 'launcher');
const target = path.join(root, 'release', `Radio-${version}-portable.exe`);

const step = (text) => console.log(`\n▶ ${text}`);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32', ...opts });

step('App mit electron-builder bauen (Ordner)');
run('npx', ['electron-builder', '--win', 'dir', `-c.directories.output="${out}"`]);

step('Starter bauen');
run('dotnet', ['build', 'native/launcher/Launcher.csproj', '-c', 'Release', '-o', `"${launcherDir}"`, '-nologo', '-v', 'q']);

step('App packen (ZIP)');
fs.rmSync(zipFile, { force: true });
execFileSync(
  'powershell',
  [
    '-NoProfile',
    '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory('${unpacked}', '${zipFile}', [IO.Compression.CompressionLevel]::Optimal, $false)`,
  ],
  { stdio: 'inherit' },
);

step('Starter + App zusammenfügen');
const launcher = fs.readFileSync(path.join(launcherDir, 'Radio.exe'));
// Prüfsumme im Ordnernamen: Ein neuer Build mit gleicher Versionsnummer wird trotzdem neu entpackt
const hash = crypto.createHash('sha1');
const hfd = fs.openSync(zipFile, 'r');
const chunk = Buffer.alloc(4 * 1024 * 1024);
let n;
while ((n = fs.readSync(hfd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, n));
fs.closeSync(hfd);
const versionBytes = Buffer.from(`${version}-${hash.digest('hex').slice(0, 8)}`, 'utf8');
const trailer = Buffer.alloc(4 + 8);
trailer.writeInt32LE(versionBytes.length, 0);
trailer.writeBigInt64LE(BigInt(launcher.length), 4);
fs.mkdirSync(path.dirname(target), { recursive: true });
const fd = fs.openSync(target, 'w');
fs.writeSync(fd, launcher);
// ZIP in Blöcken anhängen (über 100 MB)
const zfd = fs.openSync(zipFile, 'r');
const buffer = Buffer.alloc(4 * 1024 * 1024);
let read;
while ((read = fs.readSync(zfd, buffer, 0, buffer.length, null)) > 0) fs.writeSync(fd, buffer, 0, read);
fs.closeSync(zfd);
fs.writeSync(fd, versionBytes);
fs.writeSync(fd, trailer);
fs.writeSync(fd, Buffer.from('RADIOPK1', 'ascii'));
fs.closeSync(fd);

const size = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
console.log(`\n✔ ${path.relative(root, target)} (${size} MB)`);
