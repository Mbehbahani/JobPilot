<script lang="ts" module>
	import type { Snippet, Component } from 'svelte';

	interface KanbanColumnProps {
		id: string;
		title: string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		icon?: Component<any>;
		index: number;
		isOverlay?: boolean;
		overlayTilted?: boolean;
		children: Snippet;
		onAdd: (title: string) => void | Promise<void>;
		onEdit?: () => void;
		editAriaLabel?: string;
	}
</script>

<script lang="ts">
	import { useSortable } from '@dnd-kit-svelte/svelte/sortable';
	import { CollisionPriority } from '@dnd-kit/abstract';
	import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import TodoAddForm from './todo-add-form.svelte';

	let {
		id,
		title,
		icon,
		index,
		isOverlay = false,
		overlayTilted = true,
		children,
		onAdd,
		onEdit,
		editAriaLabel
	}: KanbanColumnProps = $props();

	const { ref, handleRef, isDragging, isDropping } = useSortable({
		get id() {
			return id;
		},
		index: () => index,
		type: 'column',
		accept: ['item', 'column'],
		collisionPriority: CollisionPriority.Low
	});
</script>

<div class="relative" {@attach ref}>
	<div
		class="{(isDragging.current || isDropping.current) && !isOverlay
			? 'invisible'
			: ''} {isOverlay && overlayTilted ? 'drag-tilt-column' : ''}"
	>
		<div
			class="rounded-xl border border-border/80 bg-muted/45 p-3 dark:border-border/60 dark:bg-card/95"
		>
			<div class="flex items-center justify-between px-1 pb-3">
				<span class="flex items-center gap-1.5 text-sm font-semibold text-foreground">
					{#if icon}
						{@const Icon = icon}
						<Icon class="size-3.5 text-muted-foreground" />
					{/if}
					{title}
				</span>
				<div class="flex items-center gap-0.5">
					{#if onEdit && !isOverlay}
						<button
							class="rounded p-1 text-foreground/70 transition-colors hover:bg-muted/70 hover:text-foreground dark:hover:bg-background"
							onclick={onEdit}
							aria-label={editAriaLabel}
						>
							<PencilIcon class="size-3.5" />
						</button>
					{/if}
					<button
						class="cursor-grab rounded p-1 text-foreground/70 transition-colors hover:bg-muted/70 hover:text-foreground dark:hover:bg-background"
						{@attach handleRef}
					>
						<GripVerticalIcon class="size-4" />
					</button>
				</div>
			</div>
			<div class="grid min-h-0 gap-2">
				{@render children()}
			</div>
			<TodoAddForm {onAdd} />
		</div>
	</div>

	{#if !isOverlay && (isDragging.current || isDropping.current)}
		<div class="absolute inset-0 rounded-xl bg-primary/[0.02]"></div>
	{/if}
</div>
