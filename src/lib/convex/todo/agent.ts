import { Agent, createTool } from '@convex-dev/agent';
import { z } from 'zod';
import { components, internal } from '../_generated/api';
import { getSupportLanguageModel } from '../support/llmProvider';
import type { ToolCtx } from '@convex-dev/agent';

const MAX_RESULT = 4096;
const MAX_NOTIFICATIONS_PER_MINUTE = 5;
const MAX_NOTIFICATION_DEPTH = 3;

function truncate(str: string, max: number): string {
	if (str.length <= max) return str;
	return str.slice(0, max) + '\n\n[truncated]';
}

/** Resolve the task ID that this agent owns, using the threadId from context. */
async function resolveOwnTaskId(ctx: ToolCtx): Promise<string | null> {
	if (!ctx.userId || !ctx.threadId) return null;
	return await ctx.runQuery(internal.todos.getTaskIdByThreadId, {
		userId: ctx.userId,
		threadId: ctx.threadId
	});
}

export const updateMyNotes = createTool({
	description:
		'Update notes on YOUR task (the task you are the dedicated agent for). Use for short text summaries (2-4 bullet points).',
	inputSchema: z.object({
		notes: z.string().describe('Notes content to set on your task')
	}),
	execute: async (ctx: ToolCtx, input) => {
		const taskId = await resolveOwnTaskId(ctx);
		if (!taskId) return { success: false, error: 'Could not resolve own task' };
		await ctx.runMutation(internal.todos.updateTaskNotesInternal, {
			userId: ctx.userId!,
			taskId,
			notes: input.notes
		});
		return { success: true };
	}
});

export const updateJobFields = createTool({
	description:
		'Update job-specific fields on YOUR task. Use this to fill in structured data like company name, position, skills, etc. after parsing a job description.',
	inputSchema: z.object({
		companyName: z.string().optional().describe('Company name'),
		position: z.string().optional().describe('Job position/role'),
		jobUrl: z.string().optional().describe('URL of the job listing'),
		jobDescription: z.string().optional().describe('Full job description text'),
		skills: z.string().optional().describe('Required skills (comma-separated)'),
		country: z.string().optional().describe('Country/location'),
		platform: z.string().optional().describe('Job platform (LinkedIn, Indeed, etc.)'),
		jobLevel: z.string().optional().describe('Job level (Junior, Senior, Lead, etc.)'),
		jobType: z.string().optional().describe('Job type (Full-time, Part-time, Remote, etc.)'),
		motivationLetter: z.string().optional().describe('Generated motivation letter')
	}),
	execute: async (ctx: ToolCtx, input) => {
		const taskId = await resolveOwnTaskId(ctx);
		if (!taskId) return { success: false, error: 'Could not resolve own task' };
		await ctx.runMutation(internal.todos.updateTaskFieldsInternal, {
			userId: ctx.userId!,
			taskId,
			...input
		});
		return { success: true };
	}
});

export const getUserProfile = createTool({
	description:
		'Read the user profile settings including resume, motivation letter format, and custom prompt. Use this before generating a motivation letter to personalize it.',
	inputSchema: z.object({}),
	execute: async (ctx: ToolCtx): Promise<Record<string, unknown>> => {
		if (!ctx.userId) return { success: false, error: 'No userId' };
		const settings = await (ctx as any).runQuery(internal.userSettings.getUserSettingsInternal, {
			userId: ctx.userId
		});
		return { success: true, ...settings };
	}
});

