plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Version kommt aus package.json (CI: -PversionName=…), damit Windows und Android gleich zählen
val appVersion = (findProperty("versionName") as String?) ?: "0.0.1"
val versionParts = appVersion.split(".").map { it.toIntOrNull() ?: 0 } + listOf(0, 0, 0)
val keystore: String? = System.getenv("KEYSTORE_FILE")

android {
    namespace = "io.github.drlohse2004.radio"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.drlohse2004.radio"
        minSdk = 26
        targetSdk = 35
        versionName = appVersion
        versionCode = maxOf(1, versionParts[0] * 10000 + versionParts[1] * 100 + versionParts[2])
    }

    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = "radio"
                keyPassword = System.getenv("KEYSTORE_PASSWORD")
                storeType = "pkcs12"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Ohne Schlüssel (Forks, lokale Builds) mit dem Debug-Schlüssel – Updates gehen dann nicht drüber
            signingConfig = if (keystore != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.5.1")
    implementation("androidx.media3:media3-session:1.5.1")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
