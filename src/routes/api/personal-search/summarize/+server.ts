import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { anyApi } from 'convex/server';
import { extractAuthUser } from '$lib/server/personal-jobs/auth';
import { getSearchRun, updateSearchRunSummary } from '$lib/server/personal-jobs/supabase';

/**
 * Produce the LLM summary for a finished search run.
 *
 * On the old SSE path this happened inside the long-lived stream. The async
 * start mode returns before the search finishes, so the summary is generated
 * here instead: the client calls this once, after polling reports the run is
 * finished and has no summary yet.
 *
 * Degrades rather than fails - if the LLM is unavailable, a deterministic
 * summary is written instead, so the run is never left with a blank result.
 */

const interpretResult = anyApi.personalSearchLlm.interpretResult;

function fallbackSummary(args: {
	status: string;
	totalFound: number;
	totalNew: number;
	sourceSummary: Record<string, unknown>;
	keywords: string[];
	city?: string | null;
	country?: string | null;
}): string {
	const location = [args.city, args.country].filter(Boolean).join(', ');
	const locationPart = location ? ` in ${location}` : '';
	const keywordPart = args.keywords.length > 0 ? ` for ${args.keywords.join(', ')}` : '';

	const sourceParts = Object.entries(args.sourceSummary || {}).map(([src, info]) => {
		const i = info as Record<string, unknown> | null;
		const found = Number(i?.found ?? 0);
		const added = Number(i?.new ?? 0);
		const err = i?.error ? ` (${String(i.error)})` : '';
		return `${src}: ${found} found, ${added} new${err}`;
	});

	if (args.status !== 'completed' && args.status !== 'partial_success') {
		return `Search ${args.status}${keywordPart}${locationPart}.`;
	}

	const primary = `Found ${args.totalFound} job${args.totalFound === 1 ? '' : 's'}${keywordPart}${locationPart}, ${args.totalNew} new.`;
	return sourceParts.length === 0 ? primary : `${primary} ${sourceParts.join(' | ')}`;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = extractAuthUser(locals);
	if ('error' in auth) return json({ error: auth.error }, { status: 401 });

	const body = await request.json().catch(() => ({}) as Record<string, unknown>);
	const runId = typeof body.run_id === 'string' ? body.run_id : null;
	if (!runId) return json({ error: 'run_id is required' }, { status: 400 });

	const run = await getSearchRun(runId);
	if (!run || run.user_id !== auth.userId) return json({ error: 'Not found' }, { status: 404 });

	// Already summarised - nothing to do.
	if (run.llm_summary) return json({ llm_summary: run.llm_summary, cached: true });

	const args = {
		status: String(run.status),
		totalFound: Number(run.total_found ?? 0),
		totalNew: Number(run.total_new ?? 0),
		sourceSummary: (run.source_summary_json ?? {}) as Record<string, unknown>,
		keywords: run.requested_keywords ?? [],
		city: run.city,
		country: run.country
	};

	let summary: string | null = null;
	try {
		const convex = createConvexHttpClient({ token: locals.token });
		summary = await convex.action(interpretResult, {
			status: args.status,
			totalFound: args.totalFound,
			totalNew: args.totalNew,
			sourceSummary: args.sourceSummary,
			keywords: args.keywords,
			city: args.city ?? undefined,
			country: args.country ?? undefined
		});
	} catch (e) {
		console.warn('[personal-search summarize] LLM unavailable:', (e as Error).message);
	}

	if (!summary) summary = fallbackSummary(args);

	// Persist so the summary survives a page reload.
	updateSearchRunSummary(runId, summary).catch(() => {});

	return json({ llm_summary: summary, cached: false });
};
