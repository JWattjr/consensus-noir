import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const sourceRoot = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  root: projectRoot,
  // This app has one alias. Resolving it directly keeps Vitest from asking
  // vite-tsconfig-paths to crawl parent workspaces on Windows checkouts.
  resolve: { alias: { "@": sourceRoot } },
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    // One jsdom environment per worker is expensive, and letting Vitest use
    // every core meant eight of them competing for twelve. Under that
    // contention a component that settles instantly in isolation could take
    // longer than the async budget, which surfaced as an occasional failure
    // in the heaviest suite rather than as a real defect. Capping the pool
    // trades a little wall-clock time for a deterministic result, which is
    // the right trade for a suite other people run once.
    poolOptions: { forks: { maxForks: 4 } },
  },
});
