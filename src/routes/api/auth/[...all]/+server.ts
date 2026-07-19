import { createSvelteKitHandler } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import type { RequestHandler } from './$types';

const upstreamHandlers = createSvelteKitHandler();

const SECURE_AUTH_COOKIE_PREFIX = '__Secure-better-auth.';
const LOCAL_AUTH_COOKIE_PREFIX = 'better-auth.';

function isLocalHttpRequest(url: URL): boolean {
	return (
		url.protocol === 'http:' &&
		(url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
	);
}

function translateCookiesForSecureUpstream(request: Request): void {
	const cookieHeader = request.headers.get('cookie');
	if (!cookieHeader) return;

	request.headers.set(
		'cookie',
		cookieHeader.replace(
			/(^|;\s*)(better-auth\.[^=]+=)/g,
			(_match, separator: string, cookie: string) => `${separator}__Secure-${cookie}`
		)
	);
}

function translateCookieForLocalhost(cookie: string): string {
	if (!cookie.startsWith(SECURE_AUTH_COOKIE_PREFIX)) return cookie;

	return cookie
		.replace(SECURE_AUTH_COOKIE_PREFIX, LOCAL_AUTH_COOKIE_PREFIX)
		.replace(/;\s*Secure(?=;|$)/gi, '');
}

function translateResponseCookiesForLocalhost(response: Response): Response {
	const getSetCookie = (
		response.headers as Headers & { getSetCookie?: () => string[] }
	).getSetCookie?.bind(response.headers);
	const setCookies = getSetCookie?.() ?? [];
	if (setCookies.length === 0) return response;

	const headers = new Headers(response.headers);
	headers.delete('set-cookie');
	for (const cookie of setCookies) {
		headers.append('set-cookie', translateCookieForLocalhost(cookie));
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

function withLocalhostCookieCompatibility(handler: RequestHandler): RequestHandler {
	return async (event) => {
		const localHttp = isLocalHttpRequest(event.url);
		if (localHttp) {
			translateCookiesForSecureUpstream(event.request);
		}

		const response = await handler(event);
		return localHttp ? translateResponseCookiesForLocalhost(response) : response;
	};
}

// Railway Better Auth uses an HTTPS base URL and therefore issues __Secure- cookies.
// Translate them only at the localhost HTTP proxy boundary so local development can
// store the session, while production keeps the secure cookie names and attributes.
export const GET = withLocalhostCookieCompatibility(upstreamHandlers.GET);
export const POST = withLocalhostCookieCompatibility(upstreamHandlers.POST);
