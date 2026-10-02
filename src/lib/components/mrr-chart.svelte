<script lang="ts">
	import * as Chart from '$lib/components/ui/chart';
	import { LineChart } from 'layerchart';
	import { scaleUtc } from 'd3-scale';
	import { curveMonotoneX } from 'd3-shape';
	import { money } from '$lib/format';

	let { points, class: className = 'h-56' }: { points: { period: string; mrr: number }[]; class?: string } =
		$props();

	const config = { mrr: { label: 'MRR', color: 'var(--chart-1)' } } satisfies Chart.ChartConfig;
	const data = $derived(points.map((p) => ({ date: new Date(`${p.period}-01T00:00:00Z`), mrr: p.mrr })));
	const month = (v: Date) => v.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
</script>

<Chart.Container {config} class="aspect-auto w-full {className}">
	<LineChart
		{data}
		x="date"
		xScale={scaleUtc()}
		series={[{ key: 'mrr', label: 'MRR', color: 'var(--color-mrr)' }]}
		props={{
			spline: { curve: curveMonotoneX, motion: 'tween', strokeWidth: 2 },
			xAxis: { format: month },
			yAxis: { format: (v: number) => money(v).replace(/\.00$/, '') },
			highlight: { points: { r: 3 } }
		}}
	>
		{#snippet tooltip()}
			<Chart.Tooltip labelFormatter={month}>
				{#snippet formatter({ value })}
					<div class="flex w-full items-center justify-between gap-4">
						<span class="text-muted-foreground">MRR</span>
						<span class="font-medium tabular-nums">{money(Number(value))}</span>
					</div>
				{/snippet}
			</Chart.Tooltip>
		{/snippet}
	</LineChart>
</Chart.Container>
