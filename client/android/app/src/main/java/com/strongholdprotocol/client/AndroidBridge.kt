package com.strongholdprotocol.client

import android.webkit.JavascriptInterface

class AndroidBridge(private val activity: MainActivity) {
    @JavascriptInterface fun isNativeApp(): Boolean = true
    @JavascriptInterface fun getAppVersion(): String = BuildConfig.VERSION_NAME
    @JavascriptInterface fun reportClientState(json: String) = activity.reportClientState(json)
    @JavascriptInterface fun showLogs() = activity.runOnUiThread { activity.showLogs() }
    @JavascriptInterface fun openServerSettings() = activity.runOnUiThread { activity.showSettings() }
    @JavascriptInterface fun enableCompatMode() = activity.runOnUiThread { activity.enableCompatMode() }
    @JavascriptInterface fun reloadClient() = activity.runOnUiThread { activity.loadServer() }
}
