package com.strongholdprotocol.client

import android.app.AlertDialog
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.ProgressBar
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Native-only updater: web JavaScript cannot supply an APK or start its installation. */
class AppUpdater(private val activity: MainActivity) {
    private val worker = Executors.newSingleThreadExecutor()
    private val cancelled = AtomicBoolean(false)
    @Volatile private var connection: HttpURLConnection? = null
    private var busy = false
    private var closed = false
    private var cleanedPreviousDownload = false
    private var dialog: AlertDialog? = null
    private var pendingInstall: File? = null
    private val directory get() = File(activity.filesDir, "updates").apply { mkdirs() }

    fun check(manual: Boolean = false) {
        if (closed || busy || dialog?.isShowing == true) return
        busy = true
        cancelled.set(false)
        worker.execute {
            try {
                if (!cleanedPreviousDownload) {
                    // A previous installer has finished by the next process launch.
                    File(directory, "update.apk.part").delete()
                    File(directory, "update.apk").delete()
                    cleanedPreviousDownload = true
                }
                val release = fetchRelease()
                ui {
                    busy = false
                    when {
                        release == null || release.versionCode <= BuildConfig.VERSION_CODE -> {
                            if (manual) message("当前版本 ${BuildConfig.VERSION_NAME}", "暂无可用更新")
                        }
                        Build.VERSION.SDK_INT < release.minSdk -> {
                            if (manual) message("暂时无法更新", "新版需要更高版本的 Android")
                        }
                        else -> {
                            dialog = AlertDialog.Builder(activity).setTitle("发现新版本 ${release.versionName}")
                                .setMessage("当前版本：${BuildConfig.VERSION_NAME}\n下载大小：${release.size / 1024 / 1024} MB\n\n${release.notes}")
                                .setPositiveButton("下载更新") { _, _ -> download(release) }
                                .setNegativeButton("稍后", null).show()
                        }
                    }
                }
            } catch (e: Exception) {
                FileLogger.e("update", "check failed: ${e.javaClass.simpleName}")
                ui { busy = false; if (manual) message("检查更新失败", "请检查网络后重试") }
            }
        }
    }

    private fun fetchRelease(): AndroidRelease? {
        val conn = open(BuildConfig.ANDROID_UPDATE_URL, manifest = true)
        try {
            if (conn.responseCode == 404 || conn.responseCode == 204) return null
            require(conn.responseCode == 200) { "更新服务器暂不可用" }
            val bytes = conn.inputStream.use { it.readNBytesCompat(128 * 1024) }
            val json = JSONObject(bytes.toString(Charsets.UTF_8))
            require(json.getInt("format") == 1) { "更新信息格式不支持" }
            return AndroidRelease(json.getString("applicationId"), json.getLong("versionCode"),
                json.getString("versionName"), json.getString("apkUrl"), json.getString("sha256"),
                json.getLong("size"), json.getInt("minSdk"), json.optString("notes"))
                .validate(BuildConfig.APPLICATION_ID)
        } finally { conn.disconnect(); connection = null }
    }

