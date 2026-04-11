import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { authedMutation, authedQuery } from './functions';

const COLUMN_IDS = ['targeted', 'preparing', 'applied', 'interviewing', 'done'] as const;
const _DEFAULT_COLUMN_IDS = [...COLUMN_IDS];

type ColumnMeta = { id: string; name?: string; instructions?: string };
const _columnMetaValidator = v.object({
	id: v.string(),
	name: v.optional(v.string()),
	instructions: v.optional(v.string())
});

const agentStatusValidator = v.optional(
	v.union(
		v.literal('idle'),
		v.literal('working'),
		v.literal('done'),
		v.literal('awaiting_approval'),
		v.literal('error')
	)
);
const agentDraftTypeValidator = v.optional(
	v.union(v.literal('message'), v.literal('email'), v.literal('research'))
);
const emailSignalTypeValidator = v.optional(
	v.union(
		v.literal('interview'),
		v.literal('follow_up_interview'),
		v.literal('rejection'),
		v.literal('acceptance')
	)
);

const taskValidator = v.object({
	id: v.string(),
	title: v.string(),
	notes: v.optional(v.string()),
	agentLogs: v.optional(v.string()),
	threadId: v.optional(v.string()),
	agentStatus: agentStatusValidator,
	agentSummary: v.optional(v.string()),
	agentDraft: v.optional(v.string()),
	agentDraftType: agentDraftTypeValidator,
	hasUnreadNotes: v.optional(v.boolean()),
	hasUnreadEmailSignal: v.optional(v.boolean()),
	emailSignalType: emailSignalTypeValidator,
	emailSignalSummary: v.optional(v.string()),
	emailSignalNextAction: v.optional(v.string()),
	emailSignalAt: v.optional(v.number()),
	emailSignalMessageId: v.optional(v.string()),
	agentSpec: v.optional(v.string()),
	createdAt: v.optional(v.number()),
	targetedAt: v.optional(v.number()),
	preparingAt: v.optional(v.number()),
	appliedAt: v.optional(v.number()),
	interviewingAt: v.optional(v.number()),
	doneAt: v.optional(v.number()),
	// Job-specific fields
	companyName: v.optional(v.string()),
	position: v.optional(v.string()),
	jobUrl: v.optional(v.string()),
	jobDescription: v.optional(v.string()),
	skills: v.optional(v.string()),
	country: v.optional(v.string()),
	jobLevel: v.optional(v.string()),
	jobType: v.optional(v.string()),
	platform: v.optional(v.string()),
	motivationLetter: v.optional(v.string()),
	interviewDate: v.optional(v.string()),
	interviewLink: v.optional(v.string()),
	interviewEmail: v.optional(v.string())
});

const boardValidator = v.record(v.string(), v.array(taskValidator));

type ColumnId = (typeof COLUMN_IDS)[number];
type AgentStatus = 'idle' | 'working' | 'done' | 'awaiting_approval' | 'error';
type AgentDraftType = 'message' | 'email' | 'research';
type EmailSignalType = 'interview' | 'follow_up_interview' | 'rejection' | 'acceptance';
type BoardTask = {
	id: string;
	title: string;
	notes?: string;
	agentLogs?: string;
	threadId?: string;
	agentStatus?: AgentStatus;
	agentSummary?: string;
	agentDraft?: string;
	agentDraftType?: AgentDraftType;
	hasUnreadNotes?: boolean;
	hasUnreadEmailSignal?: boolean;
	emailSignalType?: EmailSignalType;
	emailSignalSummary?: string;
	emailSignalNextAction?: string;
	emailSignalAt?: number;
	emailSignalMessageId?: string;
	agentSpec?: string;
	createdAt?: number;
	targetedAt?: number;
	preparingAt?: number;
	appliedAt?: number;
	interviewingAt?: number;
	doneAt?: number;
	// Job-specific fields
	companyName?: string;
	position?: string;
	jobUrl?: string;
	jobDescription?: string;
	skills?: string;
	country?: string;
	jobLevel?: string;
	jobType?: string;
	platform?: string;
	motivationLetter?: string;
	interviewDate?: string;
	interviewLink?: string;
	interviewEmail?: string;
};
type Board = Record<ColumnId, BoardTask[]>;
type StoredTask = {
	id: string;
	title: string;
	notes?: string;
	agentLogs?: string;
	threadId?: string;
	agentStatus?: AgentStatus;
	agentSummary?: string;
	agentDraft?: string;
	agentDraftType?: AgentDraftType;
	hasUnreadNotes?: boolean;
	hasUnreadEmailSignal?: boolean;
	emailSignalType?: EmailSignalType;
	emailSignalSummary?: string;
	emailSignalNextAction?: string;
	emailSignalAt?: number;
	emailSignalMessageId?: string;
	agentSpec?: string;
	agentStartedAt?: number;
	// Job-specific fields
	companyName?: string;
	position?: string;
	jobUrl?: string;
	jobDescription?: string;
	skills?: string;
	country?: string;
	jobLevel?: string;
	jobType?: string;
	platform?: string;
	motivationLetter?: string;
	interviewDate?: string;
	interviewLink?: string;
	interviewEmail?: string;
	columnId: ColumnId;
	order: number;
	createdAt: number;
	updatedAt: number;
	targetedAt?: number;
	preparingAt?: number;
	appliedAt?: number;
	interviewingAt?: number;
	doneAt?: number;
};

