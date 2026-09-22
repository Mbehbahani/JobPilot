// Minimal config for production smoke tests: no dev server, no test-user setup.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
	testDir: 'e2e',
	testMatch: /_cutover-.*\.spec\.ts/,
	workers: 1,
	retries: 0,
	timeout: 120_000,
	reporter: [['list']],
	use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
	projects: [{ name: 'smoke' }]
});
