<script lang="ts">
	import { goto } from '$app/navigation';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import PageHeader from '$lib/components/page-header.svelte';
	import ReportCard from '$lib/components/report-card.svelte';
	import { money } from '$lib/format';
	import { CHARGE_TYPE_LABEL } from '$lib/constants';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let range = $state(data.range);
	const rangeLabel = $derived(data.ranges.find((r) => r.value === range)?.label ?? 'Last 12 months');

	function changeRange(value: string) {
		range = value as typeof range;
		const url = new URL(window.location.href);
		url.searchParams.set('range', value);
		goto(url, { replaceState: true, noScroll: true });
	}

	const r = $derived(data.report);
	const funnelSteps = $derived([
		{ label: 'Clicks', value: r.funnel.clicks },
		{ label: 'Referrals', value: r.funnel.referrals },
		{ label: 'Installed', value: r.funnel.installed },
		{ label: 'Earning', value: r.funnel.earning }
	]);
	const funnelMax = $derived(Math.max(1, ...funnelSteps.map((s) => s.value)));
	const chargeMax = $derived(Math.max(1, ...r.byChargeType.map((c) => Math.abs(c.amountCents))));
</script>

<svelte:head><title>Reports · Bee Affiliates</title></svelte:head>

<PageHeader title="Reports">
	{#snippet actions()}
		<Select.Root type="single" value={range} onValueChange={changeRange}>
			<Select.Trigger class="w-40">{rangeLabel}</Select.Trigger>
			<Select.Content>
				{#each data.ranges as option (option.value)}
					<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{/snippet}
</PageHeader>

<div class="grid gap-4 px-5 pb-10 sm:px-8 lg:grid-cols-2">
	<ReportCard
		title="Commissions"
		total={money(r.commissionsCents)}
		points={r.commissionSeries}
		format={money}
	/>
	<ReportCard
		title="Lifetime attributed revenue"
		total={money(r.revenueCents)}
		points={r.revenueSeries}
		format={money}
	/>
	<ReportCard title="Referrals" total={String(r.referralCount)} points={r.referralSeries} />
	<ReportCard title="Payouts" total={money(r.payoutCents)} points={r.payoutSeries} format={money} />

	<Card.Root class="gap-0 p-0">
		<Card.Header class="px-5 pt-5 pb-0">
			<Card.Description class="text-sm">Commission breakdown</Card.Description>
			<Card.Title class="text-xl font-semibold tracking-tight">
				{r.byChargeType.length ? money(r.commissionsCents) : 'N/A'}
			</Card.Title>
		</Card.Header>
		<Card.Content class="px-5 pt-4 pb-5">
			{#if r.byChargeType.length === 0}
				<p class="py-12 text-center text-sm text-muted-foreground">
					No commissions in this period yet.
				</p>
			{:else}
				<div class="space-y-3">
					{#each r.byChargeType as row (row.chargeType)}
						<div>
							<div class="mb-1 flex items-center justify-between text-sm">
								<span>{CHARGE_TYPE_LABEL[row.chargeType as keyof typeof CHARGE_TYPE_LABEL] ?? row.chargeType}</span>
								<span class="tabular-nums">{money(row.amountCents)}</span>
							</div>
							<div class="h-1.5 overflow-hidden rounded-full bg-muted">
								<div
									class="h-full rounded-full bg-indigo-500"
									style="width: {(Math.abs(row.amountCents) / chargeMax) * 100}%"
								></div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root class="gap-0 p-0">
		<Card.Header class="px-5 pt-5 pb-0">
			<Card.Title class="text-base">Top referred shops</Card.Title>
		</Card.Header>
		<Card.Content class="px-5 pt-4 pb-5">
			{#if r.topReferrals.length === 0}
				<p class="py-12 text-center text-sm text-muted-foreground">No referred shops yet.</p>
			{:else}
				<div class="space-y-2.5">
					{#each r.topReferrals as referral (referral.shopDomain)}
						<div class="flex items-center justify-between gap-3 text-sm">
							<div class="min-w-0">
								<p class="truncate font-medium">{referral.shopDomain}</p>
								<p class="text-xs text-muted-foreground">{referral.appName}</p>
							</div>
							<span class="shrink-0 tabular-nums">{money(referral.lifetimeCommissionCents)}</span>
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root class="gap-0 p-0 lg:col-span-2">
		<Card.Header class="px-5 pt-5 pb-0">
			<Card.Description class="text-sm">Conversion funnel</Card.Description>
			<Card.Title class="text-xl font-semibold tracking-tight">
				{r.funnel.clicks ? `${((r.funnel.earning / r.funnel.clicks) * 100).toFixed(1)}%` : 'N/A'}
			</Card.Title>
		</Card.Header>
		<Card.Content class="px-5 pt-4 pb-5">
			{#if r.funnel.clicks === 0 && r.funnel.referrals === 0}
				<p class="py-12 text-center text-sm text-muted-foreground">
					No clicks or referrals in this period.
				</p>
			{:else}
				<div class="space-y-3">
					{#each funnelSteps as step (step.label)}
						<div>
							<div class="mb-1 flex items-center justify-between text-sm">
								<span>{step.label}</span>
								<span class="tabular-nums">{step.value}</span>
							</div>
							<div class="h-2 overflow-hidden rounded-full bg-muted">
								<div
									class="h-full rounded-full bg-indigo-500"
									style="width: {(step.value / funnelMax) * 100}%"
								></div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
