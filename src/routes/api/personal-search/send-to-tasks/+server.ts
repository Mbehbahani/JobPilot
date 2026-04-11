import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/public';

const CONVEX_SITE_URL = env.PUBLIC_CONVEX_SITE_URL;

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
	const token = locals.token;
	if (!token) return json({ error: 'Not authenticated' }, { status: 401 });

	const payload = decodeJwtPayload(token);
	const userId = payload?.sub;
	if (!userId) return json({ error: 'Invalid token' }, { status: 401 });

	if (!CONVEX_SITE_URL) {
		return json({ error: 'Convex site URL not configured' }, { status: 500 });
	}

	const body = await request.json();

	// First check for duplicate
	try {
		if (body.jobUrl) {
			const dupCheck = await fetch(`${CONVEX_SITE_URL}/api/integration/check-duplicate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId, jobUrl: body.jobUrl })
			});
			if (dupCheck.ok) {
				const dupData = await dupCheck.json();
				const isDuplicate = Boolean(
					dupData.isDuplicate ?? dupData.exists ?? dupData.duplicate ?? false
				);
				if (isDuplicate) {
					return json({ ok: false, duplicate: true, message: 'Job already in your tasks' });
				}
			}
		}
	} catch {
		// If duplicate check fails, proceed anyway
	}

	// Add job to tasks
	try {
		const res = await fetch(`${CONVEX_SITE_URL}/api/integration/add-job`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				userId,
				title: body.title || 'Untitled Job',
				companyName: body.companyName || undefined,
				position: body.title || undefined,
				jobUrl: body.jobUrl || undefined,
				jobDescription: body.description || undefined,
				skills: body.skills || undefined,
				country: body.country || undefined,
				jobLevel: body.jobLevel || undefined,
				jobType: body.jobType || undefined,
				platform: body.platform || undefined
			})
		});

		const data = await res.json();
		if (res.ok && data.success) {
			return json({ ok: true, taskId: data.taskId, duplicate: false });
		}
		return json({ ok: false, message: data.error || 'Failed to add task' }, { status: 502 });
	} catch (e) {
		console.error('[send-to-tasks]', e);
		return json({ ok: false, message: 'Could not reach task backend' }, { status: 502 });
	}
};
