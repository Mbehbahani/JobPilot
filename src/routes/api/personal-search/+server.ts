import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/public';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { anyApi } from 'convex/server';
import {
	upsertSearchProfile,
	getOldRunIds,
	deleteSearchRun,
	updateSearchRunSummary
} from '$lib/server/personal-jobs/supabase';

// Extend Vercel serverless function timeout for long-running searches (search + LLM).
export const config = { maxDuration: 300 };

const personalSearchLlm = {
	standardizeInputs: anyApi.personalSearchLlm.standardizeInputs,
	interpretResult: anyApi.personalSearchLlm.interpretResult
};

const SEARCH_API = env.PUBLIC_PERSONAL_SEARCH_API_URL || 'http://localhost:8000';
const STANDARD_MAX_DAYS_BACK = 7;
const POWER_MAX_DAYS_BACK = 14;
const POWER_SEARCH_CODE = env.PUBLIC_PERSONAL_SEARCH_POWER_CODE?.trim() || '';

function isPowerModeReferenceCode(referenceCode: unknown): boolean {
	if (!POWER_SEARCH_CODE || typeof referenceCode !== 'string') {
		return false;
	}

	return referenceCode.trim() === POWER_SEARCH_CODE;
}

function buildFallbackSummary(args: {
	status: string;
	totalFound: number;
	totalNew: number;
	sourceSummary: Record<string, any>;
	keywords: string[];
	city?: string | null;
	country?: string | null;
}): string {
	const location = [args.city, args.country].filter(Boolean).join(', ');
	const locationPart = location ? ` in ${location}` : '';
	const keywordPart = args.keywords.length > 0 ? ` for ${args.keywords.join(', ')}` : '';

	const sourceParts = Object.entries(args.sourceSummary || {}).map(([src, info]) => {
		const found = Number(info?.found ?? 0);
		const added = Number(info?.new ?? 0);
		const err = info?.error ? ` (${String(info.error)})` : '';
		return `${src}: ${found} found, ${added} new${err}`;
	});

	if (args.status !== 'completed' && args.status !== 'partial_success') {
		return `Search finished with status ${args.status}. Found ${args.totalFound} jobs and ${args.totalNew} new${locationPart}${keywordPart}.`;
	}

	const primary = `Found ${args.totalFound} jobs, ${args.totalNew} new${locationPart}${keywordPart}.`;
	if (sourceParts.length === 0) {
		return primary;
	}
	return `${primary} ${sourceParts.join(' | ')}`;
}

function decodeJwtPayload(token: string): { sub?: string } | null {
	try {
		const payload = token.split('.')[1];
		if (!payload) return null;
		return JSON.parse(atob(payload));
	} catch {
		return null;
	}
}

function extractAuthUser(locals: App.Locals): { userId: string } | { error: string } {
	const token = locals.token;
	if (!token) return { error: 'Not authenticated' };
	const payload = decodeJwtPayload(token);
	const userId = payload?.sub;
	if (!userId) return { error: 'Invalid token' };
	return { userId };
}

function validateSearchBody(body: Record<string, unknown>, powerMode: boolean) {
	const maxDaysBack = powerMode ? POWER_MAX_DAYS_BACK : STANDARD_MAX_DAYS_BACK;
	const daysBack = Math.min(Math.max(Number(body.days_back) || 3, 1), maxDaysBack);
	const keywords = Array.isArray(body.keywords)
		? body.keywords
				.filter((k: unknown) => typeof k === 'string' && (k as string).trim())
				.slice(0, 10)
		: [];
	const allowedPlatforms = new Set(['indeed', 'linkedin']);
	const platforms = Array.isArray(body.platforms)
		? body.platforms.filter(
				(p: unknown) => typeof p === 'string' && allowedPlatforms.has((p as string).toLowerCase())
			)
		: ['indeed'];

	return { daysBack, keywords, platforms };
}