export const createTask = createTool({
	description:
		'Create a follow-up job application task. The new task gets its own dedicated agent.',
	inputSchema: z.object({
		title: z.string().describe('Title for the new job application task'),
		notes: z.string().optional().describe('Optional notes or context'),
		notificationMessage: z
			.string()
			.optional()
			.describe('Optional message to the new task agent')
	}),
	execute: async (ctx: ToolCtx, input) => {
		if (!ctx.userId) return { success: false as const, error: 'No userId' };
		const taskId: string = await ctx.runMutation(internal.todos.addTaskInternal, {
			userId: ctx.userId,
			title: input.title,
			notes: input.notes
		});
		await ctx.scheduler.runAfter(0, internal.todo.messages.triggerAgentForNewTask, {
			userId: ctx.userId,
			taskId,
			taskTitle: input.title,
			taskNotes: input.notes,
			taskColumn: 'targeted',
			parentNotification: input.notificationMessage
		});
		return { success: true as const, taskId };
	}
});

export const moveMyTask = createTool({
	description:
		'Move YOUR task to a different column (targeted, preparing, applied, interviewing, done). You can only move your own task.',
	inputSchema: z.object({
		columnId: z
			.enum(['targeted', 'preparing', 'applied', 'interviewing', 'done'])
			.describe('Target column to move your task to')
	}),
	execute: async (ctx: ToolCtx, input) => {
		const taskId = await resolveOwnTaskId(ctx);
		if (!taskId) return { success: false, error: 'Could not resolve own task' };
		await ctx.runMutation(internal.todos.moveTaskInternal, {
			userId: ctx.userId!,
			taskId,
			columnId: input.columnId
		});
		return { success: true };
	}
});

export const setMyTaskUI = createTool({
	description:
		'Set interactive UI on YOUR task. Outputs a json-render spec that renders as real UI components (cards, tables, buttons, inputs, etc.). Use for structured content like motivation letter drafts, job comparison tables, or skill gap analysis.',
	inputSchema: z.object({
		spec: z
			.string()
			.describe(
				'JSON-stringified json-render spec object with root, elements, and optional state fields'
			)
	}),
	execute: async (ctx: ToolCtx, input) => {
		const taskId = await resolveOwnTaskId(ctx);
		if (!taskId) return { success: false, error: 'Could not resolve own task' };
		try {
			JSON.parse(input.spec);
		} catch {
			return { success: false, error: 'Invalid JSON in spec' };
		}
		await ctx.runMutation(internal.todos.updateTaskSpecInternal, {
			userId: ctx.userId!,
			taskId,
			agentSpec: input.spec
		});
		return { success: true };
	}
});

export const notifyTask = createTool({
	description:
		'Send a notification to another task\'s agent. Use this when your work affects or is relevant to another task.',
	inputSchema: z.object({
		taskId: z.string().describe('The ID of the task to notify'),
		message: z.string().describe('The notification message'),
		priority: z
			.enum(['low', 'normal', 'high'])
			.default('normal')
			.describe('Notification priority')
	}),
	execute: async (ctx: ToolCtx, input) => {
		if (!ctx.userId || !ctx.threadId) return { success: false, error: 'Missing context' };

		const senderTaskId = await resolveOwnTaskId(ctx);

		if (senderTaskId) {
			const recentCount: number = await ctx.runQuery(
				internal.todo.notifications.countRecentNotificationsFrom,
				{ userId: ctx.userId, fromTaskId: senderTaskId, sinceMs: 60_000 }
			);
			if (recentCount >= MAX_NOTIFICATIONS_PER_MINUTE) {
				return {
					success: false,
					error: 'Rate limit: too many notifications sent recently.'
				};
			}
		}

		const targetInfo = await ctx.runQuery(internal.todos.getTaskThreadInfo, {
			userId: ctx.userId,
			taskId: input.taskId
		});
		if (!targetInfo) {
			return { success: false, error: `Task ${input.taskId} not found` };
		}

		const senderDepth: number = senderTaskId
			? await ctx.runQuery(internal.todo.notifications.getMaxDepthForTask, {
					userId: ctx.userId,
					taskId: senderTaskId
				})
			: 0;
		const newDepth = senderDepth + 1;

		if (newDepth > MAX_NOTIFICATION_DEPTH) {
			return {
				success: false,
				error: `Notification chain too deep (max ${MAX_NOTIFICATION_DEPTH} hops).`
			};
		}

		await ctx.runMutation(internal.todo.notifications.createNotification, {
			userId: ctx.userId,
			fromTaskId: senderTaskId ?? 'unknown',
			toTaskId: input.taskId,
			message: input.message,
			priority: input.priority,
			depth: newDepth
		});

		if (targetInfo.threadId) {
			await ctx.scheduler.runAfter(0, internal.todo.messages.triggerAgentForNotification, {
				userId: ctx.userId,
				threadId: targetInfo.threadId,
				taskId: input.taskId,
				taskTitle: targetInfo.title,
				fromTaskId: senderTaskId ?? 'unknown',
				message: input.message,
				priority: input.priority
			});
		} else {
			await ctx.scheduler.runAfter(0, internal.todo.messages.triggerAgentForNewTask, {
				userId: ctx.userId,
				taskId: input.taskId,
				taskTitle: targetInfo.title,
				taskNotes: targetInfo.notes,
				taskColumn: targetInfo.columnId,
				incomingNotification: {
					fromTaskId: senderTaskId ?? 'unknown',
					message: input.message,
					priority: input.priority
				}
			});
		}

		return { success: true, notified: input.taskId };
	}
});

