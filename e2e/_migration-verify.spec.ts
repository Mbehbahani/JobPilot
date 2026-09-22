/**
 * JobPilot -> Huawei Convex migration verification.
 *
 * Runs against the isolated Huawei backend only (PUBLIC_CONVEX_URL in .env.test).
 * Every record it creates is test-owned: it is created on a freshly created e2e
 * user and removed again by the test or by globalTeardown.
 *
 * Deliberately NOT covered here (kept pending rather than faked): outbound email,
 * billing, OAuth providers, and Gmail/Unipile integrations, all of which are
 * neutralised on the isolated deployment so they cannot cause real side effects.
 */
import {
	test,
	expect,
	type BrowserContext,
	type Page,
	type APIRequestContext
} from '@playwright/test';
import fs from 'fs';
import path from 'path';

const CONVEX_URL = process.env.PUBLIC_CONVEX_URL!;
const CONVEX_SITE_URL = process.env.PUBLIC_CONVEX_SITE_URL!;

function creds() {
	return JSON.parse(
		fs.readFileSync(path.join(process.cwd(), 'e2e', '.auth', 'test-credentials.json'), 'utf-8')
	);
}

test.beforeAll(() => {
	// Hard guard: this suite must never run against the production backend.
	expect(CONVEX_URL).toContain('10.130.231.5');
	expect(CONVEX_SITE_URL).toContain('10.130.231.5');
});

async function signIn(page: Page, email: string, password: string) {
	await page.goto('/signin');
	await expect(page.locator('[data-testid="email-input"]')).toBeVisible({ timeout: 30000 });
	await page.fill('[data-testid="email-input"]', email);
	await page.fill('[data-testid="password-input"]', password);
	await page.click('[data-testid="signin-button"]');
	await page.waitForURL(/\/[a-z]{2}\/app/, { timeout: 45000 });
	await expect(page.locator('[data-testid="authenticated-layout"]')).toBeVisible({
		timeout: 45000
	});
}

async function jwtOf(context: BrowserContext): Promise<string> {
	const c = (await context.cookies()).find((x) => x.name === 'better-auth.convex_jwt');
	expect(c, 'convex_jwt cookie must exist after sign-in').toBeTruthy();
	return c!.value;
}

/** Call a Convex function over the HTTP API as the signed-in user. */
async function convex(
	req: APIRequestContext,
	kind: 'query' | 'mutation' | 'action',
	fnPath: string,
	args: unknown,
	jwt: string
) {
	const r = await req.post(`${CONVEX_URL}/api/${kind}`, {
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
		data: { path: fnPath, args, format: 'json' }
	});
	const body = await r.json();
	expect(body.status, `${fnPath} -> ${JSON.stringify(body).slice(0, 300)}`).toBe('success');
	return body.value;
}

test.describe.configure({ mode: 'serial' });

let uniqueTitle = '';

test('1. sign-in, authenticated session, and board data served by Huawei', async ({
	page,
	context
}) => {
	const { user } = creds();
	await signIn(page, user.email, user.password);

	const jwt = await jwtOf(context);
	const session = await (await page.request.get('/api/auth/get-session')).json();
	expect(session?.user?.email).toBe(user.email);

	// getBoard is a public query requiring the user's identity: proves
	// authenticated queries resolve against the Huawei backend.
	const board = await convex(page.request, 'query', 'todos:getBoard', {}, jwt);
	expect(board).toBeTruthy();
	console.log('   board columns:', Object.keys(board || {}).join(', '));
});

test('2. session persists across a full reload', async ({ page }) => {
	const { user } = creds();
	await signIn(page, user.email, user.password);
	await page.reload();
	await expect(page.locator('[data-testid="authenticated-layout"]')).toBeVisible({
		timeout: 45000
	});
	const session = await (await page.request.get('/api/auth/get-session')).json();
	expect(session?.user?.email).toBe(user.email);
});

