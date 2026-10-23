@file:OptIn(ExperimentalMaterial3Api::class)

package io.github.drlohse2004.radio.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.HorizontalDivider
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import io.github.drlohse2004.radio.Access
import io.github.drlohse2004.radio.HostPrefs
import io.github.drlohse2004.radio.localAddresses
import io.github.drlohse2004.radio.randomKey
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.drlohse2004.radio.RadioCore
import io.github.drlohse2004.radio.RoomInfo
import org.json.JSONObject

/** Rooms wie unter Windows: oben fernsteuern lassen (Host), darunter ein anderes Radio fernsteuern */
@Composable
fun RoomScreen(core: RadioCore) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Text("Rooms", color = C.text, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 16.dp))
        HostSection(core)
        HorizontalDivider(Modifier.padding(vertical = 18.dp), color = C.surface3)
        if (core.room.active) RoomConnection(core) else RoomFinder(core)
        Gap(32.dp)
    }
}

/** Eingeklappter Bereich „Weitere Optionen“ */
@Composable
private fun More(content: @Composable () -> Unit) {
    var open by remember { mutableStateOf(false) }
    TextButton({ open = !open }) { Text(if (open) "▾ Weitere Optionen" else "▸ Weitere Optionen", color = C.muted) }
    if (open) Column(Modifier.padding(start = 8.dp)) { content() }
}