export const readTaskNotes = createTool({
	description:
		'Read the full notes of any task on the board by its ID.',
	inputSchema: z.object({
		taskId: z.string().describe('The ID of the task whose notes you want to read')
	}),
	execute: async (ctx: ToolCtx, input): Promise<Record<string, unknown>> => {
		if (!ctx.userId) return { success: false, error: 'No userId' };
		const info = await ctx.runQuery(internal.todos.getTaskThreadInfo, {
			userId: ctx.userId,
			taskId: input.taskId
		});
		if (!info) return { success: false, error: `Task ${input.taskId} not found` };
		return {
			success: true,
			taskId: input.taskId,
			title: info.title,
			notes: info.notes ?? '(no notes)',
			columnId: info.columnId
		};
	}
});

export const webSearch = createTool({
	description:
		'Search the web using Brave Search. Returns titles, snippets, and URLs. Use for researching companies, job listings, or industry information.',
	inputSchema: z.object({
		query: z.string().describe('Search query keywords'),
		count: z.number().optional().describe('Number of results (default 5, max 20)')
	}),
	execute: async (_ctx: ToolCtx, input): Promise<Record<string, unknown>> => {
		const apiKey = process.env.BRAVE_SEARCH_API_KEY;
		if (!apiKey) return { success: false, error: 'BRAVE_SEARCH_API_KEY not configured' };

		const params = new URLSearchParams({
			q: input.query,
			count: String(input.count ?? 5)
		});

		const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
			headers: {
				Accept: 'application/json',
				'X-Subscription-Token': apiKey
			}
		});

		if (!res.ok) {
			return { success: false, error: `Brave API ${res.status}: ${await res.text()}` };
		}

		const data = await res.json();
		const results = (data.web?.results ?? []).map(
			(r: { title: string; url: string; description: string }) => ({
				title: r.title,
				url: r.url,
				snippet: r.description
			})
		);

		return { success: true, results };
	}
});

