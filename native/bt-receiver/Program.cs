// Bluetooth-Audio-Empfänger für die Radio-App.
//
// Protokoll: eine JSON-Nachricht pro Zeile.
//   stdout (Ereignisse): ready | devices | state | media | sessions | output | error | log
//   stdin  (Befehle):    {"cmd":"connect","id":"..."} | {"cmd":"disconnect","id":"..."}
//                        {"cmd":"media","action":"playpause|next|prev","source":"<AUMID>"} | {"cmd":"quit"}

using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using Windows.Devices.Enumeration;
using Windows.Media.Audio;
using Windows.Media.Control;
using Windows.Media.Devices;
using Windows.Storage.Streams;

namespace BtReceiver;

internal static class Program
{
    private static readonly object WriteLock = new();
    private static readonly ConcurrentDictionary<string, DeviceEntry> Devices = new();
    private static GlobalSystemMediaTransportControlsSessionManager? _mediaManager;

    private sealed class DeviceEntry
    {
        public required string Id { get; init; }
        public required string Name { get; set; }
        public AudioPlaybackConnection? Connection { get; set; }
        public string State { get; set; } = "closed";
    }

    private static async Task<int> Main()
    {
        try
        {
            StartDeviceWatcher();
        }
        catch (Exception ex)
        {
            Emit(new JsonObject { ["type"] = "error", ["message"] = "Bluetooth nicht verfügbar: " + ex.Message });
        }
        try
        {
            await StartMediaWatcherAsync();
        }
        catch (Exception ex)
        {
            // ohne Titelinfos geht es trotzdem
            Log("Mediensteuerung nicht verfügbar: " + ex.Message);
        }
        try
        {
            // Über welches Gerät gibt Windows den Ton aus? (Funk-Headsets können Bluetooth-Empfang stören)
            MediaDevice.DefaultAudioRenderDeviceChanged += async (_, _) => await EmitOutputAsync();
            await EmitOutputAsync();
        }
        catch (Exception ex)
        {
            Log("Ausgabegerät nicht ermittelbar: " + ex.Message);
        }
        Emit(new JsonObject { ["type"] = "ready" });

        // Befehle von stdin; endet, wenn die Radio-App die Pipe schließt
        string? line;
        while ((line = await Console.In.ReadLineAsync()) != null)
        {
            try
            {
                var command = JsonNode.Parse(line);
                var cmd = command?["cmd"]?.GetValue<string>();
                if (cmd == "quit") break;
                await HandleCommandAsync(cmd, command!);
            }
            catch (Exception ex)
            {
                Emit(new JsonObject { ["type"] = "error", ["message"] = ex.Message });
            }
        }

        foreach (var entry in Devices.Values) entry.Connection?.Dispose();
        return 0;
    }

    // --- Ausgabe ---------------------------------------------------------------

    private static void Emit(JsonObject message)
    {
        var json = message.ToJsonString(new JsonSerializerOptions { WriteIndented = false });
        lock (WriteLock)
        {
            Console.Out.WriteLine(json);
            Console.Out.Flush();
        }
    }

    private static void Log(string text) => Emit(new JsonObject { ["type"] = "log", ["message"] = text });

    private static void EmitDevices()
    {
        var list = new JsonArray();
        foreach (var d in Devices.Values.OrderBy(d => d.Name))
        {
            list.Add((JsonNode)new JsonObject { ["id"] = d.Id, ["name"] = d.Name, ["state"] = d.State });
        }
        Emit(new JsonObject { ["type"] = "devices", ["devices"] = list });
    }

    private static async Task EmitOutputAsync()
    {
        var id = MediaDevice.GetDefaultAudioRenderId(AudioDeviceRole.Default);
        if (string.IsNullOrEmpty(id)) return;
        var info = await DeviceInformation.CreateFromIdAsync(id);
        Emit(new JsonObject { ["type"] = "output", ["name"] = info.Name });
    }

    // --- Bluetooth-Geräte (gekoppelte Audioquellen wie iPhones) ---------------------

    private static void StartDeviceWatcher()
    {
        var selector = AudioPlaybackConnection.GetDeviceSelector();
        Log("Geräteauswahl: " + selector);
        var watcher = DeviceInformation.CreateWatcher(selector);
        watcher.Added += async (_, info) =>
        {
            var entry = new DeviceEntry { Id = info.Id, Name = info.Name };
            Devices[info.Id] = entry;
            await EnableIncomingAsync(entry);
            EmitDevices();
        };
        watcher.Updated += (_, update) =>
        {
            if (Devices.TryGetValue(update.Id, out var entry) &&
                update.Properties.TryGetValue("System.ItemNameDisplay", out var name) && name is string n)
            {
                entry.Name = n;
                EmitDevices();
            }
        };
        watcher.Removed += (_, update) =>
        {
            if (Devices.TryRemove(update.Id, out var entry)) entry.Connection?.Dispose();
            EmitDevices();
        };
        watcher.EnumerationCompleted += (_, _) => EmitDevices();
        watcher.Start();
    }

