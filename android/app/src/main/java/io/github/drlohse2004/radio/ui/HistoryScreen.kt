package io.github.drlohse2004.radio.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.drlohse2004.radio.RadioCore
import java.net.URLEncoder
import java.text.DateFormat
import java.util.Date

/** Verlauf und Merkliste – Songs nachsehen, merken und bei YouTube oder Spotify suchen */
@Composable
fun HistoryScreen(core: RadioCore) {
    var tab by remember { mutableIntStateOf(0) }
    val context = LocalContext.current
    val list = if (tab == 0) core.settings.history else core.settings.favorites
    val time = DateFormat.getTimeInstance(DateFormat.SHORT)
    fun open(url: String) = runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }

    Column(Modifier.fillMaxSize()) {
        TabRow(tab, containerColor = C.bg, contentColor = C.text) {
            Tab(tab == 0, { tab = 0 }, text = { Text("Verlauf") })
            Tab(tab == 1, { tab = 1 }, text = { Text("Merkliste") })
        }
        if (list.isEmpty()) Note(if (tab == 0) "Noch keine Songs – sobald ein Sender Titel mitschickt, stehen sie hier." else "Mit dem Herz merken Sie sich Songs.", modifier = Modifier.padding(16.dp))
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
            items(list, key = { "${it.at}-${it.title}" }) { t ->
                val q = URLEncoder.encode("${t.artist.orEmpty()} ${t.title}".trim(), "UTF-8")
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Artwork(t.cover, t.title, 44.dp, 6.dp)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(t.title, color = C.text, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(listOfNotNull(t.artist, t.station.ifEmpty { null }, time.format(Date(t.at))).joinToString(" · "), color = C.faint, fontSize = 12.sp, maxLines = 1)
                    }
                    IconButton({ core.toggleFavorite(t) }) {
                        val fav = core.isFavorite(t)
                        Icon(if (fav) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder, if (fav) "Nicht mehr merken" else "Merken", tint = if (fav) C.accent else C.muted)
                    }
                    IconButton({ open("https://music.youtube.com/search?q=$q") }) { Icon(Icons.Filled.Search, "Bei YouTube suchen", tint = C.muted) }
                    TextButton({ open("https://open.spotify.com/search/$q") }) { Text("Spotify", color = C.live, fontSize = 12.sp) }
                }
            }
        }
    }
}
