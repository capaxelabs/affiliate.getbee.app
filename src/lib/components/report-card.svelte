<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import ChartIcon from '@lucide/svelte/icons/chart-column';

	type Point = { period: string; value: number };

	let {
		title,
		total,
		points = [],
		format = (v: number) => String(v)
	}: {
		title: string;
		total: string;
		points?: Point[];
		format?: (value: number) => string;
	} = $props();

	const max = $derived(Math.max(1, ...points.map((p) => p.value)));
	const hasData = $derived(points.some((p) => p.value !== 0));

	function label(period: string) {
		// "2026-09" -> "Sep"
		const [year, month] = period.split('-');
		if (!month) return period;
		return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-US', {
			month: 'short'
		});
	}
</script>

<Card.Root class="gap-0 p-0">
	<Card.Header class="px-5 pt-5 pb-0">
		<Card.Description class="text-sm">{title}</Card.Description>
		<Card.Title class="text-xl font-semibold tracking-tight">{hasData ? total : 'N/A'}</Card.Title>
	</Card.Header>
	<Card.Content class="px-5 pt-4 pb-5">
		{#if !hasData}
			<div class="flex h-40 flex-col items-center justify-center gap-1.5 text-center">
				<ChartIcon class="size-5 text-muted-foreground" />
				<p class="text-sm font-medium">No data found</p>
				<p class="text-sm text-muted-foreground">Adjust your filters or try a different time period.</p>
			</div>
		{:else}
			<div class="flex h-40 items-end gap-1.5">
				{#each points as point (point.period)}
					<div class="group flex h-full flex-1 flex-col justify-end gap-1.5">
						<div
							class="w-full rounded-t bg-indigo-500/85 transition-colors group-hover:bg-indigo-600"
							style="height: {Math.max(2, (point.value / max) * 100)}%"
							title="{label(point.period)}: {format(point.value)}"
						></div>
						<span class="truncate text-center text-[10px] text-muted-foreground">
							{label(point.period)}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
