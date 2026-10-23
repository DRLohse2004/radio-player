package io.github.drlohse2004.radio

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URL

class HttpError(val status: Int, message: String) : Exception(message)

/** Einfacher HTTP-Aufruf (blockierend – nur aus Hintergrund-Threads). Liefert den Antworttext. */
fun httpText(
    url: String,
    method: String = "GET",
    body: String? = null,
    headers: Map<String, String> = emptyMap(),
    timeout: Int = 8000,
): String {
    val c = URL(url).openConnection() as HttpURLConnection
    c.requestMethod = method
    c.connectTimeout = timeout
    c.readTimeout = timeout
    c.setRequestProperty("User-Agent", "RadioPlayer/1.0 (Android)")
    for ((k, v) in headers) c.setRequestProperty(k, v)
    try {
        if (body != null) {
            c.doOutput = true
            if (!headers.keys.any { it.equals("Content-Type", true) }) c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toByteArray()) }
        }
        val status = c.responseCode
        val text = (if (status >= 400) c.errorStream else c.inputStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (status >= 400) {
            val message = runCatching { JSONObject(text).optString("error") }.getOrNull().orEmpty()
            throw HttpError(status, message.ifEmpty { "HTTP $status" })
        }
        return text
    } finally {
        c.disconnect()
    }
}

fun httpJson(url: String, method: String = "GET", body: JSONObject? = null, headers: Map<String, String> = emptyMap(), timeout: Int = 8000) =
    JSONObject(httpText(url, method, body?.toString(), headers, timeout).ifEmpty { "{}" })

/** Eigene IPv4-Adressen im lokalen Netz (WLAN, Ethernet), ohne Mobilfunk und VPN-Tunnel */
fun localAddresses(): List<Pair<String, Int>> =
    NetworkInterface.getNetworkInterfaces().toList()
        .filter { it.isUp && !it.isLoopback && !it.name.startsWith("rmnet") && !it.name.startsWith("tun") }
        .flatMap { nic ->
            nic.interfaceAddresses.filter { it.address is Inet4Address && it.address.isSiteLocalAddress }
                .map { it.address.hostAddress!! to it.networkPrefixLength.toInt() }
        }
