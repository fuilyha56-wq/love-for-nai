-- LFN 适配器系统数据库 schema

-- 端点配置表
CREATE TABLE IF NOT EXISTS lfn_endpoints (
  id VARCHAR(100) PRIMARY KEY,
  type VARCHAR(20) NOT NULL CHECK (type IN ('auth', 'image', 'wallet')),
  adapter_type VARCHAR(50) NOT NULL,
  name VARCHAR(200) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lfn_endpoints_type_priority ON lfn_endpoints(type, priority DESC) WHERE enabled = true;

-- 本地用户表（用于 local auth adapter）
CREATE TABLE IF NOT EXISTS lfn_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(200) NOT NULL,
  email VARCHAR(200),
  display_name VARCHAR(200),
  role INTEGER NOT NULL DEFAULT 1,
  status INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lfn_users_username ON lfn_users(username);
CREATE INDEX IF NOT EXISTS idx_lfn_users_email ON lfn_users(email) WHERE email IS NOT NULL;

-- 本地会话表
CREATE TABLE IF NOT EXISTS lfn_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES lfn_users(id) ON DELETE CASCADE,
  token VARCHAR(200) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lfn_sessions_token ON lfn_sessions(token);
CREATE INDEX IF NOT EXISTS idx_lfn_sessions_user_id ON lfn_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_lfn_sessions_expires ON lfn_sessions(expires_at);

-- 自动清理过期会话
CREATE OR REPLACE FUNCTION cleanup_expired_sessions() RETURNS void AS $$
BEGIN
  DELETE FROM lfn_sessions WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- AFF 使用日志表（补充现有 aff_transactions）
CREATE TABLE IF NOT EXISTS aff_usage_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  model VARCHAR(100) NOT NULL,
  usage JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aff_usage_logs_user_created ON aff_usage_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aff_usage_logs_model ON aff_usage_logs(model);

COMMENT ON TABLE lfn_endpoints IS 'LFN 适配器端点配置';
COMMENT ON TABLE lfn_users IS 'LFN 本地用户（用于 local auth adapter）';
COMMENT ON TABLE lfn_sessions IS 'LFN 本地会话';
COMMENT ON TABLE aff_usage_logs IS 'AFF 使用日志（供钱包适配器使用）';
