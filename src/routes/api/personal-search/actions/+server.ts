import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	toggleJobSaved,
	deleteUserJobMatch,
	deleteAllPersonalSearchData
} from '$lib/server/personal-jobs/supabase';

function decodeJwtPayload(token: string): { sub?: string } | null {
	try {
		const payload = token.split('.')[1];
		if (!payload) return null;
		return JSON.parse(atob(payload));
	} catch {
		return null;
	}
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json();
	const { matchId, action, value } = body;
	const token = locals.token;
	const userId = token ? decodeJwtPayload(token)?.sub : null;

	if (action === 'delete_all') {
		if (!userId) {
			return json({ ok: false, error: 'Not authenticated' }, { status: 401 });
		}
		const ok = await deleteAllPersonalSearchData(userId);
		if (!ok) {
			return json({ ok: false, error: 'Delete all failed' }, { status: 500 });
		}
		return json({ ok: true });
	}

	if (!matchId || !action) {
		return json({ error: 'matchId and action required' }, { status: 400 });
	}

	let ok = false;
	if (action === 'save') {
		ok = await toggleJobSaved(matchId, Boolean(value));
	} else if (action === 'delete') {
		ok = await deleteUserJobMatch(matchId);
	} else {
		return json({ error: 'Unknown action' }, { status: 400 });
	}

	if (!ok) {
		return json({ ok: false, error: 'Action failed' }, { status: 500 });
	}

	return json({ ok: true });
};
