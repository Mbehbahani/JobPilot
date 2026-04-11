import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { anyApi } from 'convex/server';

const personalSearchLlm = {
	suggestKeywordsFromProfile: anyApi.personalSearchLlm.suggestKeywordsFromProfile
};

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.token) {
		return json({ ok: false, error: 'Not authenticated' }, { status: 401 });
	}

	try {
		const convex = createConvexHttpClient({ token: locals.token });
		const result = await convex.action(personalSearchLlm.suggestKeywordsFromProfile, {});
		if (!result?.ok) {
			if (result?.error === 'missing_profile') {
				return json(
					{ ok: false, error: 'Please add your CV / Profile in Settings first.' },
					{ status: 400 }
				);
			}
			return json({ ok: false, error: 'Could not generate keywords.' }, { status: 502 });
		}
		return json({ ok: true, keywords: result.keywords });
	} catch (e) {
		console.error('[personal-search] suggest keywords failed:', e);
		return json({ ok: false, error: 'Could not generate keywords.' }, { status: 502 });
	}
};
