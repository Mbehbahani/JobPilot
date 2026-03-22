import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { authComponent, createAuth } from './auth';
import { resend } from './emails/resend';
import { internal } from './_generated/api';

const http = httpRouter();

// Better Auth routes
authComponent.registerRoutes(http, createAuth);

// Resend webhook endpoint
// Configure this URL in your Resend dashboard: https://your-deployment.convex.site/resend-webhook
// This endpoint receives email events (delivered, bounced, complained, opened, clicked)
http.route({
	path: '/resend-webhook',
	method: 'POST',
	handler: httpAction(async (ctx, req) => {
		return await resend.handleResendEventWebhook(ctx, req);
	})
});

// ── Integration API: Add job from job-analytics-frontend ───────────────────

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization'
} as const;

// CORS preflight
http.route({
	path: '/api/integration/add-job',
	method: 'OPTIONS',
	handler: httpAction(async () => {
		return new Response(null, { status: 204, headers: CORS_HEADERS });
	})
});

// Add a job card to the kanban board from an external app
http.route({
	path: '/api/integration/add-job',
	method: 'POST',
	handler: httpAction(async (ctx, req) => {
		// Validate API key
		const apiKey = process.env.INTEGRATION_API_KEY;
		if (apiKey) {
			const authHeader = req.headers.get('Authorization');
			if (authHeader !== `Bearer ${apiKey}`) {
				return new Response(JSON.stringify({ error: 'Unauthorized' }), {
					status: 401,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
				});
			}
		}

		let body: Record<string, unknown>;
		try {
			body = await req.json();
		} catch {
			return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
				status: 400,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
			});
		}

		// Resolve user ID: env var > request body
		const userId =
			process.env.INTEGRATION_USER_ID ?? (typeof body.userId === 'string' ? body.userId : null);

		if (!userId) {
			return new Response(
				JSON.stringify({
					error: 'No account linked. Please sign in to job-promus and browse jobs from there.'
				}),
				{ status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
			);
		}

		const title =
			typeof body.title === 'string' ? body.title : typeof body.position === 'string' ? body.position : 'Untitled Job';

		const taskId = await ctx.runMutation(internal.todos.addJobFromExternalInternal, {
			userId,
			title,
			companyName: typeof body.companyName === 'string' ? body.companyName : undefined,
			position: typeof body.position === 'string' ? body.position : undefined,
			jobUrl: typeof body.jobUrl === 'string' ? body.jobUrl : undefined,
			jobDescription: typeof body.jobDescription === 'string' ? body.jobDescription : undefined,
			skills: typeof body.skills === 'string' ? body.skills : undefined,
			country: typeof body.country === 'string' ? body.country : undefined,
			searchTerm: typeof body.searchTerm === 'string' ? body.searchTerm : undefined,
			postedDate: typeof body.postedDate === 'string' ? body.postedDate : undefined,
			jobLevel: typeof body.jobLevel === 'string' ? body.jobLevel : undefined,
			jobFunction: typeof body.jobFunction === 'string' ? body.jobFunction : undefined,
			jobType: typeof body.jobType === 'string' ? body.jobType : undefined,
			companyIndustry: typeof body.companyIndustry === 'string' ? body.companyIndustry : undefined,
			companyUrl: typeof body.companyUrl === 'string' ? body.companyUrl : undefined,
			platform: typeof body.platform === 'string' ? body.platform : undefined
		});

		return new Response(JSON.stringify({ success: true, taskId }), {
			status: 200,
			headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
		});
	})
});

// ── Integration API: Check duplicate job URL ───────────────────────────────

http.route({
	path: '/api/integration/check-duplicate',
	method: 'OPTIONS',
	handler: httpAction(async () => {
		return new Response(null, { status: 204, headers: CORS_HEADERS });
	})
});

http.route({
	path: '/api/integration/check-duplicate',
	method: 'POST',
	handler: httpAction(async (ctx, req) => {
		const apiKey = process.env.INTEGRATION_API_KEY;
		if (apiKey) {
			const authHeader = req.headers.get('Authorization');
			if (authHeader !== `Bearer ${apiKey}`) {
				return new Response(JSON.stringify({ error: 'Unauthorized' }), {
					status: 401,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
				});
			}
		}

		let body: Record<string, unknown>;
		try {
			body = await req.json();
		} catch {
			return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
				status: 400,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
			});
		}

		const jobUrl = typeof body.jobUrl === 'string' ? body.jobUrl : null;
		if (!jobUrl) {
			return new Response(JSON.stringify({ error: 'jobUrl is required' }), {
				status: 400,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
			});
		}

		let userId =
			process.env.INTEGRATION_USER_ID ?? (typeof body.userId === 'string' ? body.userId : null);
		if (!userId) {
			return new Response(JSON.stringify({ exists: false, error: 'No account linked' }), {
				status: 200,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
			});
		}

		const result = await ctx.runQuery(internal.todos.checkJobUrlExistsInternal, {
			userId,
			jobUrl
		});

		return new Response(JSON.stringify(result), {
			status: 200,
			headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
		});
	})
});

export default http;
