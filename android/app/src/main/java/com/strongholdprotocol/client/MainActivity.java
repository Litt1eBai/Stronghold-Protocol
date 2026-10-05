package com.strongholdprotocol.client;

import android.app.Activity;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Fixed-endpoint wrapper with the complete web client served from APK assets. */
public final class MainActivity extends Activity {
    private static final String ASSET_ORIGIN = "https://appassets.stronghold.local/";
    private WebView web;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetResponse(request.getUrl().getPath());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                try { return assetResponse(android.net.Uri.parse(url).getPath()); }
                catch (Exception ignored) { return null; }
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        setContentView(web);
        web.loadUrl(ASSET_ORIGIN + "index.html");
    }

    private WebResourceResponse assetResponse(String path) {
        if (path == null || !path.startsWith("/")) return null;
        String rel = path.substring(1);
        if (rel.startsWith("media/")) {
            String stem = rel.substring("media/".length());
            for (String ext : new String[] { ".mp3", ".ogg", ".wav", ".m4a" }) {
                WebResourceResponse response = openAsset("assets/audio/" + stem + ext, "audio/mpeg");
                if (response != null) return response;
            }
            return null;
        }
        if (rel.isEmpty()) rel = "index.html";
        if (rel.contains("..") || rel.startsWith("/")) return null;
        return openAssetResponse(rel);
    }

    private WebResourceResponse openAssetResponse(String rel) {
        try {
            InputStream in = getAssets().open("web/" + rel, android.content.res.AssetManager.ACCESS_STREAMING);
            if ("index.html".equals(rel)) {
                byte[] raw = readAll(in);
                String html = new String(raw, StandardCharsets.UTF_8);
                String endpoint = BuildConfig.SERVER_URL.replace("\\", "\\\\").replace("'", "\\'");
                String boot = "<script>window.__SP_SERVER_URL__='" + endpoint + "';</script>";
                html = html.replace("</head>", boot + "</head>");
                in = new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8));
            }
            return new WebResourceResponse(mimeType(rel), "UTF-8", 200, "OK", null, in);
        } catch (IOException ignored) { return null; }
    }

    private WebResourceResponse openAsset(String rel, String fallbackMime) {
        WebResourceResponse r = openAssetResponse(rel);
        return r == null ? null : r;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        for (int n; (n = in.read(buf)) != -1;) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }

    private static String mimeType(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".html")) return "text/html";
        if (n.endsWith(".js")) return "application/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".mp3")) return "audio/mpeg";
        if (n.endsWith(".ogg")) return "audio/ogg";
        if (n.endsWith(".woff2")) return "font/woff2";
        if (n.endsWith(".woff")) return "font/woff";
        if (n.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
