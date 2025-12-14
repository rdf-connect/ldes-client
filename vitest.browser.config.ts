
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        browser: {
            enabled: true,
            provider: playwright(),
            instances: [
                {
                    browser: 'chromium',
                },
            ],
            headless: true,
            screenshotFailures: false,
        },
        include: ['tests/browser/**/*.test.ts'],
        globalSetup: ['./tests/browser/globalSetup.ts'],
    },
})
