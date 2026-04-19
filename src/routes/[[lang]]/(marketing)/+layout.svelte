<script lang="ts">
	import MarketingHeader from '$lib/components/marketing/marketing-header.svelte';
	import PostHogIdentify from '$lib/components/analytics/PostHogIdentify.svelte';
	import SupportTicketMigrationBootstrap from '$lib/components/customer-support/support-ticket-migration-bootstrap.svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();
</script>

<PostHogIdentify />
<SupportTicketMigrationBootstrap />
<MarketingHeader />
<div class="pt-4 sm:pt-0 flex flex-col min-h-screen">
	<div class="flex-grow">
		{@render children?.()}
	</div>

	<footer class="mt-auto border-t border-border bg-background py-8 text-sm text-muted-foreground">
		<div class="mx-auto max-w-6xl px-6 lg:px-12 flex flex-col items-center text-center gap-6">
			<p class="max-w-3xl">
				<strong>About JobPilot:</strong> JobPilot is an AI-powered job application tracking platform.
				We securely integrate with your Gmail account to read application statuses and interview invitations,
				helping you automatically organize your job search workflow.
			</p>

			<div class="flex flex-wrap gap-6 justify-center">
				<a
					href="https://www.oploy.eu/privacy/"
					target="_blank"
					rel="noopener noreferrer"
					class="hover:underline underline-offset-4">Privacy Policy</a
				>
				<a
					href="https://www.oploy.eu/terms/"
					target="_blank"
					rel="noopener noreferrer"
					class="hover:underline underline-offset-4">Terms of Service</a
				>
				<a
					href="https://oploy.eu/contact/"
					target="_blank"
					rel="noopener noreferrer"
					class="hover:underline underline-offset-4">Contact Support</a
				>
			</div>

			<p>&copy; {new Date().getFullYear()} Oploy. All rights reserved.</p>
		</div>
	</footer>
</div>
