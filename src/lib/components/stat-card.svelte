<script lang="ts">
	import type { Component } from 'svelte';
	import * as Card from '$lib/components/ui/card';

	let {
		label,
		value,
		hint,
		icon: Icon
	}: { label: string; value: string; hint?: string; icon?: Component } = $props();
</script>

<Card.Root class="p-0">
	<Card.Content class="flex items-center gap-3.5 p-5">
		{#if Icon}
			<div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
				<Icon class="size-4.5 text-muted-foreground" />
			</div>
		{/if}
		<div class="min-w-0">
			<p class="truncate text-sm text-muted-foreground">{label}</p>
			<p class="text-xl font-semibold tracking-tight">{value}</p>
			{#if hint}
				<p class="mt-0.5 text-xs text-muted-foreground">{hint}</p>
			{/if}
		</div>
	</Card.Content>
</Card.Root>