test('3. HTTP action on the site origin creates a task (create + persistence)', async ({
	page,
	context
}) => {
	const { user } = creds();
	await signIn(page, user.email, user.password);
	const session = await (await page.request.get('/api/auth/get-session')).json();
	const userId = session.user.id;
	const jwt = await jwtOf(context);

	uniqueTitle = `MIG-VERIFY-${Date.now()}`;

	// Hits port 3211 on Huawei directly - the site origin / HTTP action surface.
	const r = await page.request.post(`${CONVEX_SITE_URL}/api/integration/add-job`, {
		headers: { 'Content-Type': 'application/json' },
		data: { userId, title: uniqueTitle, companyName: 'Migration Test Co' }
	});
	expect(r.status(), await r.text()).toBe(200);
	expect((await r.json()).success).toBe(true);

	// Read it back through an authenticated query - proves the write landed and
	// is visible to the owning user.
	const board = await convex(page.request, 'query', 'todos:getBoard', {}, jwt);
	const all = Object.values(board as Record<string, Array<{ title?: string }>>).flat();
	expect(all.some((t) => t.title === uniqueTitle)).toBe(true);
});

test('4. realtime propagation to two concurrent browser sessions', async ({ browser }) => {
	const { user } = creds();
	const ctxA = await browser.newContext();
	const ctxB = await browser.newContext();
	const a = await ctxA.newPage();
	const b = await ctxB.newPage();

	await signIn(a, user.email, user.password);
	await signIn(b, user.email, user.password);

	const session = await (await a.request.get('/api/auth/get-session')).json();
	const userId = session.user.id;

	const rtTitle = `MIG-REALTIME-${Date.now()}`;

	// Neither page is reloaded after this point. If the text appears, it arrived
	// over the Convex websocket from Huawei.
	const r = await a.request.post(`${CONVEX_SITE_URL}/api/integration/add-job`, {
		headers: { 'Content-Type': 'application/json' },
		data: { userId, title: rtTitle }
	});
	expect(r.status()).toBe(200);

	await expect(a.getByText(rtTitle, { exact: false }).first()).toBeVisible({ timeout: 30000 });
	await expect(b.getByText(rtTitle, { exact: false }).first()).toBeVisible({ timeout: 30000 });

	await ctxA.close();
	await ctxB.close();
});

test('5. update and delete persist (full CRUD)', async ({ page, context }) => {
	const { user } = creds();
	await signIn(page, user.email, user.password);
	const jwt = await jwtOf(context);

	type Task = { id: string; title?: string } & Record<string, unknown>;
	const board = (await convex(page.request, 'query', 'todos:getBoard', {}, jwt)) as Record<
		string,
		Task[]
	>;

	const column = Object.keys(board).find((c) => board[c].some((t) => t.title === uniqueTitle));
	expect(column, `task ${uniqueTitle} should exist from test 3`).toBeTruthy();

	// UPDATE
	const updated = `${uniqueTitle}-UPDATED`;
	const afterUpdate = structuredClone(board);
	afterUpdate[column!] = afterUpdate[column!].map((t) =>
		t.title === uniqueTitle ? { ...t, title: updated } : t
	);
	await convex(page.request, 'mutation', 'todos:saveBoard', { board: afterUpdate }, jwt);

	const b2 = (await convex(page.request, 'query', 'todos:getBoard', {}, jwt)) as Record<
		string,
		Task[]
	>;
	expect(
		Object.values(b2)
			.flat()
			.some((t) => t.title === updated)
	).toBe(true);
	expect(
		Object.values(b2)
			.flat()
			.some((t) => t.title === uniqueTitle)
	).toBe(false);

	// DELETE
	const afterDelete = structuredClone(b2);
	for (const c of Object.keys(afterDelete)) {
		afterDelete[c] = afterDelete[c].filter((t) => t.title !== updated);
	}
	await convex(page.request, 'mutation', 'todos:saveBoard', { board: afterDelete }, jwt);

	const b3 = (await convex(page.request, 'query', 'todos:getBoard', {}, jwt)) as Record<
		string,
		Task[]
	>;
	expect(
		Object.values(b3)
			.flat()
			.some((t) => t.title === updated)
	).toBe(false);
});

