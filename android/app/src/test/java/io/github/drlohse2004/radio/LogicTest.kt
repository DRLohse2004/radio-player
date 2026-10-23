package io.github.drlohse2004.radio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LogicTest {
    @Test
    fun clientTokenWieUnterWindows() {
        // Vergleichswert aus remote.cjs (Node): HMAC-SHA256("master", "ha-1234"), erste 32 Zeichen
        assertEquals("b95a8f849c1279fdea8b27446e0d8cc4", clientToken("master", "ha-1234"))
    }

    @Test
    fun castNachrichtWieCastCjs() {
        val bytes = encodeCast(CastMessage("sender-0", "receiver-0", "urn:x", "{\"type\":\"PING\"}"))
        val hex = bytes.joinToString("") { "%02x".format(it) }
        assertEquals("000000320800120873656e6465722d301a0a72656365697665722d30220575726e3a782800320f7b2274797065223a2250494e47227d", hex)
        val back = decodeCast(bytes.copyOfRange(4, bytes.size))
        assertEquals("receiver-0", back.destination)
        assertEquals("{\"type\":\"PING\"}", back.payload)
        // lange Nutzlast (mehrbytige Länge)
        val long = "x".repeat(300)
        assertEquals(long, decodeCast(encodeCast(CastMessage("a", "b", "c", long)).let { it.copyOfRange(4, it.size) }).payload)
    }

    @Test
    fun streamTitel() {
        assertEquals("Adele" to "Hello", parseStreamTitle("Adele - Hello"))
        assertEquals(null to "Nachrichten", parseStreamTitle("Nachrichten"))
        assertNull(parseStreamTitle(" - "))
    }

    @Test
    fun namenVergleichen() {
        assertTrue(artistMatches("DAVID GUETTA FEAT. SIA", "David Guetta & Sia"))
        assertFalse(artistMatches("Adele", "Coldplay"))
        assertTrue(nameMatches("1.FM Deep House", "1.FM - Deep House Radio"))
        assertFalse(nameMatches("Jam FM", "Radio Hamburg"))
    }

    @Test
    fun versionen() {
        assertTrue(isNewer("1.10.0", "1.9.3"))
        assertTrue(isNewer("v1.13.1", "1.13.0"))
        assertFalse(isNewer("1.13.0", "1.13.0"))
    }

    @Test
    fun dlnaBeschreibung() {
        val xml = """<root><URLBase>http://10.0.0.5:49152/</URLBase><device><friendlyName>WiiM Mini</friendlyName><modelName>WiiM Mini</modelName><UDN>uuid:1</UDN><serviceList>
            <service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/upnp/control/rendercontrol1</controlURL></service>
            <service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/upnp/control/rendertransport1</controlURL></service>
            </serviceList></device></root>"""
        val d = parseDlnaDescription(xml, "http://10.0.0.5:49152/description.xml")!!
        assertEquals("http://10.0.0.5:49152/upnp/control/rendertransport1", d.avTransport)
        assertEquals("http://10.0.0.5:49152/upnp/control/rendercontrol1", d.rendering)
        assertEquals("a &amp; b", xmlEscape("a & b"))
    }

    @Test
    fun einstellungenRundreise() {
        val s = Settings(volume = 0.3f, host = HostPrefs(access = Access.SECURE, joinPin = "2468"), clientId = "and-1")
        val back = settingsFromJson(settingsToJson(s))
        assertEquals(s.copy(), back)
    }
}
