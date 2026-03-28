<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Input from '$lib/components/ui/input/input.svelte';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import type { ColumnMeta } from './types.js';

	let {
		columnId,
		columnMeta,
		defaultTitle,
		open = $bindable(false),
		onSave
	}: {
		columnId: string;
		columnMeta?: ColumnMeta;
		defaultTitle: string;
		open: boolean;
		onSave: (columnId: string, updates: { name?: string; instructions?: string }) => void;
	} = $props();

	let editName = $state('');
	let editInstructions = $state('');
	let initialColumnId = $state('');

	$effect(() => {
		if (open && columnId !== initialColumnId) {
			initialColumnId = columnId;
			editName = columnMeta?.name ?? '';
			editInstructions = columnMeta?.instructions ?? '';
		}
		if (!open) {
			initialColumnId = '';
		}
	});

	function handleSave() {
		onSave(columnId, {
			name: editName.trim() || undefined,
			instructions: editInstructions.trim() || undefined
		});
		open = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'Enter')) {
			e.preventDefault();
			handleSave();
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md" onkeydown={handleKeydown}>
		<Dialog.Header>
			<Dialog.Title>Edit Column</Dialog.Title>
			<Dialog.Description>Customize column name and agent instructions</Dialog.Description>
		</Dialog.Header>
		<Field.Group>
			<Field.Field>
				<Field.Label>Column Name</Field.Label>
				<Input bind:value={editName} placeholder={defaultTitle} />
				<Field.Description>Override the default column label</Field.Description>
			</Field.Field>
			<Field.Field>
				<Field.Label>Agent Instructions</Field.Label>
				<Textarea
					bind:value={editInstructions}
					placeholder="Optional instructions for Nova..."
					rows={4}
				/>
				<Field.Description>Tell Nova how to handle tasks in this column</Field.Description>
			</Field.Field>
		</Field.Group>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={handleSave}>Save</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
