/**
 * Server-side client for the Personal Jobs Supabase instance.
 * Uses the REST API directly (same pattern as src/lib/server/jobs.ts).
 */
import { env } from '$env/dynamic/private';

function getConfig() {
	const url = env.PERSONAL_SUPABASE_URL;
	const key = env.PERSONAL_SUPABASE_ANON_KEY;
	if (!url || !key) {
		throw new Error('Missing PERSONAL_SUPABASE_URL or PERSONAL_SUPABASE_ANON_KEY');
	}
	return { url, key };
}

function getServiceConfig() {
	const url = env.PERSONAL_SUPABASE_URL;
	const key = env.PERSONAL_SUPABASE_SERVICE_KEY ?? env.PERSONAL_SUPABASE_ANON_KEY;
	if (!url || !key) {
		throw new Error('Missing PERSONAL_SUPABASE_URL or PERSONAL_SUPABASE_SERVICE_KEY');
	}
	return { url, key };
}

function headers(key: string) {
	return {
		apikey: key,
		Authorization: `Bearer ${key}`,
		'Content-Type': 'application/json',
		Accept: 'application/json',
		Prefer: 'return=representation'
	};
}

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export interface SearchProfile {
	id: string;
	user_id: string;
	keywords: string[];
	city: string | null;
	country: string | null;
	days_back: number;
	is_remote: boolean;
	platforms: string[];
	created_at: string;
	updated_at: string;
}

export interface SearchRun {
	id: string;
	user_id: string;
	requested_keywords: string[];
	city: string | null;
	country: string | null;
	days_back: number;
	platforms: string[];
	is_remote: boolean;
	status: 'queued' | 'running' | 'partial_success' | 'completed' | 'failed' | 'rate_limited';
	source_summary_json: Record<string, unknown> | null;
	total_found: number;
	total_new: number;
	started_at: string | null;
	finished_at: string | null;
	error_message: string | null;
	llm_summary: string | null;
	created_at: string;
}

export interface PersonalJobMetadata {
	actual_role?: string;
	skills?: string[];
	job_level_std?: string;
	job_function_std?: string;
	company_industry_std?: string;
	education_level?: string[];
	relevance_score?: number;
	reasoning?: string;
}

export interface CanonicalJob {
	id: string;
	source: string;
	source_job_id: string | null;
	canonical_url: string | null;
	title: string;
	company_name: string | null;
	country: string | null;
	city: string | null;
	location_text: string | null;
	job_type: string | null;
	description: string | null;
	description_clean: string | null;
	posted_date: string | null;
	scraped_at: string;
	is_remote: boolean;
	dedupe_hash: string;
	metadata_json: PersonalJobMetadata | null;
	created_at: string;
}

export interface UserJobMatch {
	id: string;
	user_id: string;
	job_id: string;
	search_run_id: string | null;
	matched_keywords: string[] | null;
	match_score: number;
	match_reason: string | null;
	is_saved: boolean;
	created_at: string;
	// Joined fields from jobs_canonical (when using select with join)
	jobs_canonical?: CanonicalJob;
}

// ----------------------------------------------------------------
// Profile operations
// ----------------------------------------------------------------

export async function getSearchProfile(userId: string): Promise<SearchProfile | null> {
	const { url, key } = getConfig();
	const params = new URLSearchParams({
		user_id: `eq.${userId}`,
		limit: '1'
	});
	const res = await fetch(`${url}/rest/v1/user_search_profiles?${params}`, {
		headers: headers(key)
	});
	if (!res.ok) return null;
	const rows = (await res.json()) as SearchProfile[];
	return rows[0] ?? null;
}

