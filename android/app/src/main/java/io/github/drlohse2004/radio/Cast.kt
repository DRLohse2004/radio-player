package io.github.drlohse2004.radio

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject
import java.io.DataInputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/** Ein Lautsprecher im Netzwerk: Chromecast (CASTV2) oder DLNA/UPnP-Renderer */
data class Speaker(val id: String, val name: String, val model: String, val host: String, val port: Int, val dlna: DlnaControl? = null)

private const val APP_ID = "CC1AD845" // Default Media Receiver
private const val NS_CONNECTION = "urn:x-cast:com.google.cast.tp.connection"
private const val NS_HEARTBEAT = "urn:x-cast:com.google.cast.tp.heartbeat"
private const val NS_RECEIVER = "urn:x-cast:com.google.cast.receiver"
private const val NS_MEDIA = "urn:x-cast:com.google.cast.media"
private const val AVT = "urn:schemas-upnp-org:service:AVTransport:1"
private const val RC = "urn:schemas-upnp-org:service:RenderingControl:1"

/**
 * Senden an Lautsprecher – wie electron/cast.cjs und dlna.cjs: Das Gerät holt den Stream selbst und
 * folgt der eigenen, stummen Wiedergabe. Alles Netzwerk läuft nacheinander in einem eigenen Thread.
 */
class CastManager(private val core: RadioCore) {
    var device by mutableStateOf<Speaker?>(null)
        private set
    var devices by mutableStateOf<List<Speaker>>(emptyList())
        private set
    var searching by mutableStateOf(false)
        private set
    var state by mutableStateOf("")
        private set
    var error by mutableStateOf<String?>(null)
        private set

    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadScheduledExecutor()
    private var wish: CastWish? = null

    // Chromecast-Verbindung (nur im worker-Thread benutzt)
    private var client: CastConnection? = null
    private var clientFor: String? = null
    private var transportId: String? = null
    private var sessionId: String? = null
    private var mediaSessionId: Int? = null
    private var launching = false
    private var loaded: String? = null
    private var lastVolume = -1f

    private fun ui(block: () -> Unit) = main.post(block)
    private fun status(text: String, err: String? = null) { ui { state = text; error = err } }

    fun choose(speaker: Speaker?) {
        error = null
        state = if (speaker == null) "" else "verbindet …"
        device = speaker
        follow(wish)
    }

    /** Neuer Wunsch aus RadioCore (Haupt-Thread) */
    fun follow(w: CastWish?) {
        wish = w
        val target = device
        worker.execute { runCatching { sync(target, w) }.onFailure { fail(it.message) } }
    }

    private fun fail(message: String?) {
        val name = device?.name
        worker.execute { closeCast(stop = false); resetDlna() }
        ui {
            device = null
            state = ""
            error = "„$name“: ${message ?: "Verbindung verloren"}"
        }
    }

    private fun sync(target: Speaker?, w: CastWish?) {
        // Gerät gewechselt oder abgewählt: Das alte schweigt
        if (clientFor != null && clientFor != target?.id) closeCast(stop = true)
        if (dlnaFor != null && dlnaFor?.avTransport != target?.dlna?.avTransport) stopDlna()
        if (target == null || w == null) return
        if (target.dlna != null) syncDlna(target.dlna, w) else syncCast(target, w)
    }

    // --- Suche ---------------------------------------------------------------------------

