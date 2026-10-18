import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript sources.
  transpilePackages: [
    "@shortloop/contracts",
    "@shortloop/db",
    "@shortloop/pipeline",
    "@shortloop/providers",
    "@shortloop/render",
    "@shortloop/worker",
  ],
  // Native / Node-only deps stay as runtime requires (not bundled).
  serverExternalPackages: [
    "@electric-sql/pglite",
    "pg",
    "bullmq",
    "ioredis",
    "msedge-tts",
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
  ],
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default config;
