package io.github.drlohse2004.radio

import android.app.Application

class RadioApp : Application() {
    lateinit var core: RadioCore
        private set

    override fun onCreate() {
        super.onCreate()
        core = RadioCore(this)
    }
}
