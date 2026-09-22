import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { extractAuthUser } from '$lib/server/personal-jobs/auth';
import { getRecentSearchRuns, getSearchRun } from '$lib/server/personal-jobs/supabase';

/**
 * Lightweight poll target for the personal job search.
 *
 * Why this exists: the search itself takes 30-260s, but this app is served by
 * Netlify Functions, which terminate a synchronous function after ~10s on the
 * current plan. The old design held an SSE connection open for the whole search
 * from inside that function, so Netlify killed the stream mid-search and the
 * client's reader simply saw `done` with no error - the search appeared to stop
 * right after starting.
 *
 * The search backend already writes progress and results to Supabase
 * independently of the caller, so the client can poll here instead. Every call
 * is a single indexed Supabase read and returns in well under a second, so it
 * never approaches the function timeout.
 *
 * GET /api/personal-search/status            -> latest run for the current user
 * GET /api/personal-search/status?run_id=... -> that specific run (ownership enforced)
 */

const TERMINAL_STATUSES = new Set(['completed', 'partial_success', 'failed', 'rate_limited']);

export const GET: RequestHandler = async ({ url, locals }) => {
	const auth = extractAuthUser(locals);
	if ('error' in auth) return json({ error: auth.error }, { status: 401 });

	const runId = url.searchParams.get('run_id');

	try {
		let run = null;

		if (runId) {
			run = await getSearchRun(runId);
			// Never let one user poll another user's run.
			if (run && run.user_id !== auth.userId) {
				return json({ error: 'Not found' }, { status: 404 });
			}
		} else {
			const runs = await getRecentSearchRuns(auth.userId, 1);
			run = runs[0] ?? null;
		}

		if (!run) {
			return json({ status: 'none', finished: false, run_id: null });
		}

		return json({
			run_id: run.id,
			status: run.status,
			finished: TERMINAL_STATUSES.has(run.status),
			total_found: run.total_found ?? 0,
			total_new: run.total_new ?? 0,
			source_summary: run.source_summary_json ?? {},
			llm_summary: run.llm_summary ?? null,
			error: run.error_message ?? null,
			started_at: run.started_at,
			finished_at: run.finished_at,
			created_at: run.created_at
		});
	} catch (e) {
		console.error('[personal-search status]', e);
		return json({ error: 'Status unavailable' }, { status: 502 });
	}
};
