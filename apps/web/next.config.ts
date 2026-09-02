import type { NextConfig } from "next";
export default {
  output: "standalone",
  experimental: { serverActions: { bodySizeLimit: "100mb" } },
  transpilePackages: ["@skilled/core"],
} satisfies NextConfig;