    private fun download(release: AndroidRelease) {
        if (busy || closed) return
        busy = true
        cancelled.set(false)
        pendingInstall = null
        val label = TextView(activity).apply { text = "准备下载…" }
        val progress = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100 }
        val content = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL; setPadding(32, 16, 32, 16)
            addView(label); addView(progress)
        }
        dialog = AlertDialog.Builder(activity).setTitle("下载 ${release.versionName}")
            .setView(content).setNegativeButton("取消") { _, _ ->
                cancelled.set(true); connection?.disconnect()
            }.setCancelable(false).show()
        worker.execute {
            val part = File(directory, "update.apk.part")
            val apk = File(directory, "update.apk")
            try {
                apk.delete()
                val digest = MessageDigest.getInstance("SHA-256")
                val conn = open(release.apkUrl)
                try {
                    require(conn.responseCode == 200) { "下载服务器暂不可用" }
                    val length = conn.getHeaderFieldLong("Content-Length", -1)
                    require(length == -1L || length == release.size) { "下载大小与发布信息不一致" }
                    var total = 0L
                    var lastPercent = -1
                    conn.inputStream.use { input -> part.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            check(!cancelled.get()) { "下载已取消" }
                            val count = input.read(buffer)
                            if (count < 0) break
                            total += count
                            require(total <= release.size) { "更新包超过声明大小" }
                            digest.update(buffer, 0, count)
                            output.write(buffer, 0, count)
                            val percent = (total * 100 / release.size).toInt()
                            if (percent != lastPercent) {
                                lastPercent = percent
                                ui { progress.progress = percent; label.text = "已下载 $percent%" }
                            }
                        }
                    } }
                    check(!cancelled.get()) { "下载已取消" }
                    require(total == release.size && digest.digest().hex().equals(release.sha256, true)) { "APK 完整性校验失败" }
                } finally { conn.disconnect(); connection = null }
                verifyApk(part, release)
                check(!cancelled.get()) { "下载已取消" }
                check(part.renameTo(apk)) { "无法保存更新包" }
                ui {
                    busy = false; dialog?.dismiss()
                    pendingInstall = apk
                    confirmInstall()
                }
            } catch (e: Exception) {
                part.delete(); apk.delete()
                FileLogger.e("update", "Download or validation failed: ${e.javaClass.simpleName}: ${e.message}")
                ui {
                    busy = false; dialog?.dismiss()
                    if (!cancelled.get()) message("更新失败", e.message ?: "请稍后重试")
                }
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun verifyApk(file: File, release: AndroidRelease) {
        val pm = activity.packageManager
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val archive = pm.getPackageArchiveInfo(file.absolutePath, flags) ?: error("无法读取 APK")
        val installed = pm.getPackageInfo(activity.packageName, flags)
        fun signers(info: PackageInfo): Set<String> {
            val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
            return signatures?.map { MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).hex() }?.toSet() ?: emptySet()
        }
        val code = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
        verifyArchive(release, archive.packageName, code, signers(installed), signers(archive))
        FileLogger.i("update", "APK verified: ${archive.packageName}, versionCode=$code, Android=${Build.VERSION.SDK_INT}")
    }

    private fun confirmInstall() {
        if (pendingInstall?.isFile != true) return
        dialog = AlertDialog.Builder(activity).setTitle("更新包已校验")
            .setMessage("安装新版将保留账号和设置。系统会要求你确认安装。")
            .setPositiveButton("安装") { _, _ -> install() }
            .setNegativeButton("稍后") { _, _ -> pendingInstall?.delete(); pendingInstall = null }.show()
    }

    private fun install() {
        val apk = pendingInstall ?: return
        try {
            if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                return
            }
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", apk)
            // Resolve through the real provider before handing the URI to another app.
            activity.contentResolver.openFileDescriptor(uri, "r")?.use {
                check(it.statSize == apk.length()) { "安装器无法读取完整的更新包" }
            } ?: error("无法打开更新包")
            FileLogger.i("update", "Opening system installer for verified APK (${apk.length()} bytes)")
            activity.startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                clipData = ClipData.newRawUri("APK", uri)
            })
            pendingInstall = null
        } catch (e: Exception) {
            FileLogger.e("update", "Installer launch failed: ${e.javaClass.simpleName}: ${e.message}")
            message("无法打开安装界面", "${e.message ?: e.javaClass.simpleName}\n可重试安装，或从发布页面手动下载安装包。")
        }
    }

    fun onResume() {
        if (pendingInstall != null && dialog?.isShowing != true) confirmInstall()
    }

    private fun message(title: String, text: String) {
        dialog = AlertDialog.Builder(activity).setTitle(title).setMessage(text).setPositiveButton("确定", null).show()
    }

    private fun ui(action: () -> Unit) = activity.runOnUiThread {
        if (!closed && !activity.isFinishing && !activity.isDestroyed) action()
    }

    private fun open(address: String, manifest: Boolean = false): HttpURLConnection {
        var url = URL(address)
        repeat(6) {
            if (manifest) {
                val uri = URI(url.toString())
                val base = URI(BuildConfig.SERVER_URL)
                require(uri.scheme == "https" || (uri.scheme == "http" && base.scheme == "http"
                    && uri.host == base.host && uri.port == base.port)) { "更新信息地址不安全" }
                require(uri.rawUserInfo == null && uri.rawFragment == null) { "更新信息地址无效" }
            } else AndroidRelease.requireHttps(url.toString())
            check(!cancelled.get()) { "下载已取消" }
            val conn = url.openConnection() as HttpURLConnection
            connection = conn
            conn.connectTimeout = 15000; conn.readTimeout = 30000
            conn.instanceFollowRedirects = false; conn.useCaches = false
            conn.setRequestProperty("Accept-Encoding", "identity")
            try {
                if (conn.responseCode !in listOf(301, 302, 303, 307, 308)) return conn
                val location = conn.getHeaderField("Location") ?: error("下载跳转地址缺失")
                val next = URL(url, location)
                require(url.protocol != "https" || next.protocol == "https") { "下载连接不能降级为 HTTP" }
                url = next
            } catch (e: Exception) { conn.disconnect(); connection = null; throw e }
            conn.disconnect(); connection = null
        }
        error("下载跳转次数过多")
    }

    fun close() {
        closed = true; cancelled.set(true); connection?.disconnect()
        dialog?.dismiss(); worker.shutdownNow()
    }
}

private fun ByteArray.hex() = joinToString("") { "%02x".format(it.toInt() and 255) }

/** InputStream.readNBytes is not available on every supported Android version. */
private fun java.io.InputStream.readNBytesCompat(limit: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
        val count = read(buffer)
        if (count < 0) break
        require(output.size() + count <= limit) { "更新信息过大" }
        output.write(buffer, 0, count)
    }
    return output.toByteArray()
}
