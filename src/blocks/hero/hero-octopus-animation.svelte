<script lang="ts">
	import { browser } from '$app/environment';
	import { untrack } from 'svelte';
	import { flip } from 'svelte/animate';
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import {
		DragDropProvider,
		DragOverlay,
		PointerSensor,
		KeyboardSensor
	} from '@dnd-kit-svelte/svelte';
	import { RestrictToWindowEdges } from '@dnd-kit-svelte/svelte/modifiers';
	import { move } from '@dnd-kit/helpers';
	import KanbanItem from '$lib/components/todo-demo/kanban-item.svelte';
	import TodoAddForm from '$lib/components/todo-demo/todo-add-form.svelte';
	import type { TodoItem } from '$lib/components/todo-demo/types.js';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';

	const taskPool = [
		'Data Scientist',
		'Machine Learning Engineer',
		'AI Engineer',
		'Backend Engineer',
		'Frontend Developer',
		'Full Stack Developer',
		'DevOps Engineer',
		'Cloud Engineer',
		'MLOps Engineer',
		'Software Engineer',
		'Data Engineer',
		'Analytics Engineer'
	];

	function makeTask(title: string): TodoItem {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return { id: crypto.randomUUID(), title };
		}
		return { id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title };
	}

	const MAX_TASKS = 5;

	// Single demo column — key matches the `group` prop passed to KanbanItem
	let board = $state<{ demo: TodoItem[] }>({
		demo: taskPool.slice(0, MAX_TASKS).map(makeTask)
	});
	let nextPoolIdx = $state(MAX_TASKS);

	let phase = $state<'idle' | 'reaching' | 'pulling'>('idle');
	let grabbedId = $state<string | null>(null);
	let grabbedOffset = $state(0); // px — drives CSS transform on grabbed card
	let shouldAnimate = $state(true);
	let isDragging = $state(false);
	let overlayTilted = $state(false);

	$effect(() => {
		if (!browser) return;
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		shouldAnimate = !mq.matches;
		const onChange = (e: MediaQueryListEvent) => (shouldAnimate = !e.matches);
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	$effect(() => {
		if (!browser || !shouldAnimate) return;

		let cancelled = false;
		let timerId: ReturnType<typeof setTimeout>;

		function wait(ms: number) {
			return new Promise<void>((resolve) => {
				timerId = setTimeout(() => {
					if (!cancelled) resolve();
				}, ms);
			});
		}

		async function loop() {
			// Small initial delay so the hero isn't mid-animation on first paint
			await wait(1200);

			while (!cancelled) {
				// Don't interrupt while the user is manually dragging
				if (isDragging) {
					await wait(400);
					continue;
				}

				if (!board.demo.length) {
					await wait(1000);
					continue;
				}

				// Squid reaches in — tentacle slides in, no glow yet.
				phase = 'reaching';
				const targetId = board.demo[0].id;
				grabbedId = targetId;
				await wait(1200); // tentacle arrives at card
				if (cancelled) break;
				if (phase !== 'reaching') continue;

				// Tentacle touches card → activate glow AND start pull simultaneously.
				// grabbedOffset=300 drives a CSS translateX on the card wrapper (1.8s ease-in-out),
				// exactly matching the octo-out tentacle retraction (also 1.8s ease-in-out).
				board.demo = board.demo.map((t, i) =>
					i === 0 ? { ...t, agentStatus: 'working' as const } : t
				);
				phase = 'pulling';
				grabbedOffset = 300;

				await wait(1800); // both card CSS-transition and tentacle retraction finish
				if (cancelled) break;

				// Card is now off-screen → safe to splice (no visible jump).
				// Add new task at end (triggers in:scale pop-in).
				const idx = untrack(() => nextPoolIdx);
				nextPoolIdx = idx + 1;
				board.demo = [...board.demo.slice(1), makeTask(taskPool[idx % taskPool.length])];
				grabbedOffset = 0;

				await wait(500); // let new card pop in before resetting
				if (cancelled) break;

				phase = 'idle';
				grabbedId = null;
				await wait(1000);
			}
		}

		loop();
		return () => {
			cancelled = true;
			clearTimeout(timerId);
		};
	});

	// If the user manually starts dragging while the AI animation is mid-flight,
	// reset the AI state so only the user's drag takes effect.
	$effect(() => {
		if (isDragging && grabbedId && phase === 'reaching') {
			const id = grabbedId;
			untrack(() => {
				board.demo = board.demo.map((t) => (t.id === id ? { ...t, agentStatus: undefined } : t));
				grabbedId = null;
				grabbedOffset = 0;
				phase = 'idle';
			});
		}
	});

	const sensors = [PointerSensor, KeyboardSensor];

	type EndEvent = { suspend: () => { resume: () => void } };
</script>

<!--
  The 480×520 container keeps the same coordinate space as the original SVG
  so the tentacle overlay aligns with the task list in the column.
-->
<div class="hero-octo-wrapper" aria-hidden="true">
	<div
		class="relative h-[520px] w-[480px] origin-top-left overflow-hidden"
		class:pulling={phase === 'pulling'}
	>
		<!-- Real KanbanColumn shell + KanbanItem cards with DnD -->
		<div class="absolute" style="left: 64px; top: 80px; width: 280px;">
			<DragDropProvider
				{sensors}
				modifiers={[RestrictToWindowEdges]}
				onDragStart={() => {
					isDragging = true;
					overlayTilted = true;
				}}
				onDragOver={(event) => {
					board = move(board, event as any) as { demo: TodoItem[] };
				}}
				onDragEnd={(event) => {
					board = move(board, event as any) as { demo: TodoItem[] };
					isDragging = false;
					overlayTilted = false;
					// Let overlay re-render without tilt before drop animation snapshot
					const suspended = (event as EndEvent).suspend();
					requestAnimationFrame(() => suspended.resume());
				}}
			>
				<!-- Column shell — same markup/classes as kanban-column.svelte -->
				<div
					class="rounded-xl border border-border/80 bg-muted/45 p-3 dark:border-border/60 dark:bg-card/95"
				>
					<div class="flex items-center justify-between px-1 pb-3">
						<span class="text-sm font-semibold text-foreground">To do</span>
						<div class="flex items-center gap-0.5">
							<button
								class="rounded p-1 text-foreground/70 transition-colors hover:bg-muted/70 hover:text-foreground dark:hover:bg-background"
								tabindex="-1"
							>
								<PencilIcon class="size-3.5" />
							</button>
							<button
								class="cursor-default rounded p-1 text-foreground/70 transition-colors hover:bg-muted/70 hover:text-foreground dark:hover:bg-background"
								tabindex="-1"
							>
								<GripVerticalIcon class="size-4" />
							</button>
						</div>
					</div>

					<!-- Task list — real KanbanItem components -->
					<div class="grid min-h-0 gap-2">
						{#each board.demo as task, i (task.id)}
							<div
								animate:flip={{ duration: 300 }}
								in:scale={{ start: 0.85, duration: 450, easing: backOut }}
								style={task.id === grabbedId
									? `transform: translateX(var(--pull-x, 0px)); rotate: ${grabbedOffset > 0 ? '2deg' : '0deg'}; opacity: ${grabbedOffset > 0 ? 0 : 1}; transition: rotate 75ms ease-out, opacity 1.2s ease-in-out 0.4s;${grabbedOffset > 0 ? ' pointer-events: none;' : ''}`
									: ''}
							>
								<KanbanItem {task} index={i} group="demo" data={{ group: 'demo' }} />
							</div>
						{/each}
					</div>

					<TodoAddForm
						onAdd={(title) => {
							const newTask = makeTask(title);
							if (board.demo.length < MAX_TASKS) {
								board.demo = [...board.demo, newTask];
							} else {
								// List is full — drop the oldest task that isn't currently grabbed,
								// then append the new one. The list stays the same height.
								const dropIdx = board.demo.findIndex((t) => t.id !== grabbedId);
								if (dropIdx === -1) return; // all grabbed (shouldn't happen)
								const next = [...board.demo];
								next.splice(dropIdx, 1);
								board.demo = [...next, newTask];
							}
						}}
					/>
				</div>

				<!-- DragOverlay — same as in kanban-board.svelte -->
				<DragOverlay>
					{#snippet children(source)}
						{@const task = board.demo.find((t) => t.id === source.id)}
						{#if task}
							<KanbanItem {task} index={0} group="demo" isOverlay {overlayTilted} />
						{/if}
					{/snippet}
				</DragOverlay>
			</DragDropProvider>
		</div>

		<!-- Animated SVG overlay -->
		<svg
			class="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
			viewBox="0 0 480 520"
		>
			<g
				class="octo-tentacle"
				class:octo-in={phase === 'reaching'}
				class:octo-out={phase === 'pulling'}
			>
				<g transform="translate(420, 150) scale(-4.2, 4.2) translate(-16, -16)">
					<path
						fill-rule="evenodd"
						d="M16 19.586L23.496 6.632H8.504L16 19.586ZM7.496 12.414L0 25.368H14.992L7.496 12.414ZM24.504 12.414L17.008 25.368H32L24.504 12.414Z"
						fill="var(--primary)"
						opacity="0.8"
					/>
				</g>
			</g>
		</svg>

		<!-- Soft fade on the right edge so the tentacle doesn't clip hard -->
		<div
			class="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-linear-to-l from-background"
		></div>
	</div>
</div>

<style>
	@property --pull-x {
		syntax: '<length>';
		initial-value: 0px;
		inherits: true;
	}

	/* Scale the fixed 480×520 layout to fit the container width */
	.hero-octo-wrapper {
		width: 100%;
		max-width: 480px;
		aspect-ratio: 480 / 520;
		position: relative;
	}
	.hero-octo-wrapper > div {
		scale: calc(100cqi / 480);
		transform-origin: top left;
	}
	@container (min-width: 480px) {
		.hero-octo-wrapper > div {
			scale: 1;
		}
	}
	.hero-octo-wrapper {
		container-type: inline-size;
	}

	/* Shared pull offset — single transition drives both card + tentacle */
	.hero-octo-wrapper > div.pulling {
		--pull-x: 300px;
		transition: --pull-x 1.8s ease-in-out;
	}

	/* Tentacle slide in/out */
	.octo-tentacle {
		transform: translateX(300px);
		transition: transform 1.8s ease-in-out;
	}
	.octo-tentacle.octo-in {
		transform: translateX(0);
		transition: transform 1.2s ease-out;
	}
	.octo-tentacle.octo-out {
		transform: translateX(var(--pull-x, 300px));
		transition: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.octo-tentacle {
			animation: none !important;
			transition: none !important;
			transform: translateX(300px);
		}
	}
</style>
