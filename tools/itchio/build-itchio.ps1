# Prepara la subida a itch.io en dist\itchio\:
#   - pong-itchio-<versión>.zip  -> el juego HTML5 (index.html en la raíz, como pide itch.io)
#   - descripcion.html / descripcion.txt -> texto de la página
#   - itchio-cover.png e itchio-descripcion.png -> portada e imagen para la descripción (si ya se generaron)
# Uso (desde la carpeta Pong):  powershell -ExecutionPolicy Bypass -File tools\itchio\build-itchio.ps1

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$game = Resolve-Path (Join-Path $here '..\..')
$out = Join-Path $game 'dist\itchio'
$stage = Join-Path $out 'stage'

$version = [regex]::Match((Get-Content (Join-Path $game 'version.js') -Raw), "PONG_VERSION\s*=\s*'([\d.]+)'").Groups[1].Value
if (-not $version) { throw 'No se encontró PONG_VERSION en version.js' }

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null

# Solo los archivos del juego: nada de Android, herramientas ni documentación
Get-ChildItem $game -File | Where-Object { $_.Extension -in '.html', '.css', '.js' } | Copy-Item -Destination $stage
if (-not (Test-Path (Join-Path $stage 'index.html'))) { throw 'Falta index.html' }

$zip = Join-Path $out "pong-itchio-v$version.zip"
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
Remove-Item $stage -Recurse -Force

Copy-Item (Join-Path $here 'descripcion.html'), (Join-Path $here 'descripcion.txt') $out
foreach ($img in 'itchio-cover.png', 'itchio-cover-630x500.png', 'itchio-descripcion.png', 'itchio-banner.png', 'itchio-background.png', 'itchio-embed-bg.png') {
    $src = Join-Path $game "marketing\$img"
    if (Test-Path $src) { Copy-Item $src $out } else { Write-Host "Aviso: falta marketing\$img (genéralo con tools\marketing\stills.mjs)" }
}

Write-Host "Versión $version lista en $out"
Get-ChildItem $out | ForEach-Object { Write-Host ("  {0,-32} {1,8:N0} KB" -f $_.Name, ($_.Length / 1KB)) }
