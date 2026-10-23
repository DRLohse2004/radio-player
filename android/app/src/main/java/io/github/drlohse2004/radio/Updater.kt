package io.github.drlohse2004.radio

import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings as AndroidSettings
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Updates wie unter Windows: neues GitHub-Release mit Radio.apk finden, laden, Android-Installation öffnen */
class Updater(private val core: RadioCore) {
    var available by mutableStateOf<String?>(null)
        private set
    var notes by mutableStateOf("")
        private set
    var progress by mutableStateOf<Float?>(null)
        private set
    var status by mutableStateOf("")
        private set

    private var apkUrl: String? = null
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()

    fun check(silent: Boolean = false) {
        if (!silent) status = "Sucht …"
        worker.execute {
            val r = runCatching {
                val release = httpJson("https://api.github.com/repos/DRLohse2004/radio-player/releases/latest", headers = mapOf("Accept" to "application/vnd.github+json"))
                val assets = release.getJSONArray("assets")
                val apk = (0 until assets.length()).map { assets.getJSONObject(it) }.firstOrNull { it.optString("name") == "Radio.apk" }
                Triple(release.optString("tag_name").removePrefix("v"), release.optString("body"), apk?.optString("browser_download_url"))
            }
            main.post {
                val (version, body, url) = r.getOrNull() ?: return@post run { if (!silent) status = "Keine Verbindung zu GitHub." }
                if (url != null && isNewer(version, BuildConfig.VERSION_NAME)) {
                    available = version
                    notes = body
                    apkUrl = url
                    status = ""
                } else if (!silent) status = "Aktuell (${BuildConfig.VERSION_NAME})."
            }
        }
    }

    fun install() {
        val context = core.context
        // Einmalig erlauben: „Unbekannte Apps installieren“ für das Radio
        if (!context.packageManager.canRequestPackageInstalls()) {
            context.startActivity(
                Intent(AndroidSettings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            status = "Bitte „Apps aus dieser Quelle zulassen“ einschalten und erneut tippen."
            return
        }
        val url = apkUrl ?: return
        progress = 0f
        worker.execute {
            val file = File(File(context.cacheDir, "updates").apply { mkdirs() }, "Radio.apk")
            val r = runCatching {
                var c = URL(url).openConnection() as HttpURLConnection
                // GitHub leitet auf den Datei-Server um
                c.instanceFollowRedirects = true
                if (c.responseCode in 300..399) c = URL(c.getHeaderField("Location")).openConnection() as HttpURLConnection
                val total = c.contentLengthLong.coerceAtLeast(1)
                c.inputStream.use { input ->
                    file.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        var done = 0L
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            done += n
                            val p = done.toFloat() / total
                            main.post { progress = p }
                        }
                    }
                }
            }
            main.post {
                progress = null
                if (r.isFailure) {
                    status = "Download fehlgeschlagen."
                    return@post
                }
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                context.startActivity(
                    Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
        }
    }
}
