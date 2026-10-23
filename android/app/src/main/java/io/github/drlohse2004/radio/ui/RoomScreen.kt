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
import androidx.compose.material.icons.filled.Close
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

@Composable
fun RoomScreen(core: RadioCore) {
    if (core.room.active) RoomConnected(core) else RoomFinder(core)
}

@Composable
private fun RoomFinder(core: RadioCore) {
    val room = core.room
    var manual by remember { mutableStateOf("") }
    var joining by remember { mutableStateOf<RoomInfo?>(null) }
    LaunchedEffect(Unit) { if (room.found.isEmpty()) room.search() }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        item {
            Text("Rooms", color = C.text, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 16.dp))
            Note("Andere Radios im Netzwerk fernsteuern oder mithören – Windows-Radios und Handys.")
            room.error?.let { Note(it, C.warn) }
            core.settings.room?.let { last ->
                OutlinedButton({ room.connect(last) }, Modifier.fillMaxWidth()) { Text("Wieder verbinden mit „${last.name}“") }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                SectionTitle("Gefunden", Modifier.weight(1f))
                TextButton({ room.search(manual) }, enabled = !room.searching) { Text(if (room.searching) "Sucht …" else "Neu suchen") }
            }
            if (!room.searching && room.found.isEmpty()) Note("Kein Radio gefunden. Beim Host den Room öffnen oder die Adresse unten eintragen.")
        }
        items(room.found, key = { it.address }) { r ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(enabled = r.open) {
                    if (r.secure) joining = r else room.join(r) { err -> err?.let { core.message = it } }
                }.padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Artwork(null, r.name, 40.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(r.name, color = C.text, fontWeight = FontWeight.SemiBold)
                    Text(if (!r.open) "geschlossen" else "${r.address} · ${r.version}", color = C.faint, fontSize = 12.sp)
                }
                if (r.secure) Icon(Icons.Filled.Lock, "gesichert", tint = C.muted)
            }
        }
        item {
            SectionTitle("Adresse eintragen")
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(manual, { manual = it }, label = { Text("z. B. 192.168.1.20 oder 192.168.1.20:8080") }, singleLine = true, modifier = Modifier.weight(1f))
                IconButton({ room.search(manual) }) { Icon(Icons.Filled.Search, "Suchen") }
            }
            Gap(24.dp)
        }
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

@Composable
private fun RoomConnected(core: RadioCore) {
    val room = core.room
    val s = room.state ?: JSONObject()
    var castOpen by remember { mutableStateOf(false) }
    var pin by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    val listen = s.optJSONObject("listen")
    val rules = s.optJSONObject("rules")
    fun allowed(rule: String) = room.admin || rules?.optBoolean(rule, true) != false
    val stations = s.optJSONArray("stations")?.let { a -> (0 until a.length()).map { a.getJSONObject(it) } }.orEmpty()
    val wishes = s.optJSONArray("wishes")?.let { a -> (0 until a.length()).map { a.getJSONObject(it) } }.orEmpty()
    fun str(o: JSONObject, name: String) = if (o.has(name) && !o.isNull(name)) o.optString(name).ifEmpty { null } else null

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        item {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(room.name, color = C.text, fontSize = 20.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(if (room.connected) "verbunden" else "verbindet …", color = if (room.connected) C.live else C.warn, fontSize = 12.sp)
                }
                if (room.listening) CastIconButton(core.cast) { castOpen = true }
                IconButton({ room.leave() }) { Icon(Icons.Filled.Close, "Room verlassen", tint = C.muted) }
            }
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                SegmentedButton(room.listening, { room.listening = true }, SegmentedButtonDefaults.itemShape(0, 2)) { Text("Mithören") }
                SegmentedButton(!room.listening, { room.listening = false }, SegmentedButtonDefaults.itemShape(1, 2)) { Text("Nur Fernbedienung") }
            }
            NowPlaying(str(s, "cover"), str(s, "sourceName") ?: room.name, str(s, "title"), str(s, "artist"), if (s.optBoolean("playing")) "läuft" else "pausiert")
            if (room.listening && listen?.optString("kind") == "youtube") Note("YouTube hört man nur an Windows-Radios mit – das Handy steuert hier nur.", C.warn)
            core.cast.device?.let { Note("Spielt auf „${it.name}“ ${core.cast.state}", C.accent) }
            Controls(s.optBoolean("playing"), false, allowed("guestSkip"), { room.command("prev") }, { room.command("toggle") }, { room.command("next") })
            if (room.listening) {
                Note("Lautstärke am Handy")
                VolumeSlider(core.settings.volume) { core.setVolume(it) }
            } else {
                Note("Lautstärke am Host")
                VolumeSlider(s.optDouble("volume", 0.5).toFloat(), allowed("guestVolume") && s.optBoolean("volumeEnabled", true)) {
                    room.command("volume", Math.round(it * 100) / 100.0)
                }
            }
            if (!room.admin && rules?.optBoolean("adminPin") == true) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(pin, { pin = it }, label = { Text("Admin-PIN") }, singleLine = true, modifier = Modifier.weight(1f),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                    Spacer(Modifier.width(8.dp))
                    Button({ room.login(pin) { ok -> core.message = if (ok) "Als Admin angemeldet." else "PIN falsch." } }, colors = accentButton()) { Text("Anmelden") }
                }
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
        item { if (stations.isNotEmpty()) SectionTitle("Sender des Hosts") }
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
        item { Gap(24.dp) }
    }
    if (castOpen) CastSheet(core.cast) { castOpen = false }
}
