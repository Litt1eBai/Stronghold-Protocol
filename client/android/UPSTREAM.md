# Android shell provenance

Adapted from Paper-Yuan/Stronghold-Protocol, branch `0.1.6-pre-skin`, commit
`66f1197` (GPL-3.0-or-later, as is this repository):
https://github.com/Paper-Yuan/Stronghold-Protocol/tree/66f1197/android

`DisplayHelper.kt` and `FileLogger.kt` retain the upstream implementation, with
the package changed and file logging concurrency corrected. The fullscreen,
audio focus, compatibility recovery and native diagnostics behavior in
`MainActivity.kt` is adapted from that shell's remote WebView mode.

This client fixes the origin at build time. It loads this repository's deployed
web client, including registration, authentication and account progress. It
does not package the fork's server, account logic, Node libraries or assets.
