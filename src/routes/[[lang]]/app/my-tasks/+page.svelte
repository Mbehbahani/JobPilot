<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import KanbanBoard from '$lib/components/todo-demo/kanban-board.svelte';
</script>

<SEOHead title="My Applications" description="Track your job applications" />

<div class="px-4 py-6 lg:px-6">
	<KanbanBoard />
</div>
