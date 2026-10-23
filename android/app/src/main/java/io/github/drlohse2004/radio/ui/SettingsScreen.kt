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
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Text("Einstellungen", color = C.text, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 16.dp))

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

