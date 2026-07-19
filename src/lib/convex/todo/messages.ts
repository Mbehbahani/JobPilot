import { internalAction, query } from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { components } from '../_generated/api';
import { todoAgent } from './agent';
import { paginationOptsValidator } from 'convex/server';
import { listUIMessages, syncStreams } from '@convex-dev/agent';
import { vStreamArgs } from '@convex-dev/agent/validators';
import { authedMutation } from '../functions';
import { getTaskLanguageModelForUser } from '../support/llmProvider';
import { stepCountIs, type FinishReason, type LanguageModelUsage, type ModelMessage } from 'ai';

const TODO_AGENT_ABORT_MS = 9 * 60 * 1000 + 30 * 1000;
const TODO_AGENT_WARNING_MS = 8 * 60 * 1000 + 30 * 1000;
const TODO_AGENT_MAX_STEPS = 24;
const TODO_AGENT_WARNING_STEP = 20;
const TODO_AGENT_TIMEOUT_SUMMARY =
	'Nova ran out of time after partial progress. Review notes and retry if needed.';
const TODO_AGENT_STEP_LIMIT_SUMMARY =
	'Nova stopped after reaching the task step limit. Partial progress was saved.';
const TODO_AGENT_ERROR_FINISH_SUMMARY =
	'Nova stopped due to a model error. Review notes and retry if needed.';
const TODO_AGENT_LENGTH_FINISH_SUMMARY =
	'Nova ran out of response tokens before finishing. Review notes and retry if needed.';
const TODO_AGENT_CONTENT_FILTER_SUMMARY =
	'Nova was stopped by a content filter. Review the task and retry with different wording.';
const TODO_AGENT_OTHER_FINISH_SUMMARY =
	'Nova stopped unexpectedly without completing the task. Review notes and retry if needed.';
const TODO_AGENT_NEAR_LIMIT_REMINDER =
	'System reminder: you are close to the runtime limit. Wrap up now. Record concrete findings, move the task to the right column, and send your final one-sentence summary. Do not start new exploratory work unless it is required to finish.';

type TodoRunOutcome = 'done' | 'timeout' | 'step_limit' | 'error';

type TodoRunMetadata = {
	finishReason?: FinishReason;
	usage?: LanguageModelUsage;
	text: string;
	steps: Array<{
		text?: string;
		toolCalls?: Array<{ toolName?: string; args?: unknown }>;
		toolResults?: Array<{ result?: unknown }>;
	}>;
};

type TodoRunResolution = {
	outcome: TodoRunOutcome;
	status: 'done' | 'error';
	summary: string;
	detail?: string;
};

