/**
 * LFN 平台适配器类型定义
 * 
 * 适配器系统让 LFN 可以接入不同的认证、图像、钱包服务，
 * 管理员通过管理中心配置端点和凭证。
 */

// ============= 认证适配器 =============

export type AuthAdapterType = "newapi" | "local" | "oauth2" | "custom";

export type AuthUserInfo = {
  id: number | string;
  username: string;
  email?: string;
  displayName?: string;
  role?: number;
  status?: number;
  quota?: number;
  group?: string;
  metadata?: Record<string, unknown>;
};

export type AuthAdapter = {
  type: AuthAdapterType;
  name: string;
  
  // 用户认证
  login(username: string, password: string): Promise<{ token: string; user: AuthUserInfo }>;
  register?(username: string, password: string, metadata?: Record<string, unknown>): Promise<{ token: string; user: AuthUserInfo }>;
  verifyToken(token: string): Promise<AuthUserInfo | null>;
  logout?(token: string): Promise<void>;
  
  // 用户管理
  getUser?(id: number | string): Promise<AuthUserInfo | null>;
  listUsers?(filters?: { role?: number; status?: number; search?: string }): Promise<AuthUserInfo[]>;
  updateUser?(id: number | string, updates: Partial<AuthUserInfo>): Promise<void>;
  
  // 密钥管理（如果支持）
  listKeys?(userId: number | string): Promise<Array<{ key: string; name?: string; createdAt?: string }>>;
  createKey?(userId: number | string, name?: string): Promise<string>;
  deleteKey?(key: string): Promise<void>;
  resolveKeyToUser?(key: string): Promise<AuthUserInfo | null>;
};

// ============= 图像生成适配器 =============

export type ImageAdapterType = "openai_compat" | "stability_ai" | "replicate" | "custom";

export type ImageGenerationRequest = {
  model: string;
  prompt: string;
  width: number;
  height: number;
  samples: number;
  steps?: number;
  strength?: number;
  negativePrompt?: string;
  seed?: number;
  operation?: "generate" | "img2img" | "inpainting" | "upscale";
  referenceImages?: string[];
  characterPrompts?: Array<Record<string, unknown>>;
  extra?: Record<string, unknown>;
};

export type ImageGenerationResponse = {
  images: Array<{
    url?: string;
    b64_json?: string;
  }>;
  usage?: {
    model: string;
    width: number;
    height: number;
    samples: number;
    cost?: number;
  };
  metadata?: Record<string, unknown>;
};

export type ImageAdapter = {
  type: ImageAdapterType;
  name: string;
  
  // 图像生成
  generate(request: ImageGenerationRequest, token: string): Promise<ImageGenerationResponse>;
  
  // 模型列表
  listModels?(): Promise<Array<{ id: string; name: string; capabilities: string[] }>>;
  
  // 计费信息（返回生成成本，用于 LFN 内部计费）
  estimateCost?(request: ImageGenerationRequest): Promise<number>;
};

// ============= 钱包/计费适配器 =============

export type WalletAdapterType = "newapi" | "stripe" | "custom";

export type WalletBalance = {
  userId: number | string;
  upstreamBalance?: number;  // 上游余额（如 NewAPI quota）
  credits?: number;          // LFN 内部创作额度
  packages?: number;         // 图包额度
  metadata?: Record<string, unknown>;
};

export type WalletTransaction = {
  id: string;
  userId: number | string;
  amount: number;
  type: "credit" | "debit" | "refund";
  source: "purchase" | "admin" | "referral" | "check_in" | "image_generation" | "refund" | "custom";
  description: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type WalletAdapter = {
  type: WalletAdapterType;
  name: string;
  
  // 余额查询
  getBalance(userId: number | string): Promise<WalletBalance>;
  
  // 扣费
  charge(userId: number | string, amount: number, description: string, metadata?: Record<string, unknown>): Promise<WalletTransaction>;
  
  // 退款
  refund?(transactionId: string, amount: number): Promise<WalletTransaction>;
  
  // 调整余额（管理员操作）
  adjustBalance?(userId: number | string, amount: number, description: string): Promise<void>;
  
  // 交易记录
  listTransactions?(userId: number | string, options?: { limit?: number; offset?: number }): Promise<WalletTransaction[]>;
  
  // 使用日志（如果支持）
  logUsage?(userId: number | string, model: string, usage: Record<string, unknown>): Promise<void>;
};

// ============= 端点配置 =============

export type EndpointConfig = {
  id: string;
  type: "auth" | "image" | "wallet";
  adapterType: string;
  name: string;
  enabled: boolean;
  config: {
    baseUrl?: string;
    token?: string;
    apiKey?: string;
    secretKey?: string;
    extra?: Record<string, unknown>;
  };
  priority: number;  // 多个同类端点时的优先级
  createdAt: string;
  updatedAt: string;
};

// ============= 适配器工厂 =============

export type AdapterFactory = {
  createAuthAdapter(config: EndpointConfig): AuthAdapter;
  createImageAdapter(config: EndpointConfig): ImageAdapter;
  createWalletAdapter(config: EndpointConfig): WalletAdapter;
};