function emptyBoard(): Board {
	return {
		targeted: [],
		preparing: [],
		applied: [],
		interviewing: [],
		done: []
	};
}

function parseBoard(input: Record<string, BoardTask[]>): Board {
	const targeted = input.targeted;
	const preparing = input.preparing;
	const applied = input.applied;
	const interviewing = input.interviewing;
	const done = input.done;
	if (!targeted || !preparing || !applied || !interviewing || !done) {
		throw new Error(
			'Board must include targeted, preparing, applied, interviewing, and done columns'
		);
	}

	for (const key of Object.keys(input)) {
		if (!COLUMN_IDS.includes(key as ColumnId)) {
			throw new Error(`Unknown board column: ${key}`);
		}
	}

	return {
		targeted,
		preparing,
		applied,
		interviewing,
		done
	};
}

function toBoard(tasks: StoredTask[]): Board {
	const board = emptyBoard();

	for (const columnId of COLUMN_IDS) {
		board[columnId] = tasks
			.filter((task) => task.columnId === columnId)
			.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
			.map((task) => ({
				id: task.id,
				title: task.title,
				...(task.notes ? { notes: task.notes } : {}),
				...(task.agentLogs ? { agentLogs: task.agentLogs } : {}),
				...(task.threadId ? { threadId: task.threadId } : {}),
				...(task.agentStatus ? { agentStatus: task.agentStatus } : {}),
				...(task.agentSummary ? { agentSummary: task.agentSummary } : {}),
				...(task.agentDraft ? { agentDraft: task.agentDraft } : {}),
				...(task.agentDraftType ? { agentDraftType: task.agentDraftType } : {}),
				...(task.hasUnreadNotes ? { hasUnreadNotes: task.hasUnreadNotes } : {}),
				...(task.hasUnreadEmailSignal ? { hasUnreadEmailSignal: task.hasUnreadEmailSignal } : {}),
				...(task.emailSignalType ? { emailSignalType: task.emailSignalType } : {}),
				...(task.emailSignalSummary ? { emailSignalSummary: task.emailSignalSummary } : {}),
				...(task.emailSignalNextAction
					? { emailSignalNextAction: task.emailSignalNextAction }
					: {}),
				...(task.emailSignalAt ? { emailSignalAt: task.emailSignalAt } : {}),
				...(task.emailSignalMessageId ? { emailSignalMessageId: task.emailSignalMessageId } : {}),
				...(task.agentSpec ? { agentSpec: task.agentSpec } : {}),
				...(task.createdAt ? { createdAt: task.createdAt } : {}),
				...(task.companyName ? { companyName: task.companyName } : {}),
				...(task.position ? { position: task.position } : {}),
				...(task.jobUrl ? { jobUrl: task.jobUrl } : {}),
				...(task.jobDescription ? { jobDescription: task.jobDescription } : {}),
				...(task.skills ? { skills: task.skills } : {}),
				...(task.country ? { country: task.country } : {}),
				...(task.jobLevel ? { jobLevel: task.jobLevel } : {}),
				...(task.jobType ? { jobType: task.jobType } : {}),
				...(task.platform ? { platform: task.platform } : {}),
				...(task.motivationLetter ? { motivationLetter: task.motivationLetter } : {}),
				...(task.interviewDate ? { interviewDate: task.interviewDate } : {}),
				...(task.interviewLink ? { interviewLink: task.interviewLink } : {}),
				...(task.interviewEmail ? { interviewEmail: task.interviewEmail } : {}),
				...(task.targetedAt ? { targetedAt: task.targetedAt } : {}),
				...(task.preparingAt ? { preparingAt: task.preparingAt } : {}),
				...(task.appliedAt ? { appliedAt: task.appliedAt } : {}),
				...(task.interviewingAt ? { interviewingAt: task.interviewingAt } : {}),
				...(task.doneAt ? { doneAt: task.doneAt } : {})
			}));
	}

	return board;
}

