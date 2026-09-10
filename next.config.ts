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
    "/ai/generate-image-stream": ["./node_modules/pg/**", "./node_modules/pg-protocol/**", "./node_modules/pg-connection-string/**", "./node_modules/pg-pool/**", "./node_modules/pg-types/**", "./node_modules/pg-int8/**", "./node_modules/pg-uint8/**", "./node_modules/pgpass/**", "./node_modules/@msgpack/msgpack/**"],
    "/api/images/operate": ["./node_modules/pg/**", "./node_modules/pg-protocol/**", "./node_modules/pg-connection-string/**", "./node_modules/pg-pool/**", "./node_modules/pg-types/**", "./node_modules/pg-int8/**", "./node_modules/pg-uint8/**", "./node_modules/pgpass/**", "./node_modules/@msgpack/msgpack/**"],
    "/ai/encode-vibe": ["./node_modules/pg/**", "./node_modules/pg-protocol/**", "./node_modules/pg-connection-string/**", "./node_modules/pg-pool/**", "./node_modules/pg-types/**", "./node_modules/pg-int8/**", "./node_modules/pg-uint8/**", "./node_modules/pgpass/**"],
    "/ai/upscale": ["./node_modules/pg/**", "./node_modules/pg-protocol/**", "./node_modules/pg-connection-string/**", "./node_modules/pg-pool/**", "./node_modules/pg-types/**", "./node_modules/pg-int8/**", "./node_modules/pg-uint8/**", "./node_modules/pgpass/**"],
    "/ai/annotate-image": ["./node_modules/pg/**", "./node_modules/pg-protocol/**", "./node_modules/pg-connection-string/**", "./node_modules/pg-pool/**", "./node_modules/pg-types/**", "./node_modules/pg-int8/**", "./node_modules/pg-uint8/**", "./node_modules/pgpass/**"],
    "/ai/augment-image": ["./node_modules/pg/**", "./node_modules/pg-protocol/**", "./node_modules/pg-connection-string/**", "./node_modules/pg-pool/**", "./node_modules/pg-types/**", "./node_modules/pg-int8/**", "./node_modules/pg-uint8/**", "./node_modules/pgpass/**"],
    "/user/subscription": ["./node_modules/pg/**", "./node_modules/pg-protocol/**", "./node_modules/pg-connection-string/**", "./node_modules/pg-pool/**", "./node_modules/pg-types/**", "./node_modules/pg-int8/**", "./node_modules/pg-uint8/**", "./node_modules/pgpass/**"],
    "/user/account": ["./node_modules/pg/**", "./node_modules/pg-protocol/**", "./node_modules/pg-connection-string/**", "./node_modules/pg-pool/**", "./node_modules/pg-types/**", "./node_modules/pg-int8/**", "./node_modules/pg-uint8/**", "./node_modules/pgpass/**"],
    "/user/objects": ["./node_modules/pg/**", "./node_modules/pg-protocol/**", "./node_modules/pg-connection-string/**", "./node_modules/pg-pool/**", "./node_modules/pg-types/**", "./node_modules/pg-int8/**", "./node_modules/pg-uint8/**", "./node_modules/pgpass/**"],
  },
  devIndicators: {
    position: "bottom-left",
  },
  // 本机内嵌浏览器以 127.0.0.1 访问 dev server 时会被当作跨域，
  // 放行本机回环地址，避免 dev 资源（含 HMR）被拦截导致无法水合。
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
