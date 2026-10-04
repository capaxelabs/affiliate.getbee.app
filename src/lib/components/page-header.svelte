<script lang="ts">
	import { getContext, type Snippet } from 'svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';

	let {
		title,
		description,
		leading,
		actions
	}: { title: string; description?: string; leading?: Snippet; actions?: Snippet } = $props();

	// Inside a shell with a site header, the sidebar toggle already lives there.
	const inShell = getContext<boolean>('site-header') ?? false;
</script>

<header class="flex items-start justify-between gap-4 px-5 pt-5 pb-4 sm:px-8">
	<div class="flex min-w-0 items-center gap-2">
		{#if !inShell}
			<Sidebar.Trigger class="-ml-1 md:hidden" />
		{/if}
		{#if leading}
			{@render leading()}
		{/if}
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