    fun search(context: Context) {
        if (searching) return
        searching = true
        worker.execute {
            val found = ConcurrentHashMap<String, Speaker>()
            val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
            val pending = java.util.concurrent.LinkedBlockingQueue<NsdServiceInfo>()
            val listener = object : NsdManager.DiscoveryListener {
                override fun onServiceFound(info: NsdServiceInfo) { pending.add(info) }
                override fun onServiceLost(info: NsdServiceInfo) {}
                override fun onDiscoveryStarted(type: String) {}
                override fun onDiscoveryStopped(type: String) {}
                override fun onStartDiscoveryFailed(type: String, code: Int) {}
                override fun onStopDiscoveryFailed(type: String, code: Int) {}
            }
            runCatching { nsd.discoverServices("_googlecast._tcp", NsdManager.PROTOCOL_DNS_SD, listener) }
            val dlnaThread = Thread { runCatching { searchDlna().forEach { found.putIfAbsent("dlna:" + it.host, it) } } }.apply { start() }
            // Gefundene Dienste nacheinander auflösen (ältere Android-Versionen können nur einen zur Zeit)
            val deadline = System.currentTimeMillis() + 3500
            while (System.currentTimeMillis() < deadline) {
                val info = pending.poll(200, TimeUnit.MILLISECONDS) ?: continue
                val done = java.util.concurrent.CountDownLatch(1)
                @Suppress("DEPRECATION")
                runCatching {
                    nsd.resolveService(info, object : NsdManager.ResolveListener {
                        override fun onResolveFailed(i: NsdServiceInfo, code: Int) = done.countDown()
                        override fun onServiceResolved(i: NsdServiceInfo) {
                            val attr = i.attributes.mapValues { String(it.value ?: ByteArray(0)) }
                            val host = i.host?.hostAddress
                            if (host != null) {
                                val id = attr["id"] ?: i.serviceName
                                found["cast:$host"] = Speaker(id, attr["fn"] ?: i.serviceName, attr["md"].orEmpty(), host, i.port)
                            }
                            done.countDown()
                        }
                    })
                }.onFailure { done.countDown() }
                done.await(2, TimeUnit.SECONDS)
            }
            runCatching { nsd.stopServiceDiscovery(listener) }
            dlnaThread.join(3000)
            // Kann ein Gerät beides (z. B. WiiM Pro), zählt Chromecast
            val castHosts = found.values.filter { it.dlna == null }.map { it.host }.toSet()
            val list = found.values.filter { it.dlna == null || it.host !in castHosts }.sortedBy { it.name.lowercase() }
            ui { devices = list; searching = false }
        }
    }

    private fun searchDlna(): List<Speaker> {
        val search = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: $AVT\r\n\r\n".toByteArray()
        val locations = mutableSetOf<String>()
        DatagramSocket().use { socket ->
            socket.soTimeout = 300
            val target = InetSocketAddress(InetAddress.getByName("239.255.255.250"), 1900)
            repeat(2) { socket.send(DatagramPacket(search, search.size, target)) }
            val buf = ByteArray(2048)
            val deadline = System.currentTimeMillis() + 2500
            while (System.currentTimeMillis() < deadline) {
                try {
                    val p = DatagramPacket(buf, buf.size)
                    socket.receive(p)
                    Regex("(?im)^location:\\s*(\\S+)").find(String(p.data, 0, p.length))?.groupValues?.get(1)?.let(locations::add)
                } catch (_: SocketTimeoutException) {
                }
            }
        }
        return locations.mapNotNull { loc ->
            runCatching {
                val control = parseDlnaDescription(httpText(loc, timeout = 2000), loc) ?: return@runCatching null
                Speaker(control.id, control.name, control.model, java.net.URL(loc).host, 0, control)
            }.getOrNull()
        }
    }

    // --- Chromecast ------------------------------------------------------------------------

    private fun syncCast(target: Speaker, w: CastWish) {
        if (clientFor != target.id) {
            status("verbindet …")
            client = CastConnection(
                target.host,
                target.port,
                onReady = { worker.execute { if (clientFor == target.id) wish?.let { syncCast(target, it) } } },
                onMessage = { m -> worker.execute { onCastMessage(m) } },
                onClose = { err -> worker.execute { if (clientFor == target.id) fail(err) } },
            )
            clientFor = target.id
        }
        val c = client ?: return
        if (!c.ready) return // geht weiter, sobald die Verbindung steht
        if (w.volume != lastVolume) {
            lastVolume = w.volume
            c.send(NS_RECEIVER, JSONObject().put("type", "SET_VOLUME").put("volume", JSONObject().put("level", w.volume.toDouble())))
        }
        if (w.url == null) {
            // Nichts zu spielen (Pause beim Radio): Player am Gerät beenden, Gerät bleibt gewählt
            sessionId?.let { c.send(NS_RECEIVER, JSONObject().put("type", "STOP").put("sessionId", it)) }
            transportId = null; sessionId = null; mediaSessionId = null; loaded = null
            return status("bereit")
        }
        val app = transportId
        if (app == null) {
            if (!launching) {
                launching = true
                c.send(NS_RECEIVER, JSONObject().put("type", "LAUNCH").put("appId", APP_ID))
            }
            return
        }
        if (loaded != w.url) {
            loaded = w.url
            status("lädt …")
            val metadata = JSONObject().put("metadataType", 3).put("title", w.title)
                .put("images", org.json.JSONArray().apply { w.cover?.let { put(JSONObject().put("url", it)) } })
            val media = JSONObject().put("contentId", w.url).put("contentType", contentType(w.url)).put("streamType", "LIVE").put("metadata", metadata)
            c.send(NS_MEDIA, JSONObject().put("type", "LOAD").put("autoplay", true).put("currentTime", 0).put("media", media), app)
        }
    }

