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

function stripHtmlToText(html: string): string {
	return html
		.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
		.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
		.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/\s+/g, ' ')
		.trim();
}

function getUrlFromInput(input: { query?: string; url?: string }): string | null {
	const candidate = input.url?.trim() || input.query?.trim();
	if (!candidate) return null;
	try {
		const parsed = new URL(candidate);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
		return parsed.toString();
	} catch {
		return null;
	}
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
		"Read the user's CV/resume and motivation letter instructions. Use this before generating a motivation letter to personalize it.",
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
		notificationMessage: z.string().optional().describe('Optional message to the new task agent')
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
		"Send a notification to another task's agent. Use this when your work affects or is relevant to another task.",
	inputSchema: z.object({
		taskId: z.string().describe('The ID of the task to notify'),
		message: z.string().describe('The notification message'),
		priority: z.enum(['low', 'normal', 'high']).default('normal').describe('Notification priority')
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
	description: 'Read the full notes of any task on the board by its ID.',
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
		'Fetch a public webpage URL and extract readable text from it. Best for job posting links and other public job pages.',
	inputSchema: z.object({
		query: z
			.string()
			.optional()
			.describe('A public URL. Kept for backward compatibility with older prompts.'),
		url: z.string().optional().describe('Public page URL to fetch and extract text from')
	}),
	execute: async (_ctx: ToolCtx, input): Promise<Record<string, unknown>> => {
		const url = getUrlFromInput(input);
		if (!url) {
			return {
				success: false,
				error:
					'Please provide a valid public http/https URL. General web search is no longer configured.'
			};
		}

		const res = await fetch(url, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
				Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
			}
		});

		if (!res.ok) {
			return { success: false, error: `Failed to fetch page (${res.status})` };
		}

		const html = await res.text();
		const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
		const title = titleMatch?.[1]?.trim() || url;
		const text = stripHtmlToText(html);

		return {
			success: true,
			url,
			title,
			content: truncate(text, MAX_RESULT)
		};
	}
});

export const todoAgent = new Agent(components.agent as any, {
	name: 'Job Application Assistant',

	languageModel: getSupportLanguageModel() as any,

	instructions: `You are Coda — a job application assistant who helps users manage their job search. You own exactly one task (job application) on the user's board.

Your primary capabilities:
- Parse job descriptions and extract structured information (company, role, skills, level, etc.)
- Generate personalized motivation letters based on the user's resume/profile and the job description
	- Read public job posting pages directly from their URLs
- Track application status across the Kanban board

## Tools

- updateMyNotes: Record findings as 2-4 short bullet points
- updateJobFields: Fill in structured job data (company, position, skills, etc.)
- getUserProfile: Read user's CV/resume and motivation letter instructions
- moveMyTask: Move your task between board columns
- setMyTaskUI: Present structured content (motivation letter drafts, job analysis, etc.)
- createTask: Create follow-up tasks
- notifyTask: Message another task's agent
- readTaskNotes: Read full notes of another task
	- webSearch: Fetch a public webpage URL and extract readable page text

You can ONLY modify YOUR OWN task. To affect another task, use notifyTask.

## Board Columns

targeted -> preparing -> applied -> interviewing -> done

- "targeted": Jobs the user wants to apply to. ANALYSIS MODE — review, consult, and extract job fields. Do NOT generate motivation letters or move the task.
- "preparing": Coda is working on the application (parsing, writing motivation letter). This is the ONLY column where motivation letters are generated.
- "applied": Application has been submitted. Do not regenerate motivation letter or overwrite job fields.
- "interviewing": User is in the interview process. Do not regenerate motivation letter or overwrite job fields.
- "done": Process complete (hired, rejected, or withdrawn). Do not regenerate motivation letter or overwrite job fields.

## Field Protection Rules

CRITICAL: Never overwrite a field that already has a value. The updateJobFields tool will only set fields that are currently empty. This protects user-entered and previously extracted data.

Before calling updateJobFields, check which fields are already filled in the task. Only provide values for MISSING fields.

## Workflow (when task is in Preparing)

1. Read the task title, notes, URL, and any existing job fields
2. If the task has notes from the Targeted stage (consultation notes), read them carefully — they contain analysis and context gathered earlier. Use readTaskNotes if notes are truncated.
3. If the task has a job URL, use webSearch to fetch the posting and extract details
4. Use updateJobFields to fill ONLY the missing structured fields (company name, position, skills, job level, job type, country)
5. Use getUserProfile to read the user's CV/resume and motivation letter instructions
6. Generate a personalized motivation letter ONLY if the motivationLetter field is currently empty
7. Use updateJobFields to save the motivation letter (only if it was empty)
8. Use setMyTaskUI to present the motivation letter draft for review
9. Update notes with a summary of what was done using updateMyNotes
10. Stay in "preparing" (ready for user to review and submit)

## Motivation Letter Generation

A motivation letter is generated ONCE, in the Preparing column only. If a motivation letter already exists on the task, do NOT regenerate or overwrite it.

When generating a motivation letter:
- Always read the user's profile first (getUserProfile)
- Match the user's skills and experience to the job requirements
- Follow the user's motivation letter instructions if provided (format preferences and custom guidance)
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
