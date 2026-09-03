/**
 * 适配器注册表
 * 管理运行时的适配器实例和端点配置
 */

import type { AuthAdapter, ImageAdapter, WalletAdapter, EndpointConfig } from "./types";
import { adapterFactory } from "./factory";
import { db } from "@/lib/db";

class AdapterRegistry {
  private authAdapters: Map<string, AuthAdapter> = new Map();
  private imageAdapters: Map<string, ImageAdapter> = new Map();
  private walletAdapters: Map<string, WalletAdapter> = new Map();
  private initialized = false;

  async init() {
    if (this.initialized) return;
    
    // 从数据库加载端点配置
    try {
      const configs = await db.any<EndpointConfig>(
        "SELECT * FROM lfn_endpoints WHERE enabled = true ORDER BY priority DESC"
      );
      
      for (const config of configs) {
        try {
          switch (config.type) {
            case "auth":
              this.authAdapters.set(config.id, adapterFactory.createAuthAdapter(config));
              break;
            case "image":
              this.imageAdapters.set(config.id, adapterFactory.createImageAdapter(config));
              break;
            case "wallet":
              this.walletAdapters.set(config.id, adapterFactory.createWalletAdapter(config));
              break;
          }
        } catch (error) {
          console.error(`Failed to create adapter for endpoint ${config.id}:`, error);
        }
      }
    } catch (error) {
      console.warn("Failed to load endpoint configs from database, using environment fallback:", error);
      this.loadFromEnvironment();
    }

    this.initialized = true;
  }

  private loadFromEnvironment() {
    // 向后兼容：从环境变量加载默认配置
    const newApiBase = process.env.NEWAPI_BASE_URL?.trim();
    const newApiToken = process.env.LFN_ADMIN_TOKEN?.trim();
    const gatewayUrl = process.env.LFN_AFF_GATEWAY_URL?.trim();
    const gatewayToken = process.env.LFN_AFF_GATEWAY_TOKEN?.trim();
    const genericImageUrl = process.env.LFN_IMAGE_PROVIDER_URL?.trim();
    const genericImageToken = process.env.LFN_IMAGE_PROVIDER_TOKEN?.trim();

    if (newApiBase && newApiToken) {
      const authConfig: EndpointConfig = {
        id: "env-newapi-auth",
        type: "auth",
        adapterType: "newapi",
        name: "NewAPI (环境变量)",
        enabled: true,
        config: { baseUrl: newApiBase, token: newApiToken },
        priority: 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.authAdapters.set(authConfig.id, adapterFactory.createAuthAdapter(authConfig));

      const walletConfig: EndpointConfig = {
        ...authConfig,
        id: "env-newapi-wallet",
        type: "wallet",
      };
      this.walletAdapters.set(walletConfig.id, adapterFactory.createWalletAdapter(walletConfig));
    }

    if (gatewayUrl && gatewayToken) {
      const imageConfig: EndpointConfig = {
        id: "env-gateway-image",
        type: "image",
        adapterType: "openai_compat",
        name: "NovelAI Gateway (环境变量)",
        enabled: true,
        config: { baseUrl: gatewayUrl, token: gatewayToken },
        priority: 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.imageAdapters.set(imageConfig.id, adapterFactory.createImageAdapter(imageConfig));
    } else if (genericImageUrl && genericImageToken) {
      const imageConfig: EndpointConfig = {
        id: "env-generic-image",
        type: "image",
        adapterType: "openai_compat",
        name: "OpenAI 兼容图像接口 (环境变量)",
        enabled: true,
        config: { baseUrl: genericImageUrl, token: genericImageToken },
        priority: 90,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.imageAdapters.set(imageConfig.id, adapterFactory.createImageAdapter(imageConfig));
    }
  }

  // 获取主认证适配器（优先级最高的已启用适配器）
  async getAuthAdapter(): Promise<AuthAdapter | null> {
    await this.init();
    const adapters = Array.from(this.authAdapters.values());
    return adapters.length > 0 ? adapters[0] : null;
  }

  // 获取主图像适配器
  async getImageAdapter(): Promise<ImageAdapter | null> {
    await this.init();
    const adapters = Array.from(this.imageAdapters.values());
    return adapters.length > 0 ? adapters[0] : null;
  }

  // 获取主钱包适配器
  async getWalletAdapter(): Promise<WalletAdapter | null> {
    await this.init();
    const adapters = Array.from(this.walletAdapters.values());
    return adapters.length > 0 ? adapters[0] : null;
  }

  // 获取所有已启用的适配器
  async getAllAdapters() {
    await this.init();
    return {
      auth: Array.from(this.authAdapters.values()),
      image: Array.from(this.imageAdapters.values()),
      wallet: Array.from(this.walletAdapters.values()),
    };
  }

  // 重新加载配置
  async reload() {
    this.authAdapters.clear();
    this.imageAdapters.clear();
    this.walletAdapters.clear();
    this.initialized = false;
    await this.init();
  }
}

export const registry = new AdapterRegistry();
