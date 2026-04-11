import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { anyApi } from 'convex/server';

const personalSearchLlm = {
	enrichJobForSearch: anyApi.personalSearchLlm.enrichJobForSearch,
	enrichJobsForSearch: anyApi.personalSearchLlm.enrichJobsForSearch
};

export const POST: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
	const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
	if (!token) {
		return json({ ok: false, error: 'Missing token' }, { status: 401 });
	}

	const body = await request.json();
	try {
		const convex = createConvexHttpClient({ token });
		const result = Array.isArray(body.jobs)
			? await convex.action(personalSearchLlm.enrichJobsForSearch, {
					jobs: body.jobs,
					keywords: body.keywords ?? [],
					city: body.city ?? undefined,
					country: body.country ?? undefined
				})
			: await convex.action(personalSearchLlm.enrichJobForSearch, {
					job: body.job,
					keywords: body.keywords ?? [],
					city: body.city ?? undefined,
					country: body.country ?? undefined
				});
		return json({ ok: true, result });
	} catch (e) {
		console.error('[personal-search] enrich-job route failed:', e);
		return json({ ok: false, error: 'Enrichment failed' }, { status: 502 });
	}
};
