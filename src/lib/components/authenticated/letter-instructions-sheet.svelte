<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import SaveIcon from '@lucide/svelte/icons/save';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { toast } from 'svelte-sonner';
	import { haptic } from '$lib/hooks/use-haptic.svelte';

	const DEFAULT_INSTRUCTIONS = `Write a professional motivation letter that:
- Opens with a strong hook specific to the company and role
- Highlights 2-3 relevant skills or experiences from my CV that match the job requirements
- Shows genuine interest in the company's mission or products
- Keeps a confident but not arrogant tone
- Closes with a clear call to action
- Stays under 400 words`;

	let { open = $bindable(false) }: { open: boolean } = $props();

	const client = useConvexClient();
	const userSettings = useQuery(api.userSettings.getUserSettings, {});

	let editPrompt = $state('');
	let saving = $state(false);
	let synced = $state(false);

	// Sync from server only once when sheet opens
	$effect(() => {
		if (open && userSettings.data && !synced) {
			editPrompt = userSettings.data.motivationLetterPrompt || DEFAULT_INSTRUCTIONS;
			synced = true;
		}
		if (!open) {
			synced = false;
		}
	});

	function resetToDefault() {
		editPrompt = DEFAULT_INSTRUCTIONS;
	}

	async function handleSave() {
		saving = true;
		try {
			await client.mutation(api.userSettings.saveUserSettings, {
				motivationLetterPrompt: editPrompt.trim()
			});
			haptic.trigger('success');
			toast.success('Instructions saved');
			open = false;
		} catch {
			haptic.trigger('error');
			toast.error('Failed to save instructions');
		} finally {
			saving = false;
		}
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="right" class="flex w-full flex-col sm:max-w-lg">
		<Sheet.Header>
			<Sheet.Title>Letter Writing Instructions</Sheet.Title>
			<Sheet.Description>
				These instructions guide Coda when generating motivation letters for your job applications.
			</Sheet.Description>
		</Sheet.Header>

		<div class="flex flex-1 flex-col gap-4 overflow-y-auto px-1 py-4">
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<Label for="letter-prompt">Instructions</Label>
					<Button variant="ghost" size="sm" class="h-7 text-xs" onclick={resetToDefault}>
						<RotateCcwIcon class="mr-1 size-3" />
						Reset to default
					</Button>
				</div>
				<p class="text-xs text-muted-foreground">
					Tell Coda how to write your motivation letters — tone, structure, things to mention, and
					anything else you care about.
				</p>
				<Textarea
					id="letter-prompt"
					bind:value={editPrompt}
					placeholder="e.g. Always mention my AWS certification. Keep it under 300 words..."
					rows={10}
				/>
			</div>
		</div>

		<Sheet.Footer class="flex flex-row gap-2 border-t pt-4">
			<Button variant="outline" onclick={() => (open = false)} class="flex-1">Cancel</Button>
			<Button onclick={handleSave} disabled={saving} class="flex-1">
				{#if saving}
					<LoaderCircleIcon class="mr-1.5 size-4 animate-spin" />
				{:else}
					<SaveIcon class="mr-1.5 size-4" />
				{/if}
				Save
			</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
