<script lang="ts">
	import { goto } from '$app/navigation';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import * as Table from '$lib/components/ui/table';
	import PageHeader from '$lib/components/page-header.svelte';
	import StatCard from '$lib/components/stat-card.svelte';
	import MrrChart from '$lib/components/mrr-chart.svelte';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import UsersIcon from '@lucide/svelte/icons/users';
	import HourglassIcon from '@lucide/svelte/icons/hourglass';
	import TrendingDownIcon from '@lucide/svelte/icons/trending-down';
	import { money, relativeTime } from '$lib/format';
	import { CHURN_REASON_LABEL, SUBSCRIPTION_EVENT_LABEL } from '$lib/constants';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const n = $derived(data.now);
	const c = $derived(data.churn);
	const appLabel = $derived(data.apps.find((a) => a.id === data.appId)?.name ?? 'All apps');

	const pct = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)}%`);
	const signed = (cents: number) => (cents === 0 ? '—' : `${cents > 0 ? '+' : '−'}${money(Math.abs(cents))}`);
	const monthLabel = (period: string) =>
		new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-US', {
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		});

	const rows = $derived([...data.movement].reverse());
	const hasLedger = $derived(data.movement.some((p) => p.mrr !== 0 || p.net !== 0 || p.trialsStarted));

	function pickApp(value: string) {
		const url = new URL(window.location.href);
		if (value && value !== 'all') url.searchParams.set('app', value);
		else url.searchParams.delete('app');
		goto(url, { replaceState: true, noScroll: true });
	}
</script>

<svelte:head><title>Subscriptions · Admin</title></svelte:head>

<PageHeader
	title="Subscriptions"
	description="MRR, what moved it, trials and churn. Built from the Partner charge history."
>
	{#snippet actions()}
		<Select.Root type="single" value={data.appId || 'all'} onValueChange={pickApp}>
			<Select.Trigger class="w-48">{appLabel}</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="All apps">All apps</Select.Item>
				{#each data.apps as app (app.id)}
					<Select.Item value={app.id} label={app.name}>{app.name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{/snippet}
</PageHeader>

<div class="space-y-5 px-5 pb-10 sm:px-8">
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		<StatCard
			label="MRR"
			value={money(n.mrrCents)}
			hint="{money(n.mrrCents * 12)} ARR"
			icon={RepeatIcon}
		/>
		<StatCard
			label="Paying shops"
			value={String(n.payingShops)}
			hint="{money(n.arpuCents)} ARPU"
			icon={UsersIcon}
		/>
		<StatCard
			label="On trial"
			value={String(n.trialShops)}
			hint="{money(n.trialPipelineCents)}/mo if they all convert"
			icon={HourglassIcon}
		/>
		<StatCard
			label="Revenue churn"
			value={pct(c.revenueChurnPct)}
			hint="Last {c.windowDays} days, incl. downgrades"
			icon={TrendingDownIcon}
		/>
	</div>

	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		<StatCard label="Subscription churn" value={pct(c.subscriptionChurnPct)} hint="Last {c.windowDays} days" />
		<StatCard label="Install churn" value={pct(c.logoChurnPct)} hint="Uninstalls net of reinstalls, free shops too" />
		<StatCard
			label="LTV"
			value={c.ltvCents === null ? '—' : money(c.ltvCents)}
			hint={c.ltvCents === null ? 'Needs some churn to estimate' : 'ARPU ÷ monthly revenue churn'}
		/>
		<StatCard label="Trial conversion" value={pct(c.trialConversionPct)} hint="Trials that ended in the last 90 days" />
	</div>

	<Card.Root class="gap-0 p-0">
		<Card.Header class="border-b px-5 py-4">
			<Card.Title class="text-base">MRR over time</Card.Title>
			<Card.Description>
				Month-end MRR for the last 12 months. Annual plans count 1/12 of their price. A trial
				counts once its first bill is due, and a frozen store counts nothing until it reopens.
			</Card.Description>
		</Card.Header>
		<Card.Content class="px-5 py-4">
			{#if hasLedger}
				<MrrChart points={data.movement} />
			{:else}
				<p class="py-12 text-center text-sm text-muted-foreground">
					No subscription history yet. It fills in after the next Partner sync.
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root class="gap-0 overflow-hidden p-0">
		<Card.Header class="border-b px-5 py-4">
			<Card.Title class="text-base">MRR movement</Card.Title>
			<Card.Description>
				What changed MRR each month. Each row adds up to Net. A plan change is an upgrade or a
				downgrade, not a cancellation.
			</Card.Description>
		</Card.Header>
		<Card.Content class="p-0">
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Month</Table.Head>
							<Table.Head class="text-right">New</Table.Head>
							<Table.Head class="text-right">Came back</Table.Head>
							<Table.Head class="text-right">Upgrades</Table.Head>
							<Table.Head class="text-right">Downgrades</Table.Head>
							<Table.Head class="text-right">Cancelled</Table.Head>
							<Table.Head class="text-right">Frozen</Table.Head>
							<Table.Head class="text-right">Net</Table.Head>
							<Table.Head class="text-right">MRR</Table.Head>
							<Table.Head class="text-right">Trials started</Table.Head>
							<Table.Head class="text-right">Trials converted</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each rows as p (p.period)}
							<Table.Row>
								<Table.Cell class="font-medium">{monthLabel(p.period)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{signed(p.new)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{signed(p.reactivated)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{signed(p.expansion)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{signed(p.contraction)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{signed(p.churned)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{signed(p.frozen)}</Table.Cell>
								<Table.Cell
									class="text-right font-medium tabular-nums {p.net < 0
										? 'text-red-600'
										: p.net > 0
											? 'text-emerald-600'
											: ''}"
								>
									{signed(p.net)}
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(p.mrr)}</Table.Cell>
								<Table.Cell class="text-right text-muted-foreground tabular-nums">
									{p.trialsStarted || '—'}
								</Table.Cell>
								<Table.Cell
									class="text-right text-muted-foreground tabular-nums"
									title={p.trialsCancelled ? `${p.trialsCancelled} cancelled during the trial` : undefined}
								>
									{p.trialsConverted || '—'}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</Card.Content>
	</Card.Root>

	<div class="grid gap-4 lg:grid-cols-2">
		{#if !data.appId}
			<Card.Root class="gap-0 overflow-hidden p-0">
				<Card.Header class="border-b px-5 py-4">
					<Card.Title class="text-base">MRR by app</Card.Title>
				</Card.Header>
				<Card.Content class="p-0">
					{#if data.byApp.length === 0}
						<p class="px-5 py-10 text-center text-sm text-muted-foreground">No paying subscriptions yet.</p>
					{:else}
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>App</Table.Head>
									<Table.Head class="text-right">Paying</Table.Head>
									<Table.Head class="text-right">MRR</Table.Head>
									<Table.Head class="text-right">Share</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each data.byApp as app (app.id)}
									<Table.Row>
										<Table.Cell>
											<a href="/admin/apps/{app.id}" class="font-medium hover:underline">{app.name}</a>
										</Table.Cell>
										<Table.Cell class="text-right tabular-nums">{app.subscriptions}</Table.Cell>
										<Table.Cell class="text-right tabular-nums">{money(app.mrrCents)}</Table.Cell>
										<Table.Cell class="text-right text-muted-foreground tabular-nums">
											{n.mrrCents ? `${((app.mrrCents / n.mrrCents) * 100).toFixed(0)}%` : '—'}
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root class="gap-0 overflow-hidden p-0 {data.appId ? 'lg:col-span-2' : ''}">
			<Card.Header class="border-b px-5 py-4">
				<Card.Title class="text-base">Latest changes</Card.Title>
			</Card.Header>
			<Card.Content class="p-0">
				{#if data.recent.length === 0}
					<p class="px-5 py-10 text-center text-sm text-muted-foreground">Nothing yet.</p>
				{:else}
					<ul class="divide-y">
						{#each data.recent as e (e.id)}
							<li class="flex items-center justify-between gap-3 px-5 py-3">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium">
										{SUBSCRIPTION_EVENT_LABEL[e.type] ?? e.type}
										<span class="font-normal text-muted-foreground">· {e.shopDomain}</span>
									</p>
									<p class="truncate text-xs text-muted-foreground">
										{e.appName}{e.planName ? ` · ${e.planName}` : ''}{e.churnReason &&
										e.type === 'churned'
											? ` · ${CHURN_REASON_LABEL[e.churnReason] ?? e.churnReason}`
											: ''}
									</p>
								</div>
								<div class="flex shrink-0 items-center gap-3">
									{#if e.mrrDeltaCents}
										<span
											class="text-sm font-medium tabular-nums {e.mrrDeltaCents < 0
												? 'text-red-600'
												: 'text-emerald-600'}"
										>
											{signed(e.mrrDeltaCents)}
										</span>
									{/if}
									<span class="text-xs text-muted-foreground">{relativeTime(e.occurredAt)}</span>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
</div>
