import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["development"] },
  test: { include: ["packages/*/test/**/*.test.ts", "tools/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"], testTimeout: 30000 },
});