function sanitizeAndFlattenBoard(
	board: Board,
	existingTasksById: Map<string, StoredTask>
): StoredTask[] {
	const now = Date.now();
	const seenIds = new Set<string>();
	const tasks: StoredTask[] = [];

	for (const columnId of COLUMN_IDS) {
		for (const [index, rawTask] of board[columnId].entries()) {
			const id = rawTask.id.trim();
			const title = rawTask.title.trim();
			if (!id) {
				throw new Error('Task id is required');
			}
			if (!title) {
				throw new Error('Task title cannot be empty');
			}
			if (seenIds.has(id)) {
				throw new Error(`Duplicate task id: ${id}`);
			}
			seenIds.add(id);

			const existing = existingTasksById.get(id);
			const notes = rawTask.notes?.trim() || undefined;
			const agentLogs = rawTask.agentLogs?.trim() || existing?.agentLogs || undefined;
			const threadId = rawTask.threadId || existing?.threadId || undefined;
			const agentStatus = rawTask.agentStatus || existing?.agentStatus || undefined;
			const agentSummary = rawTask.agentSummary?.trim() || existing?.agentSummary || undefined;
			const agentDraft = rawTask.agentDraft?.trim() || existing?.agentDraft || undefined;
			const agentDraftType = rawTask.agentDraftType || existing?.agentDraftType || undefined;
			const hasUnreadNotes = rawTask.hasUnreadNotes ?? existing?.hasUnreadNotes ?? undefined;
			const hasUnreadEmailSignal =
				rawTask.hasUnreadEmailSignal ?? existing?.hasUnreadEmailSignal ?? undefined;
			const emailSignalType = rawTask.emailSignalType || existing?.emailSignalType || undefined;
			const emailSignalSummary =
				rawTask.emailSignalSummary?.trim() || existing?.emailSignalSummary || undefined;
			const emailSignalNextAction =
				rawTask.emailSignalNextAction?.trim() || existing?.emailSignalNextAction || undefined;
			const emailSignalAt = rawTask.emailSignalAt ?? existing?.emailSignalAt ?? undefined;
			const emailSignalMessageId =
				rawTask.emailSignalMessageId?.trim() || existing?.emailSignalMessageId || undefined;
			const agentSpec = rawTask.agentSpec || existing?.agentSpec || undefined;
			// Job fields
			const companyName = rawTask.companyName?.trim() || existing?.companyName || undefined;
			const position = rawTask.position?.trim() || existing?.position || undefined;
			const jobUrl = rawTask.jobUrl?.trim() || existing?.jobUrl || undefined;
			const jobDescription =
				rawTask.jobDescription?.trim() || existing?.jobDescription || undefined;
			const skills = rawTask.skills?.trim() || existing?.skills || undefined;
			const country = rawTask.country?.trim() || existing?.country || undefined;
			const jobLevel = rawTask.jobLevel?.trim() || existing?.jobLevel || undefined;
			const jobType = rawTask.jobType?.trim() || existing?.jobType || undefined;
			const platform = rawTask.platform?.trim() || existing?.platform || undefined;
			const motivationLetter =
				rawTask.motivationLetter?.trim() || existing?.motivationLetter || undefined;
			const interviewDate = rawTask.interviewDate?.trim() || existing?.interviewDate || undefined;
			const interviewLink = rawTask.interviewLink?.trim() || existing?.interviewLink || undefined;
			const interviewEmail =
				rawTask.interviewEmail?.trim() || existing?.interviewEmail || undefined;
			const targetedAt = existing?.targetedAt ?? (columnId === 'targeted' ? now : undefined);
			const preparingAt = existing?.preparingAt ?? (columnId === 'preparing' ? now : undefined);
			const appliedAt = existing?.appliedAt ?? (columnId === 'applied' ? now : undefined);
			const interviewingAt =
				existing?.interviewingAt ?? (columnId === 'interviewing' ? now : undefined);
			const doneAt = existing?.doneAt ?? (columnId === 'done' ? now : undefined);
			tasks.push({
				id,
				title,
				...(notes ? { notes } : {}),
				...(agentLogs ? { agentLogs } : {}),
				...(threadId ? { threadId } : {}),
				...(agentStatus ? { agentStatus } : {}),
				...(agentSummary ? { agentSummary } : {}),
				...(agentDraft ? { agentDraft } : {}),
				...(agentDraftType ? { agentDraftType } : {}),
				...(hasUnreadNotes ? { hasUnreadNotes } : {}),
				...(hasUnreadEmailSignal ? { hasUnreadEmailSignal } : {}),
				...(emailSignalType ? { emailSignalType } : {}),
				...(emailSignalSummary ? { emailSignalSummary } : {}),
				...(emailSignalNextAction ? { emailSignalNextAction } : {}),
				...(emailSignalAt ? { emailSignalAt } : {}),
				...(emailSignalMessageId ? { emailSignalMessageId } : {}),
				...(agentSpec ? { agentSpec } : {}),
				...(companyName ? { companyName } : {}),
				...(position ? { position } : {}),
				...(jobUrl ? { jobUrl } : {}),
				...(jobDescription ? { jobDescription } : {}),
				...(skills ? { skills } : {}),
				...(country ? { country } : {}),
				...(jobLevel ? { jobLevel } : {}),
				...(jobType ? { jobType } : {}),
				...(platform ? { platform } : {}),
				...(motivationLetter ? { motivationLetter } : {}),
				...(interviewDate ? { interviewDate } : {}),
				...(interviewLink ? { interviewLink } : {}),
				...(interviewEmail ? { interviewEmail } : {}),
				...(targetedAt ? { targetedAt } : {}),
				...(preparingAt ? { preparingAt } : {}),
				...(appliedAt ? { appliedAt } : {}),
				...(interviewingAt ? { interviewingAt } : {}),
				...(doneAt ? { doneAt } : {}),
				columnId,
				order: index,
				createdAt: existing?.createdAt ?? now,
				updatedAt: now
			});
		}
	}

	return tasks;
}

