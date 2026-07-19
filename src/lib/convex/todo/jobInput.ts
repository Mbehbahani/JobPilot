const DESCRIPTION_HINT =
	/about the role|job description|responsibilities|requirements|qualifications|what you(?:'|’)ll do|what to expect/i;

export function normalizePublicUrl(value: string): string | undefined {
	const trimmed = value.trim();
	if (!trimmed || /\s/.test(trimmed)) return undefined;
	if (
		!/^https?:\/\//i.test(trimmed) &&
		!/^(?:localhost(?::\d+)?|[^/]+\.[^/]+)(?:\/|$)/i.test(trimmed)
	) {
		return undefined;
	}
	const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

	try {
		const url = new URL(candidate);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
		return url.toString();
	} catch {
		return undefined;
	}
}

export function isLikelyJobDescription(value: string): boolean {
	const text = value.trim();
	if (!text || normalizePublicUrl(text)) return false;
	const wordCount = text.split(/\s+/).filter(Boolean).length;
	return text.includes('\n') || text.length > 180 || wordCount > 30 || DESCRIPTION_HINT.test(text);
}

export function normalizeJobInput<
	T extends { title: string; jobUrl?: string; jobDescription?: string }
>(task: T): T {
	const title = task.title.trim();
	const titleUrl = normalizePublicUrl(title);
	const jobUrl = normalizePublicUrl(task.jobUrl ?? '') ?? titleUrl;
	const jobDescription =
		task.jobDescription?.trim() || (!jobUrl && isLikelyJobDescription(title) ? title : undefined);

	return {
		...task,
		title,
		...(jobUrl ? { jobUrl } : {}),
		...(jobDescription ? { jobDescription } : {})
	};
}

export function extractLinkedInJobId(value: string): string | undefined {
	const url = normalizePublicUrl(value);
	if (!url) return undefined;
	const parsed = new URL(url);
	if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return undefined;
	return parsed.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)(?:\/|$)/i)?.[1];
}
