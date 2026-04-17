<script lang="ts">
	import Input from '$lib/components/ui/input/input.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';

	let {
		onAdd,
		columnId = ''
	}: { onAdd: (title: string) => void | Promise<void>; columnId?: string } = $props();

	let title = $state('');
	let editing = $state(false);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const trimmed = title.trim();
		if (!trimmed) return;
		// Optimistically close the input immediately for snappier UX.
		title = '';
		editing = false;
		try {
			await onAdd(trimmed);
		} catch {
			// Restore input only if caller throws unexpectedly.
			title = trimmed;
			editing = true;
		}
	}

	function cancel() {
		title = '';
		editing = false;
	}
</script>

{#if editing}
	<form onsubmit={handleSubmit} class="grid gap-2 pt-2">
		<Input bind:value={title} placeholder="Add a job application..." class="h-8" autofocus />
		{#if columnId === 'targeted'}
			<p class="text-[11px] leading-4 text-muted-foreground">
				Tip: paste a job title, URL, or LinkedIn link — Nova will fill in the details.
			</p>
		{/if}
		<div class="flex gap-2">
			<Button type="submit" size="sm" class="h-7 text-xs">Add</Button>
			<Button type="button" variant="ghost" size="icon" class="size-7" onclick={cancel}>
				<XIcon class="size-4" />
			</Button>
		</div>
	</form>
{:else}
	<button
		class="mt-2 flex w-full items-center rounded-lg px-2 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-muted/70 hover:text-foreground dark:text-foreground/75 dark:hover:bg-background"
		onclick={() => (editing = true)}
	>
		<span class="flex items-center gap-1">
			<PlusIcon class="size-4" />
			Add
		</span>
	</button>
{/if}
