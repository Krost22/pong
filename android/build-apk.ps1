# Compila Pong.apk sin Android Studio ni Gradle, usando el SDK y el JDK que trae
# el módulo Android de Unity (o ANDROID_HOME / JAVA_HOME si están definidos).
# Uso:  powershell -ExecutionPolicy Bypass -File android\build-apk.ps1

$ErrorActionPreference = 'Continue'
$here = $PSScriptRoot
$web = Split-Path $here -Parent
$build = Join-Path $here 'build'
$out = Join-Path $web 'Pong.apk'

$versionCode = 1
$versionName = '1.0'
$minSdk = 21
$targetSdk = 35
$keystore = Join-Path $here 'pong.keystore'
$keyAlias = 'pong'
$keyPass = 'pongpong'

function Run {
    param([string]$exe, [string[]]$argv)
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { throw "Falló: $exe $($argv -join ' ')" }
}

# --- Localizar SDK y JDK ---
$sdk = $env:ANDROID_HOME
$jdk = $env:JAVA_HOME
if (-not $sdk -or -not (Test-Path "$sdk\build-tools")) {
    $player = Get-ChildItem 'C:\Program Files\Unity\Hub\Editor\*\Editor\Data\PlaybackEngines\AndroidPlayer' -Directory -ErrorAction SilentlyContinue |
        Where-Object { (Test-Path "$($_.FullName)\SDK\build-tools") -and (Test-Path "$($_.FullName)\OpenJDK\bin\javac.exe") } |
        Select-Object -Last 1
    if (-not $player) { throw 'No se encontró un Android SDK. Define ANDROID_HOME y JAVA_HOME.' }
    $sdk = "$($player.FullName)\SDK"
    if (-not $jdk -or -not (Test-Path "$jdk\bin\javac.exe")) { $jdk = "$($player.FullName)\OpenJDK" }
}
$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$env:PATH"

$tools = (Get-ChildItem "$sdk\build-tools" -Directory | Sort-Object { [version]($_.Name -replace '[^\d.]', '') } | Select-Object -Last 1).FullName
$platform = Get-ChildItem "$sdk\platforms" -Directory | Where-Object { Test-Path "$($_.FullName)\android.jar" } |
    Sort-Object { [int]($_.Name -replace '\D', '') } | Select-Object -Last 1
$androidJar = "$($platform.FullName)\android.jar"
Write-Host "SDK:   $sdk"
Write-Host "Tools: $tools"
Write-Host "API:   $($platform.Name)"

# --- Preparar carpeta de compilación ---
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Force "$build\assets", "$build\classes", "$build\dex" | Out-Null
Get-ChildItem $web -File | Where-Object { $_.Extension -in '.html', '.css', '.js' } | Copy-Item -Destination "$build\assets"

# --- Recursos + manifiesto + assets ---
Run "$tools\aapt2.exe" @('compile', '--dir', "$here\res", '-o', "$build\res.zip")
Run "$tools\aapt2.exe" @('link', '-o', "$build\unsigned.apk", '-I', $androidJar,
    '--manifest', "$here\AndroidManifest.xml", '-A', "$build\assets",
    '--min-sdk-version', $minSdk, '--target-sdk-version', $targetSdk,
    '--version-code', $versionCode, '--version-name', $versionName, "$build\res.zip")

# --- Código Java -> DEX ---
$sources = Get-ChildItem "$here\src" -Recurse -Filter *.java | ForEach-Object FullName
Run "$jdk\bin\javac.exe" (@('-source', '8', '-target', '8', '-Xlint:-options', '-encoding', 'UTF-8',
    '-bootclasspath', $androidJar, '-d', "$build\classes") + $sources)
$classes = Get-ChildItem "$build\classes" -Recurse -Filter *.class | ForEach-Object FullName
Run "$tools\d8.bat" (@('--release', '--min-api', $minSdk, '--lib', $androidJar, '--output', "$build\dex") + $classes)

Push-Location "$build\dex"
try { Run "$tools\aapt.exe" @('add', "$build\unsigned.apk", 'classes.dex') } finally { Pop-Location }

# --- Alinear y firmar ---
Run "$tools\zipalign.exe" @('-p', '-f', '4', "$build\unsigned.apk", "$build\aligned.apk")
if (-not (Test-Path $keystore)) {
    Run "$jdk\bin\keytool.exe" @('-genkeypair', '-keystore', $keystore, '-alias', $keyAlias, '-keyalg', 'RSA',
        '-keysize', '2048', '-validity', '10000', '-storepass', $keyPass, '-keypass', $keyPass,
        '-dname', 'CN=Pong, O=Juegos Web')
}
Run "$tools\apksigner.bat" @('sign', '--ks', $keystore, '--ks-key-alias', $keyAlias,
    '--ks-pass', "pass:$keyPass", '--key-pass', "pass:$keyPass", '--out', $out, "$build\aligned.apk")
Run "$tools\apksigner.bat" @('verify', $out)

Write-Host "`nAPK lista: $out"
