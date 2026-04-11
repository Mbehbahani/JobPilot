import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import {
	getSearchProfile,
	getUserJobs,
	getRecentSearchRuns,
	deleteSearchRun
} from '$lib/server/personal-jobs/supabase';

export const load = (async ({ parent, url }) => {
	const { viewer } = await parent();

	if (!viewer?._id) {
		return {
			profile: null,
			jobs: [],
			jobCount: 0,
			recentRuns: [],
			page: 1,
			pageSize: 100,
			error: 'Not authenticated'
		};
	}

	const userId = viewer._id;
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const pageSize = 100;
	const offset = (page - 1) * pageSize;

	try {
		const [profile, jobsResult, recentRuns] = await Promise.all([
			getSearchProfile(userId),
			getUserJobs(userId, { limit: pageSize, offset }),
			getRecentSearchRuns(userId, 25)
		]);

		return {
			profile,
			jobs: jobsResult.jobs,
			jobCount: jobsResult.count,
			recentRuns,
			page,
			pageSize,
			error: null
		};
	} catch (e) {
		console.error('[my-job-search] Load error:', e);
		return {
			profile: null,
			jobs: [],
			jobCount: 0,
			recentRuns: [],
			page: 1,
			pageSize: 100,
			error: 'Failed to load personal jobs data'
		};
	}
}) satisfies PageServerLoad;

export const actions: Actions = {
	deleteRun: async ({ request, locals }) => {
		const token = locals.token;
		if (!token) return fail(401, { error: 'Not authenticated' });
		const payload = (() => {
			try {
				return JSON.parse(atob(token.split('.')[1])) as { sub?: string };
			} catch {
				return null;
			}
		})();
		const userId = payload?.sub;
		if (!userId) return fail(401, { error: 'Invalid token' });

		const form = await request.formData();
		const runId = form.get('runId')?.toString();
		if (!runId) return fail(400, { error: 'Missing runId' });

		const ok = await deleteSearchRun(userId, runId);
		if (!ok) return fail(500, { error: 'Failed to delete search run' });

		return { success: true };
	}
};
