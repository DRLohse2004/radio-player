@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package io.github.drlohse2004.radio

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Metadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.extractor.metadata.icy.IcyInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID

enum class Status { IDLE, LOADING, PLAYING, ERROR }

/** Was ein Lautsprecher (Chromecast/DLNA) gerade spielen soll */
data class CastWish(val url: String?, val playing: Boolean, val volume: Float, val title: String, val cover: String?)

/**
 * Herz der App – wie App.tsx unter Windows: Sender, Wiedergabe, Titel, Verlauf.
 * Alle Felder sind Compose-Zustand und werden nur im Haupt-Thread geändert.
 */
class RadioCore(val context: Context) {
    val scope = MainScope()

    var settings by mutableStateOf(Storage.load(context).let { if (it.clientId.isEmpty()) it.copy(clientId = "and-" + UUID.randomUUID().toString().take(12)) else it })
        private set
    var wantPlay by mutableStateOf(false)
        private set
    var status by mutableStateOf(Status.IDLE)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var title by mutableStateOf<String?>(null)
        private set
    var artist by mutableStateOf<String?>(null)
        private set
    var cover by mutableStateOf<String?>(null)
        private set
    /** Kurze Meldung für die Oberfläche (Snackbar) */
    var message by mutableStateOf<String?>(null)

    val player: ExoPlayer = ExoPlayer.Builder(context)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
        .setHandleAudioBecomingNoisy(true)
        .build()

    val cast = CastManager(this)
    val room = RoomClient(this)
    val host = HostServer(this)
    val updater = Updater(this)

    private var loadedUrl: String? = null
    private var saveJob: Job? = null
    private var retryJob: Job? = null

    val current: Station? get() = settings.stations.firstOrNull { it.id == settings.lastStationId } ?: settings.stations.firstOrNull()

