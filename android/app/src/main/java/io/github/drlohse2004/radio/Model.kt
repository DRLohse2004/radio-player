package io.github.drlohse2004.radio

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class Station(val id: String, val name: String, val url: String, val logo: String? = null)

data class Track(val title: String, val artist: String?, val station: String, val cover: String?, val at: Long)

enum class Access(val label: String) { OFF("Aus"), PUBLIC("Öffentlich"), SECURE("Sicher") }

/** Das Handy als Host: Rooms und Home Assistant sprechen dieselbe Schnittstelle wie beim Windows-Radio */
data class HostPrefs(
    val access: Access = Access.OFF,
    val name: String = "",
    val key: String = "",
    val joinPin: String = "",
    val adminPin: String = "",
    val guestVolume: Boolean = true,
    val guestSkip: Boolean = true,
    val guestStations: Boolean = true,
)

/** Zuletzt benutzter Room, damit man nicht jedes Mal suchen muss */
data class RoomLink(val address: String, val name: String, val key: String, val clientId: String)

data class Settings(
    val stations: List<Station> = DEFAULT_STATIONS,
    val volume: Float = 0.7f,
    val lastStationId: String? = null,
    val history: List<Track> = emptyList(),
    val favorites: List<Track> = emptyList(),
    val host: HostPrefs = HostPrefs(),
    val room: RoomLink? = null,
    val clientId: String = "",
    val autoUpdate: Boolean = true,
)

val DEFAULT_STATIONS = listOf(
    Station("1live", "1LIVE", "https://wdr-1live-live.icecastssl.wdr.de/wdr/1live/live/mp3/128/stream.mp3"),
    Station("absolut-2000er", "Absolut 2000er", "https://absolut-top.live-sm.absolutradio.de/absolut-top/stream/aacp"),
    Station("absolut-ai", "Absolut AI", "https://absolut-ai.live-sm.absolutradio.de/absolut-ai/stream/aacp"),
    Station("swr3", "SWR3", "https://liveradio.swr.de/sw282p3/swr3/play.mp3"),
    Station("antenne-chillout", "Antenne Chillout", "https://s4-webradio.antenne.de/chillout"),
    Station("1fm-deep-house", "1.FM Deep House", "https://strm112.1.fm/deephouse_mobile_mp3"),
    Station("1fm-chillout-lounge", "1.FM Chillout Lounge", "https://strm112.1.fm/chilloutlounge_mobile_mp3"),
    Station("jam-fm", "JAM FM", "https://stream.jam.fm/jamfm-live/mp3-128/"),
)

// --- Speichern (JSON im App-Ordner) ---------------------------------------------------------

private fun JSONObject.str(name: String): String? = if (has(name) && !isNull(name)) getString(name) else null

private fun stationJson(s: Station) = JSONObject().put("id", s.id).put("name", s.name).put("url", s.url).put("logo", s.logo)
private fun stationOf(o: JSONObject) = Station(o.getString("id"), o.getString("name"), o.getString("url"), o.str("logo"))
private fun trackJson(t: Track) =
    JSONObject().put("title", t.title).put("artist", t.artist).put("station", t.station).put("cover", t.cover).put("at", t.at)
private fun trackOf(o: JSONObject) = Track(o.getString("title"), o.str("artist"), o.optString("station"), o.str("cover"), o.optLong("at"))

private fun <T> JSONArray?.items(read: (JSONObject) -> T): List<T> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { runCatching { read(getJSONObject(it)) }.getOrNull() }

fun settingsToJson(s: Settings): JSONObject {
    val h = s.host
    return JSONObject()
        .put("stations", JSONArray(s.stations.map(::stationJson)))
        .put("volume", s.volume.toDouble())
        .put("lastStationId", s.lastStationId)
        .put("history", JSONArray(s.history.map(::trackJson)))
        .put("favorites", JSONArray(s.favorites.map(::trackJson)))
        .put(
            "host",
            JSONObject().put("access", h.access.name).put("name", h.name).put("key", h.key).put("joinPin", h.joinPin)
                .put("adminPin", h.adminPin).put("guestVolume", h.guestVolume).put("guestSkip", h.guestSkip)
                .put("guestStations", h.guestStations),
        )
        .put("room", s.room?.let { JSONObject().put("address", it.address).put("name", it.name).put("key", it.key).put("clientId", it.clientId) })
        .put("clientId", s.clientId)
        .put("autoUpdate", s.autoUpdate)
}

fun settingsFromJson(o: JSONObject): Settings {
    val h = o.optJSONObject("host")
    val r = o.optJSONObject("room")
    return Settings(
        stations = o.optJSONArray("stations")?.items(::stationOf) ?: DEFAULT_STATIONS,
        volume = o.optDouble("volume", 0.7).toFloat(),
        lastStationId = o.str("lastStationId"),
        history = o.optJSONArray("history").items(::trackOf),
        favorites = o.optJSONArray("favorites").items(::trackOf),
        host = if (h == null) HostPrefs() else HostPrefs(
            access = runCatching { Access.valueOf(h.getString("access")) }.getOrDefault(Access.OFF),
            name = h.optString("name"),
            key = h.optString("key"),
            joinPin = h.optString("joinPin"),
            adminPin = h.optString("adminPin"),
            guestVolume = h.optBoolean("guestVolume", true),
            guestSkip = h.optBoolean("guestSkip", true),
            guestStations = h.optBoolean("guestStations", true),
        ),
        room = r?.let { RoomLink(it.getString("address"), it.optString("name"), it.optString("key"), it.optString("clientId")) },
        clientId = o.optString("clientId"),
        autoUpdate = o.optBoolean("autoUpdate", true),
    )
}

object Storage {
    private fun file(context: Context) = File(context.filesDir, "radio-settings.json")

    fun load(context: Context): Settings =
        runCatching { settingsFromJson(JSONObject(file(context).readText())) }.getOrDefault(Settings())

    fun save(context: Context, settings: Settings) {
        // Erst in eine Hilfsdatei, dann umbenennen – ein Absturz beim Schreiben zerstört die Sender nicht
        val target = file(context)
        val temp = File(target.parentFile, "radio-settings.json.tmp")
        temp.writeText(settingsToJson(settings).toString())
        temp.renameTo(target)
    }
}
