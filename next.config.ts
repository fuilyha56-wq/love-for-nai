import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // undici/pg 只在运行时按需引入，需显式声明才会进入 standalone 产物。
  outputFileTracingIncludes: {
    "/api/tags": ["./node_modules/undici/**"],
    "/api/assistant/tags": ["./node_modules/undici/**"],
    "/v1/images/generations": ["./node_modules/pg/**", "./node_modules/pg-protocol/**", "./node_modules/pg-connection-string/**", "./node_modules/pg-pool/**", "./node_modules/pg-types/**", "./node_modules/pg-int8/**", "./node_modules/pg-uint8/**", "./node_modules/pgpass/**"],
    "/v1/images/edits": ["./node_modules/pg/**", "./node_modules/pg-protocol/**", "./node_modules/pg-connection-string/**", "./node_modules/pg-pool/**", "./node_modules/pg-types/**", "./node_modules/pg-int8/**", "./node_modules/pg-uint8/**", "./node_modules/pgpass/**"],
    "/ai/generate-image": ["./node_modules/pg/**", "./node_modules/pg-protocol/**", "./node_modules/pg-connection-string/**", "./node_modules/pg-pool/**", "./node_modules/pg-types/**", "./node_modules/pg-int8/**", "./node_modules/pg-uint8/**", "./node_modules/pgpass/**"],
    "/ai/augment-image": ["./node_modules/pg/**", "./node_modules/pg-protocol/**", "./node_modules/pg-connection-string/**", "./node_modules/pg-pool/**", "./node_modules/pg-types/**", "./node_modules/pg-int8/**", "./node_modules/pg-uint8/**", "./node_modules/pgpass/**"],
  },
  devIndicators: {
    position: "bottom-left",
  },
};

export default nextConfig;
