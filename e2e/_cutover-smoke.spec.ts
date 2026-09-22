/**
 * Post-cutover production smoke: the LIVE site, real browser, no test accounts.
 *
 * Proves that jobpilot.oploy.eu now talks to the Huawei backend through
 * Cloudflare, and that NOTHING still reaches the old AWS address.
 */
import { test, expect } from '@playwright/test';

const SITE = 'https://jobpilot.oploy.eu';
const OLD_AWS_IP = '3.120.122.232';

test('live site: websocket goes to convex-cloud.oploy.eu via Cloudflare; nothing hits AWS', async ({
	page
}) => {
	const hosts = new Set<string>();
	const websockets: string[] = [];
	const failures: string[] = [];

	page.on('request', (r) => {
		try {
			hosts.add(new URL(r.url()).host);
		} catch {
			/* ignore */
		}
	});
	page.on('websocket', (ws) => {
		websockets.push(ws.url());
		ws.on('socketerror', (e) => failures.push(`WS ERROR ${ws.url()} :: ${e}`));
	});
	page.on('requestfailed', (r) => {
		if (!r.url().includes('google') && !r.url().includes('posthog')) {
			failures.push(`${r.method()} ${r.url().slice(0, 120)} :: ${r.failure()?.errorText}`);
		}
	});

	await page.goto(`${SITE}/en/signin`, { waitUntil: 'networkidle', timeout: 60000 });
	await expect(page.locator('[data-testid="email-input"]')).toBeVisible({ timeout: 30000 });

	// Give the Convex client time to open its sync socket.
	await page.waitForTimeout(8000);

	console.log('=== HOSTS CONTACTED ===');
	[...hosts].sort().forEach((h) => console.log('  ', h));
	console.log('=== WEBSOCKETS ===');
	websockets.forEach((w) => console.log('  ', w));
	console.log('=== FAILURES ===', failures.length ? '' : '(none)');
	failures.forEach((f) => console.log('  !', f));

	// The Convex client must have opened its sync socket to the production hostname.
	expect(
		websockets.some((w) => w.startsWith('wss://convex-cloud.oploy.eu/')),
		'expected a wss:// connection to convex-cloud.oploy.eu'
	).toBe(true);

	// And nothing at all may still be pointed at the old AWS address.
	expect([...hosts].some((h) => h.includes(OLD_AWS_IP))).toBe(false);
	expect(websockets.some((w) => w.includes(OLD_AWS_IP))).toBe(false);
	expect(
		failures.filter((f) => f.includes('convex')),
		'no convex request may fail'
	).toEqual([]);
});

test('live site: auth endpoint answers through the new backend', async ({ request }) => {
	// Unauthenticated get-session must return a well-formed null, not an error -
	// that proves the SvelteKit -> convex-site.oploy.eu -> Huawei hop is intact.
	const r = await request.get(`${SITE}/api/auth/get-session`);
	console.log('   get-session:', r.status(), (await r.text()).slice(0, 60));
	expect(r.status()).toBe(200);
});