export const getBoard = authedQuery({
	args: {},
	returns: boardValidator,
	handler: async (ctx) => {
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q) => q.eq('userId', ctx.user._id))
			.first();

		if (!board) {
			return emptyBoard();
		}

		return toBoard(board.tasks as StoredTask[]);
	}
});

export const saveBoard = authedMutation({
	args: {
		board: boardValidator
	},
	returns: boardValidator,
	handler: async (ctx, args) => {
		const parsedBoard = parseBoard(args.board as Record<string, BoardTask[]>);
		const existing = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q) => q.eq('userId', ctx.user._id))
			.first();

		const existingTasksById = new Map(
			(existing?.tasks as StoredTask[] | undefined)?.map((task) => [task.id, task]) ?? []
		);
		const sanitizedTasks = sanitizeAndFlattenBoard(parsedBoard, existingTasksById);
		const now = Date.now();

		for (const task of sanitizedTasks) {
			const oldTask = existingTasksById.get(task.id);

			if (task.columnId === 'done') {
				task.agentStatus = 'idle';
				continue;
			}

			if (oldTask?.agentStatus === 'working' && oldTask.columnId !== task.columnId) {
				task.agentStatus = 'error';
				task.agentSummary = `Nova stopped because this task was moved from "${oldTask.columnId}" to "${task.columnId}" while it was still processing. Review and retry if needed.`;
			}
		}

		if (existing) {
			await ctx.db.patch(existing._id, {
				tasks: sanitizedTasks,
				updatedAt: now
			});
		} else {
			await ctx.db.insert('todoBoards', {
				userId: ctx.user._id,
				tasks: sanitizedTasks,
				createdAt: now,
				updatedAt: now
			});
		}

		// Check if user has a ChatGPT connection — skip agent if not
		const hasOpenai = !!(await ctx.db
			.query('openaiConnections')
			.withIndex('by_user', (q) => q.eq('userId', ctx.user._id))
			.first());

		// Detect changes and trigger agent
		for (const task of sanitizedTasks) {
			if (!hasOpenai) continue; // No ChatGPT connection — skip agent triggers

			if (!existingTasksById.has(task.id)) {
				if (task.columnId === 'done') continue;
				// New task — create thread and trigger agent
				await ctx.scheduler.runAfter(0, internal.todo.messages.triggerAgentForNewTask, {
					userId: ctx.user._id,
					taskId: task.id,
					taskTitle: task.title,
					taskNotes: task.notes,
					taskColumn: task.columnId
				});
			} else {
				const oldTask = existingTasksById.get(task.id)!;

				const columnChanged = task.columnId !== oldTask.columnId;
				const notesChanged = (task.notes ?? '') !== (oldTask.notes ?? '');

				if (task.columnId === 'done') {
					task.agentStatus = 'idle';
					continue;
				}

				if (!oldTask.threadId) {
					// No thread yet — create one on any meaningful change
					if (columnChanged || notesChanged) {
						await ctx.scheduler.runAfter(0, internal.todo.messages.triggerAgentForNewTask, {
							userId: ctx.user._id,
							taskId: task.id,
							taskTitle: task.title,
							taskNotes: task.notes,
							taskColumn: task.columnId
						});
					}
				} else {
					// Has thread — notify agent of user-initiated changes
					const retryRequested = oldTask.agentStatus === 'error' && task.agentStatus !== 'error';

					if (retryRequested) {
						await ctx.scheduler.runAfter(0, internal.todo.messages.triggerAgentForTaskUpdate, {
							userId: ctx.user._id,
							threadId: oldTask.threadId,
							taskId: task.id,
							taskTitle: task.title,
							prompt: `User requested retry after a previous error. Resume work on this task.`
						});
					} else if (columnChanged) {
						const columnMovePrompt = (() => {
							const base = `User moved your task "${task.title}" from "${oldTask.columnId}" to "${task.columnId}".`;
							if (task.columnId === 'preparing') {
								return `${base} The user is now ready to prepare this application. Do the following:
1. First, check if there are existing notes from the Targeted stage — read them with readTaskNotes and use that context.
2. Use getUserProfile to read the user's resume.
3. Parse the full job description (use webSearch if a URL is available and jobDescription is empty).
4. Fill in ONLY MISSING fields using updateJobFields — do NOT overwrite any field that already has a value.
5. Generate a personalised motivation letter ONLY if the motivationLetter field is currently empty. If it already exists, do NOT regenerate it.
6. Save a summary to notes using updateMyNotes.`;
							} else if (task.columnId === 'targeted') {
								return `${base} You are back in ANALYSIS MODE. Review what you know about this job, update your consultation notes with any new observations, and fill any MISSING fields using updateJobFields. Do NOT move this task, do NOT generate a motivation letter.`;
							} else {
								return `${base} React accordingly and update your notes. Do NOT regenerate the motivation letter. Do NOT overwrite existing job fields.`;
							}
						})();
						await ctx.scheduler.runAfter(0, internal.todo.messages.triggerAgentForTaskUpdate, {
							userId: ctx.user._id,
							threadId: oldTask.threadId,
							taskId: task.id,
							taskTitle: task.title,
							prompt: columnMovePrompt
						});
					} else if (notesChanged) {
						await ctx.scheduler.runAfter(0, internal.todo.messages.triggerAgentForTaskUpdate, {
							userId: ctx.user._id,
							threadId: oldTask.threadId,
							taskId: task.id,
							taskTitle: task.title,
							prompt: `User updated notes on your task "${task.title}". New notes: ${task.notes ?? '(cleared)'}. Acknowledge and adjust your plan if needed.`
						});
					}
				}
			}
		}

		return toBoard(sanitizedTasks);
	}
});

