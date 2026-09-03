import { affGateway, newApiBaseUrl } from "@/lib/newapi";
import {
  getRuntimeSettings,
  runtimeAffGateway,
  runtimeAuthProvider,
  runtimeGenericImage,
  runtimeImageEndpoint,
  type AuthProviderId,
} from "@/lib/runtime-config";

export type { AuthProviderId };
export type ImageProviderId = "newapi" | "gateway" | "openai_compat" | "none";

export type PlatformCapabilities = {
  auth: {
    provider: AuthProviderId;
    label: string;
    login: boolean;
    register: boolean;
    groups: boolean;
    keys: boolean;
  };
  image: {
    provider: ImageProviderId;
    label: string;
    enabled: boolean;
  };
  wallet: {
    upstreamBalance: boolean;
    credits: boolean;
    packages: boolean;
    usageLogs: boolean;
  };
  admin: {
    users: boolean;
    announcements: boolean;
    credits: boolean;
    platform: boolean;
  };
  labels: {
    upstreamBalance: string;
    credits: string;
    packages: string;
  };
};

function configured(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function authProviderId(): AuthProviderId {
  const explicit = process.env.LFN_AUTH_PROVIDER?.trim().toLowerCase();
  if (explicit === "local" || explicit === "newapi") return explicit;
  return "newapi";
}

export async function resolvedAuthProviderId(): Promise<AuthProviderId> {
  try {
    return await runtimeAuthProvider();
  } catch {
    return authProviderId();
  }
}

export function genericImageProvider(): { baseUrl: string; token: string } | null {
  const baseUrl = process.env.LFN_IMAGE_PROVIDER_URL?.trim().replace(/\/+$/, "");
  const token = process.env.LFN_IMAGE_PROVIDER_TOKEN?.trim();
  return baseUrl && token ? { baseUrl, token } : null;
}

export async function resolvedGenericImageProvider(): Promise<{
  baseUrl: string;
  token: string;
} | null> {
  try {
    return await runtimeGenericImage();
  } catch {
    return genericImageProvider();
  }
}

export function imageProviderId(): ImageProviderId {
  if (affGateway()) return "gateway";
  if (genericImageProvider()) return "openai_compat";
  if (authProviderId() === "newapi" && configured(process.env.NEWAPI_BASE_URL))
    return "newapi";
  return "none";
}

export function getPlatformCapabilities(): PlatformCapabilities {
  const auth = authProviderId();
  const image = imageProviderId();
  const gateway = Boolean(affGateway());
  const newapi = auth === "newapi";
  const packages = Boolean(process.env.LFN_ADMIN_TOKEN?.trim() && gateway);
  return {
    auth: {
      provider: auth,
      label: auth === "newapi" ? "NewAPI 账号" : "本地账号",
      login: true,
      register: true,
      groups: newapi,
      keys: newapi,
    },
    image: {
      provider: image,
      label:
        image === "gateway"
          ? "NovelAI Gateway"
          : image === "openai_compat"
            ? "OpenAI 兼容图像接口"
            : image === "newapi"
              ? "NewAPI 图像接口"
              : "未配置图像上游",
      enabled: image !== "none",
    },
    wallet: {
      upstreamBalance: newapi,
      credits: true,
      packages,
      usageLogs: newapi,
    },
    admin: {
      users: true,
      announcements: true,
      credits: true,
      platform: true,
    },
    labels: {
      upstreamBalance: newapi ? "NewAPI 余额" : "账户余额",
      credits: newapi ? "AFF" : "创作额度",
      packages: "图包额度",
    },
  };
}

export function newApiConfigured(): boolean {
  return authProviderId() === "newapi" && Boolean(newApiBaseUrl());
}

export async function getResolvedPlatformCapabilities(): Promise<PlatformCapabilities> {
  const settings = await getRuntimeSettings();
  const auth = settings.authProvider;
  const imageEndpoint = await runtimeImageEndpoint();
  const gateway = await runtimeAffGateway();
  const generic = await runtimeGenericImage();
  const image: ImageProviderId =
    imageEndpoint?.adapterType === "gateway" || (!imageEndpoint && gateway)
      ? "gateway"
      : imageEndpoint || generic
        ? "openai_compat"
        : auth === "newapi" && configured(settings.newApiBaseUrl)
          ? "newapi"
          : "none";
  const newapi = auth === "newapi";
  const packages = Boolean(settings.newApiAdminToken && image === "gateway");
  return {
    auth: {
      provider: auth,
      label: auth === "newapi" ? "NewAPI 账号" : "本地账号",
      login: true,
      register: true,
      groups: newapi,
      keys: newapi,
    },
    image: {
      provider: image,
      label:
        image === "gateway"
          ? "NovelAI Gateway"
          : image === "openai_compat"
            ? "OpenAI 兼容图像接口"
            : image === "newapi"
              ? "NewAPI 图像接口"
              : "未配置图像上游",
      enabled: image !== "none",
    },
    wallet: {
      upstreamBalance: newapi,
      credits: true,
      packages,
      usageLogs: newapi,
    },
    admin: {
      users: true,
      announcements: true,
      credits: true,
      platform: true,
    },
    labels: {
      upstreamBalance: newapi ? "NewAPI 余额" : "账户余额",
      credits: newapi ? "AFF" : "创作额度",
      packages: "图包额度",
    },
  };
}
