import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_wxdrjvlqiqtzdazadfxp",
  dirs: ["./trigger"],
  runtime: "node",
  maxDuration: 7200,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30000,
      factor: 2,
      randomize: true
    }
  }
});
