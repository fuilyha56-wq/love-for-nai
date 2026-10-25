#Requires -RunAsAdministrator
# Reclaim already-deleted Docker cache blocks. Keeps images, volumes and configuration.
$ErrorActionPreference = 'Stop'
$diskPath = 'D:/Docker/wsl/disk/docker_data.vhdx'
if ([IO.Path]::GetFullPath($diskPath) -ne 'D:\Docker\wsl\disk\docker_data.vhdx') { throw 'Unexpected disk path' }
foreach ($directory in @('D:/Docker', 'D:/Docker/wsl', 'D:/Docker/wsl/disk')) {
    if ((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing a redirected disk directory' }
}
if (-not (Test-Path -LiteralPath $diskPath -PathType Leaf)) { throw 'Docker data disk not found' }
$runningContainers = @(docker ps --format '{{.Names}}')
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect active containers' }
if (@($runningContainers | Where-Object { $_ -notlike 'buildx_buildkit_*' }).Count) { throw 'Application containers are running. Stop them before compacting.' }
$beforeBytes = (Get-Item -LiteralPath $diskPath).Length
Write-Output "Preparing Docker data disk: $diskPath"
# Inform the virtual disk that the deleted Linux cache blocks are unused.
wsl.exe --distribution docker-desktop --user root -- fstrim -av
if ($LASTEXITCODE -ne 0) { throw 'Filesystem trim failed; disk unchanged' }
try {
    docker desktop stop
    if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop did not stop' }
    $available = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try { $handle = [IO.File]::Open($diskPath, 'Open', 'ReadWrite', 'None'); $handle.Dispose(); $available = $true; break }
        catch { Start-Sleep -Seconds 2 }
    }
    if (-not $available) { throw 'Data disk is still mounted; compaction cancelled' }
    Optimize-VHD -Path $diskPath -Mode Full
    $afterBytes = (Get-Item -LiteralPath $diskPath).Length
    Write-Output ('Physical disk reduction: {0:N2} GiB' -f (($beforeBytes - $afterBytes) / 1GB))
}
finally {
    docker desktop start
    Write-Output 'Docker Desktop startup requested.'
}
