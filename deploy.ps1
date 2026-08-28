# LFN 本地构建 + 上传服务器部署脚本
# 用法：
#   .\deploy.ps1 -ServerUser root -ServerHost 47.108.250.118 [-Tag <版本>] [-SshPort 22]
# 前置条件：
#   1. 本地 Docker Desktop 已启动
#   2. 已配置到服务器的 SSH 免密登录（ssh-copy-id 或手动追加公钥）
#   3. 服务器上有 compose.prod.yml 与 .env（LFN_SESSION_SECRET 等）

param(
    [Parameter(Mandatory = $true)][string]$ServerUser,
    [Parameter(Mandatory = $true)][string]$ServerHost,
    [int]$SshPort = 22,
    [string]$Tag = "latest",
    [string]$RemoteDir = "/opt/love-for-nai"
)

$ErrorActionPreference = "Stop"
$image = "love-for-nai:$Tag"
$archive = "love-for-nai-$Tag.tar"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

Step "检查 Docker 引擎"
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker 引擎未运行，请先启动 Docker Desktop" }

Step "构建镜像 $image"
docker build -t $image .
if ($LASTEXITCODE -ne 0) { throw "镜像构建失败" }

Step "导出镜像到 $archive"
docker save -o $archive $image
if ($LASTEXITCODE -ne 0) { throw "镜像导出失败" }
$size = "{0:N0} MB" -f ((Get-Item $archive).Length / 1MB)
Write-Host "归档大小：$size"

Step "上传镜像到 $ServerUser@$ServerHost"
scp -P $SshPort $archive "${ServerUser}@${ServerHost}:/tmp/"
if ($LASTEXITCODE -ne 0) { throw "镜像上传失败" }

Step "服务器端导入镜像并重启服务"
ssh -p $SshPort "${ServerUser}@${ServerHost}" "docker load -i /tmp/$archive && rm -f /tmp/$archive && cd $RemoteDir && LFN_IMAGE=$image docker compose -f compose.prod.yml up -d && docker image prune -f"
if ($LASTEXITCODE -ne 0) { throw "服务器部署失败" }

Remove-Item $archive -Force
Step "部署完成：$image 已在 $ServerHost 上运行"