export const todoAgent = new Agent(components.agent as any, {
	name: 'Job Application Assistant',

	languageModel: getSupportLanguageModel() as any,

	instructions: `You are Coda — a job application assistant who helps users manage their job search. You own exactly one task (job application) on the user's board.

Your primary capabilities:
- Parse job descriptions and extract structured information (company, role, skills, level, etc.)
- Generate personalized motivation letters based on the user's resume/profile and the job description
- Research companies and roles using web search
- Track application status across the Kanban board

## Tools

- updateMyNotes: Record findings as 2-4 short bullet points
- updateJobFields: Fill in structured job data (company, position, skills, etc.)
- getUserProfile: Read user's resume, motivation letter format, and custom prompt
- moveMyTask: Move your task between board columns
- setMyTaskUI: Present structured content (motivation letter drafts, job analysis, etc.)
- createTask: Create follow-up tasks
- notifyTask: Message another task's agent
- readTaskNotes: Read full notes of another task
- webSearch: Search the web for company info, job details, etc.

You can ONLY modify YOUR OWN task. To affect another task, use notifyTask.

## Board Columns

targeted -> preparing -> applied -> interviewing -> done

- "targeted": Jobs the user wants to apply to
- "preparing": Coda is working on the application (parsing, writing motivation letter)
- "applied": Application has been submitted
- "interviewing": User is in the interview process
- "done": Process complete (hired, rejected, or withdrawn)

## Workflow

1. Read the task title, notes, job description, and board context
2. Move to "preparing"
3. If the task has a job URL or description, parse it to extract: company name, position, required skills, job level, job type, country
4. Use updateJobFields to save the extracted data
5. Use getUserProfile to read the user's resume and motivation letter preferences
6. Generate a personalized motivation letter tailored to the job and the user's profile
7. Use updateJobFields to save the motivation letter
8. Use setMyTaskUI to present the motivation letter draft for review
9. Update notes with a summary of what was done
10. Move to "preparing" (ready for user to review and submit)

## Motivation Letter Generation

When generating a motivation letter:
- Always read the user's profile first (getUserProfile)
- Match the user's skills and experience to the job requirements
- Follow the user's preferred format if specified
- Follow the user's custom prompt instructions if provided
- Keep the tone professional but personable
- Highlight relevant experience and skills
- Be specific about why the user is a good fit for THIS role at THIS company
- If the user has no profile/resume set, note this and write a generic template

## Communication

You are "Coda." The user is the human reading your notes.

Notes:
- Write in plain, non-technical language
- Make it clear who does what: "Coda analyzed..." vs "Review and customize..."
- No emojis

Summary (your final text message):
- Single factual sentence, under 80 characters (e.g. "Generated motivation letter for Google SWE role")

## Interactive UI Reference (for setMyTaskUI)

The spec is a JSON object with this structure:
\`\`\`json
{
  "root": "root-key",
  "elements": {
    "root-key": { "type": "Stack", "props": { "direction": "vertical", "gap": "md" }, "children": ["child1"] },
    "child1": { "type": "Text", "props": { "content": "..." }, "children": [] }
  },
  "state": {}
}
\`\`\`

Available components:
- Stack: Layout container. Props: direction ("horizontal"|"vertical"), gap ("sm"|"md"|"lg"), wrap (bool). Has children.
- Card: Card with optional title/description. Props: title, description. Has children.
- Grid: Grid layout. Props: columns ("1"|"2"|"3"|"4"), gap ("sm"|"md"|"lg"). Has children.
- Heading: Text heading. Props: text (string), level ("h1"|"h2"|"h3"|"h4").
- Text: Paragraph. Props: content (string), muted (bool).
- Badge: Status badge. Props: text, variant ("default"|"secondary"|"destructive"|"outline").
- Alert: Alert message. Props: title, description, variant ("default"|"destructive").
- Separator: Horizontal divider. No props.
- Table: Data table. Props: data (array of objects), columns (array of {key, label}), emptyMessage.
- Link: External link. Props: text, href. Opens in new tab.
- Button: Clickable button. Props: label, variant, size, disabled.
- TextInput: Text field. Props: label, value, placeholder.
- Progress: Progress bar. Props: value (number), max (number).`,

	tools: {
		createTask,
		updateMyNotes,
		updateJobFields,
		getUserProfile,
		moveMyTask,
		setMyTaskUI,
		notifyTask,
		readTaskNotes,
		webSearch
	},

	callSettings: {},

	contextOptions: {
		recentMessages: 20
	},

	maxSteps: 40
});