@Composable
private fun HostSection(core: RadioCore) {
    val h = core.settings.host
    fun set(change: (HostPrefs) -> HostPrefs) = core.update { it.copy(host = change(it.host)) }
    val server = core.host

    Text("Dieses Handy fernsteuern lassen", color = C.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp))
    Note("Andere Radios, Handys und Home Assistant – ein Zugang, dieselben Regeln für alle.")
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        Access.entries.forEachIndexed { i, a ->
            SegmentedButton(h.access == a, { set { it.copy(access = a) } }, SegmentedButtonDefaults.itemShape(i, Access.entries.size)) { Text(a.label) }
        }
    }
    Note(
        when (h.access) {
            Access.OFF -> "Niemand kann sich verbinden."
            Access.PUBLIC -> "Jedes Gerät im Netzwerk darf sich verbinden."
            Access.SECURE -> "Beim Verbinden erscheint hier groß ein Einmalcode – oder man nimmt die Zugangs-PIN."
        },
    )
    if (server.running) {
        Note("Erreichbar unter " + localAddresses().joinToString(", ") { "${it.first}:${server.port}" }, C.live)
        Note(if (server.clients.isEmpty()) "Gerade ist niemand verbunden." else "Verbunden: ${server.clients.joinToString(", ")}")
    }
    server.error?.let { Note(it, C.warn) }
    if (h.access != Access.OFF) {
        More {
            OutlinedTextField(h.name, { v -> set { it.copy(name = v) } }, label = { Text("Name im Netzwerk") }, placeholder = { Text("Radio ${android.os.Build.MODEL}") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            if (h.access == Access.SECURE) {
                OutlinedTextField(h.joinPin, { v -> set { it.copy(joinPin = v.filter(Char::isDigit).take(8)) } }, label = { Text("Zugangs-PIN (statt Code, optional)") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth())
            }
            OutlinedTextField(h.adminPin, { v -> set { it.copy(adminPin = v.filter(Char::isDigit).take(8)) } }, label = { Text("Admin-PIN (optional, für alle Rechte)") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth())
            SectionTitle("Was dürfen alle?")
            Toggle("Lautstärke ändern", h.guestVolume) { v -> set { it.copy(guestVolume = v) } }
            Toggle("Pause, Weiter und Zurück", h.guestSkip) { v -> set { it.copy(guestSkip = v) } }
            Toggle("Sender wechseln", h.guestStations) { v -> set { it.copy(guestStations = v) } }
            OutlinedButton({ set { it.copy(key = randomKey()) } }) { Text("Neuen Schlüssel erzeugen") }
            Note("Sperrt alle bisher verbundenen Geräte aus. Home Assistant: Integration „Radio“ mit der Adresse oben. Solange das Handy Host ist, sollte die App offen sein oder spielen.")
        }
    }
}

@Composable
private fun RoomFinder(core: RadioCore) {
    val room = core.room
    var manual by remember { mutableStateOf("") }
    var joining by remember { mutableStateOf<RoomInfo?>(null) }
    LaunchedEffect(Unit) { if (room.found.isEmpty()) room.search() }

    Text("Ein anderes Radio fernsteuern", color = C.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
    Note("Radio antippen – danach im Reiter „Radio“ oben zwischen Mithören und Fernsteuern wählen.")
    room.error?.let { Note(it, C.warn) }
    core.settings.room?.let { last ->
        OutlinedButton({ room.connect(last) }, Modifier.fillMaxWidth()) { Text("Wieder verbinden mit „${last.name}“") }
    }
    if (room.searching) Note("Suche Radios im Netz …")
    else if (room.found.isEmpty()) Note("Kein Radio gefunden.")
    for (r in room.found) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(enabled = r.open) {
                if (r.secure) joining = r else room.join(r) { err -> err?.let { core.message = it } }
            }.padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Artwork(null, r.name, 40.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(r.name, color = if (r.open) C.text else C.faint, fontWeight = FontWeight.SemiBold)
                Text(r.address + if (!r.open) " · geschlossen" else if (r.secure) " · gesichert" else "", color = C.faint, fontSize = 12.sp)
            }
            if (r.secure) Icon(Icons.Filled.Lock, "gesichert", tint = C.muted)
        }
    }
    OutlinedButton({ room.search(manual) }, enabled = !room.searching) { Text(if (room.searching) "Sucht …" else "Erneut suchen") }
    More {
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(manual, { manual = it }, label = { Text("Adresse, z. B. 192.168.1.20:8080") }, singleLine = true, modifier = Modifier.weight(1f))
            IconButton({ room.search(manual) }) { Icon(Icons.Filled.Search, "Suchen") }
        }
        Note("Findet die Suche ein Radio nicht (anderes Netz), hier seine Adresse eintragen.")
    }
    joining?.let { r -> JoinDialog(core, r) { joining = null } }
}

/** Gesicherter Room: Zugangs-PIN eingeben oder einen Einmalcode am Host anzeigen lassen */
@Composable
private fun JoinDialog(core: RadioCore, r: RoomInfo, onDismiss: () -> Unit) {
    var pin by remember { mutableStateOf("") }
    var info by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(r.address) {
        core.room.join(r, requestCode = true) { err -> info = err ?: "Der Code steht jetzt groß am Host (2 Minuten gültig)." }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Beitreten: ${r.name}") },
        text = {
            Column {
                Text("Den Code eingeben, der jetzt groß am Host steht – oder die Zugangs-PIN des Hosts.", color = C.muted)
                OutlinedTextField(pin, { pin = it }, label = { Text("PIN oder Code") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                TextButton({ core.room.join(r, requestCode = true) { err -> info = err ?: "Der Code steht jetzt groß am Host (2 Minuten gültig)." } }) { Text("Neuen Code anzeigen") }
                info?.let { Note(it) }
            }
        },
        confirmButton = {
            TextButton({ core.room.join(r, pin) { err -> if (err == null) onDismiss() else info = err } }, enabled = pin.isNotBlank()) { Text("Beitreten") }
        },
        dismissButton = { TextButton(onDismiss) { Text("Abbrechen") } },
        containerColor = C.surface2,
    )
}

private fun str(o: JSONObject, name: String) = if (o.has(name) && !o.isNull(name)) o.optString(name).ifEmpty { null } else null

/** Room-Reiter im Room: nur die Verbindung – und als Admin der Empfang am Host (Spotify, AirPlay) */
@Composable
private fun RoomConnection(core: RadioCore) {
    val room = core.room
    val s = room.state ?: JSONObject()
    var pin by remember { mutableStateOf("") }
    val rules = s.optJSONObject("rules")
    val receivers = s.optJSONObject("receivers")

    Column(Modifier.fillMaxWidth()) {
        Text("Verbunden", color = C.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Artwork(null, room.name, 44.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(room.name, color = C.text, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    (if (room.connected) "verbunden" else "verbindet …") + if (room.admin) " · Admin" else "",
                    color = if (room.connected) C.live else C.warn,
                    fontSize = 12.sp,
                )
            }
        }
        Note("Gesteuert wird im Reiter „Radio“ – dort oben zwischen Mithören und Fernsteuern wählen.")
        OutlinedButton({ room.leave() }, Modifier.fillMaxWidth()) { Text("Room verlassen") }

        if (!room.admin && rules?.optBoolean("adminPin") == true) {
            SectionTitle("Admin")
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    pin, { pin = it }, label = { Text("Admin-PIN des Hosts") }, singleLine = true, modifier = Modifier.weight(1f),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                )
                Spacer(Modifier.width(8.dp))
                Button({ room.login(pin) { ok -> core.message = if (ok) "Als Admin angemeldet." else "PIN falsch." } }, colors = accentButton()) { Text("Anmelden") }
            }
        }
        if (room.admin && receivers != null) {
            SectionTitle("Empfang am Host")
            for ((kind, label) in listOf("spotify" to "Spotify Connect", "airplay" to "AirPlay")) {
                val r = receivers.optJSONObject(kind) ?: continue
                val enabled = r.optBoolean("enabled")
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(label, color = C.text)
                        val info = str(r, "error") ?: when {
                            !enabled -> "aus"
                            str(r, "client") != null -> "verbunden mit ${str(r, "client")}"
                            r.optBoolean("running") -> "sichtbar als „${r.optString("name")}“"
                            else -> "startet …"
                        }
                        Text(info, color = if (str(r, "error") != null) C.warn else C.faint, fontSize = 12.sp)
                    }
                    Switch(enabled, { on -> room.command("receiver", JSONObject().put("kind", kind).put("enabled", on)) })
                }
            }
        }
    }
}

