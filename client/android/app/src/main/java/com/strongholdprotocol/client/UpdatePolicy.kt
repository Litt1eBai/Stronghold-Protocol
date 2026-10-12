package com.strongholdprotocol.client

import java.net.URI

/** Release metadata is separate from the upstream game's version. */
data class AndroidRelease(
    val applicationId: String, val versionCode: Long, val versionName: String,
    val apkUrl: String, val sha256: String, val size: Long, val minSdk: Int, val notes: String
) {
    fun validate(expectedId: String): AndroidRelease {
        require(applicationId == expectedId) { "更新包属于其他应用" }
        require(versionCode in 1..Int.MAX_VALUE.toLong() && versionName.isNotBlank() && versionName.length <= 100) { "更新版本无效" }
        require(size in 1..MAX_APK_BYTES && minSdk in 24..1000) { "更新包大小或系统要求无效" }
        require(Regex("[0-9a-fA-F]{64}").matches(sha256)) { "更新包校验值无效" }
        require(notes.length <= 16000) { "更新说明过长" }
        requireHttps(apkUrl)
        return this
    }

    fun isNewer(installedCode: Long, sdk: Int) = versionCode > installedCode && sdk >= minSdk

    companion object {
        const val MAX_APK_BYTES = 2L * 1024 * 1024 * 1024
        fun requireHttps(url: String) {
            val uri = URI(url)
            require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawUserInfo == null
                && uri.rawFragment == null && uri.port in -1..65535) { "APK 下载地址必须使用 HTTPS" }
        }
    }
}

/** Require the actual archive to agree with the announcement and the installed signer. */
fun verifyArchive(release: AndroidRelease, packageName: String, versionCode: Long,
                  installedSigners: Set<String>, archiveSigners: Set<String>) {
    require(packageName == release.applicationId && versionCode == release.versionCode) { "APK 包名或版本与发布信息不一致" }
    require(installedSigners.isNotEmpty() && installedSigners == archiveSigners) { "APK 签名与当前应用不一致" }
}
