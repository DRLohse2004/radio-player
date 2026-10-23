@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)

package io.github.drlohse2004.radio.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.drlohse2004.radio.RadioCore
import io.github.drlohse2004.radio.Station
import io.github.drlohse2004.radio.Status
import io.github.drlohse2004.radio.httpText
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.net.URLEncoder

@Composable
fun RadioScreen(core: RadioCore) {
    var castOpen by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Station?>(null) }
    var storeOpen by remember { mutableStateOf(false) }
    val station = core.current
    val playing = core.wantPlay && !core.room.active
    val statusText = when {
        core.room.active -> "Im Room „${core.room.name}“"
        core.error != null -> core.error!!
        core.status == Status.LOADING && playing -> "Verbindet …"
        playing -> "Keine Titelinformationen"
        else -> "Bereit"
    }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        item {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Radio", color = C.text, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                CastIconButton(core.cast) { castOpen = true }
            }
            NowPlaying(core.cover ?: station?.logo, station?.name ?: "Radio", if (playing) core.title else null, if (playing) core.artist else null, statusText)
            core.cast.device?.let { Note("Spielt auf „${it.name}“ ${core.cast.state}", C.accent) }
            Controls(playing, playing && core.status == Status.LOADING, station != null, core::prev, core::toggle, core::next)
            VolumeSlider(core.settings.volume) { core.setVolume(it) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                SectionTitle("Sender", Modifier.weight(1f))
                IconButton({ storeOpen = true }) { Icon(Icons.Filled.Explore, "Sender entdecken", tint = C.muted) }
                IconButton({ editing = Station(core.newStationId(), "", "") }) { Icon(Icons.Filled.Add, "Sender hinzufügen", tint = C.muted) }
            }
        }
        items(core.settings.stations, key = { it.id }) { s ->
            StationRow(s, s.id == station?.id && playing, core, onEdit = { editing = s })
        }
        item { Gap(24.dp) }
    }

    if (castOpen) CastSheet(core.cast) { castOpen = false }
    editing?.let { s -> StationEditor(s, onDismiss = { editing = null }) { core.saveStation(it); editing = null } }
    if (storeOpen) StationStore(core) { storeOpen = false }
}

@Composable
private fun StationRow(s: Station, active: Boolean, core: RadioCore, onEdit: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (active) C.surface2 else Color.Transparent)
                .combinedClickable(onClick = { core.play(s) }, onLongClick = { menu = true }).padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Artwork(s.logo, s.name, 40.dp)
            Spacer(Modifier.width(12.dp))
            Text(s.name, color = if (active) C.text else C.muted, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        DropdownMenu(menu, { menu = false }) {
            DropdownMenuItem({ Text("Bearbeiten") }, { menu = false; onEdit() })
            DropdownMenuItem({ Text("Nach oben") }, { menu = false; core.moveStation(s.id, -1) })
            DropdownMenuItem({ Text("Nach unten") }, { menu = false; core.moveStation(s.id, 1) })
            DropdownMenuItem({ Text("Löschen", color = C.accent) }, { menu = false; core.deleteStation(s.id) })
        }
    }
}

@Composable
private fun StationEditor(station: Station, onDismiss: () -> Unit, onSave: (Station) -> Unit) {
    var name by remember { mutableStateOf(station.name) }
    var url by remember { mutableStateOf(station.url) }
    var logo by remember { mutableStateOf(station.logo.orEmpty()) }
    val valid = name.isNotBlank() && Regex("^https?://\\S+$").matches(url.trim())
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (station.name.isEmpty()) "Sender hinzufügen" else "Sender bearbeiten") },
        text = {
            Column {
                OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true)
                OutlinedTextField(url, { url = it }, label = { Text("Stream-Adresse (http…)") }, singleLine = true)
                OutlinedTextField(logo, { logo = it }, label = { Text("Logo-Adresse (optional)") }, singleLine = true)
            }
        },
        confirmButton = {
            TextButton({ onSave(station.copy(name = name.trim(), url = url.trim(), logo = logo.trim().ifEmpty { null })) }, enabled = valid) { Text("Speichern") }
        },
        dismissButton = { TextButton(onDismiss) { Text("Abbrechen") } },
        containerColor = C.surface2,
    )
}

private data class StoreHit(val name: String, val url: String, val logo: String?, val info: String)

/** Sender-Store über radio-browser.info (wie unter Windows) */
@Composable
private fun StationStore(core: RadioCore, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    var hits by remember { mutableStateOf<List<StoreHit>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun load(q: String) {
        loading = true
        scope.launch {
            val path = if (q.isBlank()) "stations/topclick/60" else "stations/search?name=${URLEncoder.encode(q, "UTF-8")}&limit=60&hidebroken=true&order=clickcount&reverse=true"
            hits = withContext(Dispatchers.IO) {
                runCatching {
                    val a = JSONArray(httpText("https://de1.api.radio-browser.info/json/$path"))
                    (0 until a.length()).map { a.getJSONObject(it) }
                        .filter { it.optInt("hls") == 0 && it.optString("url_resolved").startsWith("http") }
                        .map {
                            StoreHit(
                                it.optString("name").trim(),
                                it.optString("url_resolved"),
                                it.optString("favicon").takeIf { f -> f.startsWith("http") },
                                listOf(it.optString("countrycode"), it.optString("codec"), it.optInt("bitrate").takeIf { b -> b > 0 }?.let { b -> "$b kbit/s" })
                                    .filter { x -> !x.isNullOrBlank() }.joinToString(" · "),
                            )
                        }
                        .distinctBy { it.url }
                }.getOrDefault(emptyList())
            }
            loading = false
        }
    }
    LaunchedEffect(Unit) { load("") }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = C.surface2) {
        Column(Modifier.padding(horizontal = 16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(query, { query = it }, label = { Text("Sender suchen") }, singleLine = true, modifier = Modifier.weight(1f))
                IconButton({ load(query) }) { Icon(Icons.Filled.Search, "Suchen") }
            }
            if (loading) Note("Sucht …")
            LazyColumn(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
                items(hits, key = { it.url }) { h ->
                    val added = core.settings.stations.any { it.url == h.url }
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Artwork(h.logo, h.name, 40.dp)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(h.name, color = C.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(h.info, color = C.faint, fontSize = 12.sp)
                        }
                        Button(
                            { core.saveStation(Station(core.newStationId(), h.name, h.url, h.logo)) },
                            enabled = !added,
                            colors = accentButton(),
                        ) { Text(if (added) "✓" else "+") }
                    }
                }
            }
        }
    }
}