test("6. access isolation: a second user cannot see the first user's tasks", async ({
	browser
}) => {
	const { user, admin } = creds();

	const ctxA = await browser.newContext();
	const a = await ctxA.newPage();
	await signIn(a, user.email, user.password);
	const jwtA = await jwtOf(ctxA);
	const sessionA = await (await a.request.get('/api/auth/get-session')).json();

	const isoTitle = `MIG-ISOLATION-${Date.now()}`;
	await a.request.post(`${CONVEX_SITE_URL}/api/integration/add-job`, {
		headers: { 'Content-Type': 'application/json' },
		data: { userId: sessionA.user.id, title: isoTitle }
	});
	const boardA = await convex(a.request, 'query', 'todos:getBoard', {}, jwtA);
	expect(
		Object.values(boardA as Record<string, Array<{ title?: string }>>)
			.flat()
			.some((t) => t.title === isoTitle)
	).toBe(true);

	const ctxB = await browser.newContext();
	const b = await ctxB.newPage();
	await signIn(b, admin.email, admin.password);
	const jwtB = await jwtOf(ctxB);
	const boardB = await convex(b.request, 'query', 'todos:getBoard', {}, jwtB);

	const bTitles = Object.values(boardB as Record<string, Array<{ title?: string }>>)
		.flat()
		.map((t) => t.title);
	expect(bTitles).not.toContain(isoTitle);

	await ctxA.close();
	await ctxB.close();
});

test('7. file upload and download round-trip through component-owned storage', async ({
	page,
	context
}) => {
	const { user } = creds();
	await signIn(page, user.email, user.password);
	const jwt = await jwtOf(context);

	// The app restricts uploads to PNG/JPEG/WebP/GIF/PDF, so use a real 1x1 PNG.
	const payload = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
		'base64'
	);

	const gen = (await convex(
		page.request,
		'mutation',
		'support/files:generateUploadUrl',
		{},
		jwt
	)) as {
		uploadUrl: string;
		uploadToken: string;
	};
	expect(gen.uploadUrl).toContain('10.130.231.5');

	const up = await page.request.post(gen.uploadUrl, {
		headers: { 'Content-Type': 'image/png' },
		data: payload
	});
	expect(up.status(), await up.text()).toBe(200);
	const { storageId } = await up.json();
	expect(storageId).toBeTruthy();

	const saved = (await convex(
		page.request,
		'action',
		'support/files:saveUploadedFile',
		{
			storageId,
			uploadToken: gen.uploadToken,
			mimeType: 'image/png',
			filename: 'migration.png',
			width: 1,
			height: 1
		},
		jwt
	)) as { url?: string } | string;

	const url = typeof saved === 'string' ? saved : saved?.url;
	expect(url, `saveUploadedFile returned ${JSON.stringify(saved).slice(0, 200)}`).toBeTruthy();

	// Download it back and compare bytes.
	const down = await page.request.get(url!);
	expect(down.status()).toBe(200);
	const got = await down.body();
	expect(Buffer.compare(got, payload), 'downloaded bytes must equal uploaded bytes').toBe(0);
	console.log('   file round-trip OK, bytes:', payload.length, 'url host:', new URL(url!).host);
});

test('8. sign-out ends the session and protected routes are blocked', async ({ page, context }) => {
	const { user } = creds();
	await signIn(page, user.email, user.password);

	// Sign out through the app's own UI, the way a user does.
	await page.locator('[data-testid="logout-button"]').click();
	await page.waitForURL(/.*\/[a-z]{2}(\/signin)?(\?.*)?$/, { timeout: 30000 });

	const session = await (await page.request.get('/api/auth/get-session')).json();
	expect(session, 'session must be gone after sign-out').toBeNull();

	const cookies = await context.cookies();
	expect(cookies.find((c) => c.name === 'better-auth.convex_jwt')?.value || '').toBe('');

	// A protected route must now bounce back to sign-in.
	await page.goto('/en/app/my-tasks');
	await page.waitForURL(/\/signin/, { timeout: 30000 });
});