export const updateTaskThreadId = authedMutation({
	args: {
		taskId: v.string(),
		threadId: v.string()
	},
	handler: async (ctx, args) => {
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q) => q.eq('userId', ctx.user._id))
			.first();

		if (!board) throw new Error('Board not found');

		const tasks = board.tasks as StoredTask[];
		const taskIndex = tasks.findIndex((t) => t.id === args.taskId);
		if (taskIndex === -1) throw new Error('Task not found');

		tasks[taskIndex] = { ...tasks[taskIndex], threadId: args.threadId };

		await ctx.db.patch(board._id, {
			tasks,
			updatedAt: Date.now()
		});
	}
});

// ── Internal mutations (called from agent actions) ──────────────────────────

/** Helper to find board + task by userId + taskId and patch a field */
async function patchTask(
	ctx: { db: any },
	args: { userId: string; taskId: string },
	patch: Partial<StoredTask>
) {
	const board = await ctx.db
		.query('todoBoards')
		.withIndex('by_user', (q: any) => q.eq('userId', args.userId))
		.first();
	if (!board) throw new Error('Board not found');

	const tasks = board.tasks as StoredTask[];
	const idx = tasks.findIndex((t) => t.id === args.taskId);
	if (idx === -1) throw new Error('Task not found');

	tasks[idx] = { ...tasks[idx], ...patch, updatedAt: Date.now() };
	await ctx.db.patch(board._id, { tasks, updatedAt: Date.now() });
}

export const updateTaskThreadIdInternal = internalMutation({
	args: { userId: v.string(), taskId: v.string(), threadId: v.string() },
	handler: async (ctx, args) => {
		await patchTask(ctx, args, { threadId: args.threadId });
	}
});

export const updateTaskAgentLogsInternal = internalMutation({
	args: { userId: v.string(), taskId: v.string(), agentLogs: v.string() },
	handler: async (ctx, args) => {
		await patchTask(ctx, args, { agentLogs: args.agentLogs });
	}
});

export const updateTaskNotesInternal = internalMutation({
	args: { userId: v.string(), taskId: v.string(), notes: v.string() },
	handler: async (ctx, args) => {
		await patchTask(ctx, args, { notes: args.notes, hasUnreadNotes: true });
	}
});

export const getTasksForEmailMatchingInternal = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q: any) => q.eq('userId', args.userId))
			.first();
		if (!board) return [] as StoredTask[];

		return (board.tasks as StoredTask[]).filter(
			(task) => task.columnId === 'applied' || task.columnId === 'interviewing'
		);
	}
});

