package io.github.drlohse2004.radio

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

// Reine Hilfsfunktionen ohne Android – getestet in LogicTest

/** „Interpret - Titel“ aus dem StreamTitle der Sender (wie metadata.ts unter Windows, vereinfacht) */
fun parseStreamTitle(raw: String?): Pair<String?, String>? {
    val text = raw?.trim()?.trim('\'', '"')?.trim().orEmpty()
    if (text.isEmpty() || text == "-") return null
    val parts = text.split(" - ", " – ", " — ", limit = 2)
    return if (parts.size == 2 && parts[0].isNotBlank() && parts[1].isNotBlank()) parts[0].trim() to parts[1].trim()
    else null to text
}

/** Versionen numerisch vergleichen: 1.10.0 > 1.9.0 */
fun isNewer(candidate: String, current: String): Boolean {
    val a = candidate.removePrefix("v").split(".").map { it.toIntOrNull() ?: 0 }
    val b = current.removePrefix("v").split(".").map { it.toIntOrNull() ?: 0 }
    for (i in 0 until maxOf(a.size, b.size)) {
        val x = a.getOrElse(i) { 0 }
        val y = b.getOrElse(i) { 0 }
        if (x != y) return x > y
    }
    return false
}

/** Geräteschlüssel im sicheren Modus – genau wie clientToken in remote.cjs */
fun clientToken(key: String, clientId: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key.toByteArray(), "HmacSHA256"))
    return mac.doFinal(clientId.toByteArray()).joinToString("") { "%02x".format(it) }.take(32)
}

/** Vergleich ohne Zeitunterschied je nach Übereinstimmung */
fun safeEqual(a: String, b: String) = MessageDigest.isEqual(a.toByteArray(), b.toByteArray())

fun randomKey(length: Int = 24): String {
    val chars = "abcdefghijkmnpqrstuvwxyz23456789"
    val random = java.security.SecureRandom()
    return (1..length).map { chars[random.nextInt(chars.length)] }.joinToString("")
}

// --- CastMessage (Protobuf) wie in electron/cast.cjs -------------------------------------------

data class CastMessage(val source: String, val destination: String, val namespace: String, val payload: String)

private fun varint(out: java.io.ByteArrayOutputStream, value: Int) {
    var n = value
    while ((n and 0x7f.inv()) != 0) {
        out.write((n and 0x7f) or 0x80)
        n = n ushr 7
    }
    out.write(n)
}

/** Nachricht mit 4-Byte-Längenpräfix */
fun encodeCast(m: CastMessage): ByteArray {
    val body = java.io.ByteArrayOutputStream()
    fun num(field: Int, v: Int) { varint(body, field shl 3); varint(body, v) }
    fun str(field: Int, v: String) {
        val bytes = v.toByteArray()
        varint(body, (field shl 3) or 2); varint(body, bytes.size); body.write(bytes)
    }
    num(1, 0)
    str(2, m.source)
    str(3, m.destination)
    str(4, m.namespace)
    num(5, 0)
    str(6, m.payload)
    val b = body.toByteArray()
    val size = b.size
    return byteArrayOf((size ushr 24).toByte(), (size ushr 16).toByte(), (size ushr 8).toByte(), size.toByte()) + b
}

/** Protobuf-Körper ohne Längenpräfix */
fun decodeCast(buf: ByteArray): CastMessage {
    var i = 0
    fun readVarint(): Long {
        var n = 0L
        var shift = 0
        while (true) {
            val b = buf[i++].toInt() and 0xff
            n = n or ((b and 0x7f).toLong() shl shift)
            shift += 7
            if ((b and 0x80) == 0) return n
        }
    }
    var source = ""
    var destination = ""
    var namespace = ""
    var payload = ""
    while (i < buf.size) {
        val tag = readVarint().toInt()
        if ((tag and 7) == 0) { readVarint(); continue }
        val len = readVarint().toInt()
        val value = String(buf, i, len)
        i += len
        when (tag ushr 3) {
            2 -> source = value
            3 -> destination = value
            4 -> namespace = value
            6 -> payload = value
        }
    }
    return CastMessage(source, destination, namespace, payload)
}

// --- DLNA ----------------------------------------------------------------------------------

fun xmlEscape(s: String?) = (s ?: "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;")

fun xmlTag(xml: String, name: String): String =
    Regex("<(?:\\w+:)?$name[^>]*>([^<]*)<", RegexOption.IGNORE_CASE).find(xml)?.groupValues?.get(1)?.trim().orEmpty()

data class DlnaControl(val id: String, val name: String, val model: String, val avTransport: String, val rendering: String?)

/** Gerätebeschreibung → Steueradressen; null, wenn das Gerät keinen AVTransport hat */
fun parseDlnaDescription(xml: String, location: String): DlnaControl? {
    val base = xmlTag(xml, "URLBase").ifEmpty { location }
    fun control(type: String): String? {
        val service = xml.split(Regex("<service>", RegexOption.IGNORE_CASE)).firstOrNull { it.contains(type) } ?: return null
        val url = xmlTag(service, "controlURL").ifEmpty { return null }
        return java.net.URL(java.net.URL(base), url).toString()
    }
    val av = control("urn:schemas-upnp-org:service:AVTransport:1") ?: return null
    val host = java.net.URL(location).host
    return DlnaControl(
        xmlTag(xml, "UDN").ifEmpty { location },
        xmlTag(xml, "friendlyName").ifEmpty { host },
        xmlTag(xml, "modelName"),
        av,
        control("urn:schemas-upnp-org:service:RenderingControl:1"),
    )
}
