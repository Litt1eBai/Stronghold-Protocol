package com.strongholdprotocol.client

import org.junit.Assert.*
import org.junit.Test

class UpdatePolicyTest {
    private val release = AndroidRelease("com.strongholdprotocol.client", 1014, "0.2.4",
        "https://downloads.example/app.apk", "a".repeat(64), 1024, 24, "更新说明")

    private fun rejects(action: () -> Unit) {
        try { action(); fail("Expected rejection") } catch (_: IllegalArgumentException) { }
    }

    @Test fun upgradesUseNativeCodeAndRespectAndroidCompatibility() {
        assertEquals(release, release.validate(release.applicationId))
        assertTrue(release.isNewer(1013, 24))
        assertFalse(release.isNewer(1014, 24))
        assertFalse(release.isNewer(1015, 24))
        assertFalse(release.copy(minSdk = 28).isNewer(1013, 27))
    }

    @Test fun announcementsRejectInvalidAndUnboundedDownloads() {
        for (candidate in listOf(release.copy(applicationId = "other.app"), release.copy(versionCode = 0),
            release.copy(versionCode = 2147483648), release.copy(versionName = ""), release.copy(size = 0),
            release.copy(size = AndroidRelease.MAX_APK_BYTES + 1), release.copy(sha256 = "invalid"),
            release.copy(notes = "a".repeat(16001)), release.copy(minSdk = 23))) {
            rejects { candidate.validate(release.applicationId) }
        }
        for (url in listOf("http://example/app.apk", "file:///app.apk", "https://user:pass@example/app.apk",
            "https://example/app.apk#x", "https://example:99999/app.apk")) {
            rejects { release.copy(apkUrl = url).validate(release.applicationId) }
        }
    }

    @Test fun downloadedArchiveMustMatchAnnouncementAndInstalledSigningIdentity() {
        verifyArchive(release, release.applicationId, release.versionCode, setOf("signer"), setOf("signer"))
        rejects { verifyArchive(release, "other.app", release.versionCode, setOf("signer"), setOf("signer")) }
        rejects { verifyArchive(release, release.applicationId, 1013, setOf("signer"), setOf("signer")) }
        rejects { verifyArchive(release, release.applicationId, release.versionCode, setOf("signer"), setOf("other")) }
        rejects { verifyArchive(release, release.applicationId, release.versionCode, emptySet(), emptySet()) }
    }
}