function toDisplayText(value: unknown): string {
	if (typeof value === 'string') return value;
	if (value == null) return '';
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function truncateText(value: unknown, maxLength: number): string {
	const text = toDisplayText(value);
	return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function normalizeSummaryText(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === 'string') return error;
	if (error && typeof error === 'object' && 'message' in error) {
		return toDisplayText((error as { message?: unknown }).message) || 'Unknown error';
	}
	return 'Unknown error';
}

function isAbortLikeError(error: unknown): boolean {
	const message = getErrorMessage(error).toLowerCase();
	const name =
		error && typeof error === 'object' && 'name' in error
			? String((error as { name?: unknown }).name ?? '')
			: '';

	return (
		name === 'AbortError' ||
		name === 'TimeoutError' ||
		message.includes('aborted') ||
		message.includes('timeout') ||
		message.includes('timed out')
	);
}

async function collectTodoRunMetadata(result: any): Promise<TodoRunMetadata> {
	const [stepsResult, finishReasonResult, usageResult, textResult] = await Promise.allSettled([
		result.steps,
		result.finishReason,
		result.usage,
		result.text
	]);

	return {
		steps:
			stepsResult.status === 'fulfilled' && Array.isArray(stepsResult.value)
				? stepsResult.value
				: [],
		finishReason: finishReasonResult.status === 'fulfilled' ? finishReasonResult.value : undefined,
		usage: usageResult.status === 'fulfilled' ? usageResult.value : undefined,
		text: textResult.status === 'fulfilled' ? normalizeSummaryText(textResult.value) : ''
	};
}

export function formatTodoAgentDebug(
	data: Partial<TodoRunMetadata>,
	context: { taskId: string; trigger: string }
): string {
	const steps = Array.isArray(data.steps) ? data.steps : [];
	const stepCount = steps.length;
	const toolSummaries: string[] = [];

	for (const [i, step] of steps.entries()) {
		const calls = Array.isArray(step.toolCalls) ? step.toolCalls : [];
		const results = Array.isArray(step.toolResults) ? step.toolResults : [];

		for (const [j, toolCall] of calls.entries()) {
			const toolResult = results[j];
			const resultPreview = toolResult?.result ? truncateText(toolResult.result, 300) : '(empty)';
			toolSummaries.push(
				`  step${i}/${toolCall?.toolName ?? 'unknown'}(${truncateText(toolCall?.args, 200)}) => ${resultPreview}`
			);
		}

		const stepText = normalizeSummaryText(step.text);
		if (calls.length === 0 && stepText) {
			toolSummaries.push(`  step${i}/text: ${truncateText(stepText, 200)}`);
		}
	}

	return [
		`[agent-debug] task=${context.taskId} trigger=${context.trigger}`,
		`  steps=${stepCount} finishReason=${data.finishReason ?? 'unknown'} tokens=${data.usage?.totalTokens ?? '?'}`,
		`  finalText=${truncateText(data.text ?? '', 150)}`,
		...toolSummaries
	].join('\n');
}

export function resolveTodoRunOutcome(args: {
	defaultSummary: string;
	error?: unknown;
	finishReason?: FinishReason;
	steps?: Array<unknown>;
	text?: string;
}): TodoRunResolution {
	const text = normalizeSummaryText(args.text);
	const finishReason = args.finishReason;
	const stepCount = Array.isArray(args.steps) ? args.steps.length : 0;

	if (args.error) {
		const errorMessage = getErrorMessage(args.error);
		if (isAbortLikeError(args.error)) {
			return {
				outcome: 'timeout',
				status: 'error',
				summary: TODO_AGENT_TIMEOUT_SUMMARY,
				detail: `error=${errorMessage}`
			};
		}

		return {
			outcome: 'error',
			status: 'error',
			summary: truncateText(`Nova hit an error: ${errorMessage}`, 120),
			detail: `error=${errorMessage}`
		};
	}

	if (finishReason === 'tool-calls' && stepCount >= TODO_AGENT_MAX_STEPS) {
		return {
			outcome: 'step_limit',
			status: 'error',
			summary: TODO_AGENT_STEP_LIMIT_SUMMARY,
			detail: `finishReason=${finishReason} stepCount=${stepCount}`
		};
	}

	if (finishReason === 'error') {
		return {
			outcome: 'error',
			status: 'error',
			summary: TODO_AGENT_ERROR_FINISH_SUMMARY,
			detail: `finishReason=${finishReason} stepCount=${stepCount}`
		};
	}

	if (finishReason === 'length') {
		return {
			outcome: 'error',
			status: 'error',
			summary: TODO_AGENT_LENGTH_FINISH_SUMMARY,
			detail: `finishReason=${finishReason} stepCount=${stepCount}`
		};
	}

	if (finishReason === 'content-filter') {
		return {
			outcome: 'error',
			status: 'error',
			summary: TODO_AGENT_CONTENT_FILTER_SUMMARY,
			detail: `finishReason=${finishReason} stepCount=${stepCount}`
		};
	}

	if (finishReason === 'other') {
		return {
			outcome: 'error',
			status: 'error',
			summary: TODO_AGENT_OTHER_FINISH_SUMMARY,
			detail: `finishReason=${finishReason} stepCount=${stepCount}`
		};
	}

	return {
		outcome: 'done',
		status: 'done',
		summary: text || args.defaultSummary
	};
}

export function shouldInjectTodoNearLimitReminder(args: {
	elapsedMs: number;
	stepCount: number;
	reminderSent: boolean;
}): boolean {
	return (
		!args.reminderSent &&
		(args.elapsedMs >= TODO_AGENT_WARNING_MS || args.stepCount >= TODO_AGENT_WARNING_STEP)
	);
}

/**
 * Intentional passthrough. Column-specific behavior is enforced by prompts/tools,
 * not by rewriting a completed run after the fact.
 */
export function applyColumnGuard(
	resolution: TodoRunResolution,
	_columnId: string | undefined
): TodoRunResolution {
	return resolution;
}

function createTodoNearLimitReminderMessage(): ModelMessage {
	return {
		role: 'user',
		content: TODO_AGENT_NEAR_LIMIT_REMINDER
	};
}

/** Extract debug info from a streamText result after consumeStream(). */
async function extractAgentDebug(
	result: any,
	context: { taskId: string; trigger: string }
): Promise<string> {
	try {
		const metadata = await collectTodoRunMetadata(result);
		const debug = formatTodoAgentDebug(metadata, context);
		console.log(debug);
		return debug;
	} catch (e) {
		const fallback = `[agent-debug] task=${context.taskId} extraction failed: ${e}`;
		console.log(fallback);
		return fallback;
	}
}

async function runTodoAgentForTask(
	ctx: {
		runMutation: (fn: any, args: any) => Promise<any>;
		runQuery: (fn: any, args: any) => Promise<any>;
		scheduler: { runAfter: (delayMs: number, fn: any, args: any) => Promise<any> };
	},
	args: {
		userId: string;
		taskId: string;
		threadId: string;
		promptMessageId: string;
		trigger: string;
		defaultSummary: string;
		onDone?: () => Promise<void>;
	}
): Promise<TodoRunResolution> {
	const model = await getTaskLanguageModelForUser(ctx as any, args.userId);
	const startedAt = Date.now();
	let nearLimitReminderSent = false;
	let metadata: TodoRunMetadata = { steps: [], text: '' };
	let resolution!: TodoRunResolution;
	const result = await todoAgent.streamText(
		ctx as any,
		{ threadId: args.threadId, userId: args.userId },
		{
			promptMessageId: args.promptMessageId,
			model,
			providerOptions: { openai: { store: false, reasoningEffort: 'medium' } },
			abortSignal: AbortSignal.timeout(TODO_AGENT_ABORT_MS),
			stopWhen: stepCountIs(TODO_AGENT_MAX_STEPS),
			prepareStep: async (options) => {
				if (
					!shouldInjectTodoNearLimitReminder({
						elapsedMs: Date.now() - startedAt,
						stepCount: options.stepNumber,
						reminderSent: nearLimitReminderSent
					})
				) {
					return undefined;
				}

				nearLimitReminderSent = true;
				return { messages: [...options.messages, createTodoNearLimitReminderMessage()] };
			}
		},
		{ saveStreamDeltas: { chunking: 'line', throttleMs: 100 } }
	);

	try {
		await result.consumeStream();
		metadata = await collectTodoRunMetadata(result);
		resolution = resolveTodoRunOutcome({
			defaultSummary: args.defaultSummary,
			finishReason: metadata.finishReason,
			steps: metadata.steps,
			text: metadata.text
		});
	} catch (error) {
		console.error(`Agent failed for task ${args.taskId}:`, error);
		metadata = await collectTodoRunMetadata(result);
		resolution = resolveTodoRunOutcome({
			defaultSummary: args.defaultSummary,
			error,
			finishReason: metadata.finishReason,
			steps: metadata.steps,
			text: metadata.text
		});
	}

	const debug = await extractAgentDebug(result, {
		taskId: args.taskId,
		trigger: args.trigger
	});

	// Targeted analysis remains idle after completion by design.
	const taskInfo = await ctx.runQuery(internal.todos.getTaskThreadInfo, {
		userId: args.userId,
		taskId: args.taskId
	});
	const deferred = taskInfo?.columnId === 'targeted';

	// Apply column guard before onDone or any side effects
	const effective = applyColumnGuard(resolution, taskInfo?.columnId);

	// Only run onDone if the effective resolution is still done
	if (effective.outcome === 'done') {
		await args.onDone?.();
	}

	const logLines = [debug, '', `outcome=${effective.outcome}`, `summary=${effective.summary}`];
	if (nearLimitReminderSent) {
		logLines.push('nearLimitReminder=sent');
	}
	if (effective.detail) {
		logLines.push(effective.detail);
	}

	await ctx.runMutation(internal.todos.updateTaskAgentLogsInternal, {
		userId: args.userId,
		taskId: args.taskId,
		agentLogs: logLines.join('\n').slice(0, 4000)
	});

	const agentStatus = deferred ? 'idle' : effective.status;

	await ctx.runMutation(internal.todos.updateTaskAgentStatusInternal, {
		userId: args.userId,
		taskId: args.taskId,
		agentStatus,
		agentSummary: effective.summary.slice(0, 120)
	});

	return effective;
}

/**
 * Safety net around agent trigger actions: guarantees a task never gets stuck at
 * agentStatus 'working' forever. Some failures (e.g. a rejected model/provider
 * request that crashes the agent component's internal stream-reconstruction logic)
 * escape as errors that occur outside runTodoAgentForTask's own try/catch. Without
 * this wrapper those tasks would sit in "Processing…" until the recoverStaleTasks
 * cron catches up (up to ~15 minutes later). Wrapping every trigger action's body
 * here surfaces the error immediately with a clear summary instead.
 */
async function withAgentStuckGuard(
	ctx: {
		runMutation: (fn: any, args: any) => Promise<any>;
	},
	args: { userId: string; taskId: string },
	fn: () => Promise<void>
): Promise<void> {
	try {
		await fn();
	} catch (error) {
		const message = getErrorMessage(error);
		console.error(`Agent trigger failed for task ${args.taskId}:`, error);
		await ctx.runMutation(internal.todos.updateTaskAgentStatusInternal, {
			userId: args.userId,
			taskId: args.taskId,
			agentStatus: 'error',
			agentSummary: truncateText(`Nova hit an error: ${message}`, 120)
		});
		await ctx.runMutation(internal.todos.updateTaskAgentLogsInternal, {
			userId: args.userId,
			taskId: args.taskId,
			agentLogs: `[trigger-error] ${message}`.slice(0, 4000)
		});
	}
}

/**
 * Send a user message to a todo task thread
 */
export const sendMessage = authedMutation({
	args: {
		threadId: v.string(),
		prompt: v.string()
	},
	handler: async (ctx, args) => {
		const result = await todoAgent.saveMessage(ctx, {
			threadId: args.threadId,
			prompt: args.prompt,
			skipEmbeddings: true
		});

		await ctx.scheduler.runAfter(0, internal.todo.messages.createAIResponse, {
			threadId: args.threadId,
			promptMessageId: result.messageId,
			userId: ctx.user._id
		});

		return { messageId: result.messageId };
	}
});

/**
 * Generate AI response with streaming
 */
export const createAIResponse = internalAction({
	args: {
		threadId: v.string(),
		promptMessageId: v.string(),
		userId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		if (!args.userId) throw new Error('userId is required for AI responses');
		const model = await getTaskLanguageModelForUser(ctx, args.userId);

		const result = await todoAgent.streamText(
			ctx,
			{ threadId: args.threadId, userId: args.userId },
			{
				promptMessageId: args.promptMessageId,
				model,
				providerOptions: { openai: { store: false, reasoningEffort: 'medium' } }
			},
			{
				saveStreamDeltas: {
					chunking: 'line',
					throttleMs: 100
				}
			}
		);

		await result.consumeStream();
	}
});

/**
 * List messages in a todo thread with streaming support
 */
export const listMessages = query({
	args: {
		threadId: v.string(),
		paginationOpts: paginationOptsValidator,
		streamArgs: vStreamArgs
	},
	handler: async (ctx, args): Promise<unknown> => {
		const paginated = await listUIMessages(ctx, components.agent, {
			threadId: args.threadId,
			paginationOpts: args.paginationOpts
		});

		const streams = await syncStreams(ctx, components.agent, {
			threadId: args.threadId,
			streamArgs: args.streamArgs,
			includeStatuses: ['streaming', 'finished', 'aborted']
		});

		return { ...paginated, page: paginated.page, streams };
	}
});

/**
 * Build the board context lines showing other tasks (read-only awareness).
 */
async function buildBoardContext(
	ctx: { runQuery: (fn: any, args: any) => Promise<any> },
	userId: string,
	excludeTaskId: string
): Promise<{
	otherTasks: string[];
	columnInfo: string[];
	currentDateTime: string;
	currentTaskContext: string;
}> {
	const [board, columns] = await Promise.all([
		ctx.runQuery(internal.todos.getBoardInternal, { userId }),
		ctx.runQuery(internal.todos.getColumnMetaInternal, { userId })
	]);

	const otherTasks: string[] = [];
	let currentTask: Record<string, unknown> | undefined;
	for (const [col, tasks] of Object.entries(board)) {
		for (const t of tasks as Array<Record<string, unknown> & { id: string; title: string }>) {
			if (t.id !== excludeTaskId) {
				const statusTag = t.agentStatus ? ` [${String(t.agentStatus)}]` : '';
				otherTasks.push(`  - [${col}] ${truncateText(t.title, 160)} (id: ${t.id})${statusTag}`);
			} else {
				currentTask = { ...t, columnId: col };
			}
		}
	}

	const currentTaskContext = currentTask
		? [
				'Current task snapshot (authoritative; use this URL and preserve filled fields):',
				JSON.stringify({
					id: currentTask.id,
					title: truncateText(currentTask.title, 300),
					columnId: currentTask.columnId,
					notes: truncateText(currentTask.notes, 1200) || undefined,
					companyName: currentTask.companyName,
					position: currentTask.position,
					jobUrl: currentTask.jobUrl,
					jobDescription: truncateText(currentTask.jobDescription, 6000) || undefined,
					skills: currentTask.skills,
					country: currentTask.country,
					jobLevel: currentTask.jobLevel,
					jobType: currentTask.jobType,
					platform: currentTask.platform,
					motivationLetterPresent: Boolean(currentTask.motivationLetter)
				})
			].join('\n')
		: 'Current task snapshot unavailable.';

	const columnMeta = columns as { id: string; name?: string; instructions?: string }[];
	const columnInfo: string[] = ['Lists on the board:'];
	const allColumnIds = Object.keys(board);
	for (const colId of allColumnIds) {
		const meta = columnMeta.find((c) => c.id === colId);
		const namePart = meta?.name ? ` (name: "${meta.name}")` : '';
		const instrPart = meta?.instructions ? ` — Instructions: "${meta.instructions}"` : '';
		columnInfo.push(`  - ${colId}${namePart}${instrPart}`);
	}

	const currentDateTime = new Date().toISOString();

	return { otherTasks, columnInfo, currentDateTime, currentTaskContext };
}

/**
 * Auto-triggered when a new task is created on the Kanban board.
 * Creates a thread, runs the agent with tools, and updates the task with results.
 */
export const triggerAgentForNewTask = internalAction({
	args: {
		userId: v.string(),
		taskId: v.string(),
		taskTitle: v.string(),
		taskNotes: v.optional(v.string()),
		taskColumn: v.string(),
		parentNotification: v.optional(v.string()),
		incomingNotification: v.optional(
			v.object({
				fromTaskId: v.string(),
				message: v.string(),
				priority: v.string()
			})
		)
	},
	handler: async (ctx, args) => {
		await withAgentStuckGuard(ctx, args, async () => {
			// 0. Atomically claim the task. A duplicate scheduled action exits here.
			const claimed = await ctx.runMutation(internal.todos.beginTaskAgentRunInternal, {
				userId: args.userId,
				taskId: args.taskId
			});
			if (!claimed) return;

			// 1. Create a thread for this task
			const { threadId } = await todoAgent.createThread(ctx, {
				userId: args.userId,
				title: args.taskTitle
			});

			// 2. Persist threadId on the task
			await ctx.runMutation(internal.todos.updateTaskThreadIdInternal, {
				userId: args.userId,
				taskId: args.taskId,
				threadId
			});

			// 3. Build board context
			const { otherTasks, columnInfo, currentDateTime, currentTaskContext } =
				await buildBoardContext(ctx, args.userId, args.taskId);

			// 4. Build prompt
			const truncatedNotes =
				args.taskNotes && args.taskNotes.length > 300
					? args.taskNotes.slice(0, 300) + '... (truncated — use readTaskNotes to see full notes)'
					: args.taskNotes;
			const promptParts: (string | null)[] = [
				`Current date/time: ${currentDateTime}`,
				currentTaskContext,
				`You are now the dedicated agent for this task: "${truncateText(args.taskTitle, 300)}"`,
				`Current column: ${args.taskColumn}`,
				truncatedNotes ? `Notes: ${truncatedNotes}` : null,
				'',
				columnInfo.join('\n'),
				''
			];

			// Include parent notification (from createTask)
			if (args.parentNotification) {
				promptParts.push(
					'Context from the agent that created this task:',
					args.parentNotification,
					''
				);
			}

			// Include incoming notification (from notifyTask to threadless task)
			if (args.incomingNotification) {
				promptParts.push(
					'Incoming notification from another task:',
					`From task: ${args.incomingNotification.fromTaskId}`,
					`Priority: ${args.incomingNotification.priority}`,
					`Message: ${args.incomingNotification.message}`,
					''
				);
			}

			promptParts.push(
				otherTasks.length > 0
					? `Other tasks on the board (for awareness — you can notify them but NOT modify them):\n${otherTasks.join('\n')}`
					: null,
				''
			);

			if (args.taskColumn === 'targeted') {
				promptParts.push(
					'You are in ANALYSIS MODE for this job opportunity.',
					'',
					'Your task:',
					'1. Review the task title and any notes/URL provided.',
					'2. If jobDescription is present, parse it directly. If jobUrl is present and jobDescription is empty, call webSearch with that exact URL.',
					'3. Use updateJobFields to fill ONLY MISSING fields (company name, position, skills, job level, job type, country, job description, platform, etc.) — do NOT overwrite fields that already have a value.',
					'4. Write a structured consultation summary to the task notes using updateMyNotes. Include:',
					'   - What information you found and extracted',
					'   - What fields are still missing and what the user should add',
					'   - A brief assessment of the opportunity (role, company fit, any notable requirements)',
					'   - A recommendation on whether to proceed to the Preparing stage',
					'',
					'Do NOT write a motivation letter.',
					'Do NOT move this task to any other column.',
					'Stay in the Targeted column — this is analysis and field extraction only.'
				);
			} else {
				promptParts.push(
					'Analyze this task and take action immediately. Do NOT ask questions or create clarifying sub-tasks — make reasonable assumptions and proceed.',
					'',
					'Steps:',
					'1. If the task has existing notes (e.g. from the Targeted stage), read them first with readTaskNotes for full context.',
					'2. Use getUserProfile to read the user resume.',
					'3. Parse the job description (use webSearch if a URL is available and jobDescription is empty).',
					'4. Use updateJobFields to fill ONLY MISSING fields — do NOT overwrite fields that already have a value.',
					'5. Generate a motivation letter ONLY if the motivationLetter field is currently empty.',
					'6. Update your task notes with findings using updateMyNotes.'
				);
			}

			const prompt = promptParts.filter(Boolean).join('\n');

			// 5. Save the prompt as a user message
			const { messageId } = await todoAgent.saveMessage(ctx, {
				threadId,
				prompt,
				skipEmbeddings: true
			});

			// 6. Run the agent with guarded execution
			await runTodoAgentForTask(ctx, {
				userId: args.userId,
				taskId: args.taskId,
				threadId,
				promptMessageId: messageId,
				trigger: 'newTask',
				defaultSummary: 'Nova finished processing.'
			});
		});
	}
});

/**
 * Triggered when a user updates an existing task (moves it or edits notes).
 * Sends a follow-up message to the task's existing thread.
 */
export const triggerAgentForTaskUpdate = internalAction({
	args: {
		userId: v.string(),
		threadId: v.string(),
		taskId: v.string(),
		taskTitle: v.string(),
		prompt: v.string()
	},
	handler: async (ctx, args) => {
		await withAgentStuckGuard(ctx, args, async () => {
			// 0. Atomically claim the task. A duplicate scheduled action exits here.
			const claimed = await ctx.runMutation(internal.todos.beginTaskAgentRunInternal, {
				userId: args.userId,
				taskId: args.taskId
			});
			if (!claimed) return;

			// 1. Build board context
			const { otherTasks, columnInfo, currentDateTime, currentTaskContext } =
				await buildBoardContext(ctx, args.userId, args.taskId);

			const fullPrompt = [
				`Current date/time: ${currentDateTime}`,
				currentTaskContext,
				args.prompt,
				'',
				columnInfo.join('\n'),
				'',
				otherTasks.length > 0
					? `Other tasks on the board (for awareness — you can notify them but NOT modify them):\n${otherTasks.join('\n')}`
					: null
			]
				.filter(Boolean)
				.join('\n');

			// 2. Save user message to existing thread
			const { messageId } = await todoAgent.saveMessage(ctx, {
				threadId: args.threadId,
				prompt: fullPrompt,
				skipEmbeddings: true
			});

			// 3. Run agent with guarded execution
			await runTodoAgentForTask(ctx, {
				userId: args.userId,
				taskId: args.taskId,
				threadId: args.threadId,
				promptMessageId: messageId,
				trigger: 'taskUpdate',
				defaultSummary: 'Nova finished processing.'
			});
		});
	}
});

/**
 * Triggered when another task's agent sends a notification to this task.
 * Wakes the receiving agent to process the notification and decide what to do.
 */
export const triggerAgentForNotification = internalAction({
	args: {
		userId: v.string(),
		threadId: v.string(),
		taskId: v.string(),
		taskTitle: v.string(),
		fromTaskId: v.string(),
		message: v.string(),
		priority: v.string()
	},
	handler: async (ctx, args) => {
		// 0. Atomically claim the task before reading queued notifications.
		const claimed = await ctx.runMutation(internal.todos.beginTaskAgentRunInternal, {
			userId: args.userId,
			taskId: args.taskId
		});

		if (!claimed) {
			// Agent is busy — queue notification for later delivery
			await ctx.runMutation(internal.todo.notifications.createNotification, {
				userId: args.userId,
				fromTaskId: args.fromTaskId,
				toTaskId: args.taskId,
				message: args.message,
				priority: args.priority as 'low' | 'normal' | 'high',
				depth: 0
			});
			return;
		}

		await withAgentStuckGuard(ctx, args, async () => {
			// 1. Fetch any queued pending notifications
			const pendingNotifications = await ctx.runQuery(
				internal.todo.notifications.getPendingNotifications,
				{ userId: args.userId, taskId: args.taskId }
			);

			// 3. Build notification prompt
			const allNotifications = [
				{ from: args.fromTaskId, message: args.message, priority: args.priority },
				...pendingNotifications.map(
					(n: { fromTaskId: string; message: string; priority: string }) => ({
						from: n.fromTaskId,
						message: n.message,
						priority: n.priority
					})
				)
			];

			const notifLines = allNotifications.map(
				(n) => `  [${n.priority.toUpperCase()}] From task ${n.from}: ${n.message}`
			);

			// 4. Build board context
			const { otherTasks, columnInfo, currentDateTime, currentTaskContext } =
				await buildBoardContext(ctx, args.userId, args.taskId);

			const prompt = [
				`Current date/time: ${currentDateTime}`,
				currentTaskContext,
				`Notification received for your task: "${args.taskTitle}"`,
				'',
				'Incoming notification(s):',
				...notifLines,
				'',
				'Review these notifications and decide if your task needs updating.',
				'You may update your own notes, move your task, or take no action if irrelevant.',
				'If you need to notify other tasks in response, use notifyTask.',
				'',
				columnInfo.join('\n'),
				'',
				otherTasks.length > 0
					? `Other tasks on the board (for awareness only):\n${otherTasks.join('\n')}`
					: null
			]
				.filter(Boolean)
				.join('\n');

			// 5. Save prompt and run agent
			const { messageId } = await todoAgent.saveMessage(ctx, {
				threadId: args.threadId,
				prompt,
				skipEmbeddings: true
			});

			await runTodoAgentForTask(ctx, {
				userId: args.userId,
				taskId: args.taskId,
				threadId: args.threadId,
				promptMessageId: messageId,
				trigger: 'notification',
				defaultSummary: 'Nova finished processing.',
				onDone: async () => {
					await ctx.runMutation(internal.todo.notifications.clearPendingNotifications, {
						userId: args.userId,
						taskId: args.taskId
					});
				}
			});
		});
	}
});