function sseEncode(event: string, data: object): Uint8Array {
	return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Standard (non-streaming) search */
export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = extractAuthUser(locals);
	if ('error' in auth) return json({ error: auth.error }, { status: 401 });

	const body = await request.json();
	const powerMode = isPowerModeReferenceCode(body.reference_code);
	const { daysBack, keywords, platforms } = validateSearchBody(body, powerMode);

	if (keywords.length === 0) {
		return json({ error: 'At least one keyword is required' }, { status: 400 });
	}

	const useStream = body.stream === true;

	// --- Persist search preferences ---
	try {
		await upsertSearchProfile(auth.userId, {
			keywords,
			city: body.city || null,
			country: body.country || null,
			days_back: daysBack,
			platforms: platforms.length > 0 ? platforms : ['indeed'],
			is_remote: Boolean(body.is_remote)
		});
	} catch (e) {
		console.warn('[personal-search] profile save skipped:', (e as Error).message);
	}

	// --- Auto-trim runs beyond 20 (cascade-deletes their jobs too) ---
	getOldRunIds(auth.userId, 20)
		.then(async (oldIds) => {
			for (const id of oldIds) {
				await deleteSearchRun(auth.userId, id);
			}
		})
		.catch(() => {});

	// --- LLM standardization via Convex action ---
	let standardized = {
		keywords,
		city: body.city || null,
		country: body.country || null,
		warnings: [] as string[]
	};
	let llmAvailable = false;
	try {
		const convex = createConvexHttpClient({ token: locals.token });
		const result = await convex.action(personalSearchLlm.standardizeInputs, {
			keywords,
			city: body.city || undefined,
			country: body.country || undefined
		});
		if (result) {
			standardized = result;
			llmAvailable = true;
		}
	} catch (e) {
		console.warn('[personal-search] LLM standardization skipped:', (e as Error).message);
	}

	const searchPayload = {
		user_id: auth.userId,
		keywords: standardized.keywords,
		city: standardized.city,
		country: standardized.country,
		days_back: daysBack,
		platforms: platforms.length > 0 ? platforms : ['indeed'],
		is_remote: Boolean(body.is_remote),
		power_mode: powerMode,
		open_ended: powerMode,
		llm_token: locals.token,
		llm_endpoint: `${new URL(request.url).origin}/api/personal-search/enrich-job`
	};

	try {
		if (useStream) {
			// Compose a new SSE stream: LLM step → backend stream → LLM interpretation
			const stream = new ReadableStream({
				async start(controller) {
					// Step 1: Emit standardization result
					if (llmAvailable && standardized.warnings.length > 0) {
						controller.enqueue(
							sseEncode('step', {
								step: 'standardize',
								message: `Inputs refined: ${standardized.warnings.join('. ')}. `
							})
						);
					} else {
						controller.enqueue(
							sseEncode('step', {
								step: 'standardize',
								message: 'Search inputs validated.'
							})
						);
					}

					// Step 2: Forward backend SSE stream
					let lastCompleteData: Record<string, unknown> | null = null;
					try {
						const backendRes = await fetch(`${SEARCH_API}/search/stream`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(searchPayload)
						});

						if (!backendRes.body) {
							controller.enqueue(sseEncode('error', { error: 'Backend not available' }));
							controller.close();
							return;
						}

						const reader = backendRes.body.getReader();
						const decoder = new TextDecoder();
						let buffer = '';

						while (true) {
							const { done, value } = await reader.read();
							if (done) break;
							const chunk = decoder.decode(value, { stream: true });
							buffer += chunk;

							// Parse events from buffer to capture the 'complete' event
							const lines = buffer.split('\n');
							buffer = lines.pop() || '';
							let currentEvent = '';
							for (const line of lines) {
								if (line.startsWith('event: ')) {
									currentEvent = line.slice(7).trim();
								} else if (line.startsWith('data: ') && currentEvent === 'complete') {
									try {
										lastCompleteData = JSON.parse(line.slice(6).trim());
									} catch {
										/* ignore */
									}
								}
							}

							// Forward raw chunk to client
							controller.enqueue(value);
						}
					} catch (_e) {
						controller.enqueue(sseEncode('error', { error: 'Search backend unavailable' }));
						controller.close();
						return;
					}

					// Step 3: LLM interpretation of results
					if (llmAvailable && lastCompleteData) {
						controller.enqueue(
							sseEncode('step', {
								step: 'interpret',
								message: 'Analyzing results...'
							})
						);
						let emittedSummary = false;
						try {
							const convex = createConvexHttpClient({ token: locals.token });
							const summary = await convex.action(personalSearchLlm.interpretResult, {
								status: String(lastCompleteData.status ?? 'completed'),
								totalFound: Number(lastCompleteData.total_found ?? 0),
								totalNew: Number(lastCompleteData.total_new ?? 0),
								sourceSummary: lastCompleteData.source_summary ?? {},
								keywords: standardized.keywords,
								city: standardized.city ?? undefined,
								country: standardized.country ?? undefined
							});
							if (summary) {
								controller.enqueue(sseEncode('interpretation', { summary }));
								// Persist so the summary survives page reloads
								const runId = String(lastCompleteData.run_id ?? '');
								if (runId) updateSearchRunSummary(runId, summary).catch(() => {});
								emittedSummary = true;
							}
						} catch (e) {
							console.warn('[personal-search] LLM interpretation skipped:', (e as Error).message);
						}

						if (!emittedSummary) {
							const fallbackSummary = buildFallbackSummary({
								status: String(lastCompleteData.status ?? 'completed'),
								totalFound: Number(lastCompleteData.total_found ?? 0),
								totalNew: Number(lastCompleteData.total_new ?? 0),
								sourceSummary: (lastCompleteData.source_summary ?? {}) as Record<string, any>,
								keywords: standardized.keywords,
								city: standardized.city ?? undefined,
								country: standardized.country ?? undefined
							});
							controller.enqueue(sseEncode('interpretation', { summary: fallbackSummary }));
							const runId = String(lastCompleteData.run_id ?? '');
							if (runId) updateSearchRunSummary(runId, fallbackSummary).catch(() => {});
						}
					}

					controller.close();
				}
			});

			return new Response(stream, {
				headers: {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache',
					Connection: 'keep-alive'
				}
			});
		}

		// Non-streaming path
		const res = await fetch(`${SEARCH_API}/search`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(searchPayload)
		});
		const data = await res.json();

		// Add LLM interpretation for non-streaming
		if (data.status) {
			try {
				const convex = createConvexHttpClient({ token: locals.token });
				const summary = await convex.action(personalSearchLlm.interpretResult, {
					status: data.status,
					totalFound: data.total_found ?? 0,
					totalNew: data.total_new ?? 0,
					sourceSummary: data.source_summary ?? {},
					keywords: standardized.keywords,
					city: standardized.city ?? undefined,
					country: standardized.country ?? undefined
				});
				if (summary) {
					data.llm_summary = summary;
					// Persist so the summary survives page reloads
					if (data.run_id) updateSearchRunSummary(data.run_id, summary).catch(() => {});
				}
			} catch {
				/* skip interpretation */
			}

			if (!data.llm_summary) {
				const fallbackSummary = buildFallbackSummary({
					status: String(data.status ?? 'completed'),
					totalFound: Number(data.total_found ?? 0),
					totalNew: Number(data.total_new ?? 0),
					sourceSummary: (data.source_summary ?? {}) as Record<string, any>,
					keywords: standardized.keywords,
					city: standardized.city ?? undefined,
					country: standardized.country ?? undefined
				});
				data.llm_summary = fallbackSummary;
				if (data.run_id) updateSearchRunSummary(data.run_id, fallbackSummary).catch(() => {});
			}
		}

		return json(data, { status: res.ok ? 200 : 502 });
	} catch (e) {
		console.error('[personal-search API proxy]', e);
		return json({ error: 'Search backend unavailable', status: 'failed' }, { status: 502 });
	}
};
