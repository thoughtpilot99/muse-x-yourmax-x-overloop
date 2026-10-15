import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      SP_DB_PATH: ":memory:",
      MODEL_API_KEY: "test-muse",
      OVERLOOP_API_KEY: "test-overloop",
      OVERLOOP_CAMPAIGN_ID: "42",
      SP_JOBS_ENABLED: "0",
      SP_SENDING_ENABLED: "1",
    },
  },
});
