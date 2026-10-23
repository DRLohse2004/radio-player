@file:OptIn(ExperimentalMaterial3Api::class)

package io.github.drlohse2004.radio.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.drlohse2004.radio.Access
import io.github.drlohse2004.radio.BuildConfig
import io.github.drlohse2004.radio.HostPrefs
import io.github.drlohse2004.radio.RadioCore
import io.github.drlohse2004.radio.localAddresses
import io.github.drlohse2004.radio.randomKey

@Composable
fun SettingsScreen(core: RadioCore) {
    val h = core.settings.host
    fun set(change: (HostPrefs) -> HostPrefs) = core.update { it.copy(host = change(it.host)) }
    val server = core.host

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Text("Einstellungen", color = C.text, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 16.dp))

        SectionTitle("Als Host")
        Note("Andere Radios (Rooms) und Home Assistant können dieses Handy steuern und mithören.")
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            Access.entries.forEachIndexed { i, a ->
                SegmentedButton(h.access == a, { set { it.copy(access = a) } }, SegmentedButtonDefaults.itemShape(i, Access.entries.size)) { Text(a.label) }
            }
        }
        Note(
            when (h.access) {
                Access.OFF -> "Niemand kann sich verbinden."
                Access.PUBLIC -> "Jedes Gerät im Netzwerk darf beitreten."
                Access.SECURE -> "Beitreten nur mit Zugangs-PIN oder einem Einmalcode, der dann groß hier erscheint."
            },
        )
        if (server.running) {
            val addresses = localAddresses().joinToString(", ") { "${it.first}:${server.port}" }
            Note("Erreichbar unter $addresses", C.live)
            if (server.clients.isNotEmpty()) Note("Verbunden: ${server.clients.joinToString(", ")}")
        }
        server.error?.let { Note(it, C.warn) }
        OutlinedTextField(h.name, { v -> set { it.copy(name = v) } }, label = { Text("Name im Netzwerk") }, placeholder = { Text("Radio ${android.os.Build.MODEL}") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        if (h.access == Access.SECURE) {
            OutlinedTextField(h.joinPin, { v -> set { it.copy(joinPin = v.filter(Char::isDigit).take(8)) } }, label = { Text("Zugangs-PIN (optional)") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth())
        }
        OutlinedTextField(h.adminPin, { v -> set { it.copy(adminPin = v.filter(Char::isDigit).take(8)) } }, label = { Text("Admin-PIN (optional, für alle Rechte)") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth())
        Toggle("Gäste dürfen die Lautstärke ändern", h.guestVolume) { v -> set { it.copy(guestVolume = v) } }
        Toggle("Gäste dürfen Pause und Weiter", h.guestSkip) { v -> set { it.copy(guestSkip = v) } }
        Toggle("Gäste dürfen den Sender wechseln", h.guestStations) { v -> set { it.copy(guestStations = v) } }
        OutlinedButton({ set { it.copy(key = randomKey()) } }) { Text("Neuen Schlüssel erzeugen (sperrt alle Geräte aus)") }
        Note("Home Assistant: Integration „Radio“ hinzufügen und die Adresse oben eintragen. Solange das Handy Host ist, sollte die App offen sein oder spielen – sonst kann Android sie beenden.")

        SectionTitle("Updates")
        Note("Version ${BuildConfig.VERSION_NAME}")
        Toggle("Beim Start nach Updates suchen", core.settings.autoUpdate) { v -> core.update { it.copy(autoUpdate = v) } }
        val up = core.updater
        if (up.available != null) {
            Button({ up.install() }, colors = accentButton(), enabled = up.progress == null) { Text("Version ${up.available} installieren") }
            up.progress?.let { LinearProgressIndicator(progress = { it }, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) }
        } else {
            OutlinedButton({ up.check() }) { Text("Jetzt suchen") }
        }
        if (up.status.isNotEmpty()) Note(up.status)
        Gap(32.dp)
    }
}

@Composable
private fun Toggle(label: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = C.text, modifier = Modifier.weight(1f))
        Switch(value, onChange)
    }
}
