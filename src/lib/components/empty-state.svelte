<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	let {
		title,
		description,
		icon: Icon,
		action
	}: { title: string; description?: string; icon?: Component; action?: Snippet } = $props();
</script>

<div class="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
	{#if Icon}
		<Icon class="mb-1 size-6 text-muted-foreground" />
	{/if}
	<p class="text-sm font-medium">{title}</p>
	{#if description}
		<p class="max-w-sm text-sm text-muted-foreground">{description}</p>
	{/if}
	{#if action}
		<div class="mt-3">{@render action()}</div>
	{/if}
</div>
