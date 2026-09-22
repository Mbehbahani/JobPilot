import { sequence } from '@sveltejs/kit/hooks';
import { redirect, type Handle, type Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { isSupportedLanguage, DEFAULT_LANGUAGE } from '$lib/i18n/languages';
import { safeRedirectPath } from '$lib/utils/url';

/**
 * Get JWT token directly from cookies (no createAuth needed)
 * Cookie name depends on whether we're on HTTPS or HTTP
 */
function getJwtToken(cookies: Cookies, request: Request): string | undefined {
	const isSecure = new URL(request.url).protocol === 'https:';
	const cookieName = isSecure ? '__Secure-better-auth.convex_jwt' : 'better-auth.convex_jwt';
	return cookies.get(cookieName);
}

/**
 * Decode JWT payload without verification (cookie is already trusted)
 * Used for quick role checks in hooks without waiting for Convex queries
 */
function decodeJwtPayload(token: string): { role?: string } | null {
	try {
		const payload = token.split('.')[1];
		if (!payload) return null;
		return JSON.parse(atob(payload));
	} catch {
		return null;
	}
}

// Route matchers
function isSignInPage(pathname: string): boolean {
	return /^\/[a-z]{2}\/signin$/.test(pathname);
}

function isProtectedRoute(pathname: string): boolean {
	return /^\/[a-z]{2}\/app(\/|$)/.test(pathname);
}

function isAdminRoute(pathname: string): boolean {
	return /^\/[a-z]{2}\/admin(\/|$)/.test(pathname);
}

function isEmailsRoute(pathname: string): boolean {
	return /^\/[a-z]{2}\/emails(\/|$)/.test(pathname);
}

/**
 * Bypass SvelteKit CSRF origin check for internal API routes
 * that authenticate via shared secret (x-internal-key) instead of cookies.
 */
const handleCsrfBypass: Handle = async function handleCsrfBypass({ event, resolve }) {
	if (event.url.pathname === '/api/sandbox/run-internal') {
		// Mark request as same-origin so SvelteKit skips the CSRF check.
		// The route handler validates x-internal-key independently.
		event.request.headers.set('origin', event.url.origin);
	}
	return resolve(event);
};

/**
 * Block access to dev-only routes in production
 */
const handleDevOnlyRoutes: Handle = async function handleDevOnlyRoutes({ event, resolve }) {
	if (!dev && isEmailsRoute(event.url.pathname)) {
		return new Response('Not found', { status: 404 });
	}
	return resolve(event);
};

/**
 * Extract authentication token from cookies
 */
const handleAuth: Handle = async function handleAuth({ event, resolve }) {
	event.locals.token = getJwtToken(event.cookies, event.request);
	return resolve(event);
};

/**
 * Handle language detection and redirect to localized URLs
 */
const handleLanguage: Handle = async function handleLanguage({ event, resolve }) {
	const pathname = event.url.pathname;

	// Skip API routes (check if path starts with /api)
	if (pathname.startsWith('/api')) {
		return resolve(event);
	}

	// Check if path starts with a supported language code
	const langMatch = pathname.match(/^\/([a-z]{2})(\/|$)/);
	const hasLangPrefix = langMatch ? isSupportedLanguage(langMatch[1]) : false;

	// If no language prefix, redirect to add one
	if (!hasLangPrefix) {
		// Detect preferred language from Accept-Language header
		const acceptLanguage = event.request.headers.get('accept-language');
		let preferredLang = DEFAULT_LANGUAGE;

		if (acceptLanguage) {
			// Parse Accept-Language header (e.g., "en-US,en;q=0.9,de;q=0.8")
			const languages = acceptLanguage
				.split(',')
				.map((lang) => lang.split(';')[0].trim().split('-')[0]);

			// Find first supported language
			const supported = languages.find((lang) => isSupportedLanguage(lang));
			if (supported) {
				preferredLang = supported;
			}
		}

		// Redirect to language-prefixed URL, preserving query params
		const basePath = pathname === '/' ? `/${preferredLang}` : `/${preferredLang}${pathname}`;
		const newPath = `${basePath}${event.url.search}`;
		redirect(307, newPath);
	}

	return resolve(event);
};

/**
 * Handle auth redirects with language-aware paths
 */
const authFirstPattern: Handle = async function authFirstPattern({ event, resolve }) {
	const authenticated = !!event.locals.token;
	const pathname = event.url.pathname;
	const redirectToParam = event.url.searchParams.get('redirectTo');

	// Extract language from path (e.g., /en/signin -> en)
	const langMatch = pathname.match(/^\/([a-z]{2})\//);
	const lang = langMatch ? langMatch[1] : DEFAULT_LANGUAGE;

	if (isSignInPage(pathname) && authenticated) {
		const destination = safeRedirectPath(redirectToParam ?? '', `/${lang}/app`);
		redirect(307, destination);
	}
	if (isProtectedRoute(pathname) && !authenticated) {
		const destination = `/${lang}/signin?redirectTo=${encodeURIComponent(event.url.pathname + event.url.search)}`;
		redirect(307, destination);
	}

	// Admin routes require authentication AND admin role
	if (isAdminRoute(pathname)) {
		if (!authenticated) {
			const destination = `/${lang}/signin?redirectTo=${encodeURIComponent(event.url.pathname + event.url.search)}`;
			redirect(307, destination);
		}
		// Check admin role from JWT payload (fast, no Convex query needed)
		const payload = decodeJwtPayload(event.locals.token!);
		if (payload?.role !== 'admin') {
			redirect(307, `/${lang}/app`);
		}
	}

	return resolve(event);
};

/**
 * Never let a browser cache a dynamic API response.
 *
 * The hosting platform (Netlify) attaches `Cache-Control: max-age=86400` to
 * every function response that does not set its own. For `/api/*` that is
 * actively harmful: on 2026-09-11 a transient 403 from `/api/auth/convex/token`
 * was cached by the browser for 24 hours, so the user stayed locked out long
 * after the server was fixed. Auth tokens and session lookups must be
 * `no-store`; any route that genuinely wants caching can still set its own
 * header, which is respected here.
 */
const handleApiNoStore: Handle = async function handleApiNoStore({ event, resolve }) {
	const response = await resolve(event);
	const path = event.url.pathname;
	if (!path.startsWith('/api/')) return response;

	// Auth responses are always no-store, even if something upstream set a value.
	// Other API routes keep an explicit header if they chose one.
	const force = path.startsWith('/api/auth/');
	if (force || !response.headers.has('cache-control')) {
		try {
			response.headers.set('Cache-Control', 'no-store');
		} catch {
			// Immutable headers (e.g. a bare proxied Response): rebuild once.
			const headers = new Headers(response.headers);
			headers.set('Cache-Control', 'no-store');
			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers
			});
		}
	}
	return response;
};

export const handle = sequence(
	handleCsrfBypass,
	handleDevOnlyRoutes,
	handleAuth,
	handleLanguage,
	authFirstPattern,
	handleApiNoStore
);
