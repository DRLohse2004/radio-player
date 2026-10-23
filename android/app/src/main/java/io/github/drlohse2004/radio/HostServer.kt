package io.github.drlohse2004.radio

import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Einmalcode, den das Handy groß anzeigt, wenn ein Gerät im sicheren Modus beitreten will */
data class JoinCode(val code: String, val name: String)

/**
 * Das Handy als Host – dieselbe HTTP-Schnittstelle wie electron/remote.cjs, damit Windows-Radios (Rooms),
 * andere Handys und Home Assistant es steuern können. Ohne Handy-Webseite und ohne YouTube.
 * Android erlaubt Port 80 nicht; Windows-Radios und Home Assistant probieren 8080 von selbst.
 */
class HostServer(private val core: RadioCore) {
    var running by mutableStateOf(false)
        private set
    var port by mutableStateOf(0)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var joinCode by mutableStateOf<JoinCode?>(null)
        private set
    var clients by mutableStateOf<List<String>>(emptyList())
        private set

    private val main = Handler(Looper.getMainLooper())
    private val pool = Executors.newCachedThreadPool()
    private var server: ServerSocket? = null
    private var udp: DatagramSocket? = null
    private var prefs = HostPrefs()
    @Volatile private var snapshot = "{}"
    private val streams = CopyOnWriteArrayList<Pair<OutputStream, String>>()
    private val adminTokens = ConcurrentHashMap.newKeySet<String>()
    private val attempts = ConcurrentHashMap<String, MutableList<Long>>()
    private val names = ConcurrentHashMap<String, String>()
    @Volatile private var pendingCode: Triple<String, String, Long>? = null // Code, clientId, gültig bis
    private val pinger = Executors.newSingleThreadScheduledExecutor()

    init {
        pinger.scheduleWithFixedDelay({ broadcastRaw(": ping\n\n") }, 20, 20, TimeUnit.SECONDS)
    }

    /** Einstellungen geändert (Haupt-Thread): Server an/aus, Schlüssel bei Bedarf anlegen */
    fun configure(p: HostPrefs) {
        if (p.access != Access.OFF && p.key.isEmpty()) return core.update { it.copy(host = p.copy(key = randomKey())) }
        prefs = p
        if (p.access == Access.OFF) stop() else start()
    }

    fun publish(state: String) {
        snapshot = state
        // Kommt aus dem Haupt-Thread – dort verbietet Android Netzwerkzugriffe, also im eigenen Thread senden
        pinger.execute { broadcastRaw("event: state\ndata: $state\n\n") }
    }

    private fun broadcastRaw(text: String) {
        for (s in streams) {
            runCatching { synchronized(s.first) { s.first.write(text.toByteArray()); s.first.flush() } }
                .onFailure { streams.remove(s); updateClients() }
        }
    }

    private fun updateClients() {
        val list = streams.map { names[it.second] ?: "Gast" }
        main.post { clients = list }
    }

    private fun start() {
        if (server != null) return
        val socket = listOf(8080, 8081, 8000).firstNotNullOfOrNull { p ->
            runCatching { ServerSocket().apply { reuseAddress = true; bind(InetSocketAddress(p)) } }.getOrNull()
        }
        if (socket == null) {
            error = "Port 8080 ist belegt."
            return
        }
        server = socket
        port = socket.localPort
        running = true
        error = null
        pool.execute {
            while (!socket.isClosed) {
                val client = runCatching { socket.accept() }.getOrNull() ?: break
                pool.execute { runCatching { handle(client) }; }
            }
        }
        // Rooms über Netzgrenzen: Antwort auf „radio-room?“ (wie discovery.cjs)
        pool.execute {
            runCatching {
                DatagramSocket(null).use { s ->
                    s.reuseAddress = true
                    s.bind(InetSocketAddress(DISCOVERY_PORT))
                    udp = s
                    val buf = ByteArray(256)
                    while (!s.isClosed) {
                        val p = DatagramPacket(buf, buf.size)
                        s.receive(p)
                        if (String(p.data, 0, p.length).trim() != "radio-room?") continue
                        val answer = JSONObject().put("app", "radio").put("port", port).toString().toByteArray()
                        s.send(DatagramPacket(answer, answer.size, p.socketAddress))
                    }
                }
            }
        }
    }

    private fun stop() {
        runCatching { server?.close() }
        runCatching { udp?.close() }
        server = null
        udp = null
        for (s in streams) runCatching { s.first.close() }
        streams.clear()
        running = false
        port = 0
        clients = emptyList()
    }

    // --- HTTP ------------------------------------------------------------------------------

    private class Request(val method: String, val path: String, val query: Map<String, String>, val headers: Map<String, String>, val body: String, val ip: String)