/** Radio-Reiter im Room: sieht aus wie das eigene Radio, steuert aber den Host */
@Composable
fun HostRemote(core: RadioCore) {
    val room = core.room
    val s = room.state ?: JSONObject()
    var castOpen by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    val listen = s.optJSONObject("listen")
    val rules = s.optJSONObject("rules")
    fun allowed(rule: String) = room.admin || rules?.optBoolean(rule, true) != false
    val stations = s.optJSONArray("stations")?.let { a -> (0 until a.length()).map { a.getJSONObject(it) } }.orEmpty()
    val wishes = s.optJSONArray("wishes")?.let { a -> (0 until a.length()).map { a.getJSONObject(it) } }.orEmpty()

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        item {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Radio", color = C.text, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    Text(
                        "bei ${room.name}" + if (room.connected) "" else " · verbindet …",
                        color = if (room.connected) C.muted else C.warn,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (room.listening) CastIconButton(core.cast) { castOpen = true }
            }
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                SegmentedButton(room.listening, { room.listening = true }, SegmentedButtonDefaults.itemShape(0, 2)) { Text("Mithören") }
                SegmentedButton(!room.listening, { room.listening = false }, SegmentedButtonDefaults.itemShape(1, 2)) { Text("Fernsteuern") }
            }
            NowPlaying(
                str(s, "cover"),
                str(s, "sourceName") ?: room.name,
                str(s, "title"),
                listOfNotNull(str(s, "artist"), str(s, "album")).joinToString(" · ").ifEmpty { null },
                if (s.optBoolean("playing")) "läuft" else "pausiert",
            )
            if (room.listening && listen?.optString("kind") == "youtube") Note("YouTube hört man nur an Windows-Radios mit – das Handy steuert hier nur.", C.warn)
            core.cast.device?.let { Note("Spielt auf „${it.name}“ ${core.cast.state}", C.accent) }
            Controls(s.optBoolean("playing"), false, allowed("guestSkip"), { room.command("prev") }, { room.command("toggle") }, { room.command("next") })
            if (room.listening) {
                VolumeSlider(core.settings.volume) { core.setVolume(it) }
                Note("Lautstärke am Handy")
            } else {
                VolumeSlider(s.optDouble("volume", 0.5).toFloat(), allowed("guestVolume") && s.optBoolean("volumeEnabled", true)) {
                    room.command("volume", Math.round(it * 100) / 100.0)
                }
                Note("Lautstärke am Host")
            }
            if (wishes.isNotEmpty()) SectionTitle("Queue")
        }
        items(wishes) { w ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Artwork(str(w, "thumbnail"), w.optString("title"), 36.dp, 6.dp)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(w.optString("title"), color = C.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(listOfNotNull(str(w, "channel"), str(w, "by")?.let { "gewünscht von $it" }).joinToString(" · "), color = C.faint, fontSize = 12.sp, maxLines = 1)
                }
            }
        }
        item { if (stations.isNotEmpty()) SectionTitle("Sender") }
        items(stations, key = { it.optString("id") }) { st ->
            val current = st.optString("id") == s.optString("currentStationId") && s.optString("source") == "radio"
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (current) C.surface2 else Color.Transparent)
                    .clickable(enabled = allowed("guestStations")) { room.command("station", st.optString("id")) }.padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Artwork(str(st, "logo"), st.optString("name"), 40.dp)
                Spacer(Modifier.width(12.dp))
                Text(st.optString("name"), color = if (current) C.text else C.muted, fontWeight = FontWeight.SemiBold)
            }
        }
        item {
            // Wünsche gibt es nur bei Hosts mit YouTube (Windows)
            if (s.has("wishes") && rules?.optInt("maxWishes", 1) != 0) {
                SectionTitle("YouTube wünschen")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(query, { query = it }, label = { Text("Song, Interpret, Playlist") }, singleLine = true, modifier = Modifier.weight(1f))
                    IconButton({ room.searchYoutube(query) { results = it } }, enabled = query.isNotBlank()) { Icon(Icons.Filled.Search, "Suchen") }
                }
            }
        }
        items(results) { r ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Artwork(str(r, "thumbnail"), r.optString("title"), 40.dp, 6.dp)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(r.optString("title"), color = C.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(listOfNotNull(str(r, "channel"), if (r.optString("kind") == "playlist") "Playlist" else null).joinToString(" · "), color = C.faint, fontSize = 12.sp)
                }
                IconButton({ room.wish(r) }) { Icon(Icons.Filled.Add, "In die Queue", tint = C.accent) }
            }
        }
        item { Gap(24.dp) }
    }
    if (castOpen) CastSheet(core.cast) { castOpen = false }
}
