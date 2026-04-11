<script lang="ts">
	import { T } from '@tolgee/svelte';
	import {
		DragDropProvider,
		DragOverlay,
		KeyboardSensor,
		PointerSensor
	} from '@dnd-kit-svelte/svelte';
	import { RestrictToWindowEdges } from '@dnd-kit-svelte/svelte/modifiers';
	import { move } from '@dnd-kit/helpers';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/convex/_generated/api';
	import type {
		KanbanData,
		ColumnId,
		TodoItem,
		AgentStatus,
		ColumnMeta,
		EmailSignalType
	} from './types.js';
	import KanbanColumn from './kanban-column.svelte';
	import KanbanItem from './kanban-item.svelte';
	import TodoDetailDialog from './todo-detail-dialog.svelte';
	import ColumnEditDialog from './column-edit-dialog.svelte';
	import ChatgptConnectDialog from './chatgpt-connect-dialog.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CrosshairIcon from '@lucide/svelte/icons/crosshair';
	import WrenchIcon from '@lucide/svelte/icons/wrench';
	import SendIcon from '@lucide/svelte/icons/send';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import type { Component } from 'svelte';
	import { dev } from '$app/environment';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { haptic } from '$lib/hooks/use-haptic.svelte';

	const DEFAULT_COLUMN_IDS: ColumnId[] = [
		'targeted',
		'preparing',
		'applied',
		'interviewing',
		'done'
	];

	const convexClient = useConvexClient();

	const sensors = [PointerSensor, KeyboardSensor];
	const boardQuery = useQuery(api.todos.getBoard, {});
	const columnMetaQuery = useQuery(api.todos.getColumnMeta, {});

	let items: KanbanData = $state({
		targeted: [],
		preparing: [],
		applied: [],
		interviewing: [],
		done: []
	});
	let columnIds: ColumnId[] = $state([...DEFAULT_COLUMN_IDS]);
	let overlayTilted = $state(false);
	let isDragging = $state(false);
	let pendingSaveCount = $state(0);
	let pendingColumnSave = $state(false);
	let dragStartSnapshot = $state<KanbanData | null>(null);
	let dragStartColumnIds = $state<ColumnId[] | null>(null);
	let selectedTaskId = $state<string | null>(null);
	let dialogOpen = $state(false);
	let editingColumnId = $state<string | null>(null);
	let columnEditOpen = $state(false);
	let connectDialogOpen = $state(false);

	// ChatGPT connection check
	const openaiConnection = useQuery(api.openai.getConnection, {});
	const CONNECT_DISMISSED_KEY = 'JobPilot:chatgpt-connect-dismissed';
	let connectPopupDismissed = $state(
		browser ? localStorage.getItem(CONNECT_DISMISSED_KEY) === '1' : false
	);

	let connectDialogWasOpen = $state(false);
	$effect(() => {
		if (connectDialogWasOpen && !connectDialogOpen && openaiConnection.data === null) {
			// Dismissed without connecting — don't show again
			connectPopupDismissed = true;
			if (browser) localStorage.setItem(CONNECT_DISMISSED_KEY, '1');
		}
		connectDialogWasOpen = connectDialogOpen;
	});

	let hasResolvedOpenaiConnection = $derived(openaiConnection.data !== undefined);
	let needsOpenaiConnection = $derived(openaiConnection.data === null);

	let isLoading = $derived(columnMetaQuery.data === undefined);

	let columnMetaMap: Record<string, ColumnMeta> = $derived.by(() => {
		const map: Record<string, ColumnMeta> = {};
		if (columnMetaQuery.data) {
			for (const col of columnMetaQuery.data) {
				map[col.id] = col;
			}
		}
		return map;
	});

	const COLUMN_LABELS: Record<string, string> = {
		targeted: 'Targeted',
		preparing: 'Preparing',
		applied: 'Applied',
		interviewing: 'Interviewing',
		done: 'Done'
	};

	const COLUMN_ICONS: Record<string, Component<any>> = {
		targeted: CrosshairIcon,
		preparing: WrenchIcon,
		applied: SendIcon,
		interviewing: MessageSquareIcon,
		done: CircleCheckIcon
	};

	type EmailSignalBanner = {
		taskId: string;
		taskTitle: string;
		summary: string;
		nextAction: string;
		type: EmailSignalType;
	};

	function getColumnTitle(colId: string): string {
		return columnMetaMap[colId]?.name || COLUMN_LABELS[colId] || colId;
	}

	function getEmailSignalBannerClass(type: EmailSignalType): string {
		switch (type) {
			case 'rejection':
				return 'rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-red-950 dark:text-red-100';
			case 'acceptance':
				return 'rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-emerald-950 dark:text-emerald-100';
			case 'interview':
			case 'follow_up_interview':
				return 'rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-sky-950 dark:text-sky-100';
		}
	}

	let columnEmailSignalBanners = $derived.by(() => {
		const banners: Record<'applied' | 'interviewing', EmailSignalBanner[]> = {
			applied: [],
			interviewing: []
		};

		for (const columnId of ['applied', 'interviewing'] as const) {
			for (const task of items[columnId]) {
				if (
					task.hasUnreadEmailSignal &&
					task.emailSignalType &&
					task.emailSignalSummary &&
					task.emailSignalNextAction
				) {
					banners[columnId].push({
						taskId: task.id,
						taskTitle: task.companyName || task.title,
						summary: task.emailSignalSummary,
						nextAction: task.emailSignalNextAction,
						type: task.emailSignalType
					});
				}
			}
		}

		return banners;
	});

	let selectedTask: TodoItem | undefined = $derived.by(() => {
		if (!selectedTaskId) return undefined;
		for (const colId of columnIds) {
			const found = items[colId].find((t) => t.id === selectedTaskId);
			if (found) return found;
		}
		return undefined;
	});

	let selectedTaskColumnId: ColumnId | null = $derived.by(() => {
		if (!selectedTaskId) return null;
		for (const colId of columnIds) {
			if (items[colId].some((t) => t.id === selectedTaskId)) {
				return colId;
			}
		}
		return null;
	});

	const selectedTaskFromUrl = $derived(page.url.searchParams.get('task'));

	$effect(() => {
		if (!selectedTaskFromUrl) return;
		selectedTaskId = selectedTaskFromUrl;
		dialogOpen = true;
	});

	type SyncEvent = {
		operation: {
			source?: { id?: unknown; type?: unknown } | null;
			target?: { id?: unknown } | null;
		};
	};

	type EndEvent = SyncEvent & {
		suspend: () => { resume: () => void };
	};

	function cloneBoard(board: KanbanData): KanbanData {
		return {
			targeted: board.targeted.map((t) => ({ ...t })),
			preparing: board.preparing.map((t) => ({ ...t })),
			applied: board.applied.map((t) => ({ ...t })),
			interviewing: board.interviewing.map((t) => ({ ...t })),
			done: board.done.map((t) => ({ ...t }))
		};
	}

	function isSameBoard(a: KanbanData, b: KanbanData): boolean {
		for (const columnId of columnIds) {
			if (a[columnId].length !== b[columnId].length) {
				return false;
			}
			for (const [index, task] of a[columnId].entries()) {
				const other = b[columnId][index];
				if (!other || other.id !== task.id || other.title !== task.title) {
					return false;
				}
			}
		}
		return true;
	}

	function createTaskId(): string {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}

	function clearEmailSignal(task: TodoItem): TodoItem {
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
			hasUnreadNotes: false
		};
	}

	$effect(() => {
		if (!boardQuery.data || isDragging || pendingSaveCount > 0) return;
		items = cloneBoard(boardQuery.data);
	});

	// Sync column order from metadata query
	$effect(() => {
		if (!columnMetaQuery.data || isDragging || pendingColumnSave) return;
		const metaIds = columnMetaQuery.data
			.map((c: { id: string }) => c.id)
			.filter((id: string): id is ColumnId => DEFAULT_COLUMN_IDS.includes(id as ColumnId));
		if (metaIds.length > 0) {
			// Add any default columns not in metadata at the end
			const remaining = DEFAULT_COLUMN_IDS.filter((id) => !metaIds.includes(id));
			columnIds = [...metaIds, ...remaining] as ColumnId[];
		} else {
			columnIds = [...DEFAULT_COLUMN_IDS];
		}
	});

	function syncItemOrder(event: SyncEvent) {
		const { source, target } = event.operation;
		if (!source || !target) return;

		if (source.type === 'column') {
			// Column reorder
			const sourceId = String(source.id);
			const targetId = String(target.id);
			const fromIdx = columnIds.indexOf(sourceId as ColumnId);
			const toIdx = columnIds.indexOf(targetId as ColumnId);
			if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
			const next = [...columnIds];
			const [removed] = next.splice(fromIdx, 1);
			next.splice(toIdx, 0, removed);
			columnIds = next;
			return;
		}

		items = move(items, event as any) as KanbanData;
	}

	async function persistBoard(nextBoard: KanbanData, rollbackBoard: KanbanData): Promise<void> {
		const nextSnapshot = cloneBoard(nextBoard);
		const rollbackSnapshot = cloneBoard(rollbackBoard);
		pendingSaveCount += 1;

		try {
			await convexClient.mutation(
				api.todos.saveBoard,
				{ board: nextSnapshot },
				{
					optimisticUpdate: (store) => {
						store.setQuery(api.todos.getBoard, {}, nextSnapshot);
					}
				}
			);
		} catch (error) {
			console.error('[kanban] Failed to save board:', error);
			items = rollbackSnapshot;
			haptic.trigger('error');
			toast.error(error instanceof Error ? error.message : 'Failed to save changes');
		} finally {
			pendingSaveCount = Math.max(0, pendingSaveCount - 1);
		}
	}

	async function addTodo(columnId: ColumnId, title: string): Promise<void> {
		const trimmed = title.trim();
		if (!trimmed) return;
		haptic.trigger('success');

		const rollbackBoard = cloneBoard(items);
		const nextBoard = cloneBoard(items);
		nextBoard[columnId] = [
			...nextBoard[columnId],
			{
				id: createTaskId(),
				title: trimmed
			}
		];
		items = nextBoard;
		await persistBoard(nextBoard, rollbackBoard);

		// Prompt to connect ChatGPT if not connected and not already dismissed
		if (openaiConnection.data === null && !connectPopupDismissed) {
			connectDialogOpen = true;
		}
	}

	function handleTaskClick(task: TodoItem) {
		selectedTaskId = task.id;
		dialogOpen = true;

		if (task.hasUnreadNotes || task.hasUnreadEmailSignal) {
			const rollbackBoard = cloneBoard(items);
			const nextBoard = cloneBoard(items);
			for (const colId of columnIds) {
				const idx = nextBoard[colId].findIndex((t) => t.id === task.id);
				if (idx !== -1) {
					nextBoard[colId][idx] = {
						...nextBoard[colId][idx],
						hasUnreadNotes: false,
						hasUnreadEmailSignal: false
					};
					break;
				}
			}
			items = nextBoard;
			void persistBoard(nextBoard, rollbackBoard);
		}
	}

	async function acknowledgeEmailSignal(taskId: string) {
		const rollbackBoard = cloneBoard(items);
		const nextBoard = cloneBoard(items);

		for (const colId of columnIds) {
			const idx = nextBoard[colId].findIndex((t) => t.id === taskId);
			if (idx !== -1) {
				const {
					hasUnreadEmailSignal: _hasUnreadEmailSignal,
					emailSignalType: _emailSignalType,
					emailSignalSummary: _emailSignalSummary,
					emailSignalNextAction: _emailSignalNextAction,
					emailSignalAt: _emailSignalAt,
					emailSignalMessageId: _emailSignalMessageId,
					...rest
				} = nextBoard[colId][idx];
				nextBoard[colId][idx] = {
					...rest,
					hasUnreadNotes: false
				};
				break;
			}
		}

		items = nextBoard;

		try {
			await convexClient.mutation(api.todos.acknowledgeTaskEmailSignal, {
				taskId
			});
		} catch (error) {
			console.error('[kanban] Failed to acknowledge email signal:', error);
			items = rollbackBoard;
			haptic.trigger('error');
			toast.error('Failed to dismiss email warning');
		}
	}

	function getTaskDateForColumn(task: TodoItem, columnId: ColumnId): number {
		switch (columnId) {
			case 'targeted':
				return task.targetedAt ?? task.createdAt ?? 0;
			case 'preparing':
				return task.preparingAt ?? task.targetedAt ?? task.createdAt ?? 0;
			case 'applied':
				return task.appliedAt ?? task.preparingAt ?? task.targetedAt ?? task.createdAt ?? 0;
			case 'interviewing':
				return (
					task.interviewingAt ??
					task.appliedAt ??
					task.preparingAt ??
					task.targetedAt ??
					task.createdAt ??
					0
				);
			case 'done':
				return (
					task.doneAt ??
					task.interviewingAt ??
					task.appliedAt ??
					task.preparingAt ??
					task.targetedAt ??
					task.createdAt ??
					0
				);
		}
	}

	async function sortColumnByDate(columnId: ColumnId): Promise<void> {
		if (items[columnId].length < 2) return;

		const rollbackBoard = cloneBoard(items);
		const nextBoard = cloneBoard(items);
		const sortedTasks = [...nextBoard[columnId]].sort((a, b) => {
			const dateDiff = getTaskDateForColumn(b, columnId) - getTaskDateForColumn(a, columnId);
			if (dateDiff !== 0) return dateDiff;
			const createdDiff = (b.createdAt ?? 0) - (a.createdAt ?? 0);
			if (createdDiff !== 0) return createdDiff;
			return a.title.localeCompare(b.title);
		});

		const hasChanged = sortedTasks.some(
			(task, index) => task.id !== nextBoard[columnId][index]?.id
		);
		if (!hasChanged) return;

		nextBoard[columnId] = sortedTasks;
		items = nextBoard;
		haptic.trigger('success');
		await persistBoard(nextBoard, rollbackBoard);
	}

	async function handleTaskSave(id: string, updates: Partial<TodoItem>) {
		const rollbackBoard = cloneBoard(items);
		const nextBoard = cloneBoard(items);
		for (const colId of columnIds) {
			const idx = nextBoard[colId].findIndex((t) => t.id === id);
			if (idx !== -1) {
				const currentTask = nextBoard[colId][idx];
				nextBoard[colId][idx] = currentTask.hasUnreadEmailSignal
					? { ...clearEmailSignal(currentTask), ...updates }
					: { ...currentTask, ...updates };
				break;
			}
		}
		items = nextBoard;
		await persistBoard(nextBoard, rollbackBoard);
	}

	async function handleTaskDelete(id: string) {
		haptic.trigger('warning');
		const rollbackBoard = cloneBoard(items);
		const nextBoard = cloneBoard(items);
		for (const colId of columnIds) {
			nextBoard[colId] = nextBoard[colId].filter((t) => t.id !== id);
		}
		items = nextBoard;
		await persistBoard(nextBoard, rollbackBoard);
	}

	async function handleMoveTaskToDone(id: string) {
		const sourceColumnId = columnIds.find((colId) => items[colId].some((t) => t.id === id));
		if (!sourceColumnId || sourceColumnId === 'done') return;

		const taskToMove = items[sourceColumnId].find((t) => t.id === id);
		if (!taskToMove) return;

		const rollbackBoard = cloneBoard(items);
		const nextBoard = cloneBoard(items);
		nextBoard[sourceColumnId] = nextBoard[sourceColumnId].filter((t) => t.id !== id);
		nextBoard.done = [
			{ ...clearEmailSignal(taskToMove), doneAt: Date.now() },
			...nextBoard.done.filter((t) => t.id !== id)
		];
		items = nextBoard;
		dialogOpen = false;
		haptic.trigger('success');
		await persistBoard(nextBoard, rollbackBoard);
	}

	async function handleAgentApprove(id: string) {
		haptic.trigger('success');
		const rollbackBoard = cloneBoard(items);
		const nextBoard = cloneBoard(items);
		for (const colId of columnIds) {
			const idx = nextBoard[colId].findIndex((t) => t.id === id);
			if (idx !== -1) {
				nextBoard[colId][idx] = {
					...nextBoard[colId][idx],
					agentStatus: 'done' as AgentStatus,
					agentDraft: undefined,
					agentDraftType: undefined
				};
				break;
			}
		}
		items = nextBoard;
		dialogOpen = false;
		await persistBoard(nextBoard, rollbackBoard);
	}

	async function handleAgentReject(id: string, feedback: string) {
		haptic.trigger('medium');
		const rollbackBoard = cloneBoard(items);
		const nextBoard = cloneBoard(items);
		for (const colId of columnIds) {
			const idx = nextBoard[colId].findIndex((t) => t.id === id);
			if (idx !== -1) {
				nextBoard[colId][idx] = {
					...nextBoard[colId][idx],
					agentStatus: 'working' as AgentStatus,
					agentDraft: undefined,
					agentDraftType: undefined,
					notes: feedback
				};
				break;
			}
		}
		items = nextBoard;
		dialogOpen = false;
		await persistBoard(nextBoard, rollbackBoard);
	}

	async function handleAgentRetry(id: string) {
		haptic.trigger('medium');
		const rollbackBoard = cloneBoard(items);
		const nextBoard = cloneBoard(items);
		for (const colId of columnIds) {
			const idx = nextBoard[colId].findIndex((t) => t.id === id);
			if (idx !== -1) {
				nextBoard[colId][idx] = {
					...nextBoard[colId][idx],
					agentStatus: 'idle' as AgentStatus,
					agentSummary: undefined
				};
				break;
			}
		}
		items = nextBoard;
		dialogOpen = false;
		await persistBoard(nextBoard, rollbackBoard);
	}

	async function handleBlockAction(taskId: string, threadId: string, action: string) {
		dialogOpen = false;
		try {
			await convexClient.mutation(api.todo.messages.sendMessage, {
				threadId,
				prompt: `User action from UI: ${action}`
			});
		} catch (error) {
			console.error('[kanban] Failed to send block action:', error);
			haptic.trigger('error');
			toast.error('Failed to save');
		}
	}

	function mockAgentStatus(status: AgentStatus) {
		if (!items.targeted.length) return;
		const rollbackBoard = cloneBoard(items);
		const nextBoard = cloneBoard(items);
		nextBoard.targeted[0] = {
			...nextBoard.targeted[0],
			agentStatus: status,
			agentSummary:
				status === 'done' ? 'Analysis complete. Found 3 potential contacts.' : undefined,
			agentDraft:
				status === 'awaiting_approval'
					? 'Hi! I noticed we both attended the hackathon. Would love to connect!'
					: undefined,
			agentDraftType: status === 'awaiting_approval' ? 'message' : undefined
		};
		items = nextBoard;
		void persistBoard(nextBoard, rollbackBoard);
	}

	function mockAgentSpec() {
		if (!items.targeted.length) return;
		const spec = JSON.stringify({
			root: 'container',
			elements: {
				container: {
					type: 'Stack',
					props: { direction: 'vertical', gap: 'md' },
					children: ['heading', 'grid', 'summary']
				},
				heading: {
					type: 'Heading',
					props: { text: 'Top Picks', level: 'h3' },
					children: []
				},
				grid: {
					type: 'Grid',
					props: { columns: '2', gap: 'md' },
					children: ['card1', 'card2']
				},
				card1: {
					type: 'Card',
					props: { title: 'Roborock S8 Pro Ultra', description: '$1,399' },
					children: ['desc1', 'link1']
				},
				desc1: {
					type: 'Text',
					props: {
						content: 'Self-emptying, self-washing dock. Best overall for large homes with pets.'
					},
					children: []
				},
				link1: {
					type: 'Link',
					props: { text: 'View on Amazon', href: 'https://amazon.com' },
					children: []
				},
				card2: {
					type: 'Card',
					props: { title: 'iRobot Roomba j7+', description: '$599' },
					children: ['desc2', 'link2']
				},
				desc2: {
					type: 'Text',
					props: { content: 'Smart obstacle avoidance. Great value pick for apartments.' },
					children: []
				},
				link2: {
					type: 'Link',
					props: { text: 'View on Amazon', href: 'https://amazon.com' },
					children: []
				},
				summary: {
					type: 'Text',
					props: {
						content: 'Pick the one you prefer and Nova will handle the order.',
						muted: true
					},
					children: []
				}
			},
			state: {}
		});
		const rollbackBoard = cloneBoard(items);
		const nextBoard = cloneBoard(items);
		nextBoard.targeted[0] = {
			...nextBoard.targeted[0],
			agentSpec: spec,
			agentStatus: 'done' as AgentStatus,
			agentSummary: 'Nova found 2 top robot vacuums. Pick your favorite.',
			notes:
				'- Nova researched robot vacuums in your budget\n- Found 2 strong options\n- Pick your preferred model below'
		};
		items = nextBoard;
		void persistBoard(nextBoard, rollbackBoard);
	}

	function findTaskPosition(taskId: string): { colIdx: number; taskIdx: number } | null {
		for (let c = 0; c < columnIds.length; c++) {
			const col = items[columnIds[c]];
			for (let t = 0; t < col.length; t++) {
				if (col[t].id === taskId) return { colIdx: c, taskIdx: t };
			}
		}
		return null;
	}

	function focusTask(colIdx: number, taskIdx: number) {
		const col = items[columnIds[colIdx]];
		if (!col?.length) return;
		const clampedIdx = Math.min(taskIdx, col.length - 1);
		const task = col[clampedIdx];
		const el = document.querySelector<HTMLElement>(`[data-task-id="${task.id}"]`);
		el?.focus();
	}

	function handleBoardKeydown(e: KeyboardEvent) {
		if (dialogOpen || isDragging) return;

		const active = document.activeElement;
		const taskId = active?.getAttribute('data-task-id');
		if (!taskId) return;

		const pos = findTaskPosition(taskId);
		if (!pos) return;

		switch (e.key) {
			case 'ArrowDown': {
				e.preventDefault();
				const col = items[columnIds[pos.colIdx]];
				if (pos.taskIdx < col.length - 1) {
					focusTask(pos.colIdx, pos.taskIdx + 1);
				}
				break;
			}
			case 'ArrowUp': {
				e.preventDefault();
				if (pos.taskIdx > 0) {
					focusTask(pos.colIdx, pos.taskIdx - 1);
				}
				break;
			}
			case 'ArrowRight': {
				e.preventDefault();
				for (let c = pos.colIdx + 1; c < columnIds.length; c++) {
					if (items[columnIds[c]].length > 0) {
						focusTask(c, pos.taskIdx);
						break;
					}
				}
				break;
			}
			case 'ArrowLeft': {
				e.preventDefault();
				for (let c = pos.colIdx - 1; c >= 0; c--) {
					if (items[columnIds[c]].length > 0) {
						focusTask(c, pos.taskIdx);
						break;
					}
				}
				break;
			}
		}
	}

	async function handleDragEnd(event: EndEvent): Promise<void> {
		syncItemOrder(event);
		overlayTilted = false;
		isDragging = false;

		// Let overlay re-render without tilt before drop animation snapshot is taken.
		const suspended = event.suspend();
		requestAnimationFrame(() => suspended.resume());

		// Check for column order change
		const startCols = dragStartColumnIds;
		dragStartColumnIds = null;
		if (startCols && startCols.join(',') !== columnIds.join(',')) {
			pendingColumnSave = true;
			try {
				await convexClient.mutation(api.todos.saveColumnOrder, {
					columnIds: [...columnIds]
				});
			} catch (error) {
				console.error('[kanban] Failed to save column order:', error);
				columnIds = startCols;
				haptic.trigger('error');
				toast.error('Failed to save column order');
			}
		}

		const startBoard = dragStartSnapshot;
		dragStartSnapshot = null;
		if (!startBoard) return;

		const nextBoard = cloneBoard(items);
		if (isSameBoard(startBoard, nextBoard)) return;

		await persistBoard(nextBoard, startBoard);
	}
