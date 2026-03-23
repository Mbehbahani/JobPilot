<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ConfirmDeleteDialog, confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import { toast } from 'svelte-sonner';
	import ProviderIcon from '$lib/components/icons/provider-icon.svelte';
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import UnplugIcon from '@lucide/svelte/icons/unplug';
	import PenLineIcon from '@lucide/svelte/icons/pen-line';
	import FileUserIcon from '@lucide/svelte/icons/file-user';
	import ChatgptConnectDialog from '$lib/components/todo-demo/chatgpt-connect-dialog.svelte';
	import LetterInstructionsSheet from './letter-instructions-sheet.svelte';
	import CvProfileSheet from './cv-profile-sheet.svelte';
	import { haptic } from '$lib/hooks/use-haptic.svelte';

	const client = useConvexClient();

	// =========================================================================
	// OpenAI / ChatGPT section
	// =========================================================================

	const openaiConnection = useQuery(api.openai.getConnection, {});

	let openaiDialogOpen = $state(false);
	let openaiDisconnecting = $state(false);

	function handleOpenAIConnect() {
		openaiDialogOpen = true;
	}

	function handleOpenAIDisconnect() {
		confirmDelete({
			title: 'Disconnect ChatGPT',
			description: 'Are you sure you want to disconnect your ChatGPT account?',
			confirm: { text: 'Disconnect' },
			onConfirm: async () => {
				openaiDisconnecting = true;
				try {
					await client.action(api.openai.deleteConnection, {});
					haptic.trigger('success');
					toast.success('ChatGPT disconnected');
				} catch {
					haptic.trigger('error');
					toast.error('Failed to disconnect ChatGPT');
				} finally {
					openaiDisconnecting = false;
				}
			}
		});
	}

	function formatTimestamp(ts: number): string {
		return new Date(ts).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	// =========================================================================
	// Profile / Settings section — sheets
	// =========================================================================

	const userSettings = useQuery(api.userSettings.getUserSettings, {});

	let letterSheetOpen = $state(false);
	let cvSheetOpen = $state(false);

	function preview(text: string | undefined, maxLen = 36): string {
		if (!text) return 'Not set';
		const line = text.split('\n')[0].trim();
		if (!line) return 'Not set';
		return line.length > maxLen ? line.slice(0, maxLen) + '…' : line;
	}

	let letterPreview = $derived(preview(userSettings.data?.motivationLetterPrompt));
	let cvPreview = $derived(preview(userSettings.data?.profileResume));
</script>

<!-- LLM Providers section -->
<Sidebar.Group>
	<Sidebar.GroupLabel>LLM Providers</Sidebar.GroupLabel>
	<Sidebar.GroupContent>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton
					class="h-8 cursor-default hover:bg-transparent hover:text-sidebar-foreground active:scale-100 active:bg-transparent active:text-sidebar-foreground"
				>
					<ProviderIcon type="CHATGPT" class="size-5 shrink-0 rounded" />
					<span>ChatGPT</span>
				</Sidebar.MenuButton>
				{#if !openaiConnection.isLoading}
					{#if openaiConnection.data}
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Sidebar.MenuAction {...props}>
										<EllipsisVerticalIcon class="size-4" />
									</Sidebar.MenuAction>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content side="right" align="start" class="w-56">
								<DropdownMenu.Label class="flex flex-col gap-1 font-normal">
									<span class="text-sm font-medium">
										{openaiConnection.data.email ?? 'ChatGPT'}
									</span>
									<span class="flex items-center gap-1.5">
										<span
											class="size-2 shrink-0 rounded-full {openaiConnection.data.isExpired
												? 'bg-red-500'
												: 'bg-green-500'}"
										></span>
										<span class="text-xs text-muted-foreground">
											Connected since {formatTimestamp(openaiConnection.data.connectedAt)}
										</span>
									</span>
								</DropdownMenu.Label>
								<DropdownMenu.Separator />
								<DropdownMenu.Item
									class="text-destructive focus:text-destructive"
									onclick={handleOpenAIDisconnect}
									disabled={openaiDisconnecting}
								>
									<UnplugIcon class="size-4" />
									Remove
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					{:else}
						<div class="absolute top-1 right-1 group-data-[collapsible=icon]:hidden">
							<Button
								variant="outline"
								size="sm"
								class="relative h-6 px-2 text-xs"
								onclick={handleOpenAIConnect}
							>
								Connect
							</Button>
						</div>
					{/if}
				{/if}
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.GroupContent>
</Sidebar.Group>

<!-- Profile & Settings section -->
<Sidebar.Group>
	<Sidebar.GroupLabel>Profile & Settings</Sidebar.GroupLabel>
	<Sidebar.GroupContent>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton onclick={() => (letterSheetOpen = true)}>
					<PenLineIcon class="size-4 shrink-0" />
					<span class="min-w-0 flex-1">
						<span class="block text-sm">Letter Instructions</span>
						<span class="block truncate text-xs text-muted-foreground">{letterPreview}</span>
					</span>
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton onclick={() => (cvSheetOpen = true)}>
					<FileUserIcon class="size-4 shrink-0" />
					<span class="min-w-0 flex-1">
						<span class="block text-sm">CV / Profile</span>
						<span class="block truncate text-xs text-muted-foreground">{cvPreview}</span>
					</span>
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.GroupContent>
</Sidebar.Group>

<ChatgptConnectDialog bind:open={openaiDialogOpen} />
<LetterInstructionsSheet bind:open={letterSheetOpen} />
<CvProfileSheet bind:open={cvSheetOpen} />

<ConfirmDeleteDialog />
