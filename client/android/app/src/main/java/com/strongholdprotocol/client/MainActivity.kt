package com.strongholdprotocol.client

import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.*
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import androidx.activity.OnBackPressedCallback
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/** Adapted from Paper-Yuan's remote WebView shell; the server is fixed by the build. */
class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var root: FrameLayout
    private lateinit var loading: LinearLayout
    private lateinit var status: TextView
    private val handler = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("stronghold_shell", Context.MODE_PRIVATE) }
    private val audioManager by lazy { getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    private var focusRequest: AudioFocusRequest? = null
    private var loggedIn = false
    private var pageReady = false
    private var pageFailed = false
    private var clientState = "尚未收到页面状态"
    private var watchdog: Runnable? = null
    private var recoveryDialog: AlertDialog? = null
    private var documentScript: String = ""
    private val preinstalledAssets by lazy { PreinstalledAssets(assets) }
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        runOnUiThread { setPageAudio(change == AudioManager.AUDIOFOCUS_GAIN) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        FileLogger.init(applicationContext)
        if (Build.VERSION.SDK_INT >= 28) {
            window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        root = FrameLayout(this)
        setContentView(root)
        createWebView()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = showNativeMenu()
        })
        loadServer()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        webView = WebView(this)
        webView.setBackgroundColor(Color.rgb(42, 47, 46))
        root.addView(webView, FrameLayout.LayoutParams(-1, -1))
        loading = LinearLayout(this).apply {
            visibility = View.GONE
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER
            setPadding(24, 24, 24, 24)
            setBackgroundColor(Color.rgb(12, 15, 14))
        }
        status = TextView(this).apply { setTextColor(Color.WHITE); gravity = android.view.Gravity.CENTER }
        loading.addView(status)
        button(loading, "重试连接") { loadServer() }
        button(loading, "查看诊断与日志") { showLogs() }
        root.addView(loading, FrameLayout.LayoutParams(-1, -1))
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            useWideViewPort = true
            loadWithOverviewMode = true
            textZoom = 100
            setSupportZoom(false)
        }
        CookieManager.getInstance().setAcceptCookie(true)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.addJavascriptInterface(AndroidBridge(this), "AndroidNative")
        documentScript = assets.open("shell.js").bufferedReader().use { it.readText() }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, documentScript, setOf(BuildConfig.SERVER_URL))
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                FileLogger.console(message.messageLevel().name, message.message(), "${message.sourceId()}:${message.lineNumber()}")
                return true
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                preinstalledAssets.intercept(request)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Keep the bridge and account storage confined to the compiled server origin.
                return !isServerOrigin(request.url.toString())
            }
            override fun onPageStarted(view: WebView, url: String, icon: android.graphics.Bitmap?) {
                if (!isServerOrigin(url)) {
                    view.stopLoading()
                    showFailure("页面跳转到了其他服务器，已停止加载")
                    return
                }
                loggedIn = false
                pageReady = false
                pageFailed = false
                clientState = "尚未收到页面状态"
                cancelWatchdog()
                scheduleWatchdog(30_000L)
                loading.visibility = View.GONE
                FileLogger.i("webview", "page loading")
            }
            override fun onPageFinished(view: WebView, url: String) {
                if (pageFailed || !isServerOrigin(url)) return
                // Fallback for older system WebViews without document-start script support.
                view.evaluateJavascript(documentScript, null)
                if (!pageReady) {
                    cancelWatchdog()
                    scheduleWatchdog(12_000L)
                }
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showFailure("连接失败：${error.description}")
            }
            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (request.isForMainFrame) showFailure("服务器返回 HTTP ${response.statusCode}")
            }
            @TargetApi(26)
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // A terminated renderer's WebView cannot be reused. Recreate the view before retrying.
                FileLogger.e("webview", "renderer gone, crashed=${detail.didCrash()}")
                cancelWatchdog()
                view.removeJavascriptInterface("AndroidNative")
                root.removeAllViews()
                view.destroy()
                createWebView()
                showFailure("页面渲染进程已退出，请重试或启用兼容模式")
                return true
            }
        }
        applyDisplaySettings()
    }

    private fun isServerOrigin(url: String): Boolean = try {
        val expected = URI(BuildConfig.SERVER_URL)
        val actual = URI(url)
        fun port(uri: URI) = if (uri.port >= 0) uri.port else if (uri.scheme == "https") 443 else 80
        actual.scheme == expected.scheme && actual.host.equals(expected.host, true)
            && actual.rawUserInfo == null && port(actual) == port(expected)
    } catch (_: Exception) { false }

    fun loadServer() {
        cancelWatchdog()
        recoveryDialog?.dismiss()
        loggedIn = false
        loading.visibility = View.GONE
        pageFailed = false
        pageReady = false
        applyDisplaySettings()
        val suffix = if (prefs.getBoolean("compat_mode", false)) "/?render=fallback&board=2d" else "/"
        webView.loadUrl(BuildConfig.SERVER_URL + suffix)
    }

    fun reportClientState(json: String) {
        val state = try { JSONObject(json) } catch (_: Exception) { return }
        runOnUiThread {
            if (isFinishing || isDestroyed || pageFailed) return@runOnUiThread
            loggedIn = state.optBoolean("loggedIn")
            clientState = state.toString()
            if (state.has("error")) FileLogger.e("page", state.optString("error"))
            if (state.optBoolean("ready")) {
                if (!pageReady) FileLogger.i("webview", "original web client ready")
                pageReady = true
                cancelWatchdog()
                loading.visibility = View.GONE
                recoveryDialog?.dismiss()
            }
        }
    }

    private fun showFailure(message: String) {
        pageFailed = true
        cancelWatchdog()
        loading.visibility = View.VISIBLE
        status.text = "$message\n${BuildConfig.SERVER_URL}"
        FileLogger.e("connection", message)
    }

    private fun scheduleWatchdog(delay: Long) {
        watchdog = Runnable {
            if (pageReady || pageFailed || isFinishing || isDestroyed) return@Runnable
            loading.visibility = View.GONE
            recoveryDialog = AlertDialog.Builder(this)
                .setTitle("游戏画面尚未就绪")
                .setMessage("如果画面空白，可启用兼容模式后重试。也可以查看日志检查连接与页面错误。")
                .setPositiveButton("兼容模式重启") { _, _ -> enableCompatMode() }
                .setNeutralButton("查看日志") { _, _ -> showLogs() }
                .setNegativeButton("继续等", null).show()
        }.also { handler.postDelayed(it, delay) }
    }

    private fun cancelWatchdog() {
        watchdog?.let { handler.removeCallbacks(it) }
        watchdog = null
    }

    fun enableCompatMode() {
        prefs.edit().putBoolean("compat_mode", true).apply()
        loadServer()
    }

    private fun applyDisplaySettings() {
        webView.setLayerType(if (prefs.getBoolean("compat_mode", false)) View.LAYER_TYPE_SOFTWARE else View.LAYER_TYPE_NONE, null)
        val edge = prefs.getInt("edge_padding_px", 0)
        root.setPadding(edge, 0, edge, 0)
        DisplayHelper.apply(window, prefs.getBoolean("high_refresh", true))
    }

    fun showSettings() {
        if (!loggedIn) return
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(32, 16, 32, 16) }
        val refresh = SwitchCompat(this).apply { text = "使用屏幕最高刷新率"; isChecked = prefs.getBoolean("high_refresh", true) }
        content.addView(refresh)
        val label = TextView(this).apply { text = "左右屏幕边距（避开刘海）：${prefs.getInt("edge_padding_px", 0)} px" }
        content.addView(label)
        val padding = SeekBar(this).apply { max = 200; progress = prefs.getInt("edge_padding_px", 0) }
        padding.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar?, value: Int, fromUser: Boolean) { label.text = "左右屏幕边距（避开刘海）：$value px" }
            override fun onStartTrackingTouch(bar: SeekBar?) {}
            override fun onStopTrackingTouch(bar: SeekBar?) {}
        })
        content.addView(padding)
        AlertDialog.Builder(this).setTitle("安卓屏幕设置").setView(content)
            .setPositiveButton("应用") { _, _ ->
                prefs.edit().putBoolean("high_refresh", refresh.isChecked)
                    .putInt("edge_padding_px", padding.progress).apply()
                applyDisplaySettings()
            }.setNegativeButton("取消", null).show()
    }

    fun showLogs() {
        val info = TextView(this).apply {
            setPadding(24, 16, 24, 16)
            textSize = 12f
            text = "服务器：${BuildConfig.SERVER_URL}\nWebView：${WebViewCompat.getCurrentWebViewPackage(this@MainActivity)?.versionName}\n页面：$clientState\n\n${FileLogger.tail()}"
        }
        val scroll = ScrollView(this).apply { addView(info) }
        AlertDialog.Builder(this).setTitle("连接诊断与日志").setView(scroll)
            .setPositiveButton("关闭", null)
            .setNeutralButton("分享日志") { _, _ -> FileLogger.share(this) }
            .setNegativeButton("复制") { _, _ ->
                (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Stronghold logs", info.text))
            }.show()
        Thread {
            val connection = URL(BuildConfig.SERVER_URL + "/healthz").openConnection() as HttpURLConnection
            val health = try {
                connection.connectTimeout = 3000
                connection.readTimeout = 3000
                connection.instanceFollowRedirects = false
                "HTTP ${connection.responseCode}"
            } catch (e: Exception) { "${e.javaClass.simpleName}: ${e.message}" }
            finally { connection.disconnect() }
            runOnUiThread { if (!isDestroyed) info.text = "连通性：$health\n${info.text}" }
        }.start()
    }

    private fun button(parent: LinearLayout, title: String, action: () -> Unit) {
        parent.addView(Button(this).apply { text = title; setOnClickListener { action() } })
    }

    private fun requestAudioFocus() {
        if (Build.VERSION.SDK_INT >= 26) {
            focusRequest = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setOnAudioFocusChangeListener(focusListener).build()
            audioManager.requestAudioFocus(focusRequest!!)
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        }
    }

    private fun setPageAudio(active: Boolean) {
        // The existing audio module exposes its AudioContext, rather than fork-specific suspend/resume methods.
        val action = if (active) "resume" else "suspend"
        if (::webView.isInitialized) webView.evaluateJavascript(
            "import('/js/audio.js').then(m=>m.audio?.ctx?.$action()?.catch(()=>{})).catch(()=>{})", null)
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) { webView.onResume(); requestAudioFocus(); setPageAudio(true) }
    }
    override fun onPause() {
        setPageAudio(false)
        if (Build.VERSION.SDK_INT >= 26) focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        else { @Suppress("DEPRECATION") audioManager.abandonAudioFocus(focusListener) }
        if (::webView.isInitialized) webView.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus) return
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.hide(WindowInsets.Type.systemBars())
            window.insetsController?.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        DisplayHelper.apply(window, prefs.getBoolean("high_refresh", true))
    }
    private fun showNativeMenu() {
        if (!loggedIn) {
            AlertDialog.Builder(this).setTitle("退出卫戍协议？")
                .setPositiveButton("退出") { _, _ -> finish() }
                .setNegativeButton("取消", null).show()
            return
        }
        AlertDialog.Builder(this).setTitle("卫戍协议")
            .setItems(arrayOf("安卓屏幕设置", "诊断与日志", "刷新页面", "故障恢复", "退出")) { _, which ->
                when (which) { 0 -> showSettings(); 1 -> showLogs(); 2 -> loadServer(); 3 -> showRecovery(); 4 -> finish() }
            }.setNegativeButton("继续游戏", null).show()
    }
    private fun showRecovery() {
        AlertDialog.Builder(this).setTitle("故障恢复")
            .setMessage("仅在游戏画面无法正常显示时使用。切换兼容模式会刷新页面。")
            .setPositiveButton("兼容模式重启") { _, _ -> enableCompatMode() }
            .setNeutralButton("恢复正常模式") { _, _ ->
                prefs.edit().putBoolean("compat_mode", false).apply()
                loadServer()
            }.setNegativeButton("取消", null).show()
    }
    override fun onDestroy() {
        cancelWatchdog()
        recoveryDialog?.dismiss()
        if (::webView.isInitialized) {
            webView.removeJavascriptInterface("AndroidNative")
            webView.stopLoading()
            root.removeAllViews()
            webView.destroy()
        }
        super.onDestroy()
    }
}
