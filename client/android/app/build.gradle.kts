import java.net.URI
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
}

// Mandatory on every build: never silently reuse an endpoint from a previous APK.
val endpoint = URI(System.getenv("SP_SERVER_URL")?.trim()
    ?: error("Set SP_SERVER_URL to the fixed HTTP(S) server origin"))
require(endpoint.scheme in listOf("http", "https") && !endpoint.host.isNullOrBlank()
    && endpoint.rawUserInfo == null && endpoint.rawPath in listOf("", "/")
    && endpoint.rawQuery == null && endpoint.rawFragment == null
    && endpoint.port in -1..65535) { "SP_SERVER_URL must be an HTTP(S) origin without credentials, path, query or fragment" }
val serverOrigin = endpoint.toString().trimEnd('/')

val preinstalledAssets = layout.buildDirectory.dir("generated/preinstalled-assets")
val prepareStaticAssets = tasks.register<Exec>("prepareStaticAssets") {
    val repo = rootProject.projectDir.resolve("../..")
    inputs.dir(repo.resolve("public/assets"))
    inputs.dir(repo.resolve("public/fonts"))
    inputs.file(repo.resolve("data/assets.json"))
    inputs.file(repo.resolve("tools/prepare-android-assets.mjs"))
    outputs.dir(preinstalledAssets)
    commandLine("node", repo.resolve("tools/prepare-android-assets.mjs").absolutePath)
}
tasks.named("preBuild") { dependsOn(prepareStaticAssets) }

android {
    namespace = "com.strongholdprotocol.client"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.strongholdprotocol.client"
        minSdk = 24
        targetSdk = 37
        // Upgrade both the earlier Tauri APK (1003) and the WebView-only APK (1004).
        versionCode = 1005
        versionName = "0.1.3"
        buildConfigField("String", "SERVER_URL", "\"$serverOrigin\"")
        manifestPlaceholders["usesCleartextTraffic"] = (endpoint.scheme == "http").toString()
    }
    buildTypes {
        getByName("debug") { applicationIdSuffix = ".debug" }
        getByName("release") { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { buildConfig = true }
    sourceSets.getByName("main").assets.directories.add(preinstalledAssets.get().asFile.absolutePath)
}
kotlin { compilerOptions { jvmTarget = JvmTarget.JVM_17 } }
dependencies {
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
}