    private fun onCastMessage(m: CastMessage) {
        val data = runCatching { JSONObject(m.payload) }.getOrNull() ?: return
        val c = client ?: return
        when (data.optString("type")) {
            "PING" -> c.send(NS_HEARTBEAT, JSONObject().put("type", "PONG"), m.source)
            "RECEIVER_STATUS" -> {
                val apps = data.optJSONObject("status")?.optJSONArray("applications")
                val running = (0 until (apps?.length() ?: 0)).map { apps!!.getJSONObject(it) }.firstOrNull { it.optString("appId") == APP_ID }
                if (running != null && transportId == null) {
                    transportId = running.getString("transportId")
                    sessionId = running.optString("sessionId")
                    launching = false
                    c.send(NS_CONNECTION, JSONObject().put("type", "CONNECT"), transportId!!)
                    wish?.let { syncCast(device ?: return, it) }
                } else if (running == null && transportId != null) {
                    fail("dort spielt jetzt etwas anderes")
                }
            }
            "LAUNCH_ERROR" -> fail("Player konnte nicht starten")
            "MEDIA_STATUS" -> {
                val s = data.optJSONArray("status")?.optJSONObject(0) ?: return
                mediaSessionId = s.optInt("mediaSessionId")
                val player = s.optString("playerState")
                if (player == "IDLE" && s.optString("idleReason") == "ERROR") return status("Fehler", "Das Gerät kann diesen Stream nicht abspielen.")
                status(when (player) { "BUFFERING" -> "lädt …"; "PAUSED" -> "pausiert"; "IDLE" -> "bereit"; else -> "spielt" })
            }
            "LOAD_FAILED", "INVALID_REQUEST" -> status("Fehler", "Das Gerät kann diesen Stream nicht abspielen.")
        }
    }

    private fun closeCast(stop: Boolean) {
        val c = client ?: return
        if (stop) sessionId?.let { c.send(NS_RECEIVER, JSONObject().put("type", "STOP").put("sessionId", it)) }
        worker.schedule({ c.close() }, 300, TimeUnit.MILLISECONDS)
        client = null; clientFor = null; transportId = null; sessionId = null; mediaSessionId = null
        launching = false; loaded = null; lastVolume = -1f
    }

    // --- DLNA ------------------------------------------------------------------------------

    private var dlnaFor: DlnaControl? = null
    private var dlnaLoaded: String? = null
    private var dlnaVolume = -1f

    private fun resetDlna() { dlnaFor = null; dlnaLoaded = null; dlnaVolume = -1f }

    private fun stopDlna() {
        dlnaFor?.let { d -> if (dlnaLoaded != null) runCatching { soap(d.avTransport, AVT, "Stop", mapOf("InstanceID" to "0")) } }
        resetDlna()
    }

