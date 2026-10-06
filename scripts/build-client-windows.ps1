param(
    [Parameter(Mandatory = $true)][string]$ServerUrl,
    [ValidateSet('Windows', 'Android', 'Both')][string]$Target = 'Both',
    [string]$AndroidSdk = 'E:\programs\dev\android_sdk',
    [string]$JavaHome = 'C:\programs\dev\java\zulu21',
    [string]$NdkVersion = '30.0.16248370',
    [string]$KeyStore,
    [string]$KeyStorePasswordFile,
    [string]$KeyAlias = 'stronghold-release',
    [switch]$SignOnly
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
if ($SignOnly -and $Target -ne 'Android') { throw '-SignOnly requires -Target Android' }
$env:SP_SERVER_URL = $ServerUrl.TrimEnd('/')
$env:ANDROID_HOME = $AndroidSdk
$env:NDK_HOME = Join-Path $AndroidSdk "ndk\$NdkVersion"
$env:JAVA_HOME = $JavaHome
if (!$KeyStore) { $KeyStore = Join-Path $repo '.cache\client-signing\stronghold-release.jks' }
if (!$KeyStorePasswordFile) { $KeyStorePasswordFile = Join-Path $repo '.cache\client-signing\keystore-password.txt' }

Push-Location (Join-Path $repo 'client')
try {
    if ($Target -eq 'Windows' -or $Target -eq 'Both') {
        & npm.cmd run build -- --bundles nsis
        if ($LASTEXITCODE -ne 0) { throw "Windows build failed ($LASTEXITCODE)" }
        $installer = Get-ChildItem 'src-tauri\target\release\bundle\nsis' -Filter '*-setup.exe' |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (!$installer) { throw 'Windows installer not found' }
        $output = Join-Path $repo 'client\artifacts\windows'
        New-Item -ItemType Directory -Force -Path $output | Out-Null
        Copy-Item $installer.FullName (Join-Path $output $installer.Name) -Force
        Write-Host "Windows installer: $(Join-Path $output $installer.Name)"
    }
    if ($Target -eq 'Android' -or $Target -eq 'Both') {
        if (!$SignOnly) {
            & npm.cmd run android:build
            if ($LASTEXITCODE -ne 0) { throw "Android build failed ($LASTEXITCODE)" }
        }
        if (!(Test-Path $KeyStore) -or !(Test-Path $KeyStorePasswordFile)) {
            throw 'Provide a release keystore and password file to sign the APK'
        }
        $apk = Get-Item 'android\app\build\outputs\apk\release\app-release-unsigned.apk' -ErrorAction SilentlyContinue
        if (!$apk) { throw 'Release unsigned APK not found' }
        $buildTools = Get-ChildItem (Join-Path $AndroidSdk 'build-tools') -Directory |
            Where-Object { Test-Path (Join-Path $_.FullName 'apksigner.bat') } |
            Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
        if (!$buildTools) { throw 'Android SDK Build Tools with apksigner are required' }
        $output = Join-Path $repo 'client\artifacts\android'
        New-Item -ItemType Directory -Force -Path $output | Out-Null
        $aligned = Join-Path $output 'stronghold-aligned.apk'
        $signed = Join-Path $output 'Stronghold-Protocol-release.apk'
        & (Join-Path $buildTools.FullName 'zipalign.exe') -f -P 16 4 $apk.FullName $aligned
        if ($LASTEXITCODE -ne 0) { throw "APK alignment failed ($LASTEXITCODE)" }
        & (Join-Path $buildTools.FullName 'apksigner.bat') sign --ks $KeyStore --ks-key-alias $KeyAlias --ks-pass "file:$KeyStorePasswordFile" --out $signed $aligned
        if ($LASTEXITCODE -ne 0) { throw "APK signing failed ($LASTEXITCODE)" }
        & (Join-Path $buildTools.FullName 'apksigner.bat') verify --verbose $signed
        if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed ($LASTEXITCODE)" }
        & (Join-Path $buildTools.FullName 'zipalign.exe') -c -P 16 4 $signed
        if ($LASTEXITCODE -ne 0) { throw "APK alignment verification failed ($LASTEXITCODE)" }
        $checksum = (Get-FileHash $signed -Algorithm SHA256).Hash.ToLowerInvariant()
        "$checksum  Stronghold-Protocol-release.apk" | Set-Content (Join-Path $output 'SHA256SUMS') -Encoding ascii
        Write-Host "Signed release APK: $signed"
    }
} finally {
    Pop-Location
}
