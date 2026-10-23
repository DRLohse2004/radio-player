package io.github.drlohse2004.radio

import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Ein gefundenes Radio (Windows oder Handy), das man fernsteuern oder mithören kann */
data class RoomInfo(val address: String, val name: String, val version: String, val open: Boolean, val secure: Boolean, val key: String?)

const val DISCOVERY_PORT = 47811

/**
 * Room-Gast: andere Radios finden, beitreten, Zustand per Server-Sent Events halten und Befehle schicken –
 * wie electron/room.cjs. Mithören spielt den Sender des Hosts am Handy, „Nur Fernbedienung“ steuert nur.
 */
class RoomClient(private val core: RadioCore) {
    var found by mutableStateOf<List<RoomInfo>>(emptyList())
        private set
    var searching by mutableStateOf(false)
        private set
    var active by mutableStateOf(false)
        private set
    var connected by mutableStateOf(false)
        private set
    var name by mutableStateOf("")
        private set
    var listening by mutableStateOf(true)
    var state by mutableStateOf<JSONObject?>(null)
        private set
    var admin by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)

    private val main = Handler(Looper.getMainLooper())
    private val pool = Executors.newCachedThreadPool()
    private var link: RoomLink? = null
    private var adminToken = ""
    @Volatile private var session = 0
    private var stream: HttpURLConnection? = null

    /** Was das Handy beim Mithören spielt (nur Radiosender – YouTube löst nur der Windows-Host auf) */
    val listenUrl: String?
        get() {
            val l = state?.optJSONObject("listen") ?: return null
            return if (l.optString("kind") == "radio") l.optString("url").ifEmpty { null } else null
        }

    private fun ui(block: () -> Unit) = main.post(block)
    private fun base(address: String) = "http://$address"
    private fun headers() = link?.let {
        mapOf(
            "x-key" to it.key,
            "x-client" to it.clientId,
            "x-name" to URLEncoder.encode(deviceName(), "UTF-8").replace("+", "%20"),
            "x-kind" to "radio",
            "x-admin" to adminToken,
        )
    } ?: emptyMap()

    private fun deviceName() = core.settings.host.name.ifBlank { "Radio ${Build.MODEL}" }

    // --- Finden ----------------------------------------------------------------------------

    fun search(extra: String = "") {
        if (searching) return
        searching = true
        pool.execute {
            val addresses = ConcurrentHashMap<String, RoomInfo>()
            val own = localAddresses().map { it.first }.toSet()
            fun probe(address: String) {
                runCatching { probeRoom(address, 800) }.getOrNull()?.let { if (address.substringBefore(":") !in own) addresses[address] = it }
            }
            // 1. UDP-Frage an die Broadcast-Adressen, 2. das eigene /24-Netz Adresse für Adresse
            val udp = pool.submit {
                runCatching {
                    DatagramSocket().use { s ->
                        s.broadcast = true
                        s.soTimeout = 300
                        val ask = "radio-room?".toByteArray()
                        val targets = (localAddresses().map { (ip, bits) -> broadcastOf(ip, bits) } + "255.255.255.255").toSet()
                        for (t in targets) runCatching { s.send(DatagramPacket(ask, ask.size, InetAddress.getByName(t), DISCOVERY_PORT)) }
                        val buf = ByteArray(512)
                        val deadline = System.currentTimeMillis() + 1500
                        while (System.currentTimeMillis() < deadline) {
                            try {
                                val p = DatagramPacket(buf, buf.size)
                                s.receive(p)
                                val port = JSONObject(String(p.data, 0, p.length)).optInt("port")
                                if (port in 1..65535) pool.execute { probe(hostPort(p.address.hostAddress!!, port)) }
                            } catch (_: SocketTimeoutException) {
                            } catch (_: Exception) {
                            }
                        }
                    }
                }
            }
            val scan = Executors.newFixedThreadPool(64)
            val prefixes = localAddresses().filter { it.second >= 16 }.map { it.first.substringBeforeLast(".") }.toSet()
            for (prefix in prefixes) for (i in 1..254) for (port in listOf(80, 8080)) scan.execute { probe(hostPort("$prefix.$i", port)) }
            extra.split(Regex("[\\s,;]+")).filter { it.isNotBlank() }.forEach { a -> scan.execute { probe(a.removePrefix("http://").trimEnd('/')) } }
            scan.shutdown()
            scan.awaitTermination(8, TimeUnit.SECONDS)
            runCatching { udp.get(3, TimeUnit.SECONDS) }
            Thread.sleep(300)
            val list = addresses.values.distinctBy { it.address.substringBefore(":") + it.name }.sortedBy { it.name.lowercase() }
            ui { found = list; searching = false }
        }
    }

    private fun hostPort(host: String, port: Int) = if (port == 80) host else "$host:$port"

    private fun broadcastOf(ip: String, bits: Int): String {
        val n = ip.split(".").fold(0L) { acc, p -> (acc shl 8) or p.toLong() }
        val mask = if (bits == 0) 0L else (0xffffffffL shl (32 - bits)) and 0xffffffffL
        val b = (n or (mask.inv() and 0xffffffffL))
        return listOf(24, 16, 8, 0).joinToString(".") { ((b shr it) and 255).toString() }
    }

    private fun probeRoom(address: String, timeout: Int): RoomInfo? {
        val o = httpJson("${base(address)}/api/room", timeout = timeout)
        if (o.optString("app") != "radio") return null
        return RoomInfo(address, o.optString("name", address), o.optString("version"), o.optBoolean("open"), o.optBoolean("secure"), o.optString("key").ifEmpty { null })
    }

    // --- Beitreten -------------------------------------------------------------------------

    /** Beitreten: öffentlich sofort, gesichert mit PIN oder Code. requestCode = Code am Host anzeigen lassen. */
    fun join(room: RoomInfo, pin: String? = null, requestCode: Boolean = false, done: (String?) -> Unit) {
        val clientId = core.settings.clientId
        pool.execute {
            val result = runCatching {
                val body = JSONObject().put("clientId", clientId).put("name", deviceName())
                if (requestCode) body.put("request", true)
                if (!pin.isNullOrBlank()) body.put("pin", pin.trim()).put("code", pin.trim())
                httpJson("${base(room.address)}/api/join", "POST", body, mapOf("x-kind" to "radio"))
            }
            ui {
                val key = result.getOrNull()?.optString("key").orEmpty()
                when {
                    result.isFailure -> done(result.exceptionOrNull()?.message ?: "Beitreten fehlgeschlagen")
                    requestCode -> done(null)
                    key.isEmpty() -> done("Keine Antwort vom Host")
                    else -> {
                        connect(RoomLink(room.address, room.name, key, clientId))
                        done(null)
                    }
                }
            }
        }
    }

    fun connect(l: RoomLink) {
        leaveQuietly()
        link = l
        name = l.name
        active = true
        admin = false
        adminToken = ""
        error = null
        core.update { it.copy(room = l) }
        val my = ++session
        pool.execute { listen(my) }
    }

    fun leave() {
        leaveQuietly()
        core.update { it.copy(room = null) }
    }

    private fun leaveQuietly() {
        session++
        stream?.let { c -> pool.execute { runCatching { c.disconnect() } } }
        active = false
        connected = false
        state = null
        admin = false
    }

    /** Server-Sent Events: `event: state` mit dem Zustand des Hosts; bei Abbruch nach 3 s neu verbinden */
    private fun listen(my: Int) {
        while (session == my) {
            try {
                val c = URL("${base(link!!.address)}/api/events").openConnection() as HttpURLConnection
                c.connectTimeout = 5000
                c.readTimeout = 45_000 // der Host pingt alle 20 s
                headers().forEach { (k, v) -> c.setRequestProperty(k, v) }
                stream = c
                if (c.responseCode == 403) {
                    val message = runCatching { JSONObject(c.errorStream.bufferedReader().readText()).optString("error") }.getOrNull()
                    ui { if (session == my) { error = message ?: "Zugang abgelehnt"; leave() } }
                    return
                }
                ui { if (session == my) connected = true }
                var event = ""
                val data = StringBuilder()
                c.inputStream.bufferedReader().useLines { lines ->
                    for (line in lines) {
                        if (session != my) break
                        when {
                            line.startsWith("event:") -> event = line.substring(6).trim()
                            line.startsWith("data:") -> data.append(line.substring(5).trim())
                            line.isEmpty() -> {
                                if (event == "state" && data.isNotEmpty()) {
                                    val s = runCatching { JSONObject(data.toString()) }.getOrNull()
                                    if (s != null) ui { if (session == my) state = s }
                                }
                                event = ""
                                data.clear()
                            }
                        }
                    }
                }
            } catch (_: Exception) {
            }
            ui { if (session == my) connected = false }
            if (session == my) Thread.sleep(3000)
        }
    }

    // --- Befehle ---------------------------------------------------------------------------

    private fun call(path: String, body: JSONObject?, done: (JSONObject?) -> Unit = {}) {
        val l = link ?: return
        pool.execute {
            val r = runCatching { httpJson("${base(l.address)}$path", if (body != null) "POST" else "GET", body, headers(), 20_000) }
            ui {
                r.exceptionOrNull()?.let { core.message = it.message }
                done(r.getOrNull())
            }
        }
    }

    fun command(action: String, value: Any? = null) = call("/api/command", JSONObject().put("action", action).put("value", value ?: JSONObject.NULL))

    fun login(pin: String, done: (Boolean) -> Unit) = call("/api/admin", JSONObject().put("pin", pin)) { r ->
        adminToken = r?.optString("token").orEmpty()
        admin = adminToken.isNotEmpty()
        done(admin)
    }

    /** YouTube-Suche beim Host (nur Windows-Hosts haben yt-dlp) */
    fun searchYoutube(query: String, done: (List<JSONObject>) -> Unit) =
        call("/api/search?q=" + URLEncoder.encode(query, "UTF-8"), null) { r ->
            val results: JSONArray? = r?.optJSONArray("results")
            done((0 until (results?.length() ?: 0)).map { results!!.getJSONObject(it) })
        }

    fun wish(result: JSONObject, now: Boolean = false) {
        val body = JSONObject().put("now", now)
        if (result.optString("kind") == "playlist") body.put("playlist", result.optString("id")) else body.put("id", result.optString("id"))
        call("/api/wish", body) { if (it != null) core.message = if (now) "Spielt gleich." else "„${result.optString("title")}“ ist in der Queue." }
    }
}
