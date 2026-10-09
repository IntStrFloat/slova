param(
  [string]$ArtifactDir = 'C:\Users\Dima2\Documents\Slova\output\release-0.1.5-vc9'
)
$ErrorActionPreference = 'Stop'
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$buildTools = 'C:\Users\Dima2\AppData\Local\Android\Sdk\build-tools\36.0.0'
$workspacePath = 'C:\Users\Dima2\Documents\Slova'
$apkSource = Join-Path $workspacePath 'android\app\build\outputs\apk\release\app-release.apk'
$aabSource = Join-Path $workspacePath 'android\app\build\outputs\bundle\release\app-release.aab'
$expectedCertificate = '8888E53939D854A282A0EE40E9A78E21360B50D0DD077EFC2D107DA155BFADCD'
$metadata = Get-Content -LiteralPath (Join-Path $workspacePath 'android\app\build\outputs\apk\release\output-metadata.json') -Raw | ConvertFrom-Json
if ($metadata.elements[0].versionCode -ne 9 -or $metadata.elements[0].versionName -ne '0.1.5') { throw 'Unexpected release version in APK metadata' }
$apkVerification = & "$buildTools\apksigner.bat" verify --verbose --print-certs $apkSource 2>&1
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
$apkCertificate = [regex]::Match(($apkVerification -join "`n"), 'certificate SHA-256 digest:\s*([a-fA-F0-9]+)').Groups[1].Value.ToUpperInvariant()
if ($apkCertificate -ne $expectedCertificate) { throw 'APK certificate differs from the existing release key' }
$aabVerification = & "$env:JAVA_HOME\bin\jarsigner.exe" -verify $aabSource 2>&1
if ($LASTEXITCODE -ne 0 -or ($aabVerification -join "`n") -notmatch 'jar verified') { throw 'AAB signature verification failed' }
$aabCertificateOutput = & "$env:JAVA_HOME\bin\keytool.exe" -printcert -jarfile $aabSource 2>&1
if ($LASTEXITCODE -ne 0) { throw 'AAB certificate could not be read' }
$aabCertificate = ([regex]::Match(($aabCertificateOutput -join "`n"), 'SHA256:\s*([A-Fa-f0-9:]+)').Groups[1].Value -replace ':', '').ToUpperInvariant()
if ($aabCertificate -ne $expectedCertificate) { throw 'AAB certificate differs from the existing release key' }
$manifest = & "$buildTools\aapt2.exe" dump xmltree $apkSource --file AndroidManifest.xml 2>&1
if ($LASTEXITCODE -ne 0) { throw 'APK manifest inspection failed' }
if (($manifest -join "`n") -match 'debuggable[^\n]*0xffffffff') { throw 'APK is debuggable' }
$debuggable = & 'C:\Users\Dima2\AppData\Local\Android\Sdk\cmdline-tools\latest\bin\apkanalyzer.bat' manifest debuggable $apkSource
if ($LASTEXITCODE -ne 0 -or ($debuggable -join '').Trim() -ne 'false') { throw 'Release APK must have debuggable=false' }
$badging = & "$buildTools\aapt2.exe" dump badging $apkSource 2>&1
if ($LASTEXITCODE -ne 0) { throw 'APK metadata inspection failed' }
if (($badging -join "`n") -notmatch "package: name='com.intstrfloat.slova' versionCode='9' versionName='0.1.5'") { throw 'APK manifest version or application ID mismatch' }
New-Item -ItemType Directory -Path $ArtifactDir -Force | Out-Null
$apkPath = Join-Path $ArtifactDir 'slova-0.1.5-vc9-release.apk'
$aabPath = Join-Path $ArtifactDir 'slova-0.1.5-vc9-release.aab'
Copy-Item -LiteralPath $apkSource -Destination $apkPath
Copy-Item -LiteralPath $aabSource -Destination $aabPath
$apkVerification | Set-Content -LiteralPath (Join-Path $ArtifactDir 'apk-signature.txt') -Encoding utf8
$aabVerification | Set-Content -LiteralPath (Join-Path $ArtifactDir 'aab-signature.txt') -Encoding utf8
$badging | Select-String 'package:|sdkVersion:|targetSdkVersion:|native-code:|application-label:' | ForEach-Object { $_.Line } | Set-Content -LiteralPath (Join-Path $ArtifactDir 'apk-metadata.txt') -Encoding utf8
Add-Type -AssemblyName System.IO.Compression.FileSystem
$bundleSource = Join-Path $workspacePath 'android\app\build\generated\assets\react\release\index.android.bundle'
$bundleHash = (Get-FileHash -LiteralPath $bundleSource -Algorithm SHA256).Hash
foreach ($package in @(@{ Path = $apkPath; Entry = 'assets/index.android.bundle' }, @{ Path = $aabPath; Entry = 'base/assets/index.android.bundle' })) {
  $archive = [System.IO.Compression.ZipFile]::OpenRead($package.Path)
  try {
    $entry = $archive.GetEntry($package.Entry)
    if ($null -eq $entry) { throw 'Production JS bundle is missing from the artifact' }
    $stream = $entry.Open()
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
      $embeddedHash = ([System.BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '')
      if ($embeddedHash -ne $bundleHash) { throw 'Packaged JS differs from the freshly generated production bundle' }
    } finally { $stream.Dispose(); $hasher.Dispose() }
  } finally { $archive.Dispose() }
}
$report = [ordered]@{
  version = '0.1.5'
  versionCode = 9
  applicationId = 'com.intstrfloat.slova'
  debuggable = $false
  certificateSha256 = $expectedCertificate
  matchesPreviousReleaseCertificate = $true
  packagedJsMatchesBuild = $true
  productionBundleSha256 = $bundleHash
  checkedAt = (Get-Date).ToUniversalTime().ToString('o')
  artifacts = @($apkPath, $aabPath) | ForEach-Object { [ordered]@{ path = $_; bytes = (Get-Item -LiteralPath $_).Length; sha256 = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash } }
}
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $ArtifactDir 'verification.json') -Encoding utf8
$report | ConvertTo-Json -Depth 4


