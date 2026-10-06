package com.strongholdprotocol.client

import android.content.res.AssetManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.FilterInputStream
import java.io.InputStream

/** Serve packaged art/audio/font requests at the fixed server's origin, without an extraction step. */
class PreinstalledAssets(private val assets: AssetManager) {
    private val policy: StaticAssetPolicy
    init {
        val index = assets.open("preinstalled/index.json").bufferedReader().use { JSONObject(it.readText()) }
        val files = index.getJSONArray("files")
        val inventory = (0 until files.length()).associate { i ->
            val file = files.getJSONObject(i)
            val asset = BundledAsset(file.getString("url"), file.getLong("size"), file.getString("mime"))
            asset.url to asset
        }
        policy = StaticAssetPolicy(BuildConfig.SERVER_URL, inventory)
        FileLogger.i("assets", "preinstalled ${files.length()} files, ${index.getLong("totalBytes")} bytes")
    }

    fun intercept(request: WebResourceRequest): WebResourceResponse? {
        val asset = policy.find(request.url.toString(), request.method) ?: return null
        val rangeHeader = request.requestHeaders.entries.firstOrNull { it.key.equals("Range", true) }?.value
        val range = if (request.method == "GET") policy.range(asset.size, rangeHeader) else null
        val headers = mutableMapOf("Accept-Ranges" to "bytes", "X-SP-Asset-Source" to "preinstalled")
        if (range?.start == -1L) {
            headers["Content-Range"] = "bytes */${asset.size}"
            headers["Content-Length"] = "0"
            return WebResourceResponse(asset.mime, null, 416, "Range Not Satisfiable", headers, ByteArrayInputStream(byteArrayOf()))
        }
        val length = range?.length ?: asset.size
        headers["Content-Length"] = length.toString()
        if (range != null) headers["Content-Range"] = "bytes ${range.start}-${range.end}/${asset.size}"
        val body = if (request.method == "HEAD") ByteArrayInputStream(byteArrayOf()) else try {
            val input = assets.open("preinstalled${asset.url}", AssetManager.ACCESS_STREAMING)
            try {
                // WebView's AndroidStreamReaderURLLoader performs range seeking itself.
                // Report the full size for that seek, but stop reads at the requested end.
                // The loader does not bound reads using our Content-Length header.
                LimitedAssetStream(input, range?.let { it.end + 1 } ?: asset.size, asset.size)
            } catch (e: Exception) { input.close(); throw e }
        } catch (e: Exception) {
            FileLogger.e("assets", "Packaged asset unavailable: ${asset.url}", e)
            return null // Missing local resources use the existing server URL.
        }
        val encoding = if (asset.mime.startsWith("text/") || asset.mime == "application/json" || asset.mime == "image/svg+xml") "UTF-8" else null
        return WebResourceResponse(asset.mime, encoding, if (range == null) 200 else 206,
            if (range == null) "OK" else "Partial Content", headers, body)
    }
}

/** Clip audio range responses to the promised byte count, including mark/reset handling. */
class LimitedAssetStream(input: InputStream, private var remaining: Long, private var physicalRemaining: Long = remaining) : FilterInputStream(input) {
    private var markedRemaining = remaining
    private var markedPhysicalRemaining = physicalRemaining
    override fun read(): Int {
        if (remaining == 0L) return -1
        val value = super.read()
        if (value >= 0) { remaining--; physicalRemaining-- }
        return value
    }
    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (remaining == 0L) return -1
        val count = super.read(buffer, offset, minOf(length.toLong(), remaining).toInt())
        if (count > 0) { remaining -= count; physicalRemaining -= count }
        return count
    }
    override fun skip(count: Long): Long {
        val skipped = super.skip(minOf(count.coerceAtLeast(0), remaining))
        remaining -= skipped
        physicalRemaining -= skipped
        return skipped
    }
    override fun available(): Int = minOf(super.available().toLong(), physicalRemaining).toInt()
    override fun mark(readlimit: Int) { super.mark(readlimit); markedRemaining = remaining; markedPhysicalRemaining = physicalRemaining }
    override fun reset() { super.reset(); remaining = markedRemaining; physicalRemaining = markedPhysicalRemaining }
}
