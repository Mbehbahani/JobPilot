<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ConfirmDeleteDialog, confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import { toast } from 'svelte-sonner';
	import ProviderIcon from '$lib/components/icons/provider-icon.svelte';
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import UnplugIcon from '@lucide/svelte/icons/unplug';
	import PenLineIcon from '@lucide/svelte/icons/pen-line';
	import FileUserIcon from '@lucide/svelte/icons/file-user';
	import MailIcon from '@lucide/svelte/icons/mail';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
	import ChatgptConnectDialog from '$lib/components/todo-demo/chatgpt-connect-dialog.svelte';
	import GmailConnectDialog from '$lib/components/todo-demo/gmail-connect-dialog.svelte';
	import LetterInstructionsSheet from './letter-instructions-sheet.svelte';
	import CvProfileSheet from './cv-profile-sheet.svelte';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	const gmailSecurityMessage =
		'Your data is secure. JobPilot uses Google’s official authentication (OAuth) for Gmail access. We only read the selected recent emails to help you manage tasks, and we do not share your data.';

	const client = useConvexClient();

	// =========================================================================
	// OpenAI / ChatGPT section
	// =========================================================================

	const openaiConnection = useQuery(api.openai.getConnection, {});

	let openaiDialogOpen = $state(false);
	let openaiDisconnecting = $state(false);
	const gmailConnection = useQuery(api.gmail.getConnection, {});
	let gmailDialogOpen = $state(false);
	let gmailDisconnecting = $state(false);
	let gmailReadPending = $state(false);
	const emailReadOptions = [1, 5, 10, 20] as const;
	let selectedEmailReadCount = $state<(typeof emailReadOptions)[number]>(10);

	function handleOpenAIConnect() {
		openaiDialogOpen = true;
	}

	function handleGmailConnect() {
		gmailDialogOpen = true;
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

	function handleGmailDisconnect() {
		confirmDelete({
			title: 'Disconnect Gmail',
			description: 'Are you sure you want to disconnect your Gmail account?',
			confirm: { text: 'Disconnect' },
			onConfirm: async () => {
				gmailDisconnecting = true;
				try {
					await client.action(api.gmail.deleteConnection, {});
					haptic.trigger('success');
					toast.success('Gmail disconnected');
				} catch {
					haptic.trigger('error');
					toast.error('Failed to disconnect Gmail');
				} finally {
					gmailDisconnecting = false;
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

	function formatEmailCheckTimestamp(ts?: number): string {
		if (!ts) return 'No email checks yet';
		return `Last check ${new Date(ts).toLocaleString()}`;
	}

	async function handleReadRecentEmails() {
		if (gmailReadPending) return;
		gmailReadPending = true;
		try {
			const result = await client.action(api.gmail.readRecentEmails, {
				maxResults: selectedEmailReadCount
			});
			haptic.trigger('success');
			if (result.count === 0) {
				toast.success('No recent inbox emails were found');
			} else {
				const preview = result.messages
					.slice(0, 3)
					.map((message) => message.subject || 'Untitled email')
					.join(' · ');
				toast.success(
					preview
						? `Checked the latest ${result.count} emails: ${preview}`
						: `Checked the latest ${result.count} emails`
				);
			}
		} catch (error) {
			console.error('[sidebar] Failed to read recent Gmail emails:', error);
			haptic.trigger('error');
			toast.error(error instanceof Error ? error.message : 'Failed to read recent emails');
		} finally {
			gmailReadPending = false;
		}
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

<!-- Gmail section -->
<Sidebar.Group>
	<Sidebar.GroupLabel>Gmail</Sidebar.GroupLabel>
	<Sidebar.GroupContent>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton
					class="h-auto min-h-8 cursor-default items-start py-2 hover:bg-transparent hover:text-sidebar-foreground active:scale-100 active:bg-transparent active:text-sidebar-foreground"
				>
					<MailIcon class="mt-0.5 size-4 shrink-0" />
					<span class="min-w-0 flex-1">
						<span class="flex items-center gap-1.5 text-sm">
							<span>Gmail</span>
							<Tooltip.Root>
								<Tooltip.Trigger>
									{#snippet child({ props })}
										<button
											{...props}
											type="button"
											class="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
											onclick={(event) => event.preventDefault()}
										>
											<CircleHelpIcon class="size-3.5" />
										</button>
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content side="right" class="max-w-72 text-xs leading-5">
									<p>{gmailSecurityMessage}</p>
								</Tooltip.Content>
							</Tooltip.Root>
						</span>
						<span class="block truncate text-xs text-muted-foreground">
							{#if gmailConnection.data?.connection}
								{gmailConnection.data.connection.email ?? 'Connected'}
							{:else if gmailConnection.data && !gmailConnection.data.configured}
								Not configured
							{:else}
								Not connected
							{/if}
						</span>
						<span class="mt-1 block truncate text-[11px] text-muted-foreground">
							{#if gmailConnection.data?.connection}
								{formatEmailCheckTimestamp(gmailConnection.data.connection.lastSyncAt)}
							{:else if gmailConnection.data && !gmailConnection.data.configured}
								Set Gmail OAuth environment variables first
							{:else}
								Connect Gmail to manually check recent emails
							{/if}
						</span>
					</span>
				</Sidebar.MenuButton>
				<div class="mt-2 flex flex-wrap gap-2 px-2 pb-1 group-data-[collapsible=icon]:hidden">
					{#if gmailConnection.data?.connection}
						<div
							class="w-full rounded-md border border-border/60 bg-muted/40 px-2 py-2 text-xs text-muted-foreground"
						>
							<div class="mb-2 font-medium text-foreground">
								Read the latest {selectedEmailReadCount} emails
							</div>
							<div class="flex flex-wrap gap-1.5">
								{#each emailReadOptions as option (option)}
									<Button
										variant={selectedEmailReadCount === option ? 'default' : 'outline'}
										size="sm"
										class="h-6 min-w-8 px-2 text-[11px]"
										onclick={() => (selectedEmailReadCount = option)}
										disabled={gmailReadPending}
									>
										{option}
									</Button>
								{/each}
							</div>
						</div>
						<Button
							size="sm"
							class="h-7 px-2 text-xs"
							onclick={handleReadRecentEmails}
							disabled={gmailReadPending}
						>
							<RefreshCwIcon class="mr-1 size-3.5 {gmailReadPending ? 'animate-spin' : ''}" />
							Check latest {selectedEmailReadCount}
						</Button>
						<Button
							variant="outline"
							size="sm"
							class="h-7 px-2 text-xs"
							onclick={handleGmailDisconnect}
							disabled={gmailDisconnecting}
						>
							Disconnect
						</Button>
					{:else if gmailConnection.data && !gmailConnection.data.configured}
						<Button size="sm" class="h-7 px-2 text-xs" disabled>Connect</Button>
					{:else}
						<Button size="sm" class="h-7 px-2 text-xs" onclick={handleGmailConnect}>Connect</Button>
					{/if}
				</div>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.GroupContent>
</Sidebar.Group>

<ChatgptConnectDialog bind:open={openaiDialogOpen} />
<GmailConnectDialog
	bind:open={gmailDialogOpen}
	isConfigured={gmailConnection.data?.configured ?? false}
/>
<LetterInstructionsSheet bind:open={letterSheetOpen} />
<CvProfileSheet bind:open={cvSheetOpen} />

<ConfirmDeleteDialog />
