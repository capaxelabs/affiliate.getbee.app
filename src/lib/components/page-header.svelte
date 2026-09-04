<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';

	let {
		title,
		description,
		actions
	}: { title: string; description?: string; actions?: Snippet } = $props();
</script>

<header class="flex items-start justify-between gap-4 px-5 pt-5 pb-4 sm:px-8">
	<div class="flex min-w-0 items-center gap-2">
		<Sidebar.Trigger class="-ml-1 md:hidden" />
		<div class="min-w-0">
			<h1 class="truncate text-xl font-semibold tracking-tight">{title}</h1>
			{#if description}
				<p class="mt-0.5 text-sm text-muted-foreground">{description}</p>
			{/if}
		</div>
	</div>
	{#if actions}
		<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>
	{/if}
</header>
