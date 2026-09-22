/**
 * Playwright config for the JobPilot -> Huawei Convex migration verification.
 *
 * Separate from playwright.config.ts on purpose:
 *   - it never starts a dev server (AGENTS.md: the dev server is already running
 *     in its own terminal and must not be started a second time). It runs against
 *     the isolated production preview on PUBLIC_SITE_URL instead;
 *   - it only picks up the _migration-*.spec.ts files;
 *   - it reuses the project's real globalSetup/globalTeardown, so the users it
 *     creates are test-owned and deleted afterwards.
 *
 * Run: CI=1 bunx playwright test --config playwright.migration.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const baseURL = process.env.PUBLIC_SITE_URL || 'http://localhost:4173';

export default defineConfig({
	testDir: 'e2e',
	testMatch: /_migration-.*\.spec\.ts/,
	globalSetup: './e2e/global-setup.ts',
	globalTeardown: './e2e/global-teardown.ts',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 90_000,
	reporter: [['list']],
	use: {
		baseURL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [{ name: 'migration', use: { ...devices['Desktop Chrome'] } }]
});
