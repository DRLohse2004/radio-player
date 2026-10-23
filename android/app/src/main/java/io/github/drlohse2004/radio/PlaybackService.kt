@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package io.github.drlohse2004.radio

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/** Hintergrund-Wiedergabe mit Benachrichtigung; Weiter/Zurück wechseln den Sender */
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val core = (application as RadioApp).core
        val player = object : ForwardingPlayer(core.player) {
            override fun getAvailableCommands(): Player.Commands =
                super.getAvailableCommands().buildUpon().add(COMMAND_SEEK_TO_NEXT).add(COMMAND_SEEK_TO_PREVIOUS).build()

            override fun isCommandAvailable(command: Int) =
                command == COMMAND_SEEK_TO_NEXT || command == COMMAND_SEEK_TO_PREVIOUS || super.isCommandAvailable(command)

            override fun seekToNext() = core.next()
            override fun seekToPrevious() = core.prev()
            override fun play() { if (!core.wantPlay && !core.room.active) core.toggle() else super.play() }
            override fun pause() { if (core.wantPlay && !core.room.active) core.toggle() else super.pause() }
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        session = MediaSession.Builder(this, player).setSessionActivity(open).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo) = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        // App weggewischt und nichts läuft: Dienst beenden
        if (session?.player?.playWhenReady != true) stopSelf()
    }

    override fun onDestroy() {
        session?.release()
        session = null
        super.onDestroy()
    }
}
