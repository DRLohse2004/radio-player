@file:OptIn(ExperimentalMaterial3Api::class)

package io.github.drlohse2004.radio.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.CastConnected
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import io.github.drlohse2004.radio.CastManager

// Farben wie im Standard-Design der Windows-App (src/index.css)
object C {
    val bg = Color(0xFF0D0F14)
    val surface = Color(0xFF151821)
    val surface2 = Color(0xFF1C202B)
    val surface3 = Color(0xFF262B38)
    val text = Color(0xFFEEF0F5)
    val muted = Color(0xFF9198A8)
    val faint = Color(0xFF646B7B)
    val accent = Color(0xFFFF5A5F)
    val accentSoft = Color(0x24FF5A5F)
    val live = Color(0xFF3DDC84)
    val warn = Color(0xFFFFB547)
}

val radioColors: ColorScheme = darkColorScheme(
    primary = C.accent,
    onPrimary = Color.White,
    secondary = C.accent,
    background = C.bg,
    onBackground = C.text,
    surface = C.surface,
    onSurface = C.text,
    surfaceVariant = C.surface2,
    onSurfaceVariant = C.muted,
    surfaceContainer = C.surface,
    surfaceContainerHigh = C.surface2,
    surfaceContainerHighest = C.surface3,
    outline = C.surface3,
)

@Composable
fun RadioTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = radioColors, content = content)

/** Sender-Logo oder Cover; ohne Bild ein Feld mit dem Anfangsbuchstaben */
@Composable
fun Artwork(url: String?, label: String, size: Dp, corner: Dp = 10.dp) {
    Box(
        Modifier.size(size).clip(RoundedCornerShape(corner)).background(if (url == null) C.surface3 else Color.White),
        contentAlignment = Alignment.Center,
    ) {
        if (url != null) AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.size(size))
        else Text(label.take(1).uppercase(), color = C.muted, fontSize = (size.value / 2.4).sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) =
    Text(text.uppercase(), color = C.faint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.sp, modifier = modifier.padding(top = 18.dp, bottom = 6.dp))

/** Großes Bild, Titel, Interpret – wie die Mitte der Windows-App */
@Composable
fun NowPlaying(image: String?, station: String, title: String?, artist: String?, status: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Artwork(image, station, 112.dp, 16.dp)
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(station.uppercase(), color = C.accent, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(title ?: station, color = C.text, fontSize = 22.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(artist ?: status, color = C.muted, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun Controls(playing: Boolean, loading: Boolean, enabled: Boolean, onPrev: () -> Unit, onToggle: () -> Unit, onNext: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        IconButton(onPrev, enabled = enabled, modifier = Modifier.size(52.dp)) { Icon(Icons.Filled.SkipPrevious, "Zurück", Modifier.size(30.dp)) }
        Spacer(Modifier.width(18.dp))
        FilledIconButton(
            onToggle,
            enabled = enabled,
            modifier = Modifier.size(68.dp),
            shape = CircleShape,
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = C.accent, contentColor = Color.White),
        ) {
            if (loading) CircularProgressIndicator(Modifier.size(28.dp), color = Color.White, strokeWidth = 3.dp)
            else Icon(if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, if (playing) "Pause" else "Abspielen", Modifier.size(36.dp))
        }
        Spacer(Modifier.width(18.dp))
        IconButton(onNext, enabled = enabled, modifier = Modifier.size(52.dp)) { Icon(Icons.Filled.SkipNext, "Weiter", Modifier.size(30.dp)) }
    }
}

@Composable
fun VolumeSlider(value: Float, enabled: Boolean = true, onChange: (Float) -> Unit) =
    Slider(
        value = value,
        onValueChange = onChange,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
        colors = SliderDefaults.colors(thumbColor = Color.White, activeTrackColor = C.text, inactiveTrackColor = C.surface3),
    )

@Composable
fun CastIconButton(cast: CastManager, onClick: () -> Unit) =
    IconButton(onClick) {
        Icon(
            if (cast.device != null) Icons.Filled.CastConnected else Icons.Filled.Cast,
            if (cast.device != null) "Spielt auf ${cast.device?.name}" else "Auf Lautsprecher abspielen",
            tint = if (cast.device != null) C.accent else C.muted,
        )
    }

/** Auswahl: dieses Handy oder ein Lautsprecher (Chromecast, DLNA) */
@Composable
fun CastSheet(cast: CastManager, onDismiss: () -> Unit) {
    val context = LocalContext.current
    LaunchedEffect(Unit) { cast.search(context) }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = C.surface2) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 28.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Abspielen auf", color = C.muted, modifier = Modifier.weight(1f))
                TextButton({ cast.search(context) }, enabled = !cast.searching) { Text(if (cast.searching) "Sucht …" else "Neu suchen") }
            }
            CastRow("Diesem Handy", "", cast.device == null) { cast.choose(null); onDismiss() }
            for (d in cast.devices) {
                val selected = cast.device?.id == d.id
                CastRow(d.name, if (selected && cast.state.isNotEmpty()) cast.state else d.model + if (d.dlna != null) " · DLNA" else "", selected) {
                    cast.choose(d)
                    onDismiss()
                }
            }
            if (!cast.searching && cast.devices.isEmpty()) Note("Kein Lautsprecher im Netzwerk gefunden.")
            cast.error?.let { Note(it, C.warn) }
            Note("Radio und Mithören im Room. Der Lautsprecher holt den Stream selbst, das Handy bleibt stumm.")
        }
    }
}

@Composable
private fun CastRow(name: String, sub: String, selected: Boolean, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(if (selected) C.accentSoft else Color.Transparent)
            .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Text(name, color = if (selected) C.accent else C.text, fontSize = 16.sp)
        if (sub.isNotEmpty()) Text(sub, color = C.faint, fontSize = 12.sp)
    }
}

@Composable
fun Note(text: String, color: Color = C.faint, modifier: Modifier = Modifier) =
    Text(text, color = color, fontSize = 13.sp, modifier = modifier.padding(vertical = 6.dp))

@Composable
fun accentButton() = ButtonDefaults.buttonColors(containerColor = C.accent, contentColor = Color.White)

@Composable
fun Gap(h: Dp = 12.dp) = Spacer(Modifier.height(h))

/** Schalter mit Beschriftung */
@Composable
fun Toggle(label: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = C.text, modifier = Modifier.weight(1f))
        Switch(value, onChange)
    }
}