export async function upsertSearchProfile(
	userId: string,
	data: {
		keywords: string[];
		city?: string | null;
		country?: string | null;
		days_back?: number;
		is_remote?: boolean;
		platforms?: string[];
	}
): Promise<SearchProfile | null> {
	const { url, key } = getConfig();
	const body = {
		user_id: userId,
		keywords: data.keywords,
		city: data.city ?? null,
		country: data.country ?? null,
		days_back: Math.min(Math.max(data.days_back ?? 3, 1), 7),
		is_remote: data.is_remote ?? false,
		platforms: data.platforms ?? ['indeed'],
		updated_at: new Date().toISOString()
	};
	const res = await fetch(`${url}/rest/v1/user_search_profiles?on_conflict=user_id`, {
		method: 'POST',
		headers: { ...headers(key), Prefer: 'resolution=merge-duplicates,return=representation' },
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		console.error('[upsertProfile]', res.status, await res.text());
		return null;
	}
	const rows = (await res.json()) as SearchProfile[];
	return rows[0] ?? null;
}

// ----------------------------------------------------------------
// Search run operations
// ----------------------------------------------------------------

export async function getRecentSearchRuns(userId: string, limit = 10): Promise<SearchRun[]> {
	const { url, key } = getConfig();
	const params = new URLSearchParams({
		user_id: `eq.${userId}`,
		order: 'created_at.desc',
		limit: String(limit)
	});
	const res = await fetch(`${url}/rest/v1/search_runs?${params}`, {
		headers: headers(key)
	});
	if (!res.ok) return [];
	return (await res.json()) as SearchRun[];
}

export async function getSearchRun(runId: string): Promise<SearchRun | null> {
	const { url, key } = getConfig();
	const params = new URLSearchParams({ id: `eq.${runId}`, limit: '1' });
	const res = await fetch(`${url}/rest/v1/search_runs?${params}`, {
		headers: headers(key)
	});
	if (!res.ok) return null;
	const rows = (await res.json()) as SearchRun[];
	return rows[0] ?? null;
}

export async function updateSearchRunSummary(runId: string, summary: string): Promise<boolean> {
	const { url, key } = getServiceConfig();
	const res = await fetch(`${url}/rest/v1/search_runs?id=eq.${runId}`, {
		method: 'PATCH',
		headers: headers(key),
		body: JSON.stringify({ llm_summary: summary })
	});
	return res.ok;
}

export async function deleteSearchRun(userId: string, runId: string): Promise<boolean> {
	const { url, key } = getConfig();
	// Cascade: delete job matches that came from this run first
	await fetch(`${url}/rest/v1/user_job_matches?search_run_id=eq.${runId}&user_id=eq.${userId}`, {
		method: 'DELETE',
		headers: headers(key)
	});
	// Then delete the run itself
	const params = new URLSearchParams({ id: `eq.${runId}`, user_id: `eq.${userId}` });
	const res = await fetch(`${url}/rest/v1/search_runs?${params}`, {
		method: 'DELETE',
		headers: headers(key)
	});
	return res.ok;
}

/** Return IDs of search runs beyond the N most recent for a user. */
export async function getOldRunIds(userId: string, keepCount = 20): Promise<string[]> {
	const { url, key } = getConfig();
	const params = new URLSearchParams({
		user_id: `eq.${userId}`,
		select: 'id',
		order: 'created_at.desc',
		offset: String(keepCount),
		limit: '100'
	});
	const res = await fetch(`${url}/rest/v1/search_runs?${params}`, {
		headers: headers(key)
	});
	if (!res.ok) return [];
	const rows = (await res.json()) as { id: string }[];
	return rows.map((r) => r.id);
}

// ----------------------------------------------------------------
// User job matches (with joined canonical job data)
// ----------------------------------------------------------------

export async function getUserJobs(
	userId: string,
	opts: { limit?: number; offset?: number } = {}
): Promise<{ jobs: (UserJobMatch & { job: CanonicalJob })[]; count: number }> {
	const { url, key } = getConfig();
	const limit = opts.limit ?? 20;
	const offset = opts.offset ?? 0;

	const params = new URLSearchParams({
		user_id: `eq.${userId}`,
		select: '*, jobs_canonical(*)',
		order: 'created_at.desc',
		limit: String(limit),
		offset: String(offset)
	});

	const res = await fetch(`${url}/rest/v1/user_job_matches?${params}`, {
		headers: { ...headers(key), Prefer: 'count=exact' }
	});
	if (!res.ok) {
		console.error('[getUserJobs]', res.status, await res.text());
		return { jobs: [], count: 0 };
	}

	const countHeader = res.headers.get('content-range');
	const count = countHeader ? parseInt(countHeader.split('/')[1] || '0', 10) : 0;
	const rows = (await res.json()) as (UserJobMatch & { jobs_canonical: CanonicalJob })[];

	return {
		jobs: rows.map((r) => ({
			...r,
			job: r.jobs_canonical
		})),
		count
	};
}

export async function toggleJobSaved(matchId: string, saved: boolean): Promise<boolean> {
	const { url, key } = getConfig();
	const res = await fetch(`${url}/rest/v1/user_job_matches?id=eq.${matchId}`, {
		method: 'PATCH',
		headers: headers(key),
		body: JSON.stringify({ is_saved: saved })
	});
	return res.ok;
}

export async function deleteUserJobMatch(matchId: string): Promise<boolean> {
	const { url, key } = getServiceConfig();
	const res = await fetch(`${url}/rest/v1/user_job_matches?id=eq.${matchId}`, {
		method: 'DELETE',
		headers: headers(key)
	});
	return res.ok;
}

export async function deleteAllPersonalSearchData(userId: string): Promise<boolean> {
	const { url, key } = getServiceConfig();

	const deleteMatches = await fetch(`${url}/rest/v1/user_job_matches?user_id=eq.${userId}`, {
		method: 'DELETE',
		headers: headers(key)
	});
	if (!deleteMatches.ok) {
		const body = await deleteMatches.text();
		console.error('[deleteAll] user_job_matches failed:', deleteMatches.status, body);
		return false;
	}

	const deleteRuns = await fetch(`${url}/rest/v1/search_runs?user_id=eq.${userId}`, {
		method: 'DELETE',
		headers: headers(key)
	});
	if (!deleteRuns.ok) {
		const body = await deleteRuns.text();
		console.error('[deleteAll] search_runs failed:', deleteRuns.status, body);
		return false;
	}

	const deleteProfile = await fetch(`${url}/rest/v1/user_search_profiles?user_id=eq.${userId}`, {
		method: 'DELETE',
		headers: headers(key)
	});
	if (!deleteProfile.ok) {
		const body = await deleteProfile.text();
		console.error('[deleteAll] user_search_profiles failed:', deleteProfile.status, body);
	}

	return deleteProfile.ok;
}
