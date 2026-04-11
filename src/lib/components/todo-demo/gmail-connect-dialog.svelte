<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

	let {
		open = $bindable(false),
		isConfigured = false,
		description = 'Connect your Gmail account to enable email sync for job tasks'
	}: {
		open: boolean;
		isConfigured?: boolean;
		description?: string;
	} = $props();

	const client = useConvexClient();

	let connecting = $state(false);
	let awaitingCallback = $state(false);
	let popupWindow = $state<Window | null>(null);
	let autoStartAttempted = $state(false);

	async function startAuth() {
		if (connecting || typeof window === 'undefined') return;
		if (!isConfigured) {
			haptic.trigger('error');
			toast.error(
				'Gmail OAuth is not configured. Set GMAIL_GOOGLE_CLIENT_ID and GMAIL_GOOGLE_CLIENT_SECRET first.'
			);
			return;
		}
		connecting = true;
		try {
			const result = await client.action(api.gmail.getAuthorizationUrl, {
				redirectUri: `${window.location.origin}/api/auth/gmail/callback`
			});

			popupWindow = window.open(
				result.authorizationUrl,
				'jobpilot-gmail-connect',
				'popup=yes,width=560,height=720,resizable=yes,scrollbars=yes'
			);

			if (!popupWindow) {
				haptic.trigger('error');
				toast.error('Popup blocked. Please allow popups and try again.');
				return;
			}

			awaitingCallback = true;
		} catch (error) {
			console.error('[gmail] Failed to start OAuth:', error);
			haptic.trigger('error');
			toast.error(error instanceof Error ? error.message : 'Failed to start Gmail connection');
		} finally {
			connecting = false;
		}
	}

	function cleanupPopup() {
		if (popupWindow && !popupWindow.closed) {
			popupWindow.close();
		}
		popupWindow = null;
		awaitingCallback = false;
	}

	function handleOpenChange(next: boolean) {
		if (!next) {
			cleanupPopup();
			autoStartAttempted = false;
		}
		open = next;
	}

	$effect(() => {
		if (!open || typeof window === 'undefined') return;

		const handleMessage = (event: MessageEvent) => {
			if (event.origin !== window.location.origin) return;
			if (!event.data || event.data.type !== 'jobpilot:gmail-oauth') return;

			cleanupPopup();
			if (event.data.success) {
				haptic.trigger('success');
				toast.success('Gmail connected successfully');
				open = false;
			} else {
				haptic.trigger('error');
				toast.error(event.data.message || 'Failed to connect Gmail');
			}
		};

		window.addEventListener('message', handleMessage);
		return () => {
			window.removeEventListener('message', handleMessage);
		};
	});

	$effect(() => {
		if (open && !awaitingCallback && !connecting && !autoStartAttempted) {
			autoStartAttempted = true;
			void startAuth();
		}
		if (!open) {
			cleanupPopup();
			autoStartAttempted = false;
		}
	});
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Connect Gmail</Dialog.Title>
			<Dialog.Description>
				{description}
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 pt-3">
			<div class="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
				{#if isConfigured}
					Grant read-only Gmail access so JobPilot can later check recent job-related emails.
				{:else}
					Gmail OAuth is not configured for this app yet. Add the Gmail Google client ID and client
					secret before connecting.
				{/if}
			</div>

			<Button
				class="w-full"
				disabled={connecting || !isConfigured}
				onclick={() => void startAuth()}
			>
				<ExternalLinkIcon class="h-4 w-4" />
				Open Google Sign-In
			</Button>

			{#if awaitingCallback}
				<div class="flex items-center justify-center gap-2 text-sm text-muted-foreground">
					<LoaderCircleIcon class="h-4 w-4 animate-spin" />
					Waiting for Gmail authorization...
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="ghost" onclick={() => handleOpenChange(false)}>Cancel</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
