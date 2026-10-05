#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""通过 paramiko 部署 LFN 镜像到生产服务器。
用法: python scripts/deploy-paramiko.py <image-tag>
依赖 .rsh.py 中的 SSH 凭据（HOST/USER/PASS）。
"""
import sys
import os
import subprocess
import time
import importlib.util
from pathlib import Path

def load_ssh_config():
    """从 .rsh.py 加载 SSH 配置。"""
    rsh_path = Path(__file__).parent.parent / ".rsh.py"
    if not rsh_path.exists():
        raise FileNotFoundError(f".rsh.py 未找到: {rsh_path}")
    spec = importlib.util.spec_from_file_location("rsh", rsh_path)
    rsh = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rsh)
    return rsh.HOST, rsh.PORT, rsh.USER, rsh.PASS

def run_local(cmd):
    """本地执行命令。"""
    print(f"[LOCAL] {cmd}")
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"STDOUT: {result.stdout}")
        print(f"STDERR: {result.stderr}")
        raise RuntimeError(f"命令失败 (exit {result.returncode}): {cmd}")
    return result.stdout

def run_remote(client, cmd, timeout=600):
    """远程执行命令。"""
    print(f"[REMOTE] {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout, get_pty=False)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out:
        print(out.rstrip())
    if err:
        print(err.rstrip(), file=sys.stderr)
    if exit_code != 0:
        raise RuntimeError(f"远程命令失败 (exit {exit_code}): {cmd}")
    return out

def upload_file(sftp, local_path, remote_path):
    """SFTP 上传文件。"""
    print(f"[UPLOAD] {local_path} -> {remote_path}")
    sftp.put(str(local_path), remote_path)

def main():
    if len(sys.argv) < 2:
        print("用法: python scripts/deploy-paramiko.py <image-tag>", file=sys.stderr)
        sys.exit(2)
    
    import paramiko
    
    tag = sys.argv[1]
    image_name = f"love-for-nai:{tag}"
    archive_name = f"love-for-nai-{tag}.tar"
    archive_gz = f"{archive_name}.gz"
    
    print(f"\n==> 1. 导出镜像 {image_name}")
    run_local(f"docker save -o {archive_name} {image_name}")
    archive_size = Path(archive_name).stat().st_size / (1024 * 1024)
    print(f"归档大小: {archive_size:.1f} MB")
    
    print(f"\n==> 2. 压缩归档")
    gzip_exe = r"C:\Program Files\Git\usr\bin\gzip.exe"
    run_local(f'"{gzip_exe}" -f {archive_name}')
    gz_size = Path(archive_gz).stat().st_size / (1024 * 1024)
    print(f"压缩后: {gz_size:.1f} MB")
    
    print(f"\n==> 3. 连接服务器并上传")
    host, port, user, password = load_ssh_config()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password,
                   timeout=30, banner_timeout=90, auth_timeout=30,
                   allow_agent=False, look_for_keys=False)
    
    try:
        sftp = client.open_sftp()
        remote_tmp = f"/tmp/{archive_gz}"
        upload_file(sftp, archive_gz, remote_tmp)
        sftp.close()
        
        print(f"\n==> 4. 解压并导入镜像")
        run_remote(client, f"gunzip -f {remote_tmp}")
        remote_tar = f"/tmp/{archive_name}"
        
        print("后台启动 docker load...")
        run_remote(client, f"nohup sh -c 'docker load -i {remote_tar} > /tmp/lfn-load.log 2>&1 &'")
        
        print("等待镜像导入完成...")
        for _ in range(60):
            time.sleep(5)
            out = run_remote(client, f"docker image ls {image_name} --format '{{{{.Repository}}}}:{{{{.Tag}}}}'")
            if image_name in out:
                print(f"镜像 {image_name} 已就绪")
                break
        else:
            raise TimeoutError("镜像导入超时（5分钟）")
        
        run_remote(client, f"rm -f {remote_tar}")
        
        print(f"\n==> 5. 备份并更新 compose.prod.yml")
        deploy_dir = "/home/ikun/love-for-nai-deploy"
        backup_name = f"compose.prod.yml.bak-history-fix-{time.strftime('%Y%m%d')}"
        run_remote(client, f"cd {deploy_dir} && cp compose.prod.yml {backup_name}")
        
        sed_cmd = f"cd {deploy_dir} && sed -i 's|image: love-for-nai:.*|image: {image_name}|' compose.prod.yml"
        run_remote(client, sed_cmd)
        
        print(f"\n==> 6. 重启容器")
        run_remote(client, f"cd {deploy_dir} && docker compose -f compose.prod.yml up -d", timeout=120)
        
        print(f"\n==> 7. 清理旧镜像")
        run_remote(client, "docker image prune -f")
        
    finally:
        client.close()
    
    Path(archive_gz).unlink(missing_ok=True)
    print(f"\n✓ 部署完成: {image_name} 已在 {host} 运行")

if __name__ == "__main__":
    main()