    init {
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) = updateStatus()
            override fun onIsPlayingChanged(isPlaying: Boolean) = updateStatus()

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                // Pause/Play aus der Benachrichtigung oder vom Kopfhörer
                if (reason != Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST || room.active) return
                if (playWhenReady != wantPlay && loadedUrl != null) wantPlay = playWhenReady
            }

            override fun onPlayerError(e: PlaybackException) {
                status = Status.ERROR
                error = "Stream nicht erreichbar"
                // Wie unter Windows: einmal kurz warten und neu verbinden
                retryJob?.cancel()
                retryJob = scope.launch {
                    delay(3000)
                    val url = loadedUrl ?: return@launch
                    loadedUrl = null
                    load(url)
                }
            }

            override fun onMetadata(metadata: Metadata) {
                if (room.active) return
                for (i in 0 until metadata.length()) {
                    val entry = metadata.get(i)
                    if (entry is IcyInfo) onStreamTitle(entry.title)
                }
            }
        })
        applyVolume()
        // Lautsprecher folgen der eigenen Wiedergabe, Host-Gäste dem Zustand
        scope.launch {
            snapshotFlow { castWish() }.distinctUntilChanged().collect { cast.follow(it) }
        }
        scope.launch {
            snapshotFlow { cast.device != null to settings.volume }.collect { applyVolume() }
        }
        scope.launch {
            snapshotFlow { hostSnapshot().toString() }.distinctUntilChanged().collect { host.publish(it) }
        }
        scope.launch {
            snapshotFlow { settings.host }.distinctUntilChanged().collect { host.configure(it) }
        }
        scope.launch {
            snapshotFlow { Triple(room.active, room.listening, room.listenUrl) }.distinctUntilChanged().collect {
                // Wie unter Windows: Im Room endet die eigene Wiedergabe
                if (room.active) wantPlay = false
                syncPlayer()
            }
        }
        if (settings.autoUpdate) updater.check(silent = true)
    }

    // --- Einstellungen ---------------------------------------------------------------------

    fun update(change: (Settings) -> Settings) {
        settings = change(settings)
        saveJob?.cancel()
        val snapshot = settings
        saveJob = scope.launch {
            delay(500)
            withContext(Dispatchers.IO) { runCatching { Storage.save(context, snapshot) } }
        }
    }

    // --- Wiedergabe ------------------------------------------------------------------------

    fun play(station: Station) {
        if (room.active) room.leave()
        update { it.copy(lastStationId = station.id) }
        wantPlay = true
        title = null
        artist = null
        cover = null
        syncPlayer()
    }

    fun toggle() {
        if (room.active) return room.command("toggle")
        wantPlay = !wantPlay
        syncPlayer()
    }

    fun next() = step(1)
    fun prev() = step(-1)

    private fun step(delta: Int) {
        if (room.active) return room.command(if (delta > 0) "next" else "prev")
        val list = settings.stations
        if (list.isEmpty()) return
        val i = list.indexOfFirst { it.id == current?.id }
        play(list[((i + delta) % list.size + list.size) % list.size])
    }

    fun setVolume(v: Float) {
        if (room.active && !room.listening) return room.command("volume", Math.round(v * 100) / 100.0)
        update { it.copy(volume = v.coerceIn(0f, 1f)) }
    }

    private fun applyVolume() {
        // Spielt ein Lautsprecher, bleibt das Handy stumm, gibt aber weiter Titel und Takt vor
        player.volume = if (cast.device != null) 0f else settings.volume
    }

    /** Was das Handy selbst abspielen soll: eigener Sender oder beim Mithören der des Hosts */
    fun syncPlayer() {
        val url = when {
            room.active -> if (room.listening) room.listenUrl else null
            wantPlay -> current?.url
            else -> null
        }
        if (url == null) {
            loadedUrl = null
            retryJob?.cancel()
            player.stop()
            player.clearMediaItems()
            status = Status.IDLE
            error = null
            return
        }
        if (url != loadedUrl) load(url)
    }

    private fun load(url: String) {
        loadedUrl = url
        error = null
        val label = if (room.active) room.state?.optString("sourceName").orEmpty().ifEmpty { room.name } else current?.name.orEmpty()
        val logo = if (room.active) null else current?.logo
        val item = MediaItem.Builder()
            .setUri(url)
            .setMediaMetadata(
                MediaMetadata.Builder().setTitle(label).setArtist("Radio").setArtworkUri(logo?.let(Uri::parse)).build(),
            )
            .build()
        player.setMediaItem(item)
        player.prepare()
        player.playWhenReady = true
        status = Status.LOADING
    }

    private fun updateStatus() {
        if (loadedUrl == null) return
        status = when {
            player.isPlaying -> Status.PLAYING
            player.playbackState == Player.STATE_BUFFERING -> Status.LOADING
            status == Status.ERROR -> Status.ERROR
            else -> if (player.playWhenReady) Status.LOADING else Status.IDLE
        }
        if (player.isPlaying) error = null
    }

    // --- Titel, Cover, Verlauf -------------------------------------------------------------

    private fun onStreamTitle(raw: String?) {
        val parsed = parseStreamTitle(raw)
        val newTitle = parsed?.second
        val newArtist = parsed?.first
        if (newTitle == title && newArtist == artist) return
        title = newTitle
        artist = newArtist
        cover = null
        val station = current?.name.orEmpty()
        player.replaceMediaItem(
            0,
            player.currentMediaItem?.buildUpon()?.setMediaMetadata(
                MediaMetadata.Builder().setTitle(newTitle ?: station).setArtist(newArtist ?: station)
                    .setArtworkUri(current?.logo?.let(Uri::parse)).build(),
            )?.build() ?: return,
        )
        if (newTitle == null || newArtist == null) return
        scope.launch {
            val found = withContext(Dispatchers.IO) { lookupCover(newArtist, newTitle) }
            if (title != newTitle) return@launch
            cover = found
            val track = Track(newTitle, newArtist, station, found, System.currentTimeMillis())
            update { s ->
                val last = s.history.firstOrNull()
                if (last?.title == newTitle && last.artist == newArtist) s else s.copy(history = (listOf(track) + s.history).take(100))
            }
            if (found != null) {
                player.currentMediaItem?.let { item ->
                    player.replaceMediaItem(0, item.buildUpon().setMediaMetadata(item.mediaMetadata.buildUpon().setArtworkUri(Uri.parse(found)).build()).build())
                }
            }
        }
    }

    private fun lookupCover(artist: String, title: String): String? = runCatching {
        val term = URLEncoder.encode("$artist $title", "UTF-8")
        val results = httpJson("https://itunes.apple.com/search?term=$term&entity=song&limit=5", timeout = 5000).getJSONArray("results")
        (0 until results.length()).map { results.getJSONObject(it) }
            .firstOrNull { it.optString("artistName").contains(artist.split(" feat", ",", "&").first().trim(), ignoreCase = true) }
            ?.optString("artworkUrl100")?.replace("100x100", "600x600")
    }.getOrNull()

    fun isFavorite(t: Track) = settings.favorites.any { it.title == t.title && it.artist == t.artist }

    fun toggleFavorite(t: Track) = update { s ->
        if (isFavorite(t)) s.copy(favorites = s.favorites.filterNot { it.title == t.title && it.artist == t.artist })
        else s.copy(favorites = listOf(t) + s.favorites)
    }

    // --- Sender verwalten ------------------------------------------------------------------

    fun saveStation(station: Station) = update { s ->
        if (s.stations.any { it.id == station.id }) s.copy(stations = s.stations.map { if (it.id == station.id) station else it })
        else s.copy(stations = s.stations + station)
    }

    fun deleteStation(id: String) = update { s -> s.copy(stations = s.stations.filterNot { it.id == id }) }

    fun moveStation(id: String, delta: Int) = update { s ->
        val list = s.stations.toMutableList()
        val i = list.indexOfFirst { it.id == id }
        val j = i + delta
        if (i < 0 || j !in list.indices) return@update s
        list.add(j, list.removeAt(i))
        s.copy(stations = list)
    }

    fun newStationId() = "st-" + UUID.randomUUID().toString().take(8)

    // --- Für Lautsprecher und Host ----------------------------------------------------------

    private fun castWish(): CastWish {
        val url = when {
            room.active -> if (room.listening) room.listenUrl else null
            wantPlay -> current?.url
            else -> null
        }
        val name = if (room.active) room.state?.optString("sourceName").orEmpty() else current?.name.orEmpty()
        return CastWish(url, url != null, settings.volume, name.ifEmpty { "Radio" }, if (room.active) null else current?.logo?.takeIf { it.startsWith("http") })
    }

    /** Zustand für Gäste und Home Assistant – dieselben Felder wie remoteSnapshot in App.tsx */
    fun hostSnapshot(): JSONObject {
        val h = settings.host
        val playing = !room.active && wantPlay
        val station = current
        return JSONObject()
            .put("source", "radio")
            .put("sourceName", station?.name ?: "")
            .put("status", if (playing) status.name.lowercase() else "idle")
            .put("playing", playing && status != Status.ERROR)
            .put("canControl", true)
            .put("title", if (playing) title else null)
            .put("artist", if (playing) artist else null)
            .put("album", JSONObject.NULL)
            .put("cover", cover ?: station?.logo?.takeIf { it.startsWith("http") })
            .put("live", true)
            .put("volume", Math.round(settings.volume * 100) / 100.0)
            .put("volumeEnabled", true)
            .put("progress", JSONObject.NULL)
            .put(
                "stations",
                JSONArray(settings.stations.map {
                    JSONObject().put("id", it.id).put("name", it.name).put("url", it.url).put("logo", it.logo?.takeIf { l -> l.startsWith("http") })
                }),
            )
            .put("currentStationId", station?.id)
            .put("youtube", JSONArray())
            .put("wishes", JSONArray())
            .put(
                "rules",
                JSONObject().put("guestVolume", h.guestVolume).put("guestSkip", h.guestSkip).put("guestStations", h.guestStations)
                    .put("maxWishes", 0).put("maxMinutes", 0).put("adminPin", h.adminPin.isNotEmpty()),
            )
            .put(
                "listen",
                if (playing && station != null) JSONObject().put("kind", "radio").put("url", station.url)
                else JSONObject().put("kind", "none").put("reason", ""),
            )
    }
}