export const updateTaskEmailSignalInternal = internalMutation({
	args: {
		userId: v.string(),
		taskId: v.string(),
		messageId: v.string(),
		emailSignalType: v.union(
			v.literal('interview'),
			v.literal('follow_up_interview'),
			v.literal('rejection'),
			v.literal('acceptance')
		),
		emailSignalSummary: v.string(),
		emailSignalNextAction: v.string(),
		emailSignalAt: v.number(),
		noteEntry: v.string(),
		interviewEmail: v.optional(v.string()),
		interviewDate: v.optional(v.string()),
		interviewLink: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q: any) => q.eq('userId', args.userId))
			.first();
		if (!board) throw new Error('Board not found');

		const currentTask = (board.tasks as StoredTask[]).find((t) => t.id === args.taskId);
		if (!currentTask) throw new Error('Task not found');
		if (currentTask.emailSignalMessageId === args.messageId && currentTask.hasUnreadEmailSignal) {
			return;
		}

		const existingNotes = currentTask.notes?.trim();
		const notes = [existingNotes, args.noteEntry].filter(Boolean).join('\n\n');

		await patchTask(ctx, args, {
			notes,
			hasUnreadNotes: true,
			hasUnreadEmailSignal: true,
			emailSignalType: args.emailSignalType,
			emailSignalSummary: args.emailSignalSummary,
			emailSignalNextAction: args.emailSignalNextAction,
			emailSignalAt: args.emailSignalAt,
			emailSignalMessageId: args.messageId,
			...(!currentTask.interviewEmail && args.interviewEmail
				? { interviewEmail: args.interviewEmail }
				: {}),
			...(!currentTask.interviewDate && args.interviewDate
				? { interviewDate: args.interviewDate }
				: {}),
			...(!currentTask.interviewLink && args.interviewLink
				? { interviewLink: args.interviewLink }
				: {})
		});
	}
});

export const acknowledgeTaskEmailSignal = authedMutation({
	args: {
		taskId: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q) => q.eq('userId', ctx.user._id))
			.first();
		if (!board) throw new Error('Board not found');

		const tasks = (board.tasks as StoredTask[]).map((task) => {
			if (task.id !== args.taskId) return task;

			const {
				hasUnreadEmailSignal: _hasUnreadEmailSignal,
				emailSignalType: _emailSignalType,
				emailSignalSummary: _emailSignalSummary,
				emailSignalNextAction: _emailSignalNextAction,
				emailSignalAt: _emailSignalAt,
				emailSignalMessageId: _emailSignalMessageId,
				...rest
			} = task;

			return {
				...rest,
				hasUnreadNotes: false,
				updatedAt: Date.now()
			};
		});

		await ctx.db.patch(board._id, {
			tasks,
			updatedAt: Date.now()
		});

		return null;
	}
});

export const updateTaskFieldsInternal = internalMutation({
	args: {
		userId: v.string(),
		taskId: v.string(),
		companyName: v.optional(v.string()),
		position: v.optional(v.string()),
		jobUrl: v.optional(v.string()),
		jobDescription: v.optional(v.string()),
		skills: v.optional(v.string()),
		country: v.optional(v.string()),
		platform: v.optional(v.string()),
		jobLevel: v.optional(v.string()),
		jobType: v.optional(v.string()),
		motivationLetter: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { userId, taskId, ...fields } = args;

		// Read current task to protect existing values
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q: any) => q.eq('userId', userId))
			.first();
		if (!board) throw new Error('Board not found');
		const currentTask = (board.tasks as StoredTask[]).find((t) => t.id === taskId);
		if (!currentTask) throw new Error('Task not found');

		const patch: Record<string, string> = {};
		for (const [k, val] of Object.entries(fields)) {
			if (val === undefined) continue;
			const key = k as keyof typeof currentTask;
			// Only set if current value is empty/undefined
			if (!currentTask[key]) {
				patch[k] = val;
			}
		}
		if (Object.keys(patch).length > 0) {
			await patchTask(ctx, { userId, taskId }, patch);
		}
	}
});

export const updateTaskSpecInternal = internalMutation({
	args: { userId: v.string(), taskId: v.string(), agentSpec: v.string() },
	handler: async (ctx, args) => {
		await patchTask(ctx, args, { agentSpec: args.agentSpec, hasUnreadNotes: true });
	}
});

export const moveTaskInternal = internalMutation({
	args: {
		userId: v.string(),
		taskId: v.string(),
		columnId: v.union(
			v.literal('targeted'),
			v.literal('preparing'),
			v.literal('applied'),
			v.literal('interviewing'),
			v.literal('done')
		)
	},
	handler: async (ctx, args) => {
		await patchTask(ctx, args, { columnId: args.columnId });
	}
});

export const addTaskInternal = internalMutation({
	args: {
		userId: v.string(),
		title: v.string(),
		notes: v.optional(v.string())
	},
	returns: v.string(),
	handler: async (ctx, args) => {
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q: any) => q.eq('userId', args.userId))
			.first();

		const taskId = crypto.randomUUID();
		const now = Date.now();
		const newTask: StoredTask = {
			id: taskId,
			title: args.title,
			...(args.notes ? { notes: args.notes } : {}),
			columnId: 'targeted',
			order: 0,
			createdAt: now,
			updatedAt: now
		};

		if (board) {
			const tasks = board.tasks as StoredTask[];
			const todoTasks = tasks.filter((t) => t.columnId === 'targeted');
			newTask.order = todoTasks.length > 0 ? Math.max(...todoTasks.map((t) => t.order)) + 1 : 0;
			await ctx.db.patch(board._id, {
				tasks: [...tasks, newTask],
				updatedAt: now
			});
		} else {
			await ctx.db.insert('todoBoards', {
				userId: args.userId,
				tasks: [newTask],
				createdAt: now,
				updatedAt: now
			});
		}

		return taskId;
	}
});

