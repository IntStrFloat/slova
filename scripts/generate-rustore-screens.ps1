param(
  [string]$SourceDir = "output/playwright",
  [string]$OutputDir = "assets/store"
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $repoRoot $SourceDir
$outputRoot = Join-Path $repoRoot $OutputDir
$fontPath = (Join-Path $repoRoot 'node_modules/@expo-google-fonts/unbounded/700Bold/Unbounded_700Bold.ttf').Replace('\', '/')

if (-not (Get-Command magick -ErrorAction SilentlyContinue)) {
  throw 'ImageMagick (magick) is required to compose the RuStore screenshots.'
}
if (-not (Test-Path -LiteralPath $fontPath)) {
  throw "Missing title font: $fontPath. Run npm ci first."
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

$screens = @(
  @{ Source = 'aso-01-gameplay.png'; Output = 'rustore-screen-01-words.jpg'; Line1 = 'СОБИРАЙ СЛОВА'; Line2 = 'ИЗ БУКВ' },
  @{ Source = 'aso-02-crossword.png'; Output = 'rustore-screen-02-crossword.jpg'; Line1 = 'КРОССВОРДЫ'; Line2 = 'БЕЗ СПЕШКИ' },
  @{ Source = 'aso-03-collection.png'; Output = 'rustore-screen-03-collection.jpg'; Line1 = 'ОТКРЫВАЙ'; Line2 = 'НОВЫЕ МЕСТА' },
  @{ Source = 'aso-04-daily.png'; Output = 'rustore-screen-04-daily.jpg'; Line1 = 'НОВОЕ ЗАДАНИЕ'; Line2 = 'КАЖДЫЙ ДЕНЬ' },
  @{ Source = 'aso-05-hint.png'; Output = 'rustore-screen-05-hint.jpg'; Line1 = 'ПОДСКАЗКА,'; Line2 = 'КОГДА НУЖНА' }
)

$screenWidth = 890
$screenHeight = 1606
$screenX = 95
$screenY = 274
$maskPath = Join-Path $sourceRoot 'rustore-rounded-mask.png'

& magick -size "${screenWidth}x${screenHeight}" xc:none `
  -fill white `
  -draw "roundrectangle 0,0,$($screenWidth - 1),$($screenHeight - 1),48,48" `
  $maskPath

foreach ($screen in $screens) {
  $sourcePath = Join-Path $sourceRoot $screen.Source
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Missing source screenshot: $sourcePath"
  }

  $backgroundPath = Join-Path $sourceRoot ("rustore-bg-" + $screen.Output + '.png')
  $roundedPath = Join-Path $sourceRoot ("rustore-rounded-" + $screen.Output + '.png')
  $outputPath = Join-Path $outputRoot $screen.Output

  & magick $sourcePath `
    -resize '1080x1920^' `
    -gravity center `
    -extent '1080x1920' `
    -blur '0x30' `
    -fill '#07101C' `
    -colorize '72%' `
    $backgroundPath

  & magick $sourcePath `
    -resize "${screenWidth}x${screenHeight}!" `
    $maskPath `
    -alpha off `
    -compose CopyOpacity `
    -composite `
    $roundedPath

  & magick $backgroundPath `
    -fill 'rgba(6,11,20,0.72)' `
    -draw 'roundrectangle 77,256 1003,1904 62,62' `
    -fill 'rgba(14,22,36,0.90)' `
    -stroke 'rgba(255,255,255,0.14)' `
    -strokewidth 2 `
    -draw 'roundrectangle 48,34 1032,244 46,46' `
    -fill '#3FD27E' `
    -stroke none `
    -draw 'roundrectangle 80,65 102,211 11,11' `
    $roundedPath `
    -geometry "+${screenX}+${screenY}" `
    -compose over `
    -composite `
    -fill none `
    -stroke 'rgba(255,255,255,0.34)' `
    -strokewidth 3 `
    -draw 'roundrectangle 95,274 984,1879 48,48' `
    -font $fontPath `
    -gravity northwest `
    -fill white `
    -stroke none `
    -pointsize 50 `
    -annotate '+138+63' $screen.Line1 `
    -fill '#EBA63D' `
    -pointsize 58 `
    -annotate '+138+132' $screen.Line2 `
    -strip `
    -sampling-factor '4:4:4' `
    -quality 94 `
    $outputPath

  Remove-Item -LiteralPath $backgroundPath, $roundedPath
  Write-Output $outputPath
}

Remove-Item -LiteralPath $maskPath
