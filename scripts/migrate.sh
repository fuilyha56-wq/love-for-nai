#!/bin/bash
set -e

echo "=== LFN 数据库迁移工具 ==="

# 读取数据库连接
if [ -z "$DATABASE_URL" ] && [ -z "$NEWAPI_DB_URL" ]; then
  echo "错误: 未设置 DATABASE_URL 或 NEWAPI_DB_URL 环境变量"
  echo "请在 .env 文件中配置数据库连接字符串"
  exit 1
fi

DB_URL="${DATABASE_URL:-$NEWAPI_DB_URL}"
echo "使用数据库: ${DB_URL%%@*}@***"

# 运行迁移
echo ""
echo "运行适配器系统迁移 (003_adapter_system.sql)..."
psql "$DB_URL" -f migrations/003_adapter_system.sql

echo ""
echo "✓ 迁移完成"
echo ""
echo "现在可以通过管理中心 -> 平台配置 添加自定义端点"
