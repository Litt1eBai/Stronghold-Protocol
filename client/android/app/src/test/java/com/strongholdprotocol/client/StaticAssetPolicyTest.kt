package com.strongholdprotocol.client

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream

class StaticAssetPolicyTest {
    private val policy = StaticAssetPolicy("http://game.example:30089", mapOf(
        "/assets/audio/test.mp3" to BundledAsset("/assets/audio/test.mp3", 10, "audio/mpeg"),
        "/fonts/test.woff2" to BundledAsset("/fonts/test.woff2", 10, "font/woff2")))

    @Test fun assetsStayAtTheFixedOriginAndAccountRequestsRemainOnline() {
        assertNotNull(policy.find("http://game.example:30089/assets/audio/test.mp3", "GET"))
        assertNotNull(policy.find("http://game.example:30089/fonts/test.woff2", "HEAD"))
        for (url in listOf("https://game.example:30089/assets/audio/test.mp3",
            "http://other.example:30089/assets/audio/test.mp3", "http://game.example/assets/audio/test.mp3",
            "http://user@game.example:30089/assets/audio/test.mp3", "http://game.example:30089/api/auth/register",
            "http://game.example:30089/data/assets.json", "http://game.example:30089/js/main.js",
            "http://game.example:30089/assets/new.png", "http://game.example:30089/assets/audio/test.mp3?v=2",
            "http://game.example:30089/assets/../api/auth/register")) assertNull(policy.find(url, "GET"))
        assertNull(policy.find("http://game.example:30089/assets/audio/test.mp3", "POST"))
    }

    @Test fun mediaRangesSupportSeekingOpenEndsAndSuffixes() {
        assertEquals(AssetRange(2, 4), policy.range(10, "bytes=2-4"))
        assertEquals(AssetRange(2, 9), policy.range(10, "bytes=2-"))
        assertEquals(AssetRange(7, 9), policy.range(10, "bytes=-3"))
        assertEquals(AssetRange(0, 9), policy.range(10, "bytes=-20"))
        assertEquals(AssetRange(2, 9), policy.range(10, "bytes=2-200"))
        assertEquals(AssetRange(-1, -1), policy.range(10, "bytes=20-"))
        assertEquals(AssetRange(-1, -1), policy.range(10, "bytes=5-2"))
        assertEquals(AssetRange(-1, -1), policy.range(10, "bytes=-0"))
        assertNull(policy.range(10, "bytes=0-1,3-4"))
        assertNull(policy.range(10, "bytes=999999999999999999999999-"))
        assertNull(policy.range(10, null))
    }

    @Test fun contentHashedUrlsUseOnlyMatchingPackagedBytesOrModels() {
        val fileHash = "0123456789abcdef"
        val modelHash = "fedcba9876543210"
        val asset = BundledAsset("/assets/model/test.skel", 10, "application/octet-stream", setOf(fileHash, modelHash))
        val font = BundledAsset("/fonts/test.woff2", 10, "font/woff2", setOf(fileHash))
        val hashed = StaticAssetPolicy("http://game.example:30089", mapOf(asset.url to asset, font.url to font))
        val origin = "http://game.example:30089"
        assertEquals(asset, hashed.find("$origin/assets/~$fileHash/model/test.skel", "GET"))
        assertEquals(asset, hashed.find("$origin/assets/~$modelHash/model/test.skel", "HEAD"))
        assertEquals(font, hashed.find("$origin/fonts/~$fileHash/test.woff2", "GET"))
        for (url in listOf("$origin/assets/~1111111111111111/model/test.skel",
            "$origin/fonts/~$modelHash/test.woff2", "$origin/assets/~short/model/test.skel",
            "$origin/assets/~$fileHash/model/test.skel?v=2", "$origin/assets/~$fileHash/model/missing.skel",
            "http://other.example:30089/assets/~$fileHash/model/test.skel")) assertNull(hashed.find(url, "GET"))
        assertNull(hashed.find("$origin/assets/~$fileHash/model/test.skel", "POST"))
        assertNull(policy.find("$origin/assets/~$fileHash/audio/test.mp3", "GET"))
    }

    @Test fun rangeStreamsStopAtTheirBoundaryAndPreserveMarkReset() {
        val input = LimitedAssetStream(ByteArrayInputStream(byteArrayOf(1, 2, 3, 4, 5)), 3)
        assertEquals(3, input.available())
        assertEquals(1, input.read())
        input.mark(8)
        val buffer = ByteArray(8)
        assertEquals(2, input.read(buffer, 0, buffer.size))
        assertArrayEquals(byteArrayOf(2, 3), buffer.copyOfRange(0, 2))
        assertEquals(-1, input.read())
        input.reset()
        assertEquals(1L, input.skip(1))
        assertEquals(3, input.read())
        assertEquals(-1, input.read())
        assertEquals(0, input.read(buffer, 0, 0))
        input.close()
        // WebView discovers the complete asset size, seeks once, then reads to EOF.
        val ranged = LimitedAssetStream(ByteArrayInputStream(ByteArray(100) { it.toByte() }), 26, 100)
        assertEquals(100, ranged.available())
        assertEquals(10L, ranged.skip(10))
        assertArrayEquals(ByteArray(16) { (it + 10).toByte() }, ranged.readBytes())
        ranged.close()
    }
}
