// Starter der portablen Radio.exe.
//
// Aufbau der fertigen Datei:  [Starter.exe][App als ZIP][Version (UTF-8)][Länge Version: int32][Start ZIP: int64]["RADIOPK1"]
//
// Ablauf: Ist diese Version schon unter %LOCALAPPDATA%\RadioPlayer\app\<version> entpackt, wird die App sofort
// gestartet. Sonst wird einmalig entpackt – mit einem kleinen Ladefenster samt Fortschritt.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace RadioLauncher
{
    internal static class Program
    {
        private const string Magic = "RADIOPK1";
        private const string AppExe = "Radio.exe";

        [STAThread]
        private static int Main(string[] args)
        {
            // Für die Doku/Tests: Ladefenster nur in eine Bilddatei zeichnen
            if (args.Length == 2 && args[0] == "--splash-preview")
            {
                using (var preview = new SplashForm())
                using (var bmp = new Bitmap(preview.ClientSize.Width, preview.ClientSize.Height))
                {
                    preview.SetProgress(0.42, "resources\\app.asar");
                    preview.DrawToBitmap(bmp, new Rectangle(Point.Empty, bmp.Size));
                    bmp.Save(args[1]);
                }
                return 0;
            }

            try
            {
                string self = Application.ExecutablePath;
                Payload payload = Payload.Read(self);
                if (payload == null)
                {
                    MessageBox.Show("Diese Radio.exe ist unvollständig. Bitte neu herunterladen.", "Radio", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }

                string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RadioPlayer", "app");
                string dir = Path.Combine(root, Sanitize(payload.Version));
                string marker = Path.Combine(dir, ".fertig");

                if (!File.Exists(marker))
                {
                    // Mehrere Starter gleichzeitig (Doppelklick): nur einer entpackt
                    using (var mutex = new Mutex(false, "Local\\RadioPlayerEntpacken"))
                    {
                        mutex.WaitOne();
                        try
                        {
                            if (!File.Exists(marker)) Extract(self, payload, dir, marker);
                        }
                        finally
                        {
                            mutex.ReleaseMutex();
                        }
                    }
                }

                CleanupOldVersions(root, dir);
                Launch(Path.Combine(dir, AppExe), self, args);
                return 0;
            }
            catch (Exception ex)
            {
                MessageBox.Show("Das Radio konnte nicht gestartet werden:\n\n" + ex.Message, "Radio", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        private static string Sanitize(string version)
        {
            var chars = version.Where(c => char.IsLetterOrDigit(c) || c == '.' || c == '-').ToArray();
            return chars.Length > 0 ? new string(chars) : "app";
        }

        private static void Launch(string exe, string self, string[] args)
        {
            var info = new ProcessStartInfo(exe)
            {
                UseShellExecute = false,
                WorkingDirectory = Path.GetDirectoryName(exe),
                Arguments = string.Join(" ", args.Select(Quote)),
            };
            // Wie beim Portable-Format von electron-builder: Die App legt ihre Daten neben die .exe
            info.EnvironmentVariables["PORTABLE_EXECUTABLE_DIR"] = Path.GetDirectoryName(self);
            info.EnvironmentVariables["PORTABLE_EXECUTABLE_FILE"] = self;
            info.EnvironmentVariables["PORTABLE_EXECUTABLE_APP_FILENAME"] = "Radio";
            Process.Start(info);
        }

        private static string Quote(string arg)
        {
            if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return arg;
            return "\"" + arg.Replace("\"", "\\\"") + "\"";
        }

        /// <summary>Alte Versionen löschen – aber nie eine, die gerade läuft.</summary>
        private static void CleanupOldVersions(string root, string keep)
        {
            try
            {
                var inUse = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var p in Process.GetProcessesByName("Radio"))
                {
                    try { inUse.Add(Path.GetDirectoryName(p.MainModule.FileName)); } catch { }
                }
                foreach (var d in Directory.GetDirectories(root))
                {
                    if (string.Equals(d, keep, StringComparison.OrdinalIgnoreCase) || inUse.Contains(d)) continue;
                    try { Directory.Delete(d, true); } catch { }
                }
            }
            catch { }
        }

        private static void Extract(string self, Payload payload, string dir, string marker)
        {
            string temp = dir + ".tmp";
            Exception error = null;
            using (var splash = new SplashForm())
            {
                splash.Shown += (s, e) => Task.Run(() =>
                {
                    try
                    {
                        if (Directory.Exists(temp)) Directory.Delete(temp, true);
                        if (Directory.Exists(dir)) Directory.Delete(dir, true);
                        Directory.CreateDirectory(temp);

                        using (var file = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16))
                        using (var zip = new ZipArchive(new SubStream(file, payload.Offset, payload.Length), ZipArchiveMode.Read))
                        {
                            long total = zip.Entries.Sum(x => x.Length);
                            long done = 0;
                            string fullTemp = Path.GetFullPath(temp) + Path.DirectorySeparatorChar;
                            foreach (var entry in zip.Entries)
                            {
                                string target = Path.GetFullPath(Path.Combine(temp, entry.FullName));
                                if (!target.StartsWith(fullTemp, StringComparison.OrdinalIgnoreCase)) continue; // nichts außerhalb
                                if (entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\"))
                                {
                                    Directory.CreateDirectory(target);
                                    continue;
                                }
                                Directory.CreateDirectory(Path.GetDirectoryName(target));
                                entry.ExtractToFile(target, true);
                                done += entry.Length;
                                splash.SetProgress(total > 0 ? (double)done / total : 1, entry.FullName);
                            }
                        }
                        Directory.Move(temp, dir);
                        File.WriteAllText(marker, payload.Version, Encoding.UTF8);
                    }
                    catch (Exception ex)
                    {
                        error = ex;
                        try { if (Directory.Exists(temp)) Directory.Delete(temp, true); } catch { }
                    }
                    finally
                    {
                        splash.Finish();
                    }
                });
                Application.EnableVisualStyles();
                Application.Run(splash);
            }
            if (error != null) throw error;
        }
    }

    internal sealed class Payload
    {
        public long Offset;
        public long Length;
        public string Version;

        public static Payload Read(string path)
        {
            using (var f = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var r = new BinaryReader(f))
            {
                if (f.Length < 20) return null;
                f.Seek(-8, SeekOrigin.End);
                if (Encoding.ASCII.GetString(r.ReadBytes(8)) != "RADIOPK1") return null;
                // Ende der Datei: … [Version][int32 Länge][int64 Start ZIP]["RADIOPK1"]
                f.Seek(-16, SeekOrigin.End);
                long offset = r.ReadInt64();
                f.Seek(-20, SeekOrigin.End);
                int versionLength = r.ReadInt32();
                if (versionLength <= 0 || versionLength > 64) return null;
                f.Seek(-20 - versionLength, SeekOrigin.End);
                string version = Encoding.UTF8.GetString(r.ReadBytes(versionLength));
                long end = f.Length - 20 - versionLength;
                if (offset <= 0 || offset >= end) return null;
                return new Payload { Offset = offset, Length = end - offset, Version = version };
            }
        }
    }

    /// <summary>Ausschnitt einer Datei als eigener, durchsuchbarer Stream (für ZipArchive).</summary>
    internal sealed class SubStream : Stream
    {
        private readonly Stream inner;
        private readonly long start;
        private readonly long length;
        private long position;

        public SubStream(Stream inner, long start, long length)
        {
            this.inner = inner;
            this.start = start;
            this.length = length;
        }

        public override bool CanRead => true;
        public override bool CanSeek => true;
        public override bool CanWrite => false;
        public override long Length => length;
        public override long Position { get => position; set => position = value; }

        public override int Read(byte[] buffer, int offset, int count)
        {
            long remaining = length - position;
            if (remaining <= 0) return 0;
            if (count > remaining) count = (int)remaining;
            inner.Position = start + position;
            int read = inner.Read(buffer, offset, count);
            position += read;
            return read;
        }

        public override long Seek(long offset, SeekOrigin origin)
        {
            switch (origin)
            {
                case SeekOrigin.Begin: position = offset; break;
                case SeekOrigin.Current: position += offset; break;
                case SeekOrigin.End: position = length + offset; break;
            }
            return position;
        }

        public override void Flush() { }
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    /// <summary>Kleines, randloses Ladefenster im Stil der App.</summary>
    internal sealed class SplashForm : Form
    {
        private static readonly Color Bg = Color.FromArgb(13, 15, 20);
        private static readonly Color Surface = Color.FromArgb(38, 43, 56);
        private static readonly Color Accent = Color.FromArgb(255, 90, 95);
        private static readonly Color Muted = Color.FromArgb(145, 152, 168);
        private double progress;
        private string detail = "";
        private readonly Icon appIcon;

        public SplashForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(460, 250);
            BackColor = Bg;
            ShowInTaskbar = true;
            Text = "Radio wird vorbereitet";
            DoubleBuffered = true;
            TopMost = true;
            try { appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); Icon = appIcon; } catch { }
        }

        public void SetProgress(double value, string file)
        {
            progress = Math.Max(0, Math.Min(1, value));
            detail = file;
            if (IsHandleCreated) BeginInvoke((Action)Invalidate);
        }

        public void Finish()
        {
            if (IsHandleCreated) BeginInvoke((Action)Close);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            using (var border = new Pen(Color.FromArgb(40, 255, 255, 255)))
                g.DrawRectangle(border, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);

            if (appIcon != null)
            {
                using (var big = new Icon(appIcon, 64, 64))
                    g.DrawIcon(big, new Rectangle(32, 36, 56, 56));
            }
            using (var title = new Font("Segoe UI Semibold", 20f))
            using (var text = new Font("Segoe UI", 10.5f))
            using (var small = new Font("Segoe UI", 8.5f))
            using (var white = new SolidBrush(Color.FromArgb(238, 240, 245)))
            using (var muted = new SolidBrush(Muted))
            {
                g.DrawString("Radio", title, white, 102, 34);
                g.DrawString("Wird vorbereitet …", text, muted, 105, 72);

                g.DrawString("Das passiert nur beim ersten Start einer neuen Version –\ndanach startet das Radio sofort.", text, muted, new RectangleF(32, 118, 400, 50));

                var bar = new Rectangle(32, 186, 396, 8);
                using (var track = new SolidBrush(Surface)) FillRounded(g, track, bar);
                if (progress > 0)
                {
                    var fill = new Rectangle(bar.X, bar.Y, Math.Max(8, (int)(bar.Width * progress)), bar.Height);
                    using (var accent = new SolidBrush(Accent)) FillRounded(g, accent, fill);
                }
                string status = $"{Math.Round(progress * 100)} %   {Path.GetFileName(detail)}";
                g.DrawString(status, small, muted, new RectangleF(32, 202, 396, 20), new StringFormat { Trimming = StringTrimming.EllipsisPath, FormatFlags = StringFormatFlags.NoWrap });
            }
        }

        private static void FillRounded(Graphics g, Brush brush, Rectangle r)
        {
            int d = r.Height;
            using (var path = new System.Drawing.Drawing2D.GraphicsPath())
            {
                path.AddArc(r.X, r.Y, d, d, 90, 180);
                path.AddArc(r.Right - d, r.Y, d, d, 270, 180);
                path.CloseFigure();
                g.FillPath(brush, path);
            }
        }
    }
}
