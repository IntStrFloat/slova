param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Destination
)

$sourcePath = [IO.Path]::GetFullPath($Source)
$destinationPath = [IO.Path]::GetFullPath($Destination)
$workspacePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$allowedOutputPath = [IO.Path]::GetFullPath((Join-Path $workspacePath 'output\yandex-games'))

if (-not $sourcePath.StartsWith($allowedOutputPath, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Source must stay inside $allowedOutputPath"
}
if (-not $destinationPath.StartsWith($allowedOutputPath, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Destination must stay inside $allowedOutputPath"
}
if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
  throw "Build directory does not exist: $sourcePath"
}

$destinationDirectory = Split-Path -Parent $destinationPath
New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
if (Test-Path -LiteralPath $destinationPath) {
  Remove-Item -LiteralPath $destinationPath -Force
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory(
  $sourcePath,
  $destinationPath,
  [IO.Compression.CompressionLevel]::Optimal,
  $false
)

