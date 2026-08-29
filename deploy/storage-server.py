#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LFN 远程历史图片存储服务。

极简单文件 HTTP 服务，部署在二级存储节点（当前为华为云 ECS）：
- PUT    /objects/{userId}/{file}   上传（Bearer 鉴权）
- GET    /objects/{userId}/{file}   读取
- DELETE /objects/{userId}/{file}   删除

鉴权：环境变量 LFN_STORAGE_TOKEN，请求需带 Authorization: Bearer <token>。
存储目录：环境变量 LFN_STORAGE_DIR（默认 /var/lib/lfn-storage）。
端口：环境变量 LFN_STORAGE_PORT（默认 8300）。

用法（裸跑）:  LFN_STORAGE_TOKEN=secret python3 storage-server.py
推荐用 systemd 或 docker 运行，见部署脚本。
"""
import hashlib
import hmac
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("LFN_STORAGE_TOKEN", "")
STORAGE_DIR = os.environ.get("LFN_STORAGE_DIR", "/var/lib/lfn-storage")
PORT = int(os.environ.get("LFN_STORAGE_PORT", "8300"))

# 路径形如 {userId}/{uuid}.{ext}；严格白名单，防目录穿越。
OBJECT_RE = re.compile(r"^/objects/([1-9]\d{0,9})/([A-Za-z0-9._-]{8,128})$")

CONTENT_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
}


def authorized(header: str | None) -> bool:
    if not TOKEN:
        return False
    if not header or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[len("Bearer "):], TOKEN)


def object_path(user_id: str, file_name: str) -> str:
    # 两个分量都已通过正则白名单，这里只做拼接。
    return os.path.join(STORAGE_DIR, user_id, file_name)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LFN-Storage/1.0"

    def _send(self, status: int, body: bytes = b"", content_type: str = "text/plain"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body and self.command != "HEAD":
            self.wfile.write(body)

    def _resolve(self):
        match = OBJECT_RE.match(self.path)
        if not match:
            return None
        return match.group(1), match.group(2)

    def do_PUT(self):
        if not authorized(self.headers.get("Authorization")):
            self._send(401, b"unauthorized")
            return
        resolved = self._resolve()
        if not resolved:
            self._send(400, b"bad object path")
            return
        user_id, file_name = resolved
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send(400, b"bad length")
            return
        # 单张 NAI 图片按 832x1216 PNG 估计不超过 25MB，留一倍余量。
        if length <= 0 or length > 50 * 1024 * 1024:
            self._send(413, b"payload too large")
            return
        target = object_path(user_id, file_name)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        temp = f"{target}.tmp"
        remaining = length
        with open(temp, "wb") as handle:
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 1024 * 256))
                if not chunk:
                    break
                handle.write(chunk)
                remaining -= len(chunk)
        if remaining > 0:
            os.unlink(temp)
            self._send(400, b"incomplete body")
            return
        os.replace(temp, target)
        self._send(200, b"ok")

    def do_GET(self):
        if not authorized(self.headers.get("Authorization")):
            self._send(401, b"unauthorized")
            return
        resolved = self._resolve()
        if not resolved:
            self._send(400, b"bad object path")
            return
        user_id, file_name = resolved
        target = object_path(user_id, file_name)
        if not os.path.isfile(target):
            self._send(404, b"not found")
            return
        extension = file_name.rsplit(".", 1)[-1].lower()
        with open(target, "rb") as handle:
            data = handle.read()
        self._send(200, data, CONTENT_TYPES.get(extension, "application/octet-stream"))

    def do_DELETE(self):
        if not authorized(self.headers.get("Authorization")):
            self._send(401, b"unauthorized")
            return
        resolved = self._resolve()
        if not resolved:
            self._send(400, b"bad object path")
            return
        user_id, file_name = resolved
        target = object_path(user_id, file_name)
        if os.path.isfile(target):
            os.unlink(target)
        self._send(200, b"ok")

    def log_message(self, fmt, *args):
        # 只记访问行，不写 body/鉴权头。
        print(f"{self.address_string()} {self.command} {self.path} - {fmt % args}")


def main():
    if not TOKEN:
        print("ERR: LFN_STORAGE_TOKEN is required", flush=True)
        raise SystemExit(1)
    os.makedirs(STORAGE_DIR, exist_ok=True)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"LFN storage listening on :{PORT}, dir={STORAGE_DIR}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
