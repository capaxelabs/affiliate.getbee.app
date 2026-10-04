<script lang="ts">
	import * as Chart from '$lib/components/ui/chart';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import { scaleUtc } from 'd3-scale';
	import { Area, AreaChart } from 'layerchart';
	import { curveMonotoneX } from 'd3-shape';

	type Point = { date: string; installed: number; removed: number };

	let {
		title,
		points
	}: {
		title: string;
		/** One row per day, oldest first. */
		points: Point[];
	} = $props();

	const RANGES = [
		{ value: '90d', days: 90, label: 'Last 3 months' },
		{ value: '30d', days: 30, label: 'Last 30 days' },
		{ value: '7d', days: 7, label: 'Last 7 days' }
	];

	let timeRange = $state('90d');
	const range = $derived(RANGES.find((r) => r.value === timeRange) ?? RANGES[0]);

	const data = $derived(
		points.slice(-range.days).map((p) => ({
			date: new Date(`${p.date}T00:00:00Z`),
			installed: p.installed,
			removed: p.removed
		}))
	);
	const totals = $derived(
		data.reduce((a, p) => ({ installed: a.installed + p.installed, removed: a.removed + p.removed }), {
			installed: 0,
			removed: 0
		})
	);

	const chartConfig = {
		installed: { label: 'Installs', color: 'var(--chart-1)' },
		removed: { label: 'Uninstalls', color: 'var(--chart-2)' }
	} satisfies Chart.ChartConfig;

	const day = (v: Date) =>
		v.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
</script>

<Card.Root class="@container/card">
	<Card.Header>
		<Card.Title>{title}</Card.Title>
		<Card.Description>
			{totals.installed} installs and {totals.removed} uninstalls or closed stores, {range.label.toLowerCase()}
		</Card.Description>
		<Card.Action>
			<ToggleGroup.Root
				type="single"
				bind:value={timeRange}
				variant="outline"
				class="hidden *:data-[slot=toggle-group-item]:!px-4 @[767px]/card:flex"
			>
				{#each RANGES as r (r.value)}
					<ToggleGroup.Item value={r.value}>{r.label}</ToggleGroup.Item>
				{/each}
			</ToggleGroup.Root>
			<Select.Root type="single" bind:value={timeRange}>
				<Select.Trigger size="sm" class="flex w-40 @[767px]/card:hidden" aria-label="Choose a time range">
					{range.label}
				</Select.Trigger>
				<Select.Content class="rounded-xl">
					{#each RANGES as r (r.value)}
						<Select.Item value={r.value} class="rounded-lg">{r.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</Card.Action>
	</Card.Header>
	<Card.Content class="px-2 pt-4 sm:px-6 sm:pt-6">
		<Chart.Container config={chartConfig} class="aspect-auto h-[250px] w-full">
			<AreaChart
				legend
				{data}
				x="date"
				xScale={scaleUtc()}
				series={[
					{ key: 'removed', label: 'Uninstalls', color: chartConfig.removed.color },
					{ key: 'installed', label: 'Installs', color: chartConfig.installed.color }
				]}
				props={{
					area: {
						curve: curveMonotoneX,
						'fill-opacity': 0.4,
						line: { class: 'stroke-1' },
						motion: 'tween'
					},
					xAxis: { ticks: range.days === 7 ? 7 : undefined, format: day },
					yAxis: { format: (v: number) => (Number.isInteger(v) ? String(v) : '') }
				}}
			>
				{#snippet marks({ series, getAreaProps })}
					<defs>
						<linearGradient id="fillInstalled" x1="0" y1="0" x2="0" y2="1">
							<stop offset="5%" stop-color="var(--color-installed)" stop-opacity={0.9} />
							<stop offset="95%" stop-color="var(--color-installed)" stop-opacity={0.1} />
						</linearGradient>
						<linearGradient id="fillRemoved" x1="0" y1="0" x2="0" y2="1">
							<stop offset="5%" stop-color="var(--color-removed)" stop-opacity={0.7} />
							<stop offset="95%" stop-color="var(--color-removed)" stop-opacity={0.1} />
						</linearGradient>
					</defs>
					{#each series as s, i (s.key)}
						<Area
							{...getAreaProps(s, i)}
							fill={s.key === 'installed' ? 'url(#fillInstalled)' : 'url(#fillRemoved)'}
						/>
					{/each}
				{/snippet}
				{#snippet tooltip()}
					<Chart.Tooltip labelFormatter={day} indicator="line" />
				{/snippet}
			</AreaChart>
		</Chart.Container>
	</Card.Content>
</Card.Root>
