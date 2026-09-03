/**
 * 适配器工厂
 * 根据端点配置创建对应的适配器实例
 */

import type { AdapterFactory, AuthAdapter, ImageAdapter, WalletAdapter, EndpointConfig } from "./types";
import { createNewApiAuthAdapter } from "./auth/newapi";
import { createLocalAuthAdapter } from "./auth/local";
import { createOpenAICompatImageAdapter } from "./image/openai-compat";
import { createNewApiWalletAdapter } from "./wallet/newapi";

export const adapterFactory: AdapterFactory = {
  createAuthAdapter(config: EndpointConfig): AuthAdapter {
    switch (config.adapterType) {
      case "newapi":
        return createNewApiAuthAdapter(config);
      case "local":
        return createLocalAuthAdapter(config);
      default:
        throw new Error(`Unsupported auth adapter type: ${config.adapterType}`);
    }
  },

  createImageAdapter(config: EndpointConfig): ImageAdapter {
    switch (config.adapterType) {
      case "openai_compat":
      case "gateway":
        return createOpenAICompatImageAdapter(config);
      default:
        throw new Error(`Unsupported image adapter type: ${config.adapterType}`);
    }
  },

  createWalletAdapter(config: EndpointConfig): WalletAdapter {
    switch (config.adapterType) {
      case "newapi":
        return createNewApiWalletAdapter(config);
      default:
        throw new Error(`Unsupported wallet adapter type: ${config.adapterType}`);
    }
  },
};
