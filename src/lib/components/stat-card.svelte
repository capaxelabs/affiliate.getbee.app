<script lang="ts">
	import type { Component } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import TrendingDownIcon from '@lucide/svelte/icons/trending-down';

	let {
		label,
		value,
		hint,
		trend = null,
		trendLabel
	}: {
		label: string;
		value: string;
		hint?: string;
		/** Accepted for older callers; the dashboard style has no icon tile. */
		icon?: Component;
		/** Change in percent. Null hides the badge. */
		trend?: number | null;
		/** The headline under the number, e.g. "Up on last month". */
		trendLabel?: string;
	} = $props();

	const up = $derived((trend ?? 0) >= 0);
</script>

<Card.Root
	class="@container/card gap-4 bg-gradient-to-t from-primary/5 to-card shadow-xs dark:bg-card"
>
	<Card.Header>
		<Card.Description>{label}</Card.Description>
		<Card.Title class="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
			{value}
		</Card.Title>
		{#if trend !== null && Number.isFinite(trend)}
			<Card.Action>
				<Badge variant="outline">
					{#if up}<TrendingUpIcon />{:else}<TrendingDownIcon />{/if}
					{up ? '+' : ''}{trend.toFixed(Math.abs(trend) < 10 ? 1 : 0)}%
				</Badge>
			</Card.Action>
		{/if}
	</Card.Header>
	{#if trendLabel || hint}
		<Card.Footer class="flex-col items-start gap-1.5 text-sm">
			{#if trendLabel}
				<div class="line-clamp-1 flex gap-2 font-medium">
					{trendLabel}
					{#if trend !== null}
						{#if up}<TrendingUpIcon class="size-4" />{:else}<TrendingDownIcon class="size-4" />{/if}
					{/if}
				</div>
			{/if}
			{#if hint}
				<div class="text-muted-foreground">{hint}</div>
			{/if}
		</Card.Footer>
	{/if}
</Card.Root>
