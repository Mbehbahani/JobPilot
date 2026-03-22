<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { ConfirmDeleteDialog, confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import { toast } from 'svelte-sonner';
	import ProviderIcon from '$lib/components/icons/provider-icon.svelte';
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import UnplugIcon from '@lucide/svelte/icons/unplug';
	import SaveIcon from '@lucide/svelte/icons/save';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ChatgptConnectDialog from '$lib/components/todo-demo/chatgpt-connect-dialog.svelte';
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
	// Profile / Settings section
	// =========================================================================

	const userSettings = useQuery(api.userSettings.getUserSettings, {});

	let editMotivationFormat = $state('');
	let editMotivationPrompt = $state('');
	let editResume = $state('');
	let settingsInitialized = $state(false);
	let savingSettings = $state(false);

	let formatOpen = $state(false);
	let promptOpen = $state(false);
	let resumeOpen = $state(false);

	function preview(text: string, maxLen = 40): string {
		if (!text) return 'Empty';
		const line = text.split('\n')[0].trim();
		return line.length > maxLen ? line.slice(0, maxLen) + '…' : line;
	}

	$effect(() => {
		if (userSettings.data && !settingsInitialized) {
			editMotivationFormat = userSettings.data.motivationLetterFormat;
			editMotivationPrompt = userSettings.data.motivationLetterPrompt;
			editResume = userSettings.data.profileResume;
			settingsInitialized = true;
		}
	});

	async function saveSettings() {
		savingSettings = true;
		try {
			await client.mutation(api.userSettings.saveUserSettings, {
				motivationLetterFormat: editMotivationFormat.trim(),
				motivationLetterPrompt: editMotivationPrompt.trim(),
				profileResume: editResume.trim()
			});
			haptic.trigger('success');
			toast.success('Settings saved');
		} catch {
			haptic.trigger('error');
			toast.error('Failed to save settings');
		} finally {
			savingSettings = false;
		}
	}
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

<!-- Profile / Settings section -->
<Sidebar.Group>
	<Sidebar.GroupLabel>Profile & Settings</Sidebar.GroupLabel>
	<Sidebar.GroupContent>
		<div class="grid gap-2 px-2 group-data-[collapsible=icon]:hidden">
			<!-- Motivation Letter Format -->
			<Collapsible.Root bind:open={formatOpen}>
				<Collapsible.Trigger
					class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/70"
				>
					<ChevronRightIcon
						class="size-3.5 shrink-0 transition-transform {formatOpen ? 'rotate-90' : ''}"
					/>
					<span class="min-w-0 flex-1">
						<span class="block font-medium text-muted-foreground">Motivation Letter Format</span>
						<span class="block truncate text-muted-foreground/60"
							>{preview(editMotivationFormat)}</span
						>
					</span>
				</Collapsible.Trigger>
				<Collapsible.Content>
					<div class="px-2 pt-1.5 pb-1">
						<Textarea
							bind:value={editMotivationFormat}
							placeholder="Describe your preferred letter format..."
							rows={3}
							class="text-xs"
						/>
					</div>
				</Collapsible.Content>
			</Collapsible.Root>

			<!-- Custom Prompt -->
			<Collapsible.Root bind:open={promptOpen}>
				<Collapsible.Trigger
					class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/70"
				>
					<ChevronRightIcon
						class="size-3.5 shrink-0 transition-transform {promptOpen ? 'rotate-90' : ''}"
					/>
					<span class="min-w-0 flex-1">
						<span class="block font-medium text-muted-foreground">Custom Prompt</span>
						<span class="block truncate text-muted-foreground/60"
							>{preview(editMotivationPrompt)}</span
						>
					</span>
				</Collapsible.Trigger>
				<Collapsible.Content>
					<div class="px-2 pt-1.5 pb-1">
						<Textarea
							bind:value={editMotivationPrompt}
							placeholder="Custom instructions for AI letter generation..."
							rows={3}
							class="text-xs"
						/>
					</div>
				</Collapsible.Content>
			</Collapsible.Root>

			<!-- Resume / Profile -->
			<Collapsible.Root bind:open={resumeOpen}>
				<Collapsible.Trigger
					class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/70"
				>
					<ChevronRightIcon
						class="size-3.5 shrink-0 transition-transform {resumeOpen ? 'rotate-90' : ''}"
					/>
					<span class="min-w-0 flex-1">
						<span class="block font-medium text-muted-foreground">Resume / Profile</span>
						<span class="block truncate text-muted-foreground/60">{preview(editResume)}</span>
					</span>
				</Collapsible.Trigger>
				<Collapsible.Content>
					<div class="px-2 pt-1.5 pb-1">
						<Textarea
							bind:value={editResume}
							placeholder="Paste your resume or key qualifications..."
							rows={4}
							class="text-xs"
						/>
					</div>
				</Collapsible.Content>
			</Collapsible.Root>

			<Button size="sm" class="w-full" onclick={saveSettings} disabled={savingSettings}>
				{#if savingSettings}
					<LoaderCircleIcon class="mr-1.5 size-3.5 animate-spin" />
				{:else}
					<SaveIcon class="mr-1.5 size-3.5" />
				{/if}
				Save Settings
			</Button>
		</div>
	</Sidebar.GroupContent>
</Sidebar.Group>

<ChatgptConnectDialog bind:open={openaiDialogOpen} />

<ConfirmDeleteDialog />