</script>

<svelte:window onkeydown={handleBoardKeydown} />

<div>
	{#if hasResolvedOpenaiConnection && needsOpenaiConnection}
		<div
			class="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100"
		>
			<p class="font-medium">
				<T keyName="todo_demo.chatgpt_warning_title" />
			</p>
			<p class="mt-1 text-amber-900/90 dark:text-amber-100/90">
				<T keyName="todo_demo.chatgpt_warning_body" />
			</p>
			<div class="mt-3">
				<Button size="sm" onclick={() => (connectDialogOpen = true)}>
					<T keyName="todo_demo.chatgpt_warning_cta" />
				</Button>
			</div>
		</div>
	{/if}

	<DragDropProvider
		{sensors}
		modifiers={[RestrictToWindowEdges]}
		onDragStart={() => {
			haptic.trigger('medium');
			dragStartSnapshot = cloneBoard(items);
			dragStartColumnIds = [...columnIds];
			overlayTilted = true;
			isDragging = true;
		}}
		onDragEnd={(event) => {
			void handleDragEnd(event as EndEvent);
		}}
		onDragOver={syncItemOrder}
	>
		{#if isLoading}
			<div class="grid items-start gap-3 md:grid-cols-5">
				{#each { length: 5 } as _, i (i)}
					<div
						class="rounded-xl border border-border/80 bg-muted/45 p-3 dark:border-border/60 dark:bg-card/95"
					>
						<div class="flex items-center justify-between px-1 pb-3">
							<Skeleton class="h-4 w-24" />
							<div class="flex items-center gap-0.5">
								<div class="rounded p-1 text-foreground/70">
									<PencilIcon class="size-3.5" />
								</div>
								<div class="rounded p-1 text-foreground/70">
									<GripVerticalIcon class="size-4" />
								</div>
							</div>
						</div>
						<div class="grid min-h-0 gap-2">
							<Skeleton class="h-11 w-full rounded-lg" />
							<Skeleton class="h-11 w-full rounded-lg" />
						</div>
						<button
							class="mt-2 flex w-full items-center rounded-lg px-2 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-muted/70 hover:text-foreground dark:text-foreground/75 dark:hover:bg-background"
							disabled
						>
							<span class="flex items-center gap-1">
								<PlusIcon class="size-4" />
								Add Card
							</span>
						</button>
					</div>
				{/each}
			</div>
		{:else}
			{@const leftCols = ['targeted', 'preparing', 'applied'] as ColumnId[]}
			{@const rightCols = ['interviewing', 'done'] as ColumnId[]}
			<div class="grid items-start gap-3 md:grid-cols-4">
				{#each leftCols as columnId, colIdx (columnId)}
					<KanbanColumn
						id={columnId}
						title={getColumnTitle(columnId)}
						icon={COLUMN_ICONS[columnId]}
						index={colIdx}
						onAdd={(title) => addTodo(columnId, title)}
						onSortByDate={() => sortColumnByDate(columnId)}
						sortAriaLabel="Sort tasks by newest date"
						onEdit={() => {
							editingColumnId = columnId;
							columnEditOpen = true;
						}}
						editAriaLabel="Edit column"
					>
						{#if columnId === 'applied' && columnEmailSignalBanners.applied.length > 0}
							<div class="grid gap-2">
								{#each columnEmailSignalBanners.applied as banner (banner.taskId)}
									<div class={getEmailSignalBannerClass(banner.type)}>
										<div class="flex items-start justify-between gap-3">
											<div class="min-w-0 flex-1">
												<p class="text-[11px] font-semibold uppercase tracking-wide">
													{banner.taskTitle}
												</p>
												<p class="mt-1 text-xs">{banner.summary}</p>
												<p class="mt-1 text-[11px] font-medium">Next action: {banner.nextAction}</p>
											</div>
											<Button
												variant="outline"
												size="sm"
												class="h-7 shrink-0 border-current/25 bg-white/60 px-2 text-[11px] dark:bg-black/10"
												onclick={() => acknowledgeEmailSignal(banner.taskId)}
											>
												OK
											</Button>
										</div>
									</div>
								{/each}
							</div>
						{/if}
						{#each items[columnId] as task, taskIdx (task.id)}
							<KanbanItem
								{task}
								index={taskIdx}
								group={columnId}
								data={{ group: columnId }}
								canQuickDelete={columnId === 'done'}
								onQuickDelete={handleTaskDelete}
								onclick={handleTaskClick}
							/>
						{/each}
					</KanbanColumn>
				{/each}
				<!-- Interviewing (top) + Done (bottom) share the 4th column -->
				<div class="flex flex-col gap-3">
					{#each rightCols as columnId, colIdx (columnId)}
						<KanbanColumn
							id={columnId}
							title={getColumnTitle(columnId)}
							icon={COLUMN_ICONS[columnId]}
							index={colIdx + 3}
							onAdd={(title) => addTodo(columnId, title)}
							onSortByDate={() => sortColumnByDate(columnId)}
							sortAriaLabel="Sort tasks by newest date"
							onEdit={() => {
								editingColumnId = columnId;
								columnEditOpen = true;
							}}
							editAriaLabel="Edit column"
						>
							{#if columnId === 'interviewing' && columnEmailSignalBanners.interviewing.length > 0}
								<div class="grid gap-2">
									{#each columnEmailSignalBanners.interviewing as banner (banner.taskId)}
										<div class={getEmailSignalBannerClass(banner.type)}>
											<div class="flex items-start justify-between gap-3">
												<div class="min-w-0 flex-1">
													<p class="text-[11px] font-semibold uppercase tracking-wide">
														{banner.taskTitle}
													</p>
													<p class="mt-1 text-xs">{banner.summary}</p>
													<p class="mt-1 text-[11px] font-medium">
														Next action: {banner.nextAction}
													</p>
												</div>
												<Button
													variant="outline"
													size="sm"
													class="h-7 shrink-0 border-current/25 bg-white/60 px-2 text-[11px] dark:bg-black/10"
													onclick={() => acknowledgeEmailSignal(banner.taskId)}
												>
													OK
												</Button>
											</div>
										</div>
									{/each}
								</div>
							{/if}
							{#each items[columnId] as task, taskIdx (task.id)}
								<KanbanItem
									{task}
									index={taskIdx}
									group={columnId}
									data={{ group: columnId }}
									canQuickDelete={columnId === 'done'}
									onQuickDelete={handleTaskDelete}
									onclick={handleTaskClick}
								/>
							{/each}
						</KanbanColumn>
					{/each}
				</div>
			</div>
		{/if}

		<DragOverlay>
			{#snippet children(source)}
				{#if source.data.group}
					{@const task = items[source.data.group as ColumnId]?.find((t) => t.id === source.id)}
					{#if task}
						<KanbanItem {task} index={0} isOverlay {overlayTilted} />
					{/if}
				{:else}
					{@const colId = source.id as ColumnId}
					<KanbanColumn
						id={colId}
						title={getColumnTitle(colId)}
						index={0}
						isOverlay
						{overlayTilted}
						onAdd={() => {}}
					>
						{#each items[colId] as task, taskIdx (task.id)}
							<KanbanItem {task} index={taskIdx} group={colId} data={{ group: colId }} />
						{/each}
					</KanbanColumn>
				{/if}
			{/snippet}
		</DragOverlay>
	</DragDropProvider>

	{#if dev}
		<div
			class="mt-4 flex flex-wrap gap-2 rounded-md border border-dashed border-muted-foreground/30 p-3"
		>
			<span class="text-xs text-muted-foreground">Debug:</span>
			<Button
				variant="outline"
				size="sm"
				class="h-6 text-xs"
				onclick={() => mockAgentStatus('working')}
			>
				Set Working
			</Button>
			<Button
				variant="outline"
				size="sm"
				class="h-6 text-xs"
				onclick={() => mockAgentStatus('done')}
			>
				Set Done
			</Button>
			<Button
				variant="outline"
				size="sm"
				class="h-6 text-xs"
				onclick={() => mockAgentStatus('awaiting_approval')}
			>
				Set Approval
			</Button>
			<Button
				variant="outline"
				size="sm"
				class="h-6 text-xs"
				onclick={() => mockAgentStatus('error')}
			>
				Set Error
			</Button>
			<Button
				variant="outline"
				size="sm"
				class="h-6 text-xs"
				onclick={() => mockAgentStatus('idle')}
			>
				Reset
			</Button>
			<Button variant="outline" size="sm" class="h-6 text-xs" onclick={mockAgentSpec}>
				Set UI Spec
			</Button>
		</div>
	{/if}
</div>

{#if selectedTask && dialogOpen}
	<TodoDetailDialog
		task={selectedTask}
		bind:open={dialogOpen}
		onSave={handleTaskSave}
		onDelete={handleTaskDelete}
		canMoveToDone={selectedTaskColumnId !== null && selectedTaskColumnId !== 'done'}
		onMoveToDone={handleMoveTaskToDone}
		onApprove={handleAgentApprove}
		onReject={handleAgentReject}
		onBlockAction={handleBlockAction}
		onRetry={handleAgentRetry}
	/>
{/if}

<ChatgptConnectDialog
	bind:open={connectDialogOpen}
	description="Connect your ChatGPT account to enable AI-powered job application features"
/>

{#if editingColumnId}
	<ColumnEditDialog
		columnId={editingColumnId}
		columnMeta={columnMetaMap[editingColumnId]}
		defaultTitle={COLUMN_LABELS[editingColumnId] || editingColumnId}
		bind:open={columnEditOpen}
		onSave={async (colId, updates) => {
			try {
				await convexClient.mutation(api.todos.updateColumn, {
					columnId: colId,
					name: updates.name,
					instructions: updates.instructions
				});
			} catch (err) {
				console.error('[kanban] Failed to update column:', err);
				haptic.trigger('error');
				toast.error('Failed to update column');
			}
		}}
	/>
{/if}
