<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Accordion from '$lib/components/ui/accordion';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import BookmarkIcon from '@lucide/svelte/icons/bookmark';
	import SendIcon from '@lucide/svelte/icons/send';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import type { CanonicalJob, PersonalJobMetadata } from '$lib/server/personal-jobs/supabase';
	import type { PageData } from './$types';
	import { invalidateAll, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { env as publicEnv } from '$env/dynamic/public';

	let { data }: { data: PageData } = $props();
	const POWER_SEARCH_CODE = (publicEnv.PUBLIC_PERSONAL_SEARCH_POWER_CODE ?? '').trim();
	const STANDARD_MAX_DAYS_BACK = 7;
	const POWER_MAX_DAYS_BACK = 14;
	const POWER_MODE_STORAGE_KEY = 'JobPilot:personal-search-power-code';
	const powerModeHoverSummary =
		'Power mode expands the search window to 14 days, extends the backend runtime budget to 6 minutes, and increases LinkedIn coverage to 4 query variations with up to 20 results per query.';

	// ── Form state (persists across searches) ──
	let keywords = $state(data.profile?.keywords?.join(', ') ?? '');
	let city = $state(data.profile?.city ?? '');
	let country = $state(data.profile?.country ?? '');
	let daysBack = $state(String(data.profile?.days_back ?? 3));
	let isRemote = $state(data.profile?.is_remote ?? false);
	let useIndeed = $state(data.profile?.platforms?.includes('indeed') ?? true);
	let useLinkedin = $state(data.profile?.platforms?.includes('linkedin') ?? false);
	let referenceCode = $state(browser ? (localStorage.getItem(POWER_MODE_STORAGE_KEY) ?? '') : '');
	let powerDetailsOpen = $state(false);

	$effect(() => {
		if (!browser) return;
		const savedCode = localStorage.getItem(POWER_MODE_STORAGE_KEY) ?? '';
		if (!savedCode) return;
		if (POWER_SEARCH_CODE && savedCode === POWER_SEARCH_CODE) {
			referenceCode = savedCode;
			return;
		}
		localStorage.removeItem(POWER_MODE_STORAGE_KEY);
		if (referenceCode === savedCode) {
			referenceCode = '';
		}
	});

	let clearingAllData = $state(false);
	let generatingKeywords = $state(false);
	let selectedMatchIds = $state<string[]>([]);

	async function _clearAllPersonalSearchData() {
		clearingAllData = true;
		try {
			const res = await fetch('/api/personal-search/actions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'delete_all' })
			});
			if (res.ok) {
				await invalidateAll();
			}
		} finally {
			clearingAllData = false;
		}
	}

	function toggleSelectedMatch(matchId: string, checked: boolean) {
		selectedMatchIds = checked
			? [...selectedMatchIds, matchId]
			: selectedMatchIds.filter((id) => id !== matchId);
	}

	function toggleSelectAllVisible() {
		const visibleIds = sortedJobs().map((match) => match.id);
		const allSelected =
			visibleIds.length > 0 && visibleIds.every((id) => selectedMatchIds.includes(id));
		selectedMatchIds = allSelected ? [] : visibleIds;
	}

	async function deleteSelectedMatches() {
		if (selectedMatchIds.length === 0) return;
		clearingAllData = true;
		try {
			for (const matchId of selectedMatchIds) {
				await fetch('/api/personal-search/actions', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ matchId, action: 'delete' })
				});
			}
			selectedMatchIds = [];
			await invalidateAll();
		} finally {
			clearingAllData = false;
		}
	}

	async function fillKeywordsFromProfile() {
		generatingKeywords = true;
		try {
			const res = await fetch('/api/personal-search/suggest-keywords', { method: 'POST' });
			const result = await res.json();
			if (res.ok && result.ok && Array.isArray(result.keywords) && result.keywords.length > 0) {
				keywords = result.keywords.join(', ');
			} else if (result?.error) {
				searchResult = { status: 'failed', error: result.error };
			}
		} catch {
			searchResult = { status: 'failed', error: 'Could not generate keywords from your profile.' };
		} finally {
			generatingKeywords = false;
		}
	}

	// ── Search state ──
	let searching = $state(false);
	let searchResult = $state<{
		status: string;
		total_found?: number;
		total_new?: number;
		error?: string;
		llm_summary?: string;
		source_summary?: Record<string, { found: number; new: number; error?: string }>;
	} | null>(null);

	// ── Progress steps ──
	type ProgressStep = {
		id: string;
		message: string;
		done: boolean;
	};
	let progressSteps = $state<ProgressStep[]>([]);

	const powerModeAvailable = $derived(POWER_SEARCH_CODE.length > 0);
	const powerModeEnabled = $derived(
		powerModeAvailable && referenceCode.trim() === POWER_SEARCH_CODE
	);
	const effectiveMaxDaysBack = $derived(
		powerModeEnabled ? POWER_MAX_DAYS_BACK : STANDARD_MAX_DAYS_BACK
	);

	function applyPowerMode() {
		if (!POWER_SEARCH_CODE || referenceCode.trim() !== POWER_SEARCH_CODE) return;
		if (browser) localStorage.setItem(POWER_MODE_STORAGE_KEY, POWER_SEARCH_CODE);
	}

	function clearPowerMode() {
		if (browser) localStorage.removeItem(POWER_MODE_STORAGE_KEY);
		referenceCode = '';
		if ((Number(daysBack) || 0) > STANDARD_MAX_DAYS_BACK) {
			daysBack = String(STANDARD_MAX_DAYS_BACK);
		}
	}

	// ── Job detail dialog ──
	let selectedJob = $state<(typeof data.jobs)[number] | null>(null);
	let dialogOpen = $state(false);
	let filtersOpen = $state(false);

	// ── Sorting ──
	let sortField = $state<'match_score' | 'posted_date' | 'title' | 'run_date'>('run_date');
	let sortDir = $state<'asc' | 'desc'>('desc');

	// ── Run code maps ──
	const runCodeMap = $derived.by(() => {
		const sorted = [...data.recentRuns].sort(
			(a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
		);
		const byDate: Record<string, string[]> = {};
		for (const run of sorted) {
			const d = new Date(run.created_at);
			const key = `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
			(byDate[key] ??= []).push(run.id);
		}
		const map: Record<string, string> = {};
		for (const [dateKey, ids] of Object.entries(byDate)) {
			ids.forEach((id, i) => {
				map[id] = ids.length === 1 ? dateKey : `${dateKey}-${i + 1}`;
			});
		}
		return map;
	});

	const runTimestampMap = $derived(
		Object.fromEntries(data.recentRuns.map((r) => [r.id, new Date(r.created_at).getTime()]))
	);

	// ── Action feedback ──
	let actionFeedback = $state<Record<string, { message: string; type: 'success' | 'error' }>>({});
	let sentToTasksState = $state<
		Record<string, 'idle' | 'loading' | 'success' | 'duplicate' | 'error'>
	>({});
	let searchQuery = $state('');

	function normalizeFilterOption(value: string | null | undefined): string {
		const normalized = typeof value === 'string' ? value.trim() : '';
		if (!normalized || normalized === '—') return 'NA';
		return normalized;
	}

	// ── Filters ──
	let levelFilter = $state<string[]>([]);
	let functionFilter = $state<string[]>([]);
	let educationFilter = $state<string[]>([]);
	let countryFilter = $state<string[]>([]);
	let sourceFilter = $state<string[]>([]);
	let remoteFilter = $state<string[]>([]);
	let runFilter = $state<string[]>([]);
	let searchTermFilter = $state<string[]>([]);

	const levelOptions = $derived.by(() => {
		const values = Array.from(
			new Set(data.jobs.map((match) => normalizeFilterOption(getJobLevel(match.job))))
		).sort();
		return values;
	});

	const functionOptions = $derived.by(() => {
		const values = Array.from(
			new Set(data.jobs.map((match) => normalizeFilterOption(getJobFunction(match.job))))
		).sort();
		return values;
	});

	const educationOptions = $derived.by(() => {
		const values = Array.from(
			new Set(
				data.jobs.flatMap((match) => {
					const levels = getEducationLevels(match.job);
					return levels.length > 0 ? levels.map((level) => normalizeFilterOption(level)) : ['NA'];
				})
			)
		).sort();
		return values;
	});

	const countryOptions = $derived.by(() => {
		const values = Array.from(
			new Set(data.jobs.map((match) => normalizeFilterOption(match.job?.country)))
		).sort();
		return values;
	});

	const sourceOptions = $derived.by(() => {
		const values = Array.from(
			new Set(data.jobs.map((match) => normalizeFilterOption(match.job?.source)))
		).sort();
		return values;
	});

	const remoteOptions = ['Remote', 'On-site'];

	const _runOptions = $derived.by(() => {
		const values = Array.from(
			new Set(data.jobs.map((match) => runCodeMap[match.search_run_id ?? '']).filter(Boolean))
		).sort();
		return values;
	});

	const searchTermOptions = $derived.by(() => {
		const values = Array.from(
			new Set(data.jobs.map((match) => normalizeFilterOption(getSearchTerm(match))))
		).sort();
		return values;
	});

	const hasActiveFilters = $derived(
		levelFilter.length > 0 ||
			functionFilter.length > 0 ||
			educationFilter.length > 0 ||
			countryFilter.length > 0 ||
			sourceFilter.length > 0 ||
			remoteFilter.length > 0 ||
			runFilter.length > 0 ||
			searchTermFilter.length > 0
	);

	function toggleFilterValue(list: string[], value: string): string[] {
		return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
	}

	function toggleLevelFilter(value: string) {
		levelFilter = toggleFilterValue(levelFilter, value);
	}

	function toggleFunctionFilter(value: string) {
		functionFilter = toggleFilterValue(functionFilter, value);
	}

	function toggleEducationFilter(value: string) {
		educationFilter = toggleFilterValue(educationFilter, value);
	}

	function toggleCountryFilter(value: string) {
		countryFilter = toggleFilterValue(countryFilter, value);
	}

	function toggleSourceFilter(value: string) {
		sourceFilter = toggleFilterValue(sourceFilter, value);
	}

	function toggleRemoteFilter(value: string) {
		remoteFilter = toggleFilterValue(remoteFilter, value);
	}

	function _toggleRunFilter(value: string) {
		runFilter = toggleFilterValue(runFilter, value);
	}

	function toggleSearchTermFilter(value: string) {
		searchTermFilter = toggleFilterValue(searchTermFilter, value);
	}

	function clearFilters() {
		levelFilter = [];
		functionFilter = [];
		educationFilter = [];
		countryFilter = [];
		sourceFilter = [];
		remoteFilter = [];
		runFilter = [];
		searchTermFilter = [];
	}

	const sortedJobs = $derived(() => {
		const jobs = data.jobs.filter((match) => {
			const level = normalizeFilterOption(getJobLevel(match.job));
			const jobFunction = normalizeFilterOption(getJobFunction(match.job));
			const educationLevels =
				getEducationLevels(match.job).length > 0
					? getEducationLevels(match.job).map((level) => normalizeFilterOption(level))
					: ['NA'];
			const country = normalizeFilterOption(match.job?.country);
			const source = normalizeFilterOption(match.job?.source);
			const remoteState = match.job?.is_remote ? 'Remote' : 'On-site';
			const runCode = runCodeMap[match.search_run_id ?? ''] ?? 'NA';
			const searchTerm = normalizeFilterOption(getSearchTerm(match));
			const query = searchQuery.trim().toLowerCase();

			if (levelFilter.length > 0 && !levelFilter.includes(level)) return false;
			if (functionFilter.length > 0 && !functionFilter.includes(jobFunction)) return false;
			if (
				educationFilter.length > 0 &&
				!educationFilter.some((item) => educationLevels.includes(item))
			)
				return false;
			if (countryFilter.length > 0 && !countryFilter.includes(country)) return false;
			if (sourceFilter.length > 0 && !sourceFilter.includes(source)) return false;
			if (remoteFilter.length > 0 && !remoteFilter.includes(remoteState)) return false;
			if (runFilter.length > 0 && !runFilter.includes(runCode)) return false;
			if (searchTermFilter.length > 0 && !searchTermFilter.includes(searchTerm)) return false;
			if (query) {
				const haystack = [
					getActualRole(match.job),
					match.job?.company_name ?? '',
					getJobLevel(match.job),
					getJobFunction(match.job),
					...getEducationLevels(match.job),
					match.job?.country ?? '',
					match.job?.source ?? '',
					getSearchTerm(match),
					...getJobSkills(match.job)
				]
					.join(' ')
					.toLowerCase();
				if (!haystack.includes(query)) return false;
			}
			return true;
		});
		jobs.sort((a, b) => {
			if (sortField === 'run_date') {
				const tsA = runTimestampMap[a.search_run_id ?? ''] ?? 0;
				const tsB = runTimestampMap[b.search_run_id ?? ''] ?? 0;
				if (tsA !== tsB) return sortDir === 'desc' ? tsB - tsA : tsA - tsB;
				return (b.match_score ?? 0) - (a.match_score ?? 0);
			}
			let va: string | number = 0;
			let vb: string | number = 0;
			if (sortField === 'match_score') {
				va = a.match_score ?? 0;
				vb = b.match_score ?? 0;
			} else if (sortField === 'posted_date') {
				va = a.job?.posted_date ?? '';
				vb = b.job?.posted_date ?? '';
			} else if (sortField === 'title') {
				va = (a.job?.title ?? '').toLowerCase();
				vb = (b.job?.title ?? '').toLowerCase();
			}
			if (va < vb) return sortDir === 'asc' ? -1 : 1;
			if (va > vb) return sortDir === 'asc' ? 1 : -1;
			return 0;
		});
		return jobs;
	});

	// ── Pagination ──
	const totalPages = $derived(Math.max(1, Math.ceil(data.jobCount / data.pageSize)));
	const currentPage = $derived(data.page);

	function toggleSort(field: 'match_score' | 'posted_date' | 'title' | 'run_date') {
		if (sortField === field) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortField = field;
			sortDir = 'desc';
		}
	}

	// ── Search with SSE progress ──
	async function startSearch() {
		const kws = keywords
			.split(',')
			.map((k) => k.trim())
			.filter(Boolean);
		if (kws.length === 0) return;

		const platforms: string[] = [];
		if (useIndeed) platforms.push('indeed');
		if (useLinkedin) platforms.push('linkedin');
		if (platforms.length === 0) platforms.push('indeed');

		searching = true;
		searchResult = null;
		progressSteps = [
			{
				id: 'init',
				message: powerModeEnabled
					? 'Starting search. Power mode is enabled with expanded search limits. Please wait — this process can take several minutes.'
					: 'Starting search. Please wait — this process can take several minutes.',
				done: false
			}
		];

		try {
			const res = await fetch('/api/personal-search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					stream: true,
					keywords: kws,
					city: city || null,
					country: country || null,
					days_back: Math.min(Math.max(Number(daysBack) || 3, 1), effectiveMaxDaysBack),
					platforms,
					is_remote: isRemote,
					reference_code: referenceCode || null
				})
			});

			if (res.headers.get('content-type')?.includes('text/event-stream') && res.body) {
				// Read SSE stream
				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });

					// Parse SSE events from buffer
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					let currentEvent = '';
					let currentData = '';
					for (const line of lines) {
						if (line.startsWith('event: ')) {
							currentEvent = line.slice(7).trim();
						} else if (line.startsWith('data: ')) {
							currentData = line.slice(6).trim();
							if (currentEvent && currentData) {
								handleSSEEvent(currentEvent, currentData);
								currentEvent = '';
								currentData = '';
							}
						}
					}
				}
			} else {
				// Fallback: non-streaming JSON response
				searchResult = await res.json();
			}

			// After search completes, refresh data without losing form state
			await invalidateAll();
		} catch (_e) {
			searchResult = {
				status: 'failed',
				error: 'Network error. Is the search backend running?'
			};
		} finally {
			searching = false;
		}
	}

	function handleSSEEvent(event: string, dataStr: string) {
		try {
			const data = JSON.parse(dataStr);
			if (event === 'step') {
				// Mark previous steps as done
				progressSteps = progressSteps.map((s) => ({ ...s, done: true }));
				// Add new step
				progressSteps = [...progressSteps, { id: data.step, message: data.message, done: false }];
			} else if (event === 'complete') {
				progressSteps = progressSteps.map((s) => ({ ...s, done: true }));
				searchResult = data;
			} else if (event === 'interpretation') {
				// LLM summary from Convex arrives after backend stream completes
				progressSteps = progressSteps.map((s) => ({ ...s, done: true }));
				if (searchResult && data.summary) {
					searchResult = { ...searchResult, llm_summary: data.summary };
				}
			} else if (event === 'error') {
				progressSteps = progressSteps.map((s) => ({ ...s, done: true }));
				searchResult = { status: 'failed', error: data.error };
			}
		} catch {
			// ignore parse errors
		}
	}

	// ── Actions ──
	function openJobDetail(job: (typeof data.jobs)[number]) {
		selectedJob = job;
		dialogOpen = true;
	}

	async function toggleSave(matchId: string, currentSaved: boolean, e: Event) {
		e.stopPropagation();
		const res = await fetch('/api/personal-search/actions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ matchId, action: 'save', value: !currentSaved })
		});
		if (res.ok) {
			actionFeedback = {
				...actionFeedback,
				[matchId]: {
					message: currentSaved ? 'Unsaved' : 'Saved',
					type: 'success'
				}
			};
			await invalidateAll();
			setTimeout(() => {
				const { [matchId]: _, ...rest } = actionFeedback;
				actionFeedback = rest;
			}, 2000);
		}
	}

	async function _deleteMatch(matchId: string, e: Event) {
		e.stopPropagation();
		const res = await fetch('/api/personal-search/actions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ matchId, action: 'delete' })
		});
		if (res.ok) {
			await invalidateAll();
		}
	}

	async function sendToTasks(match: (typeof data.jobs)[number], e: Event) {
		e.stopPropagation();
		const job = match.job;
		if (!job) return;
		if (sentToTasksState[match.id] === 'success' || sentToTasksState[match.id] === 'duplicate')
			return;

		sentToTasksState = { ...sentToTasksState, [match.id]: 'loading' };

		const res = await fetch('/api/personal-search/send-to-tasks', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: getActualRole(job),
				companyName: job.company_name,
				position: getActualRole(job),
				jobUrl: job.canonical_url,
				description: job.description_clean || job.description,
				skills: getJobSkills(job).join(', '),
				country: job.country,
				jobLevel: getJobLevel(job),
				jobType: job.job_type,
				platform: job.source
			})
		});
		const result = await res.json();

		if (result.duplicate) {
			sentToTasksState = { ...sentToTasksState, [match.id]: 'duplicate' };
			actionFeedback = {
				...actionFeedback,
				[match.id]: { message: 'Already in tasks', type: 'error' }
			};
		} else if (result.ok) {
			sentToTasksState = { ...sentToTasksState, [match.id]: 'success' };
			actionFeedback = {
				...actionFeedback,
				[match.id]: { message: 'Added to tasks!', type: 'success' }
			};
		} else {
			sentToTasksState = { ...sentToTasksState, [match.id]: 'error' };
			actionFeedback = {
				...actionFeedback,
				[match.id]: { message: result.message || 'Failed', type: 'error' }
			};
			setTimeout(() => {
				if (sentToTasksState[match.id] === 'error') {
					sentToTasksState = { ...sentToTasksState, [match.id]: 'idle' };
				}
			}, 3000);
		}
		setTimeout(() => {
			const { [match.id]: _, ...rest } = actionFeedback;
			actionFeedback = rest;
		}, 3000);
	}

	async function goToPage(p: number) {
		const url = new URL(page.url);
		url.searchParams.set('page', String(p));
		await goto(resolve(url.pathname + url.search), { invalidateAll: true });
	}

	// ── Helpers ──
	function platformColor(source: string): 'default' | 'secondary' | 'outline' | 'destructive' {
		switch (source?.toLowerCase()) {
			case 'linkedin':
				return 'default';
			case 'indeed':
				return 'secondary';
			default:
				return 'outline';
		}
	}

	function _scoreColor(score: number): string {
		if (score >= 7) return 'text-green-600 dark:text-green-400';
		if (score >= 4) return 'text-yellow-600 dark:text-yellow-400';
		return 'text-muted-foreground';
	}

	function formatDate(dateStr: string | null | undefined): string {
		if (!dateStr) return '—';
		try {
			const d = new Date(dateStr);
			const day = d.toLocaleDateString('en-GB', { day: 'numeric' });
			const month = d.toLocaleDateString('en-GB', { month: 'short' });
			const year = d.toLocaleDateString('en-GB', { year: '2-digit' });
			return `${day} ${month} ${year}`;
		} catch {
			return dateStr;
		}
	}

	function formatDateTime(dateStr: string | null | undefined): string {
		if (!dateStr) return '—';
		try {
			const d = new Date(dateStr);
			const date = d.toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric',
				year: 'numeric'
			});
			const time = d.toLocaleTimeString('en-US', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: false
			});
			return `${date}, ${time}`;
		} catch {
			return dateStr;
		}
	}

	function statusBadgeVariant(status: string): 'default' | 'secondary' | 'outline' | 'destructive' {
		switch (status) {
			case 'completed':
				return 'default';
			case 'partial_success':
				return 'secondary';
			case 'running':
			case 'queued':
				return 'outline';
			case 'failed':
			case 'rate_limited':
				return 'destructive';
			default:
				return 'outline';
		}
	}

	function formatLocation(job: CanonicalJob | undefined): string {
		if (!job) return '—';
		const parts = [job.city, job.country].filter(Boolean);
		if (parts.length > 0) return parts.join(', ');
		if (job.location_text) return job.location_text;
		return '—';
	}

	function getMeta(job: CanonicalJob | undefined): PersonalJobMetadata {
		return (job?.metadata_json ?? {}) as PersonalJobMetadata;
	}

	function getActualRole(job: CanonicalJob | undefined): string {
		return getMeta(job).actual_role || job?.title || '—';
	}

	function getJobLevel(job: CanonicalJob | undefined): string {
		return getMeta(job).job_level_std || 'Not Specified';
	}

	function getJobFunction(job: CanonicalJob | undefined): string {
		return getMeta(job).job_function_std || 'Other';
	}

	function getJobSkills(job: CanonicalJob | undefined): string[] {
		return getMeta(job).skills || [];
	}

	function getEducationLevels(job: CanonicalJob | undefined): string[] {
		return getMeta(job).education_level || [];
	}

	function getSearchTerm(match: (typeof data.jobs)[number]): string {
		if (match.matched_keywords?.length) return match.matched_keywords[0] ?? 'N/A';
		const run = data.recentRuns.find((r) => r.id === match.search_run_id);
		return run?.requested_keywords?.[0] ?? 'N/A';
	}

	function levelClasses(level: string): string {
		switch (level) {
			case 'Entry Level':
				return 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300';
			case 'Mid-Level':
				return 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300';
			case 'Senior':
				return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300';
			case 'Director':
				return 'bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-300';
			case 'Executive':
				return 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300';
			case 'Internship':
				return 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300';
			default:
				return 'bg-muted text-muted-foreground';
		}
	}

	function functionClasses(jobFunction: string): string {
		switch (jobFunction) {
			case 'Engineering':
				return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-900';
			case 'Data Science & Analytics':
				return 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-900';
			case 'Supply Chain & Logistics':
				return 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/60 dark:text-green-300 dark:border-green-900';
			case 'Operations Research':
				return 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-900';
			default:
				return 'bg-muted text-muted-foreground border-border';
		}
	}

	function relevanceColor(score: number): string {
		if (score >= 8) return 'bg-teal-500';
		if (score >= 6) return 'bg-green-500';
		if (score >= 4) return 'bg-yellow-500';
		if (score >= 2) return 'bg-orange-500';
		return 'bg-red-500';
	}

	function runBadgeClasses(runCode: string): string {
		const colors = [
			'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-900',
			'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/60 dark:text-green-300 dark:border-green-900',
			'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-900',
			'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-900',
			'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-900'
		];
		let hash = 0;
		for (const char of runCode) hash = (hash + char.charCodeAt(0)) % colors.length;
		return colors[hash] ?? colors[0];
	}

	function sendIconClasses(matchId: string): string {
		const state = sentToTasksState[matchId] ?? 'idle';
		if (state === 'success' || state === 'duplicate') {
			return 'text-green-600';
		}
		if (state === 'error') {
			return 'text-red-600';
		}
		return 'text-muted-foreground hover:text-blue-600';
	}
</script>

<SEOHead title="My Job Search" description="Personal job search and tracking" />

<div class="space-y-4 px-4 py-6 lg:px-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">My Job Search</h1>
		</div>
	</div>

	<!-- Search Preferences Card -->
	<Card.Root>
		<Card.Header>
			<Card.Title>Search Preferences</Card.Title>
		</Card.Header>
		<Card.Content>
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<div class="sm:col-span-2 lg:col-span-4">
					<div class="flex items-center gap-2">
						<label for="keywords" class="text-sm font-medium">Keywords (comma-separated)</label>
						<Button
							variant="outline"
							size="sm"
							onclick={fillKeywordsFromProfile}
							disabled={generatingKeywords}
						>
							{generatingKeywords ? 'Filling…' : 'Fill from CV / Profile'}
						</Button>
					</div>
					<Input
						id="keywords"
						bind:value={keywords}
						placeholder="e.g. data engineer, backend developer, Python"
						class="mt-1"
					/>
				</div>
				<div>
					<label for="city" class="text-sm font-medium">City</label>
					<Input id="city" bind:value={city} placeholder="e.g. Berlin" class="mt-1" />
				</div>
				<div>
					<label for="country" class="text-sm font-medium">Country</label>
					<Input id="country" bind:value={country} placeholder="e.g. Germany" class="mt-1" />
				</div>
				<div>
					<label for="days" class="text-sm font-medium">Days Back (1–{effectiveMaxDaysBack})</label>
					<Input
						id="days"
						type="number"
						min="1"
						max={String(effectiveMaxDaysBack)}
						bind:value={daysBack}
						class="mt-1"
					/>
					<p class="text-muted-foreground mt-1 text-xs">
						{#if powerModeEnabled}
							Power mode doubles the time window from 7 to 14 days for this run.
						{:else}
							Standard mode searches up to 7 days. Apply Power mode to extend this to 14 days.
						{/if}
					</p>
				</div>
				<div>
					<div class="flex items-center gap-2">
						<label for="reference-code" class="text-sm font-medium">Reference (optional)</label>
						{#if powerModeAvailable}
							<button
								type="button"
								class="cursor-pointer rounded-full"
								title={powerModeHoverSummary}
								onclick={() => {
									powerDetailsOpen = !powerDetailsOpen;
								}}
							>
								<Badge variant={powerModeEnabled ? 'default' : 'outline'} class="text-xs">
									{powerModeEnabled ? 'Power' : 'Bonus'}
								</Badge>
							</button>
						{/if}
					</div>
					<div class="mt-1 flex gap-2">
						<Input
							id="reference-code"
							bind:value={referenceCode}
							placeholder="Optional"
							class="flex-1"
						/>
						<Button
							type="button"
							variant={powerModeEnabled ? 'secondary' : 'outline'}
							onclick={powerModeEnabled ? clearPowerMode : applyPowerMode}
							disabled={!powerModeAvailable ||
								searching ||
								(!powerModeEnabled && referenceCode.trim() !== POWER_SEARCH_CODE)}
						>
							{powerModeEnabled ? 'Applied' : 'Apply'}
						</Button>
					</div>
					{#if powerDetailsOpen}
						<div class="bg-muted/40 mt-3 space-y-2 rounded-lg border p-3 text-xs">
							<p class="font-medium">Technical upgrades in Power mode</p>
							<ul class="text-muted-foreground list-disc space-y-1 pl-4">
								<li>Search window increases from 7 days to 14 days.</li>
								<li>Backend search runtime budget increases from 3 minutes to 6 minutes.</li>
								<li>LinkedIn expands from 2 to 4 query variations.</li>
								<li>LinkedIn expands from 10 to 20 results per query.</li>
								<li>
									Activate Bonus mode with a reference code after supporting “Help keep it running”.
								</li>
							</ul>
						</div>
					{/if}
				</div>
				<div class="flex items-end">
					<Button onclick={startSearch} disabled={searching}>
						{#if searching}
							<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
							Searching…
						{:else}
							<SearchIcon class="mr-2 h-4 w-4" />
							Start Search
						{/if}
					</Button>
				</div>
				<div class="flex items-end gap-4">
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={useIndeed} class="accent-primary" />
						<span class="text-sm">Indeed</span>
					</label>
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={useLinkedin} class="accent-primary" />
						<span class="text-sm">LinkedIn</span>
					</label>
				</div>
				<div class="flex items-end">
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={isRemote} class="accent-primary" />
						<span class="text-sm">Remote preferred</span>
					</label>
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Progress Steps (shown during search) -->
	{#if searching && progressSteps.length > 0}
		<Card.Root>
			<Card.Content class="py-4">
				<div class="space-y-2">
					{#each progressSteps as step (step.message)}
						<div class="flex items-center gap-2 text-sm">
							{#if step.done}
								<CheckCircleIcon class="h-4 w-4 text-green-500" />
							{:else}
								<LoaderIcon class="h-4 w-4 animate-spin text-blue-500" />
							{/if}
							<span class:text-muted-foreground={step.done}>{step.message}</span>
						</div>
					{/each}
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	<!-- Search Result Banner -->
	{#if searchResult && !searching}
		<div
			class="rounded-lg border p-4 {searchResult.status === 'completed'
				? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950'
				: searchResult.status === 'partial_success'
					? 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950'
					: 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950'}"
		>
			<div class="flex items-center gap-2">
				<Badge variant={statusBadgeVariant(searchResult.status)}>
					{searchResult.status.replace('_', ' ')}
				</Badge>
				{#if searchResult.total_found}
					<span class="text-sm">
						Found {searchResult.total_found} jobs, {searchResult.total_new} new
					</span>
				{/if}
				{#if searchResult.error}
					<span class="text-destructive text-sm">{searchResult.error}</span>
				{/if}
			</div>
			{#if searchResult.llm_summary}
				<p class="mt-2 text-sm">{searchResult.llm_summary}</p>
			{/if}
			{#if searchResult.source_summary}
				<div class="mt-2 flex gap-4 text-xs">
					{#each Object.entries(searchResult.source_summary) as [src, info] (src)}
						<span>
							<strong class="capitalize">{src}</strong>: {info.found} found, {info.new} new
							{#if info.error}
								<span class="text-destructive">({info.error})</span>
							{/if}
						</span>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Recent Search Runs -->
	{#if data.recentRuns.length > 0}
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Recent Searches</Card.Title>
			</Card.Header>
			<Card.Content>
				{@const latestRun = data.recentRuns[0]}
				{@const olderRuns = data.recentRuns.slice(1)}

				<!-- Latest search (always visible) -->
				<div class="mb-2 rounded-md border p-3">
					<div class="flex flex-wrap items-center gap-2 text-sm">
						<Badge
							variant="outline"
							class={`text-xs ${runBadgeClasses(runCodeMap[latestRun.id] ?? 'NA')}`}
						>
							{runCodeMap[latestRun.id] ?? 'NA'}
						</Badge>
						<Badge variant={statusBadgeVariant(latestRun.status)} class="text-xs">
							{latestRun.status.replace('_', ' ')}
						</Badge>
						<span class="font-medium">{latestRun.requested_keywords?.join(', ')}</span>
						{#if latestRun.city || latestRun.country}
							<span class="text-muted-foreground">
								in {[latestRun.city, latestRun.country].filter(Boolean).join(', ')}
							</span>
						{/if}
						<span class="text-muted-foreground">
							{latestRun.total_new ?? 0} new / {latestRun.total_found ?? 0} total
						</span>
						<Badge variant="outline" class="text-xs">{latestRun.days_back}d</Badge>
						<span class="text-muted-foreground text-xs">{formatDateTime(latestRun.created_at)}</span
						>
					</div>
					{#if latestRun.llm_summary}
						<p class="text-muted-foreground mt-1.5 text-sm">{latestRun.llm_summary}</p>
					{/if}
					{#if latestRun.error_message}
						<p class="text-destructive mt-1.5 text-xs">Error: {latestRun.error_message}</p>
					{/if}
					{#if latestRun.source_summary_json}
						{@const sourceErrors = Object.entries(
							latestRun.source_summary_json as Record<string, { error?: string }>
						).filter(([, s]) => s?.error)}
						{#if sourceErrors.length > 0}
							<div class="mt-1.5 flex flex-wrap gap-2">
								{#each sourceErrors as [src, s] (src)}
									<span class="text-destructive text-xs capitalize">{src}: {s.error}</span>
								{/each}
							</div>
						{/if}
					{/if}
				</div>

				<!-- Older searches (collapsed by default) -->
				{#if olderRuns.length > 0}
					<Accordion.Root type="single" class="border-none">
						<Accordion.Item value="older">
							<Accordion.Trigger class="py-2 text-xs text-muted-foreground">
								{olderRuns.length} older {olderRuns.length === 1 ? 'search' : 'searches'}
							</Accordion.Trigger>
							<Accordion.Content>
								<div class="space-y-1.5">
									{#each olderRuns as run (run.id)}
										<div
											class="flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-xs"
										>
											<Badge
												variant="outline"
												class={`text-xs ${runBadgeClasses(runCodeMap[run.id] ?? 'NA')}`}
											>
												{runCodeMap[run.id] ?? 'NA'}
											</Badge>
											<Badge variant={statusBadgeVariant(run.status)} class="text-xs">
												{run.status.replace('_', ' ')}
											</Badge>
											<span>{run.requested_keywords?.join(', ')}</span>
											{#if run.city || run.country}
												<span class="text-muted-foreground">
													in {[run.city, run.country].filter(Boolean).join(', ')}
												</span>
											{/if}
											<span class="text-muted-foreground">
												{run.total_new ?? 0} new / {run.total_found ?? 0} total
											</span>
											<Badge variant="outline" class="text-xs">{run.days_back}d</Badge>
											<span class="text-muted-foreground">{formatDateTime(run.created_at)}</span>
											{#if run.llm_summary}
												<span class="text-muted-foreground basis-full pl-0">
													{run.llm_summary}
												</span>
											{/if}
										</div>
									{/each}
								</div>
							</Accordion.Content>
						</Accordion.Item>
					</Accordion.Root>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<div class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-2">
					<Card.Title class="text-base">Filters</Card.Title>
					{#if hasActiveFilters}
						<Badge variant="secondary" class="text-[10px]">Active</Badge>
					{/if}
				</div>
				<div class="flex items-center gap-2">
					{#if hasActiveFilters}
						<Button variant="ghost" size="sm" class="h-8 px-2" onclick={clearFilters}>
							Clear Filters
						</Button>
					{/if}
					<Button
						variant="outline"
						size="sm"
						class="h-8 px-3"
						onclick={() => (filtersOpen = !filtersOpen)}
					>
						{filtersOpen ? 'Hide Filters' : 'Show Filters'}
					</Button>
				</div>
			</div>
		</Card.Header>
		{#if filtersOpen}
			<Card.Content class="pt-0">
				<div class="space-y-3">
					<div>
						<div class="mb-1 text-xs font-medium text-muted-foreground">Level</div>
						<div class="flex flex-wrap gap-2">
							{#each levelOptions as option (option)}
								<button
									type="button"
									class={`rounded-full border px-2 py-1 text-xs ${levelFilter.includes(option) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border'}`}
									onclick={() => toggleLevelFilter(option)}
								>
									{option}
								</button>
							{/each}
						</div>
					</div>

					<div>
						<div class="mb-1 text-xs font-medium text-muted-foreground">Function</div>
						<div class="flex flex-wrap gap-2">
							{#each functionOptions as option (option)}
								<button
									type="button"
									class={`rounded-full border px-2 py-1 text-xs ${functionFilter.includes(option) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border'}`}
									onclick={() => toggleFunctionFilter(option)}
								>
									{option}
								</button>
							{/each}
						</div>
					</div>

					<div>
						<div class="mb-1 text-xs font-medium text-muted-foreground">Education</div>
						<div class="flex flex-wrap gap-2">
							{#each educationOptions as option (option)}
								<button
									type="button"
									class={`rounded-full border px-2 py-1 text-xs ${educationFilter.includes(option) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border'}`}
									onclick={() => toggleEducationFilter(option)}
								>
									{option}
								</button>
							{/each}
						</div>
					</div>

					<div>
						<div class="mb-1 text-xs font-medium text-muted-foreground">Country</div>
						<div class="flex flex-wrap gap-2">
							{#each countryOptions as option (option)}
								<button
									type="button"
									class={`rounded-full border px-2 py-1 text-xs ${countryFilter.includes(option) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border'}`}
									onclick={() => toggleCountryFilter(option)}
								>
									{option}
								</button>
							{/each}
						</div>
					</div>

					<div>
						<div class="mb-1 text-xs font-medium text-muted-foreground">Source</div>
						<div class="flex flex-wrap gap-2">
							{#each sourceOptions as option (option)}
								<button
									type="button"
									class={`rounded-full border px-2 py-1 text-xs ${sourceFilter.includes(option) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border'}`}
									onclick={() => toggleSourceFilter(option)}
								>
									{option}
								</button>
							{/each}
						</div>
					</div>

					<div>
						<div class="mb-1 text-xs font-medium text-muted-foreground">Remote</div>
						<div class="flex flex-wrap gap-2">
							{#each remoteOptions as option (option)}
								<button
									type="button"
									class={`rounded-full border px-2 py-1 text-xs ${remoteFilter.includes(option) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border'}`}
									onclick={() => toggleRemoteFilter(option)}
								>
									{option}
								</button>
							{/each}
						</div>
					</div>

					<div>
						<div class="mb-1 text-xs font-medium text-muted-foreground">Search Term</div>
						<div class="flex flex-wrap gap-2">
							{#each searchTermOptions as option (option)}
								<button
									type="button"
									class={`rounded-full border px-2 py-1 text-xs ${searchTermFilter.includes(option) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border'}`}
									onclick={() => toggleSearchTermFilter(option)}
								>
									{option}
								</button>
							{/each}
						</div>
					</div>
				</div>
			</Card.Content>
		{/if}
	</Card.Root>

	<!-- Jobs Table -->
	<Card.Root>
		<Card.Header>
			<div class="flex items-center justify-between">
				<div>
					<Card.Title>Job Details</Card.Title>
					<Card.Description>Jobs ({data.jobCount.toLocaleString()} total)</Card.Description>
				</div>
				<div class="flex items-center gap-2">
					<Input
						bind:value={searchQuery}
						placeholder="Search jobs, company, level, function, skills..."
						class="w-[320px]"
					/>
					<Button
						variant="destructive"
						size="sm"
						disabled={clearingAllData || selectedMatchIds.length === 0}
						onclick={deleteSelectedMatches}
					>
						{clearingAllData ? 'Deleting…' : 'Delete Selected'}
					</Button>
					<Button variant="outline" size="sm" onclick={toggleSelectAllVisible}>Select All</Button>
					<Button variant="outline" size="sm" onclick={() => invalidateAll()}>
						<RefreshCwIcon class="mr-1 h-3.5 w-3.5" />
						Refresh
					</Button>
				</div>
			</div>
		</Card.Header>
		<Card.Content>
			{#if data.jobs.length === 0}
				<div
					class="text-muted-foreground flex flex-col items-center justify-center py-12 text-center"
				>
					<SearchIcon class="mb-3 h-10 w-10 opacity-40" />
					<p class="text-lg font-medium">No jobs yet</p>
					<p class="text-sm">
						Set your preferences above and start a search to find matching jobs.
					</p>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Run</Table.Head>
								<Table.Head
									class="cursor-pointer select-none"
									onclick={() => toggleSort('match_score')}
								>
									Relevance
									{#if sortField === 'match_score'}
										<span>{sortDir === 'asc' ? '↑' : '↓'}</span>
									{/if}
								</Table.Head>
								<Table.Head class="cursor-pointer select-none" onclick={() => toggleSort('title')}>
									Job / Company
									{#if sortField === 'title'}
										<span>{sortDir === 'asc' ? '↑' : '↓'}</span>
									{/if}
								</Table.Head>
								<Table.Head>Level</Table.Head>
								<Table.Head>Function</Table.Head>
								<Table.Head>Education</Table.Head>
								<Table.Head>Country</Table.Head>
								<Table.Head>Search Term</Table.Head>
								<Table.Head>Source</Table.Head>
								<Table.Head
									class="cursor-pointer select-none"
									onclick={() => toggleSort('posted_date')}
								>
									Posted
									{#if sortField === 'posted_date'}
										<span>{sortDir === 'asc' ? '↑' : '↓'}</span>
									{/if}
								</Table.Head>
								<Table.Head>Actions</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each sortedJobs() as match (match.id)}
								{@const job = match.job}
								<Table.Row
									class="cursor-pointer hover:bg-muted/50"
									onclick={() => openJobDetail(match)}
								>
									<Table.Cell>
										<Badge
											variant="outline"
											class={`text-[10px] ${runBadgeClasses(runCodeMap[match.search_run_id ?? ''] ?? 'NA')}`}
										>
											{runCodeMap[match.search_run_id ?? ''] ?? 'NA'}
										</Badge>
									</Table.Cell>
									<Table.Cell>
										<div class="w-[72px]">
											<div class="flex items-center gap-2">
												<div class="h-2 w-10 overflow-hidden rounded-full bg-muted">
													<div
														class={`h-full ${relevanceColor(match.match_score)}`}
														style={`width: ${Math.max(0, Math.min(100, (match.match_score / 10) * 100))}%`}
													></div>
												</div>
												<span class="text-sm font-semibold">{Math.round(match.match_score)}</span>
											</div>
										</div>
									</Table.Cell>
									<Table.Cell
										class="max-w-[300px]"
										title={`${getActualRole(job)} — ${job?.company_name ?? '—'}`}
									>
										<div class="truncate font-medium">{getActualRole(job)}</div>
										<div class="mt-0.5 flex items-center gap-2 text-xs">
											<div class="text-muted-foreground truncate" title={job?.company_name ?? '—'}>
												{job?.company_name ?? '—'}
											</div>
											{#if job?.is_remote}
												<Badge variant="secondary" class="text-[10px]">Remote</Badge>
											{/if}
										</div>
									</Table.Cell>
									<Table.Cell>
										<span
											class={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${levelClasses(getJobLevel(job))}`}
										>
											{getJobLevel(job)}
										</span>
									</Table.Cell>
									<Table.Cell class="max-w-[220px]">
										<span
											class={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${functionClasses(getJobFunction(job))}`}
										>
											{getJobFunction(job)}
										</span>
									</Table.Cell>
									<Table.Cell class="max-w-[180px]">
										{#if getEducationLevels(job).length > 0}
											<div class="flex flex-wrap gap-1">
												{#each getEducationLevels(job).slice(0, 2) as level (level)}
													<Badge variant="secondary" class="text-[10px]">{level}</Badge>
												{/each}
											</div>
										{:else}
											<span class="text-muted-foreground text-xs">—</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="max-w-[160px]">
										<div class="flex items-center gap-1 text-sm">
											<MapPinIcon class="h-3 w-3 shrink-0 opacity-50" />
											<span class="truncate">{job?.country || '—'}</span>
										</div>
									</Table.Cell>
									<Table.Cell>
										<span class="text-muted-foreground text-xs">{getSearchTerm(match)}</span>
									</Table.Cell>
									<Table.Cell>
										<Badge variant={platformColor(job?.source ?? '')}>
											{job?.source ?? '—'}
										</Badge>
									</Table.Cell>
									<Table.Cell class="text-sm">
										{formatDate(job?.posted_date)}
									</Table.Cell>
									<Table.Cell>
										<div class="flex items-center gap-1">
											<!-- Save -->
											<button
												onclick={(e) => toggleSave(match.id, match.is_saved, e)}
												class="rounded p-1 hover:bg-muted {match.is_saved
													? 'text-yellow-500'
													: 'text-muted-foreground hover:text-foreground'}"
												title={match.is_saved ? 'Unsave' : 'Save'}
											>
												<BookmarkIcon class="h-4 w-4" />
											</button>
											<!-- Send to Tasks -->
											<button
												onclick={(e) => sendToTasks(match, e)}
												class={`rounded p-1 hover:bg-muted ${sendIconClasses(match.id)}`}
												title={sentToTasksState[match.id] === 'success' ||
												sentToTasksState[match.id] === 'duplicate'
													? 'Already sent to Tasks'
													: 'Send to Tasks'}
												disabled={sentToTasksState[match.id] === 'loading' ||
													sentToTasksState[match.id] === 'success' ||
													sentToTasksState[match.id] === 'duplicate'}
											>
												<SendIcon class="h-4 w-4" />
											</button>
											<!-- External link -->
											{#if job?.canonical_url}
												<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
												<a
													href={job.canonical_url}
													target="_blank"
													rel="noopener noreferrer"
													onclick={(e) => e.stopPropagation()}
													class="text-muted-foreground rounded p-1 hover:bg-muted hover:text-foreground"
													title="View on {job.source}"
												>
													<ExternalLinkIcon class="h-4 w-4" />
												</a>
											{/if}
											<input
												type="checkbox"
												checked={selectedMatchIds.includes(match.id)}
												onclick={(e) => e.stopPropagation()}
												onchange={(e) =>
													toggleSelectedMatch(
														match.id,
														(e.currentTarget as HTMLInputElement).checked
													)}
												class="accent-primary"
											/>
										</div>
										{#if actionFeedback[match.id]}
											<span
												class="mt-0.5 block text-[10px] {actionFeedback[match.id].type === 'success'
													? 'text-green-600'
													: 'text-red-500'}"
											>
												{actionFeedback[match.id].message}
											</span>
										{/if}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>

				<!-- Pagination -->
				{#if totalPages > 1}
					<div class="flex items-center justify-between border-t pt-4">
						<span class="text-muted-foreground text-sm">
							Page {currentPage} of {totalPages} ({data.jobCount} jobs)
						</span>
						<div class="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={currentPage <= 1}
								onclick={() => goToPage(currentPage - 1)}
							>
								<ChevronLeftIcon class="h-4 w-4" />
							</Button>
							{#each Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
								const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
								return start + i;
							}) as p (p)}
								<Button
									variant={p === currentPage ? 'default' : 'outline'}
									size="sm"
									onclick={() => goToPage(p)}
								>
									{p}
								</Button>
							{/each}
							<Button
								variant="outline"
								size="sm"
								disabled={currentPage >= totalPages}
								onclick={() => goToPage(currentPage + 1)}
							>
								<ChevronRightIcon class="h-4 w-4" />
							</Button>
						</div>
					</div>
				{/if}
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<!-- Job Detail Dialog -->
<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content
		class="max-h-[85vh] w-[min(96vw,1100px)] max-w-[1100px] overflow-y-auto sm:max-w-[1100px]"
	>
		{#if selectedJob}
			{@const job = selectedJob.job}
			<Dialog.Header>
				<Dialog.Title>{getActualRole(job)}</Dialog.Title>
				<Dialog.Description>
					{job?.company_name ?? 'Unknown Company'}
					{#if job?.city || job?.country}
						— {[job?.city, job?.country].filter(Boolean).join(', ')}
					{/if}
				</Dialog.Description>
			</Dialog.Header>

			<div class="space-y-4 py-2">
				<!-- Meta badges -->
				<div class="flex flex-wrap gap-2">
					<Badge variant={platformColor(job?.source ?? '')}>{job?.source}</Badge>
					{#if job?.is_remote}
						<Badge variant="secondary">Remote</Badge>
					{/if}
					{#if job?.job_type}
						<Badge variant="outline">{job.job_type}</Badge>
					{/if}
					<span
						class={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${levelClasses(getJobLevel(job))}`}
					>
						{getJobLevel(job)}
					</span>
					<span
						class={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${functionClasses(getJobFunction(job))}`}
					>
						{getJobFunction(job)}
					</span>
					<Badge variant="outline">
						Score: {selectedJob.match_score.toFixed(1)}/10
					</Badge>
				</div>

				{#if getJobSkills(job).length > 0}
					<div>
						<div class="mb-2 text-sm font-medium">Skills</div>
						<div class="flex flex-wrap gap-2">
							{#each getJobSkills(job) as skill (skill)}
								<Badge variant="outline">{skill}</Badge>
							{/each}
						</div>
					</div>
				{/if}

				{#if getEducationLevels(job).length > 0}
					<div>
						<div class="mb-2 text-sm font-medium">Education</div>
						<div class="flex flex-wrap gap-2">
							{#each getEducationLevels(job) as level (level)}
								<Badge variant="secondary">{level}</Badge>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Date info -->
				<div class="text-muted-foreground flex gap-4 text-sm">
					<span>Posted: {formatDate(job?.posted_date)}</span>
					<span>Scraped: {formatDateTime(job?.scraped_at)}</span>
				</div>

				<!-- Location -->
				{#if job?.location_text || job?.city || job?.country}
					<div class="flex items-center gap-1 text-sm">
						<MapPinIcon class="h-4 w-4 opacity-50" />
						<span>{formatLocation(job)}</span>
						{#if job?.location_text && (job?.city || job?.country)}
							<span class="text-muted-foreground">({job.location_text})</span>
						{/if}
					</div>
				{/if}

				<!-- Actions in dialog -->
				<div class="flex gap-2">
					<Button
						variant={selectedJob.is_saved ? 'default' : 'outline'}
						size="sm"
						onclick={(e: Event) => toggleSave(selectedJob!.id, selectedJob!.is_saved, e)}
					>
						<BookmarkIcon class="mr-1 h-3.5 w-3.5" />
						{selectedJob.is_saved ? 'Saved' : 'Save'}
					</Button>
					<Button variant="outline" size="sm" onclick={(e: Event) => sendToTasks(selectedJob!, e)}>
						<SendIcon class="mr-1 h-3.5 w-3.5" />
						Send to Tasks
					</Button>
				</div>

				<!-- Description -->
				{#if job?.description_clean || job?.description}
					<div
						class="prose prose-sm dark:prose-invert max-h-[400px] overflow-y-auto rounded-md border p-4"
					>
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						{@html (job.description_clean || job.description || '').replace(/\n/g, '<br>')}
					</div>
				{/if}

				<!-- Link -->
				{#if job?.canonical_url}
					<div>
						<a
							href={job.canonical_url}
							target="_blank"
							rel="noopener noreferrer"
							class="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
						>
							<ExternalLinkIcon class="h-3.5 w-3.5" />
							View on {job.source}
						</a>
					</div>
				{/if}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
