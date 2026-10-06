package com.strongholdprotocol.client

import java.net.URI

data class BundledAsset(val url: String, val size: Long, val mime: String)
data class AssetRange(val start: Long, val end: Long) {
    val length: Long get() = end - start + 1
}

/** Pure request policy, shared by the interceptor and JVM tests. */
class StaticAssetPolicy(origin: String, private val inventory: Map<String, BundledAsset>) {
    private val server = URI(origin)
    private fun port(uri: URI) = if (uri.port >= 0) uri.port else if (uri.scheme == "https") 443 else 80

    fun find(url: String, method: String): BundledAsset? {
        if (method != "GET" && method != "HEAD") return null
        val uri = try { URI(url) } catch (_: Exception) { return null }
        if (uri.scheme != server.scheme || !uri.host.equals(server.host, true)
            || port(uri) != port(server) || uri.rawUserInfo != null) return null
        // Explicit cache-busting URLs are fetched from the server, so deployments can replace old art.
        if (uri.rawQuery != null || uri.rawFragment != null) return null
        val path = uri.path ?: return null
        if (!path.startsWith("/assets/") && !path.startsWith("/fonts/")) return null
        return inventory[path]
    }

    /** A malformed/unsupported range is ignored; an unsatisfiable single range returns start=-1. */
    fun range(size: Long, header: String?): AssetRange? {
        if (header == null) return null
        val match = Regex("^bytes=(\\d*)-(\\d*)$").matchEntire(header.trim()) ?: return null
        val first = match.groupValues[1]
        val last = match.groupValues[2]
        if (first.isEmpty() && last.isEmpty()) return null
        if (size == 0L) return AssetRange(-1, -1)
        if (first.isEmpty()) {
            val suffix = last.toLongOrNull() ?: return null
            if (suffix == 0L) return AssetRange(-1, -1)
            return AssetRange((size - suffix).coerceAtLeast(0), size - 1)
        }
        val start = first.toLongOrNull() ?: return null
        val end = if (last.isEmpty()) size - 1 else last.toLongOrNull() ?: return null
        if (start >= size || end < start) return AssetRange(-1, -1)
        return AssetRange(start, minOf(end, size - 1))
    }
}
