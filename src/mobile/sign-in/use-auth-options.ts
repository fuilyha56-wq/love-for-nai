"use client";

import { useCallback, useEffect, useState } from "react";
import { registrationMethods, type AuthPolicy } from "@/lib/auth-policy";

export type AuthMode = "password" | "token" | "register";
export function useAuthOptions() {
  const [policy, setPolicy] = useState<AuthPolicy | null>(null);
  const [provider, setProvider] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/auth/policy", {
        cache: "no-store",
        signal,
      });
      const result = await response.json();
      if (!response.ok || !result.policy)
        throw new Error("登录配置读取失败，请重试");
      setPolicy(result.policy);
      setProvider(result.provider);
      setError("");
    } catch {
      if (signal?.aborted) return;
      setPolicy(null);
      setError("登录配置读取失败，请重试");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => reload(controller.signal));
    const refresh = () => {
      if (document.visibilityState === "visible")
        void reload(controller.signal);
    };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [reload]);
  const methods = policy ? registrationMethods(policy) : [];
  const modes: Array<[AuthMode, string]> = [
    ...(policy?.passwordLoginEnabled
      ? [["password", "账号密码"] as [AuthMode, string]]
      : []),
    ...(policy?.tokenLoginEnabled && provider !== "local"
      ? [["token", "访问令牌"] as [AuthMode, string]]
      : []),
    ...(methods.length ? [["register", "注册"] as [AuthMode, string]] : []),
  ];
  return { policy, provider, methods, modes, loading, error, reload };
}
