<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';

	let { onaccept }: { onaccept: () => void } = $props();
</script>

<div
	class="fixed right-0 bottom-0 left-0 z-50 border-t bg-background/95 px-4 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80"
>
	<div
		class="mx-auto flex max-w-screen-xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
	>
		<p class="text-sm text-muted-foreground">
			We use analytics cookies to understand how visitors interact with JobFlow and to improve your
			experience. No advertising or tracking data is shared with third parties.
		</p>
		<Button size="sm" class="shrink-0" onclick={onaccept}>Accept</Button>
	</div>
</div>