    private fun syncDlna(d: DlnaControl, w: CastWish) {
        if (dlnaFor?.avTransport != d.avTransport) {
            resetDlna()
            dlnaFor = d
        }
        if (d.rendering != null && w.volume != dlnaVolume) {
            dlnaVolume = w.volume
            soap(d.rendering, RC, "SetVolume", mapOf("InstanceID" to "0", "Channel" to "Master", "DesiredVolume" to Math.round(w.volume * 100).toString()))
        }
        if (w.url == null) {
            if (dlnaLoaded != null) soap(d.avTransport, AVT, "Stop", mapOf("InstanceID" to "0"))
            dlnaLoaded = null
            return status("bereit")
        }
        if (dlnaLoaded != w.url) {
            status("lädt …")
            val didl = "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" " +
                "xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\"><item id=\"0\" parentID=\"-1\" restricted=\"1\">" +
                "<dc:title>${xmlEscape(w.title)}</dc:title>" +
                (w.cover?.let { "<upnp:albumArtURI>${xmlEscape(it)}</upnp:albumArtURI>" } ?: "") +
                "<upnp:class>object.item.audioItem.musicTrack</upnp:class>" +
                "<res protocolInfo=\"http-get:*:${contentType(w.url)}:*\">${xmlEscape(w.url)}</res></item></DIDL-Lite>"
            soap(d.avTransport, AVT, "SetAVTransportURI", mapOf("InstanceID" to "0", "CurrentURI" to w.url, "CurrentURIMetaData" to didl))
            soap(d.avTransport, AVT, "Play", mapOf("InstanceID" to "0", "Speed" to "1"))
            dlnaLoaded = w.url
        }
        status("spielt")
    }

    private fun soap(url: String, service: String, action: String, args: Map<String, String>) {
        val body = "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" " +
            "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:$action xmlns:u=\"$service\">" +
            args.entries.joinToString("") { "<${it.key}>${xmlEscape(it.value)}</${it.key}>" } +
            "</u:$action></s:Body></s:Envelope>"
        try {
            httpText(url, "POST", body, mapOf("Content-Type" to "text/xml; charset=\"utf-8\"", "SOAPACTION" to "\"$service#$action\""), 5000)
        } catch (e: HttpError) {
            throw Exception("$action: ${e.message}")
        }
    }
}

fun contentType(url: String) = when {
    Regex("\\.m3u8(\\?|$)", RegexOption.IGNORE_CASE).containsMatchIn(url) -> "application/x-mpegURL"
    Regex("\\.aac(\\?|$)", RegexOption.IGNORE_CASE).containsMatchIn(url) -> "audio/aac"
    Regex("\\.ogg(\\?|$)", RegexOption.IGNORE_CASE).containsMatchIn(url) -> "audio/ogg"
    else -> "audio/mpeg"
}

/** TLS-Verbindung zu einem Chromecast (Port 8009, selbst signiertes Zertifikat) */
private class CastConnection(host: String, port: Int, onReady: () -> Unit, onMessage: (CastMessage) -> Unit, onClose: (String?) -> Unit) {
    @Volatile var ready = false
        private set
    private val socket: SSLSocket
    private var requestId = 1
    @Volatile private var closed = false
    private val heartbeat = Executors.newSingleThreadScheduledExecutor()

    init {
        val trustAll = arrayOf<TrustManager>(object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
            override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
        })
        val ssl = SSLContext.getInstance("TLS").apply { init(null, trustAll, null) }
        socket = ssl.socketFactory.createSocket() as SSLSocket
        Thread {
            try {
                socket.connect(InetSocketAddress(host, port), 5000)
                socket.soTimeout = 20_000
                socket.startHandshake()
                ready = true
                send(NS_CONNECTION, JSONObject().put("type", "CONNECT"))
                onReady()
                heartbeat.scheduleWithFixedDelay({ send(NS_HEARTBEAT, JSONObject().put("type", "PING")) }, 5, 5, TimeUnit.SECONDS)
                val input = DataInputStream(socket.inputStream)
                while (!closed) {
                    val len = input.readInt()
                    val buf = ByteArray(len)
                    input.readFully(buf)
                    onMessage(decodeCast(buf))
                }
            } catch (e: Exception) {
                if (!closed) onClose(if (e is SocketTimeoutException) "Das Gerät antwortet nicht." else e.message)
            } finally {
                close()
            }
        }.start()
    }

    @Synchronized
    fun send(namespace: String, data: JSONObject, destination: String = "receiver-0") {
        if (closed || !ready) return
        val type = data.optString("type")
        if (type != "PING" && type != "PONG" && type != "CONNECT") data.put("requestId", requestId++)
        runCatching { socket.outputStream.write(encodeCast(CastMessage("sender-0", destination, namespace, data.toString()))) }
    }

    fun close() {
        closed = true
        heartbeat.shutdownNow()
        runCatching { socket.close() }
    }
}
