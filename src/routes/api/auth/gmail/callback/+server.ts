import { redirect, type RequestHandler } from '@sveltejs/kit';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { api } from '$lib/convex/_generated/api';

function renderCallbackHtml(payload: { success: boolean; message: string }) {
	const serialized = JSON.stringify({ type: 'jobpilot:gmail-oauth', ...payload });
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Gmail Connection</title>
	</head>
	<body style="font-family: system-ui, sans-serif; padding: 24px; color: #111827;">
		<p>${payload.message}</p>
		<script>
			(function () {
				const payload = ${serialized};
				if (window.opener && !window.opener.closed) {
					window.opener.postMessage(payload, window.location.origin);
				}
				window.close();
			})();
		</script>
	</body>
</html>`;
}

export const GET: RequestHandler = async (event) => {
	const code = event.url.searchParams.get('code');
	const error = event.url.searchParams.get('error');

	if (!event.locals.token) {
		throw redirect(302, '/signin');
	}

	if (error) {
		return new Response(
			renderCallbackHtml({
				success: false,
				message: `Gmail connection failed: ${error}`
			}),
			{
				headers: { 'content-type': 'text/html; charset=utf-8' },
				status: 400
			}
		);
	}

	if (!code) {
		return new Response(
			renderCallbackHtml({
				success: false,
				message: 'Gmail connection failed: missing authorization code.'
			}),
			{
				headers: { 'content-type': 'text/html; charset=utf-8' },
				status: 400
			}
		);
	}

	try {
		const client = createConvexHttpClient({ token: event.locals.token });
		await client.action(api.gmail.exchangeAuthCode, {
			code,
			redirectUri: `${event.url.origin}/api/auth/gmail/callback`
		});

		return new Response(
			renderCallbackHtml({
				success: true,
				message: 'Gmail connected successfully. You can close this window.'
			}),
			{
				headers: { 'content-type': 'text/html; charset=utf-8' }
			}
		);
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : 'Unknown error';
		return new Response(
			renderCallbackHtml({
				success: false,
				message: `Gmail connection failed: ${message}`
			}),
			{
				headers: { 'content-type': 'text/html; charset=utf-8' },
				status: 500
			}
		);
	}
};
