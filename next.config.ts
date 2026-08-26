import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // undici 只在运行时按需引入，需显式声明才会进入 standalone 产物。
  outputFileTracingIncludes: {
    "/api/tags": ["./node_modules/undici/**"],
    "/api/assistant/tags": ["./node_modules/undici/**"],
  },
  devIndicators: {
    position: "bottom-left",
  },
};

export default nextConfig;