export const getBoardInternal = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q: any) => q.eq('userId', args.userId))
			.first();

		if (!board) return emptyBoard();
		return toBoard(board.tasks as StoredTask[]);
	}
});

export const getTaskIdByThreadId = internalQuery({
	args: { userId: v.string(), threadId: v.string() },
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args) => {
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q: any) => q.eq('userId', args.userId))
			.first();
		if (!board) return null;
		const task = (board.tasks as StoredTask[]).find((t) => t.threadId === args.threadId);
		return task?.id ?? null;
	}
});

export const getTaskThreadInfo = internalQuery({
	args: { userId: v.string(), taskId: v.string() },
	handler: async (ctx, args) => {
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q: any) => q.eq('userId', args.userId))
			.first();
		if (!board) return null;
		const task = (board.tasks as StoredTask[]).find((t) => t.id === args.taskId);
		if (!task) return null;
		return {
			threadId: task.threadId,
			title: task.title,
			notes: task.notes,
			columnId: task.columnId
		};
	}
});

export const getTaskAgentStatus = internalQuery({
	args: { userId: v.string(), taskId: v.string() },
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args) => {
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q: any) => q.eq('userId', args.userId))
			.first();
		if (!board) return null;
		const task = (board.tasks as StoredTask[]).find((t) => t.id === args.taskId);
		return task?.agentStatus ?? null;
	}
});

export const updateTaskAgentStatusInternal = internalMutation({
	args: {
		userId: v.string(),
		taskId: v.string(),
		agentStatus: v.union(
			v.literal('idle'),
			v.literal('working'),
			v.literal('done'),
			v.literal('awaiting_approval'),
			v.literal('error')
		),
		agentSummary: v.optional(v.string()),
		agentDraft: v.optional(v.string()),
		agentDraftType: v.optional(
			v.union(v.literal('message'), v.literal('email'), v.literal('research'))
		)
	},
	handler: async (ctx, args) => {
		const patch: Partial<StoredTask> = { agentStatus: args.agentStatus };
		if (args.agentStatus === 'working') patch.agentStartedAt = Date.now();
		if (args.agentSummary !== undefined) patch.agentSummary = args.agentSummary;
		if (args.agentDraft !== undefined) patch.agentDraft = args.agentDraft;
		if (args.agentDraftType !== undefined) patch.agentDraftType = args.agentDraftType;
		await patchTask(ctx, args, patch);
	}
});

// ── Column metadata queries/mutations ───────────────────────────────────────

export const getColumnMeta = authedQuery({
	args: {},
	handler: async (ctx) => {
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q) => q.eq('userId', ctx.user._id))
			.first();
		return board?.columns ?? undefined;
	}
});

export const updateColumn = authedMutation({
	args: {
		columnId: v.string(),
		name: v.optional(v.string()),
		instructions: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q) => q.eq('userId', ctx.user._id))
			.first();

		const now = Date.now();
		const columns: ColumnMeta[] = board?.columns ? [...board.columns] : [];
		const idx = columns.findIndex((c) => c.id === args.columnId);
		const entry: ColumnMeta = {
			id: args.columnId,
			...(args.name ? { name: args.name } : {}),
			...(args.instructions ? { instructions: args.instructions } : {})
		};

		if (idx !== -1) {
			columns[idx] = entry;
		} else {
			columns.push(entry);
		}

		if (board) {
			await ctx.db.patch(board._id, { columns, updatedAt: now });
		} else {
			await ctx.db.insert('todoBoards', {
				userId: ctx.user._id,
				tasks: [],
				columns,
				createdAt: now,
				updatedAt: now
			});
		}
	}
});

export const saveColumnOrder = authedMutation({
	args: {
		columnIds: v.array(v.string())
	},
	handler: async (ctx, args) => {
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q) => q.eq('userId', ctx.user._id))
			.first();

		const now = Date.now();
		const existingMap = new Map<string, ColumnMeta>();
		for (const col of board?.columns ?? []) {
			existingMap.set(col.id, col);
		}

		const columns: ColumnMeta[] = args.columnIds.map((id) => existingMap.get(id) ?? { id });

		if (board) {
			await ctx.db.patch(board._id, { columns, updatedAt: now });
		} else {
			await ctx.db.insert('todoBoards', {
				userId: ctx.user._id,
				tasks: [],
				columns,
				createdAt: now,
				updatedAt: now
			});
		}
	}
});

// ── External integration ────────────────────────────────────────────────────