    /// <summary>Erlaubt dem Gerät, sich von sich aus mit dem PC als Lautsprecher zu verbinden.</summary>
    private static async Task EnableIncomingAsync(DeviceEntry entry)
    {
        try
        {
            entry.Connection?.Dispose();
            var connection = AudioPlaybackConnection.TryCreateFromId(entry.Id);
            if (connection == null)
            {
                Log($"Keine Audioverbindung möglich für {entry.Name}");
                return;
            }
            connection.StateChanged += (sender, _) =>
            {
                entry.State = sender.State == AudioPlaybackConnectionState.Opened ? "connected" : "closed";
                Emit(new JsonObject { ["type"] = "state", ["id"] = entry.Id, ["name"] = entry.Name, ["state"] = entry.State });
                EmitDevices();
            };
            entry.Connection = connection;
            await connection.StartAsync();
            entry.State = connection.State == AudioPlaybackConnectionState.Opened ? "connected" : "closed";
        }
        catch (Exception ex)
        {
            Log($"Start fehlgeschlagen für {entry.Name}: {ex.Message}");
        }
    }

    private static async Task HandleCommandAsync(string? cmd, JsonNode command)
    {
        switch (cmd)
        {
            case "connect":
            {
                var id = command["id"]?.GetValue<string>() ?? "";
                if (!Devices.TryGetValue(id, out var entry)) throw new InvalidOperationException("Gerät nicht gefunden");
                if (entry.Connection == null) await EnableIncomingAsync(entry);
                if (entry.Connection == null) throw new InvalidOperationException("Verbindung nicht möglich");
                entry.State = "connecting";
                EmitDevices();
                var result = await entry.Connection.OpenAsync();
                entry.State = result.Status == AudioPlaybackConnectionOpenResultStatus.Success ? "connected" : "closed";
                Emit(new JsonObject
                {
                    ["type"] = "state",
                    ["id"] = entry.Id,
                    ["name"] = entry.Name,
                    ["state"] = entry.State,
                    ["result"] = result.Status.ToString(),
                });
                EmitDevices();
                break;
            }
            case "disconnect":
            {
                var id = command["id"]?.GetValue<string>() ?? "";
                if (Devices.TryGetValue(id, out var entry))
                {
                    entry.Connection?.Dispose();
                    entry.Connection = null;
                    entry.State = "closed";
                    // gleich wieder bereit für eine neue Verbindung vom Handy aus
                    await EnableIncomingAsync(entry);
                    EmitDevices();
                }
                break;
            }
            case "devices":
                EmitDevices();
                break;
            case "media":
                await MediaActionAsync(command["source"]?.GetValue<string>(), command["action"]?.GetValue<string>());
                break;
        }
    }

    // --- Titelinfos über die Windows-Mediensteuerung -----------------------------------
    // Windows meldet hier alle Medienquellen (auch das per Bluetooth verbundene Handy, sofern
    // es AVRCP-Titelinfos schickt). Die Radio-App wählt die passende Quelle aus.

    private static async Task StartMediaWatcherAsync()
    {
        _mediaManager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        _mediaManager.SessionsChanged += (_, _) => WireSessions();
        WireSessions();
    }

    private static readonly HashSet<string> Wired = new();

    private static void WireSessions()
    {
        if (_mediaManager == null) return;
        foreach (var session in _mediaManager.GetSessions())
        {
            var id = session.SourceAppUserModelId;
            lock (Wired)
            {
                if (!Wired.Add(id)) continue;
            }
            session.MediaPropertiesChanged += async (s, _) => await EmitSessionAsync(s);
            session.PlaybackInfoChanged += async (s, _) => await EmitSessionAsync(s);
            _ = EmitSessionAsync(session);
        }
        var active = new JsonArray();
        // JsonValue.Create statt Add<T>: funktioniert auch in der größenoptimierten (getrimmten) .exe
        foreach (var s in _mediaManager.GetSessions()) active.Add((JsonNode?)JsonValue.Create(s.SourceAppUserModelId));
        Emit(new JsonObject { ["type"] = "sessions", ["sources"] = active });
    }

    private static async Task EmitSessionAsync(GlobalSystemMediaTransportControlsSession session)
    {
        try
        {
            var props = await session.TryGetMediaPropertiesAsync();
            var playback = session.GetPlaybackInfo();
            string? cover = null;
            if (props.Thumbnail != null)
            {
                using var stream = await props.Thumbnail.OpenReadAsync();
                if (stream.Size is > 0 and < 2_000_000)
                {
                    var buffer = new Windows.Storage.Streams.Buffer((uint)stream.Size);
                    await stream.ReadAsync(buffer, buffer.Capacity, InputStreamOptions.None);
                    var bytes = new byte[buffer.Length];
                    using (var reader = DataReader.FromBuffer(buffer)) reader.ReadBytes(bytes);
                    var type = string.IsNullOrEmpty(stream.ContentType) ? "image/jpeg" : stream.ContentType;
                    cover = $"data:{type};base64,{Convert.ToBase64String(bytes)}";
                }
            }
            Emit(new JsonObject
            {
                ["type"] = "media",
                ["source"] = session.SourceAppUserModelId,
                ["title"] = props.Title,
                ["artist"] = props.Artist,
                ["album"] = props.AlbumTitle,
                ["status"] = playback.PlaybackStatus.ToString(),
                ["cover"] = cover,
            });
        }
        catch (Exception ex)
        {
            Log($"Medieninfo nicht lesbar ({session.SourceAppUserModelId}): {ex.Message}");
        }
    }

    private static async Task MediaActionAsync(string? source, string? action)
    {
        if (_mediaManager == null || source == null) return;
        var session = _mediaManager.GetSessions().FirstOrDefault(s => s.SourceAppUserModelId == source);
        if (session == null) return;
        _ = action switch
        {
            "playpause" => await session.TryTogglePlayPauseAsync(),
            "next" => await session.TrySkipNextAsync(),
            "prev" => await session.TrySkipPreviousAsync(),
            _ => false,
        };
    }
}
