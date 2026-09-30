const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  testMatch: "game-system.spec.js",
  timeout: 180000,
  expect: {
    timeout: 10000
  },
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.METAAVES_BASE_URL || "http://localhost:8080",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1600, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  }
});