/** Add a job card from an external app (job-analytics-frontend) with full job fields */
export const addJobFromExternalInternal = internalMutation({
	args: {
		userId: v.string(),
		title: v.string(),
		companyName: v.optional(v.string()),
		position: v.optional(v.string()),
		jobUrl: v.optional(v.string()),
		jobDescription: v.optional(v.string()),
		skills: v.optional(v.string()),
		country: v.optional(v.string()),
		jobLevel: v.optional(v.string()),
		jobType: v.optional(v.string()),
		platform: v.optional(v.string())
	},
	returns: v.string(),
	handler: async (ctx, args) => {
		const { userId, title, ...jobFields } = args;
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q: any) => q.eq('userId', userId))
			.first();

		const taskId = crypto.randomUUID();
		const now = Date.now();

		// Build task with only defined fields
		const newTask: StoredTask = {
			id: taskId,
			title,
			columnId: 'targeted',
			order: 0,
			createdAt: now,
			updatedAt: now,
			targetedAt: now,
			...(jobFields.companyName ? { companyName: jobFields.companyName } : {}),
			...(jobFields.position ? { position: jobFields.position } : {}),
			...(jobFields.jobUrl ? { jobUrl: jobFields.jobUrl } : {}),
			...(jobFields.jobDescription ? { jobDescription: jobFields.jobDescription } : {}),
			...(jobFields.skills ? { skills: jobFields.skills } : {}),
			...(jobFields.country ? { country: jobFields.country } : {}),
			...(jobFields.jobLevel ? { jobLevel: jobFields.jobLevel } : {}),
			...(jobFields.jobType ? { jobType: jobFields.jobType } : {}),
			...(jobFields.platform ? { platform: jobFields.platform } : {})
		};

		if (board) {
			const tasks = board.tasks as StoredTask[];
			const targetedTasks = tasks.filter((t) => t.columnId === 'targeted');
			newTask.order =
				targetedTasks.length > 0 ? Math.max(...targetedTasks.map((t) => t.order)) + 1 : 0;
			await ctx.db.patch(board._id, {
				tasks: [...tasks, newTask],
				updatedAt: now
			});
		} else {
			await ctx.db.insert('todoBoards', {
				userId,
				tasks: [newTask],
				createdAt: now,
				updatedAt: now
			});
		}

		return taskId;
	}
});

/** Look up the first user that has a board (for single-user integration) */
export const getFirstBoardUserId = internalQuery({
	args: {},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx) => {
		const board = await ctx.db.query('todoBoards').first();
		return board?.userId ?? null;
	}
});

/** Check if a job with the given URL already exists on the user's board */
export const checkJobUrlExistsInternal = internalQuery({
	args: { userId: v.string(), jobUrl: v.string() },
	returns: v.object({
		exists: v.boolean(),
		existingTask: v.optional(
			v.object({
				id: v.string(),
				title: v.string(),
				columnId: v.string(),
				companyName: v.optional(v.string())
			})
		)
	}),
	handler: async (ctx, args) => {
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q: any) => q.eq('userId', args.userId))
			.first();
		if (!board) return { exists: false };

		const tasks = board.tasks as StoredTask[];
		const match = tasks.find(
			(t) => t.jobUrl && t.jobUrl.toLowerCase() === args.jobUrl.toLowerCase()
		);
		if (!match) return { exists: false };

		return {
			exists: true,
			existingTask: {
				id: match.id,
				title: match.title,
				columnId: match.columnId,
				companyName: match.companyName
			}
		};
	}
});

export const getColumnMetaInternal = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q: any) => q.eq('userId', args.userId))
			.first();
		return board?.columns ?? [];
	}
});

export const getTasksForCascade = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		const board = await ctx.db
			.query('todoBoards')
			.withIndex('by_user', (q: any) => q.eq('userId', args.userId))
			.first();
		if (!board) return [];
		return (board.tasks as StoredTask[]).map((t) => ({
			id: t.id,
			title: t.title,
			notes: t.notes,
			columnId: t.columnId,
			agentStatus: t.agentStatus,
			threadId: t.threadId
		}));
	}
});

// ── One-time migration: strip legacy fields from existing tasks ─────────────

const LEGACY_TASK_FIELDS = [
	'searchTerm',
	'postedDate',
	'jobFunction',
	'companyIndustry',
	'companyUrl'
] as const;

export const stripLegacyTaskFields = internalMutation({
	args: {},
	handler: async (ctx) => {
		const boards = await ctx.db.query('todoBoards').collect();
		let patched = 0;
		for (const board of boards) {
			const tasks = board.tasks as Record<string, unknown>[];
			let changed = false;
			for (const task of tasks) {
				for (const field of LEGACY_TASK_FIELDS) {
					if (field in task) {
						delete task[field];
						changed = true;
					}
				}
			}
			if (changed) {
				await ctx.db.patch(board._id, { tasks: tasks as any, updatedAt: Date.now() });
				patched++;
			}
		}
		return { patched, total: boards.length };
	}
});
