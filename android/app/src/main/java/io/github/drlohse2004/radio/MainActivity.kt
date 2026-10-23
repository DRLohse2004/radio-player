package io.github.drlohse2004.radio

import android.Manifest
import android.content.ComponentName
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import io.github.drlohse2004.radio.ui.C
import io.github.drlohse2004.radio.ui.HistoryScreen
import io.github.drlohse2004.radio.ui.RadioScreen
import io.github.drlohse2004.radio.ui.RadioTheme
import io.github.drlohse2004.radio.ui.RoomScreen
import io.github.drlohse2004.radio.ui.SettingsScreen

class MainActivity : ComponentActivity() {
    private var controller: ListenableFuture<MediaController>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val core = (application as RadioApp).core
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        setContent { RadioTheme { RadioUi(core) } }
    }

    override fun onStart() {
        super.onStart()
        // Verbindet den Wiedergabedienst – er hält das Radio im Hintergrund am Leben (Benachrichtigung)
        controller = MediaController.Builder(this, SessionToken(this, ComponentName(this, PlaybackService::class.java))).buildAsync()
    }

    override fun onStop() {
        controller?.let(MediaController::releaseFuture)
        controller = null
        super.onStop()
    }
}

private val TABS = listOf("Radio" to Icons.Filled.Radio, "Room" to Icons.Filled.Groups, "Verlauf" to Icons.Filled.History, "Einstellungen" to Icons.Filled.Settings)

@Composable
private fun RadioUi(core: RadioCore) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(core.message) {
        core.message?.let {
            snackbar.showSnackbar(it)
            core.message = null
        }
    }
    Scaffold(
        containerColor = C.bg,
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            NavigationBar(containerColor = C.surface) {
                TABS.forEachIndexed { i, (label, icon) ->
                    NavigationBarItem(
                        selected = tab == i,
                        onClick = { tab = i },
                        icon = { Icon(icon, label) },
                        label = { Text(label, fontSize = 11.sp) },
                        colors = NavigationBarItemDefaults.colors(selectedIconColor = C.accent, selectedTextColor = C.accent, indicatorColor = C.accentSoft, unselectedIconColor = C.muted, unselectedTextColor = C.muted),
                    )
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            core.updater.available?.let { version ->
                if (tab != 3) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Version $version ist da.", color = C.text, modifier = Modifier.weight(1f))
                        TextButton({ tab = 3 }) { Text("Ansehen") }
                    }
                }
            }
            when (tab) {
                0 -> RadioScreen(core)
                1 -> RoomScreen(core)
                2 -> HistoryScreen(core)
                else -> SettingsScreen(core)
            }
        }
    }
    // Einmalcode für ein Gerät, das im sicheren Modus beitreten will
    core.host.joinCode?.let { code ->
        AlertDialog(
            onDismissRequest = {},
            title = { Text("„${code.name}“ möchte beitreten") },
            text = { Text(code.code.chunked(3).joinToString(" "), fontSize = 48.sp, fontWeight = FontWeight.Bold, color = C.text) },
            confirmButton = {},
            containerColor = C.surface2,
        )
    }
}
