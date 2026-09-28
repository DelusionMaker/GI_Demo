import { defineConfig, devices } from '@playwright/test'

/** 用独立端口，避免与手动 `npm run dev`（5173）互相干扰 */
const PORT = 5199
const BASE_URL = `http://localhost:${PORT}`

/**
 * 浏览器来源：
 * - 默认 `chrome` / `msedge` = 直接驱动系统已安装的浏览器，不需要下载内核
 * - 设 `SMOKE_CHANNEL=bundled` = 改用 Playwright 自带的 Chromium（需先 `npm run smoke:install`）
 *
 * 之所以默认走系统浏览器：本机环境访问 Playwright CDN 被挡，内置内核下载会卡住。
 * CI 上建议 `npm run smoke:install` 后用 bundled 内核，版本更可控。
 */
const SMOKE_CHANNEL = process.env.SMOKE_CHANNEL ?? 'chrome'
const channelOption =
  SMOKE_CHANNEL === 'bundled' ? {} : { channel: SMOKE_CHANNEL as 'chrome' | 'msedge' }

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    launchOptions: {
      // 无头环境走软件 GL（SwiftShader）；新版 Chromium 需要显式放行
      args: ['--enable-unsafe-swiftshader'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...channelOption } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
