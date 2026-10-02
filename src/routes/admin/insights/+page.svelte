<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import * as Table from '$lib/components/ui/table';
	import PageHeader from '$lib/components/page-header.svelte';
	import StatCard from '$lib/components/stat-card.svelte';
	import { money, relativeTime } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const TABS = [
		{ key: 'revenue', label: 'Revenue' },
		{ key: 'retention', label: 'Retention' },
		{ key: 'customers', label: 'Customers' },
		{ key: 'acquisition', label: 'Acquisition' },
		{ key: 'engagement', label: 'Engagement' }
	];
	const DIMENSIONS = [
		{ key: 'country', label: 'Country' },
		{ key: 'shopifyPlan', label: 'Shopify plan' },
		{ key: 'currency', label: 'Currency' }
	];
	const SURFACE_LABEL: Record<string, string> = {
		search: 'App Store search',
		category: 'App Store category',
		collection: 'App Store collection',
		home: 'App Store home',
		app_details: 'Another app’s listing',
		app_store: 'Other App Store pages',
		external: 'Other websites',
		direct: 'Direct, no referrer'
	};

	const appLabel = $derived(data.apps.find((a) => a.id === data.appId)?.name ?? 'All apps');

	function href(next: Record<string, string>) {
		const url = new URL(page.url);
		for (const [key, value] of Object.entries(next)) {
			if (value) url.searchParams.set(key, value);
			else url.searchParams.delete(key);
		}
		return `${url.pathname}${url.search}`;
	}

	const pct = (v: number | null | undefined, digits = 0) =>
		v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`;
	const monthLabel = (period: string) =>
		new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-US', {
			month: 'short',
			year: '2-digit',
			timeZone: 'UTC'
		});
	const dayLabel = (day: string) =>
		new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
	const days = (v: number | null) => (v === null ? '—' : `${Math.round(v)} days`);
	const shade = (v: number | null) =>
		v === null ? '' : `background: color-mix(in oklch, var(--chart-1) ${Math.round(v * 70)}%, transparent)`;
	const change = (now: number | null, before: number | null) => {
		if (now === null || before === null || now === before) return '';
		return now < before ? `▲ ${before - now}` : `▼ ${now - before}`;
	};
</script>

<svelte:head><title>Insights · Admin</title></svelte:head>

<PageHeader
	title="Insights"
	description="Revenue, retention, customers, acquisition and in-app engagement."
>
	{#snippet actions()}
		<Select.Root
			type="single"
			value={data.appId || 'all'}
			onValueChange={(v) => goto(href({ app: v === 'all' ? '' : v }), { noScroll: true })}
		>
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
	<nav class="flex gap-1 overflow-x-auto border-b">
		{#each TABS as t (t.key)}
			<a
				href={href({ tab: t.key })}
				data-sveltekit-noscroll
				class="-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors {data.tab ===
				t.key
					? 'border-foreground font-medium'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				{t.label}
			</a>
		{/each}
	</nav>

	{#if data.revenue}
		{@const r = data.revenue}
		{@const maxWeek = Math.max(1, ...r.flow.weeks.map((w) => Math.abs(w.net)))}
		<div class="grid gap-4 sm:grid-cols-3">
			<StatCard
				label="Due to bill in 30 days"
				value={money(r.flow.dueNext30dCents)}
				hint="{r.flow.dueNext30dCharges} live subscriptions, before Shopify's share"
			/>
			<StatCard
				label="Install to first payment"
				value={days(r.timing.daysToPay)}
				hint="Median of {r.timing.paidSample} paying shops"
			/>
			<StatCard
				label="First payment to cancel"
				value={days(r.timing.daysToCancel)}
				hint="Median of {r.timing.cancelSample} cancelled subscriptions"
			/>
		</div>

		<Card.Root class="gap-0 overflow-hidden p-0">
			<Card.Header class="border-b px-5 py-4">
				<Card.Title class="text-base">Revenue by type</Card.Title>
				<Card.Description>
					Gross billed per month by kind. Usage applied and credits issued count when they happen,
					before Shopify bills or deducts them.
				</Card.Description>
			</Card.Header>
			<Card.Content class="overflow-x-auto p-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Month</Table.Head>
							<Table.Head class="text-right">Subscriptions</Table.Head>
							<Table.Head class="text-right">One-time</Table.Head>
							<Table.Head class="text-right">Usage</Table.Head>
							<Table.Head class="text-right">Adjustments</Table.Head>
							<Table.Head class="text-right">Credits</Table.Head>
							<Table.Head class="text-right">Gross</Table.Head>
							<Table.Head class="text-right">Net</Table.Head>
							<Table.Head class="text-right">Usage applied</Table.Head>
							<Table.Head class="text-right">Credits issued</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each [...r.mix].reverse() as m (m.period)}
							<Table.Row>
								<Table.Cell class="font-medium">{monthLabel(m.period)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(m.subscriptions)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(m.oneTime)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(m.usage)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(m.adjustments)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(m.credits)}</Table.Cell>
								<Table.Cell class="text-right font-medium tabular-nums">{money(m.gross)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(m.net)}</Table.Cell>
								<Table.Cell class="text-right text-muted-foreground tabular-nums">
									{money(m.usageApplied)}
								</Table.Cell>
								<Table.Cell class="text-right text-muted-foreground tabular-nums">
									{money(m.creditsIssued)}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>

		<div class="grid gap-4 lg:grid-cols-2">
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-base">Net cash per week</Card.Title>
					<Card.Description>
						What reached your payouts, by the week Shopify dated it. The Partner API has no payout
						list, so this is built from transactions.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					{#if r.flow.weeks.length === 0}
						<p class="py-8 text-center text-sm text-muted-foreground">No transactions in 13 weeks.</p>
					{:else}
						<div class="flex h-40 items-end gap-1">
							{#each r.flow.weeks as w (w.week)}
								<div class="group flex h-full flex-1 flex-col justify-end gap-1">
									<div
										class="w-full rounded-t {w.net < 0 ? 'bg-red-400' : 'bg-indigo-500/85'}"
										style="height: {Math.max(2, (Math.abs(w.net) / maxWeek) * 100)}%"
										title="Week of {dayLabel(w.week)}: {money(w.net)}"
									></div>
									<span class="truncate text-center text-[10px] text-muted-foreground">
										{dayLabel(w.week)}
									</span>
								</div>
							{/each}
						</div>
					{/if}
				</Card.Content>
			</Card.Root>

			<Card.Root class="gap-0 overflow-hidden p-0">
				<Card.Header class="border-b px-5 py-4">
					<Card.Title class="text-base">MRR by plan</Card.Title>
				</Card.Header>
				<Card.Content class="p-0">
					{#if r.plans.length === 0}
						<p class="px-5 py-10 text-center text-sm text-muted-foreground">No paying subscriptions.</p>
					{:else}
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Plan</Table.Head>
									<Table.Head class="text-right">Paying</Table.Head>
									<Table.Head class="text-right">MRR</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each r.plans as plan, i (i)}
									<Table.Row>
										<Table.Cell>
											<span class="font-medium">{plan.plan ?? 'Unnamed plan'}</span>
											<span class="block text-xs text-muted-foreground">
												{plan.appName} · {plan.interval === 'annual' ? 'yearly' : 'monthly'}
											</span>
										</Table.Cell>
										<Table.Cell class="text-right tabular-nums">{plan.subscriptions}</Table.Cell>
										<Table.Cell class="text-right tabular-nums">{money(plan.mrr)}</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					{/if}
				</Card.Content>
			</Card.Root>
		</div>
	{/if}

	{#if data.retention}
		{@const ret = data.retention}
		{@const width = Math.max(1, ...ret.installs.map((c) => c.retained.length))}
		<Card.Root class="gap-0 overflow-hidden p-0">
			<Card.Header class="border-b px-5 py-4">
				<Card.Title class="text-base">Install retention</Card.Title>
				<Card.Description>
					Shops grouped by the month they first installed, and the share still installed at the end
					of each month after. A shop that left and came back counts again.
				</Card.Description>
			</Card.Header>
			<Card.Content class="overflow-x-auto p-0">
				{#if ret.installs.length === 0}
					<p class="px-5 py-10 text-center text-sm text-muted-foreground">No installs in 12 months.</p>
				{:else}
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Cohort</Table.Head>
								<Table.Head class="text-right">Shops</Table.Head>
								{#each Array.from({ length: width }) as _, i (i)}
									<Table.Head class="text-center">M{i}</Table.Head>
								{/each}
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each ret.installs as c (c.cohort)}
								<Table.Row>
									<Table.Cell class="font-medium">{monthLabel(c.cohort)}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{c.size}</Table.Cell>
									{#each Array.from({ length: width }) as _, i (i)}
										{@const v = c.retained[i] ?? null}
										<Table.Cell class="text-center text-xs tabular-nums" style={shade(v)}>
											{v === null ? '' : pct(v)}
										</Table.Cell>
									{/each}
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class="gap-0 overflow-hidden p-0">
			<Card.Header class="border-b px-5 py-4">
				<Card.Title class="text-base">Revenue retention</Card.Title>
				<Card.Description>
					Paying shops grouped by the month they first paid. Each cell is their MRR against what they
					started on, so upgrades push it past 100%. Hover a cell for the share still paying.
				</Card.Description>
			</Card.Header>
			<Card.Content class="overflow-x-auto p-0">
				{#if ret.revenue.length === 0}
					<p class="px-5 py-10 text-center text-sm text-muted-foreground">
						No new paying shops in 12 months.
					</p>
				{:else}
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Cohort</Table.Head>
								<Table.Head class="text-right">Shops</Table.Head>
								<Table.Head class="text-right">Starting MRR</Table.Head>
								{#each Array.from({ length: width }) as _, i (i)}
									<Table.Head class="text-center">M{i}</Table.Head>
								{/each}
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each ret.revenue as c (c.cohort)}
								<Table.Row>
									<Table.Cell class="font-medium">{monthLabel(c.cohort)}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{c.size}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{money(c.startingMrr)}</Table.Cell>
									{#each Array.from({ length: width }) as _, i (i)}
										{@const v = c.revenue[i] ?? null}
										<Table.Cell
											class="text-center text-xs tabular-nums"
											style={shade(v === null ? null : Math.min(1, v))}
											title={c.retained[i] === undefined ? undefined : `${pct(c.retained[i])} still paying`}
										>
											{v === null ? '' : pct(v)}
										</Table.Cell>
									{/each}
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if data.customers}
		{@const cu = data.customers}
		{@const maxReason = Math.max(1, ...cu.reasons.map((r) => r.count))}
		<Card.Root class="gap-0 overflow-hidden p-0">
			<Card.Header class="border-b px-5 py-4">
				<Card.Title class="text-base">Who installs and who pays</Card.Title>
				<Card.Description>
					From the shop details each app sends at install. Shops whose app never sent them show as
					Unknown.
				</Card.Description>
				<Card.Action>
					<div class="flex gap-1">
						{#each DIMENSIONS as d (d.key)}
							<a
								href={href({ by: d.key })}
								data-sveltekit-noscroll
								class="rounded-md px-2.5 py-1 text-xs {data.dimension === d.key
									? 'bg-muted font-medium'
									: 'text-muted-foreground hover:bg-muted/60'}"
							>
								{d.label}
							</a>
						{/each}
					</div>
				</Card.Action>
			</Card.Header>
			<Card.Content class="overflow-x-auto p-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>{DIMENSIONS.find((d) => d.key === data.dimension)?.label}</Table.Head>
							<Table.Head class="text-right">Installs ever</Table.Head>
							<Table.Head class="text-right">Live</Table.Head>
							<Table.Head class="text-right">Paying</Table.Head>
							<Table.Head class="text-right">Paying rate</Table.Head>
							<Table.Head class="text-right">MRR</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each cu.breakdown as row (row.value)}
							<Table.Row>
								<Table.Cell class="font-medium">{row.value}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{row.installs}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{row.live}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{row.paying}</Table.Cell>
								<Table.Cell class="text-right text-muted-foreground tabular-nums">
									{row.installs ? pct(row.paying / row.installs) : '—'}
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(row.mrr)}</Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell colspan={6} class="py-10 text-center text-muted-foreground">
									No installs yet.
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Why shops uninstalled</Card.Title>
				<Card.Description>
					Last 12 months. Your own exit survey wins over Shopify's dropdown when both exist.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-2">
				{#each cu.reasons as r (r.reason)}
					<div class="flex items-center gap-3 text-sm">
						<span class="w-56 shrink-0 truncate" title={r.reason}>{r.reason}</span>
						<span class="h-2 flex-1 overflow-hidden rounded-full bg-muted">
							<span
								class="block h-full rounded-full bg-indigo-500"
								style="width: {(r.count / maxReason) * 100}%"
							></span>
						</span>
						<span class="w-8 text-right tabular-nums text-muted-foreground">{r.count}</span>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">No uninstalls in 12 months.</p>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if data.acquisition}
		{@const a = data.acquisition}
		{#if a.traffic.bySurface.length === 0}
			<div class="rounded-lg border bg-background px-4 py-3 text-sm text-muted-foreground">
				No listing traffic yet. Connect GA4 on <a href="/admin/integrations" class="underline">Integrations</a>
				to see where visitors come from and which searches find you.
			</div>
		{:else}
			<div class="grid gap-4 lg:grid-cols-2">
				<Card.Root class="gap-0 overflow-hidden p-0">
					<Card.Header class="border-b px-5 py-4">
						<Card.Title class="text-base">Where listing visitors come from</Card.Title>
						<Card.Description>Distinct visitors over the last three months.</Card.Description>
					</Card.Header>
					<Card.Content class="p-0">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Source</Table.Head>
									<Table.Head class="text-right">Visitors</Table.Head>
									<Table.Head class="text-right">Add app clicks</Table.Head>
									<Table.Head class="text-right">Click rate</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each a.traffic.bySurface as s (s.surface)}
									<Table.Row>
										<Table.Cell class="font-medium">{SURFACE_LABEL[s.surface] ?? s.surface}</Table.Cell>
										<Table.Cell class="text-right tabular-nums">{s.views}</Table.Cell>
										<Table.Cell class="text-right tabular-nums">{s.clicks}</Table.Cell>
										<Table.Cell class="text-right text-muted-foreground tabular-nums">
											{s.views ? pct(s.clicks / s.views) : '—'}
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</Card.Content>
				</Card.Root>

				<Card.Root class="gap-0 overflow-hidden p-0">
					<Card.Header class="border-b px-5 py-4">
						<Card.Title class="text-base">Searches that found your listing</Card.Title>
						<Card.Description>What merchants typed in the App Store before clicking through.</Card.Description>
					</Card.Header>
					<Card.Content class="p-0">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Search</Table.Head>
									<Table.Head class="text-right">Visitors</Table.Head>
									<Table.Head class="text-right">Add app clicks</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each a.traffic.terms as t (t.term)}
									<Table.Row>
										<Table.Cell class="font-medium">{t.term}</Table.Cell>
										<Table.Cell class="text-right tabular-nums">{t.views}</Table.Cell>
										<Table.Cell class="text-right tabular-nums">{t.clicks}</Table.Cell>
									</Table.Row>
								{:else}
									<Table.Row>
										<Table.Cell colspan={3} class="py-8 text-center text-muted-foreground">
											No search traffic yet.
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</Card.Content>
				</Card.Root>
			</div>
		{/if}

		<Card.Root class="gap-0 overflow-hidden p-0">
			<Card.Header class="border-b px-5 py-4">
				<Card.Title class="text-base">App Store search rank</Card.Title>
				<Card.Description>
					Organic position for each keyword, checked daily across the first three result pages. ▲ is
					an improvement since a week ago.
					<a href="/admin/integrations" class="underline">Manage keywords and competitors</a>
				</Card.Description>
			</Card.Header>
			<Card.Content class="overflow-x-auto p-0">
				{#if a.ranks.keywords.length === 0}
					<p class="px-5 py-10 text-center text-sm text-muted-foreground">
						No keywords yet. Add the searches you want to rank for on Integrations.
					</p>
				{:else}
					{@const listings = a.ranks.keywords[0].positions}
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Keyword</Table.Head>
								{#each listings as l (l.handle)}
									<Table.Head class="text-right {l.own ? 'text-foreground' : ''}">{l.name}</Table.Head>
								{/each}
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each a.ranks.keywords as k (k.keywordId)}
								<Table.Row>
									<Table.Cell class="font-medium">{k.keyword}</Table.Cell>
									{#each k.positions as p (p.handle)}
										{@const delta = change(p.now, p.weekAgo)}
										<Table.Cell class="text-right tabular-nums {p.own ? 'font-medium' : 'text-muted-foreground'}">
											{p.now ?? '—'}
											{#if delta}
												<span class="ml-1 text-xs {delta.startsWith('▲') ? 'text-emerald-600' : 'text-red-600'}">
													{delta}
												</span>
											{/if}
										</Table.Cell>
									{/each}
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{/if}
			</Card.Content>
		</Card.Root>

		{#if a.ranks.competitors.length}
			<Card.Root class="gap-0 overflow-hidden p-0">
				<Card.Header class="border-b px-5 py-4">
					<Card.Title class="text-base">Competitors</Card.Title>
				</Card.Header>
				<Card.Content class="p-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>App</Table.Head>
								<Table.Head class="text-right">Rating</Table.Head>
								<Table.Head class="text-right">Reviews</Table.Head>
								<Table.Head class="text-right">New in 30 days</Table.Head>
								<Table.Head class="text-right">Checked</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each a.ranks.competitors as c (c.id)}
								<Table.Row>
									<Table.Cell>
										<a href="https://apps.shopify.com/{c.handle}" target="_blank" rel="noreferrer" class="font-medium hover:underline">
											{c.name ?? c.handle}
										</a>
									</Table.Cell>
									<Table.Cell class="text-right tabular-nums">
										{c.ratingHundredths === null ? '—' : (c.ratingHundredths / 100).toFixed(1)}
									</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{c.reviewCount ?? '—'}</Table.Cell>
									<Table.Cell class="text-right text-muted-foreground tabular-nums">
										{c.reviewCount !== null && c.reviewsMonthAgo !== null ? `+${c.reviewCount - c.reviewsMonthAgo}` : '—'}
									</Table.Cell>
									<Table.Cell class="text-right text-muted-foreground">
										{c.checkedAt ? relativeTime(c.checkedAt) : 'not yet'}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}

	{#if data.engagement}
		{@const e = data.engagement}
		{@const maxDay = Math.max(1, ...e.summary.daily.map((d) => d.shops))}
		{#if !e.summary.reporting}
			<div class="rounded-lg border bg-background px-4 py-3 text-sm text-muted-foreground">
				No in-app events yet. Each Bee app has to post them to <code>/api/track/event</code>; the
				snippet is on <a href="/admin/integrations" class="underline">Integrations</a>. Until then,
				the at-risk list below uses billing signals only.
			</div>
		{:else}
			<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				<StatCard label="Active shops today" value={String(e.summary.dau)} hint="Last 24 hours" />
				<StatCard label="Active this week" value={String(e.summary.wau)} />
				<StatCard label="Active this month" value={String(e.summary.mau)} />
				<StatCard
					label="Stickiness"
					value={e.summary.mau ? pct(e.summary.dau / e.summary.mau) : '—'}
					hint="Daily ÷ monthly active shops"
				/>
			</div>

			<div class="grid gap-4 lg:grid-cols-2">
				<Card.Root>
					<Card.Header>
						<Card.Title class="text-base">Active shops per day</Card.Title>
					</Card.Header>
					<Card.Content>
						<div class="flex h-36 items-end gap-0.5">
							{#each e.summary.daily as d (d.date)}
								<div
									class="flex-1 rounded-t bg-indigo-500/85"
									style="height: {Math.max(2, (d.shops / maxDay) * 100)}%"
									title="{dayLabel(d.date)}: {d.shops} shops"
								></div>
							{/each}
						</div>
					</Card.Content>
				</Card.Root>

				<Card.Root class="gap-0 overflow-hidden p-0">
					<Card.Header class="border-b px-5 py-4">
						<Card.Title class="text-base">Most used, last 30 days</Card.Title>
					</Card.Header>
					<Card.Content class="p-0">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Event</Table.Head>
									<Table.Head class="text-right">Shops</Table.Head>
									<Table.Head class="text-right">Times</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each e.summary.topEvents as t (t.name)}
									<Table.Row>
										<Table.Cell class="font-mono text-xs">{t.name}</Table.Cell>
										<Table.Cell class="text-right tabular-nums">{t.shops}</Table.Cell>
										<Table.Cell class="text-right tabular-nums">{t.events}</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</Card.Content>
				</Card.Root>
			</div>
		{/if}

		{#if e.activation.length}
			<Card.Root class="gap-0 overflow-hidden p-0">
				<Card.Header class="border-b px-5 py-4">
					<Card.Title class="text-base">Activation</Card.Title>
					<Card.Description>
						Shops installed in the last 90 days that reached the app's activation event within 14 days.
					</Card.Description>
				</Card.Header>
				<Card.Content class="p-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>App</Table.Head>
								<Table.Head>Event</Table.Head>
								<Table.Head class="text-right">Installs</Table.Head>
								<Table.Head class="text-right">Activated</Table.Head>
								<Table.Head class="text-right">Rate</Table.Head>
								<Table.Head class="text-right">Median time</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each e.activation as act (act.app)}
								<Table.Row>
									<Table.Cell class="font-medium">{act.app}</Table.Cell>
									<Table.Cell class="font-mono text-xs">{act.event}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{act.installs}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{act.activated}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">
										{act.ratePct === null ? '—' : `${act.ratePct.toFixed(0)}%`}
									</Table.Cell>
									<Table.Cell class="text-right text-muted-foreground tabular-nums">
										{act.medianHours === null
											? '—'
											: act.medianHours < 48
												? `${Math.round(act.medianHours)} h`
												: `${Math.round(act.medianHours / 24)} days`}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root class="gap-0 overflow-hidden p-0">
			<Card.Header class="border-b px-5 py-4">
				<Card.Title class="text-base">At risk</Card.Title>
				<Card.Description>
					Paying or trialling shops showing a sign they may leave, most signs first.
				</Card.Description>
			</Card.Header>
			<Card.Content class="p-0">
				{#if e.risk.length === 0}
					<p class="px-5 py-10 text-center text-sm text-muted-foreground">Nobody looks at risk right now.</p>
				{:else}
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Shop</Table.Head>
								<Table.Head>Signs</Table.Head>
								<Table.Head class="text-right">MRR at stake</Table.Head>
								<Table.Head class="text-right">Last active</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each e.risk as row (row.appId + row.shopDomain)}
								<Table.Row>
									<Table.Cell>
										<span class="font-medium">{row.shopDomain}</span>
										<span class="block text-xs text-muted-foreground">{row.appName}</span>
									</Table.Cell>
									<Table.Cell class="text-sm">{row.reasons.join(' · ')}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{money(row.mrrCents)}</Table.Cell>
									<Table.Cell class="text-right text-muted-foreground">
										{row.lastActiveAt ? relativeTime(row.lastActiveAt) : '—'}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>