    private fun read(socket: Socket): Request? {
        val input = BufferedInputStream(socket.getInputStream())
        val head = StringBuilder()
        while (!head.endsWith("\r\n\r\n")) {
            val b = input.read()
            if (b < 0 || head.length > 8192) return null
            head.append(b.toChar())
        }
        val lines = head.trim().split("\r\n")
        val (method, target) = lines[0].split(" ").let { (it.getOrNull(0) ?: "") to (it.getOrNull(1) ?: "/") }
        val headers = lines.drop(1).mapNotNull { l -> l.indexOf(':').takeIf { it > 0 }?.let { l.substring(0, it).trim().lowercase() to l.substring(it + 1).trim() } }.toMap()
        val length = headers["content-length"]?.toIntOrNull() ?: 0
        if (length > 16 * 1024) return null
        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(body, read, length - read)
            if (n < 0) break
            read += n
        }
        val path = target.substringBefore("?")
        val query = target.substringAfter("?", "").split("&").filter { it.contains("=") }
            .associate { URLDecoder.decode(it.substringBefore("="), "UTF-8") to URLDecoder.decode(it.substringAfter("="), "UTF-8") }
        return Request(method, path, query, headers, String(body, 0, read), socket.inetAddress.hostAddress.orEmpty())
    }

    private fun respond(socket: Socket, status: Int, body: JSONObject) {
        val bytes = body.toString().toByteArray()
        val text = when (status) { 200 -> "OK"; 400 -> "Bad Request"; 403 -> "Forbidden"; 404 -> "Not Found"; 429 -> "Too Many Requests"; else -> "Error" }
        socket.getOutputStream().apply {
            write("HTTP/1.1 $status $text\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
            write(bytes)
            flush()
        }
        socket.close()
    }

    private fun reject(socket: Socket, status: Int, message: String, extra: JSONObject.() -> Unit = {}) =
        respond(socket, status, JSONObject().put("error", message).apply(extra))

    private fun handle(socket: Socket) {
        socket.soTimeout = 10_000
        val req = read(socket) ?: return socket.close()
        val p = prefs
        if (req.method == "GET" && req.path == "/api/room") {
            return respond(
                socket, 200,
                JSONObject().put("app", "radio").put("name", p.name.ifBlank { "Radio ${android.os.Build.MODEL}" })
                    .put("version", BuildConfig.VERSION_NAME).put("open", p.access != Access.OFF).put("secure", p.access == Access.SECURE)
                    .put("key", if (p.access == Access.PUBLIC) p.key else JSONObject.NULL).put("listeners", streams.size),
            )
        }
        if (!req.path.startsWith("/api/")) return reject(socket, 404, "Unbekannt")
        if (req.method == "POST" && req.path == "/api/join") return join(socket, req, p)

        val key = req.headers["x-key"] ?: req.query["k"].orEmpty()
        val clientId = (req.headers["x-client"] ?: req.query["c"].orEmpty()).take(40)
        val valid = p.key.isNotEmpty() && (
            (p.access == Access.PUBLIC && safeEqual(key, p.key)) ||
                (p.access != Access.OFF && clientId.isNotEmpty() && safeEqual(key, clientToken(p.key, clientId)))
            )
        if (!valid) {
            return when (p.access) {
                Access.OFF -> reject(socket, 403, "Das Radio lässt gerade niemanden herein.")
                Access.SECURE -> reject(socket, 403, "Dieses Radio ist gesichert – bitte PIN oder Code eingeben.") { put("join", true) }
                Access.PUBLIC -> reject(socket, 403, "Zugang abgelaufen – bitte neu verbinden.")
            }
        }
        if (clientId.isNotEmpty()) names[clientId] = runCatching { URLDecoder.decode(req.headers["x-name"].orEmpty(), "UTF-8") }.getOrDefault("").ifBlank { "Gast" }.take(30)
        val isAdmin = adminTokens.contains(req.headers["x-admin"].orEmpty())

        when {
            req.method == "GET" && req.path == "/api/events" -> {
                val out = socket.getOutputStream()
                out.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nConnection: keep-alive\r\n\r\nretry: 3000\n\nevent: state\ndata: $snapshot\n\n".toByteArray())
                out.flush()
                socket.soTimeout = 0
                streams.add(out to clientId)
                updateClients()
                // Verbindung halten, bis der Gast geht (read liefert dann -1)
                runCatching { while (socket.getInputStream().read() >= 0) Unit }
                streams.removeIf { it.first === out }
                updateClients()
                socket.close()
            }
            req.method == "GET" && req.path == "/api/state" -> respond(socket, 200, JSONObject(snapshot))
            req.method == "POST" && req.path == "/api/admin" -> {
                if (limited(req.ip)) return reject(socket, 429, "Zu viele Versuche – bitte eine Minute warten.")
                val pin = runCatching { JSONObject(req.body).optString("pin") }.getOrDefault("")
                if (p.adminPin.isEmpty() || !safeEqual(pin, p.adminPin)) {
                    fail(req.ip)
                    return reject(socket, 403, if (p.adminPin.isEmpty()) "Am Radio ist keine Admin-PIN eingerichtet." else "PIN falsch.")
                }
                val token = ByteArray(24).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
                adminTokens.add(token)
                respond(socket, 200, JSONObject().put("token", token))
            }
            req.method == "POST" && req.path == "/api/command" -> {
                val body = runCatching { JSONObject(req.body) }.getOrDefault(JSONObject())
                val action = body.optString("action")
                val allowed = isAdmin || when (action) {
                    "toggle", "next", "prev" -> p.guestSkip
                    "volume" -> p.guestVolume
                    "station" -> p.guestStations
                    else -> false
                }
                if (!allowed) return reject(socket, 403, "Das darf nur der Admin.")
                val result = onMain { command(action, body.opt("value")) }
                if (result != null) reject(socket, 400, result) else respond(socket, 200, JSONObject().put("ok", true))
            }
            req.path == "/api/search" || req.path == "/api/wish" || req.path == "/api/playlist" ->
                reject(socket, 400, "YouTube gibt es nur an Windows-Radios.")
            else -> reject(socket, 404, "Unbekannt")
        }
    }

    /** Befehl im Haupt-Thread ausführen; liefert eine Fehlermeldung oder null */
    private fun command(action: String, value: Any?): String? {
        when (action) {
            "toggle" -> core.toggle()
            "next" -> core.next()
            "prev" -> core.prev()
            "volume" -> core.setVolume(((value as? Number)?.toFloat() ?: return "Ungültige Lautstärke."))
            "station" -> core.play(core.settings.stations.firstOrNull { it.id == value.toString() } ?: return "Sender nicht gefunden.")
            else -> return "Das geht am Handy-Radio nicht."
        }
        return null
    }

    private fun onMain(block: () -> String?): String? {
        var result: String? = null
        val done = CountDownLatch(1)
        main.post { result = runCatching(block).getOrElse { it.message }; done.countDown() }
        return if (done.await(8, TimeUnit.SECONDS)) result else "Das Radio antwortet nicht."
    }

    private fun limited(ip: String): Boolean {
        val now = System.currentTimeMillis()
        val list = attempts.getOrPut(ip) { mutableListOf() }
        synchronized(list) { list.removeAll { now - it > 60_000 }; return list.size >= 5 }
    }

    private fun fail(ip: String) {
        val list = attempts.getOrPut(ip) { mutableListOf() }
        synchronized(list) { list.add(System.currentTimeMillis()) }
    }

    /** Beitreten: öffentlich sofort, sicher mit Join-PIN oder dem Einmalcode, den das Handy anzeigt */
    private fun join(socket: Socket, req: Request, p: HostPrefs) {
        val body = runCatching { JSONObject(req.body) }.getOrDefault(JSONObject())
        val clientId = body.optString("clientId").take(40)
        if (p.access == Access.OFF || p.key.isEmpty()) return reject(socket, 403, "Das Radio lässt gerade niemanden herein.")
        if (clientId.isEmpty()) return reject(socket, 400, "Gerätekennung fehlt.")
        if (p.access == Access.PUBLIC) return respond(socket, 200, JSONObject().put("key", clientToken(p.key, clientId)))
        val now = System.currentTimeMillis()
        if (body.optBoolean("request")) {
            val code = (100000 + SecureRandom().nextInt(900000)).toString()
            pendingCode = Triple(code, clientId, now + 120_000)
            val name = body.optString("name").ifBlank { "Gast" }.take(30)
            main.post { joinCode = JoinCode(code, name) }
            main.postDelayed({ if (pendingCode?.first == code) { pendingCode = null; joinCode = null } }, 121_000)
            return respond(socket, 200, JSONObject().put("ok", true))
        }
        if (limited(req.ip)) return reject(socket, 429, "Zu viele Versuche – bitte eine Minute warten.")
        val code = body.optString("code").filter { it.isDigit() }
        val pending = pendingCode
        val pinOk = body.has("pin") && p.joinPin.isNotEmpty() && safeEqual(body.optString("pin"), p.joinPin)
        val codeOk = code.isNotEmpty() && pending != null && pending.second == clientId && pending.third > now && safeEqual(code, pending.first)
        if (!pinOk && !codeOk) {
            fail(req.ip)
            return reject(socket, 403, "PIN oder Code falsch – ein Code gilt 2 Minuten.")
        }
        if (codeOk || pending?.second == clientId) {
            pendingCode = null
            main.post { joinCode = null }
        }
        respond(socket, 200, JSONObject().put("key", clientToken(p.key, clientId)))
    }
}
