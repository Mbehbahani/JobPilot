/**
 * Shared auth extraction for the personal-search endpoints.
 *
 * Lifted out of src/routes/api/personal-search/+server.ts so the polling status
 * endpoint can reuse it verbatim rather than duplicating the logic.
 */

function decodeJwtPayload(token: string): { sub?: string } | null {
	try {
		const payload = token.split('.')[1];
		if (!payload) return null;
		return JSON.parse(atob(payload));
	} catch {
		return null;
	}
}

export function extractAuthUser(locals: App.Locals): { userId: string } | { error: string } {
	const token = locals.token;
	if (!token) return { error: 'Not authenticated' };
	const payload = decodeJwtPayload(token);
	const userId = payload?.sub;
	if (!userId) return { error: 'Invalid token' };
	return { userId };
}
