<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import PageHeader from '$lib/components/page-header.svelte';
	import StatCard from '$lib/components/stat-card.svelte';
	import ReportCard from '$lib/components/report-card.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import DollarIcon from '@lucide/svelte/icons/circle-dollar-sign';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import BuildingIcon from '@lucide/svelte/icons/building-2';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import UnplugIcon from '@lucide/svelte/icons/unplug';
	import UsersIcon from '@lucide/svelte/icons/users';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import HandCoinsIcon from '@lucide/svelte/icons/hand-coins';
	import PackageIcon from '@lucide/svelte/icons/package';
	import { money, relativeTime } from '$lib/format';
	import { REFERRAL_STATUS_LABEL, SOURCE_LABEL } from '$lib/constants';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const s = $derived(data.summary);
	const r = $derived(data.revenue);
	const m = $derived(data.merchants);

	const momChange = $derived(
		r.lastMonthGrossCents > 0
			? ((r.thisMonthGrossCents - r.lastMonthGrossCents) / r.lastMonthGrossCents) * 100
			: null
	);

	const momLabel = $derived(
		momChange === null
			? 'No prior month to compare'
			: `${momChange >= 0 ? '+' : ''}${momChange.toFixed(0)}% vs last month`
	);

	const grossSeries = $derived(data.series.map((p) => ({ period: p.period, value: p.gross })));
	const netSeries = $derived(data.series.map((p) => ({ period: p.period, value: p.net })));
</script>

<svelte:head><title>Overview · Admin</title></svelte:head>

<PageHeader title="Overview" description="Revenue, merchants and anything waiting on you." />

<div class="space-y-5 px-5 pb-10 sm:px-8">
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		<StatCard
			label="Gross revenue"
			value={money(r.grossCents)}
			hint="All apps, all time"
			icon={DollarIcon}
		/>
		<StatCard
			label="Net revenue"
			value={money(r.netCents)}
			hint="{money(r.shopifyFeeCents)} to Shopify"
			icon={WalletIcon}
		/>
		<StatCard
			label="This month"
			value={money(r.thisMonthGrossCents)}
			hint={momLabel}
			icon={TrendingUpIcon}
		/>
		{#if data.access.canViewAffiliates}
			<StatCard
				label="Affiliate commissions"
				value={money(s.commissionsPendingCents + s.commissionsApprovedCents + s.paidLifetimeCents)}
				hint="{money(s.payoutsDueCents)} ready to pay"
				icon={HandCoinsIcon}
			/>
		{/if}
	</div>

	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		<StatCard
			label="Merchants"
			value={String(m.total)}
			hint="{m.newThisMonth} new this month"
			icon={BuildingIcon}
		/>
		<StatCard label="Active installs" value={String(m.activeInstalls)} icon={PlugIcon} />
		<StatCard label="Churned" value={String(m.churnedInstalls)} icon={UnplugIcon} />
		{#if data.access.canViewAffiliates}
			<StatCard
				label="Affiliates"
				value={String(s.affiliatesTotal)}
				hint="{s.affiliatesPending} awaiting review"
				icon={UsersIcon}
			/>
		{/if}
	</div>

	<div class="grid gap-4 lg:grid-cols-2">
		<ReportCard
			title="Gross revenue"
			total={money(r.grossCents)}
			points={grossSeries}
			format={money}
		/>
		<ReportCard title="Net revenue" total={money(r.netCents)} points={netSeries} format={money} />
	</div>

	<Card.Root class="gap-0 p-0">
		<Card.Header class="border-b px-5 py-4">
			<Card.Title class="text-base">Revenue by app</Card.Title>
			<Card.Description>Every app in the program, referred installs and otherwise.</Card.Description>
			<Card.Action>
				<Button href="/admin/apps" variant="ghost" size="sm">Manage apps</Button>
			</Card.Action>
		</Card.Header>
		<Card.Content class="p-0">
			{#if data.perApp.length === 0}
				<p class="px-5 py-10 text-center text-sm text-muted-foreground">
					No apps yet. Add one to start tracking revenue.
				</p>
			{:else}
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>App</Table.Head>
								<Table.Head class="text-right">Installs</Table.Head>
								<Table.Head class="text-right">Churned</Table.Head>
								<Table.Head class="text-right">This month</Table.Head>
								<Table.Head class="text-right">Net</Table.Head>
								<Table.Head class="text-right">Gross</Table.Head>
								{#if data.access.canViewAffiliates}
									<Table.Head class="text-right">Commissions</Table.Head>
								{/if}
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.perApp as app (app.appId)}
								<Table.Row>
									<Table.Cell>
										<div class="flex items-center gap-2.5">
											{#if app.iconUrl}
												<img src={app.iconUrl} alt="" class="size-7 rounded-md object-cover" />
											{:else}
												<div
													class="flex size-7 items-center justify-center rounded-md bg-muted text-xs font-semibold"
												>
													{app.name.slice(0, 1)}
												</div>
											{/if}
											<div>
												<p class="font-medium">{app.name}</p>
												{#if app.status !== 'active'}
													<span class="text-xs text-muted-foreground">Paused</span>
												{/if}
											</div>
										</div>
									</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{app.activeInstalls}</Table.Cell>
									<Table.Cell class="text-right tabular-nums text-muted-foreground">
										{app.churnedInstalls}
									</Table.Cell>
									<Table.Cell class="text-right tabular-nums">
										{money(app.thisMonthGrossCents)}
									</Table.Cell>
									<Table.Cell class="text-right tabular-nums text-muted-foreground">
										{money(app.netCents)}
									</Table.Cell>
									<Table.Cell class="text-right font-medium tabular-nums">
										{money(app.grossCents)}
									</Table.Cell>
									{#if data.access.canViewAffiliates}
										<Table.Cell class="text-right tabular-nums text-muted-foreground">
											{money(app.commissionCents)}
										</Table.Cell>
									{/if}
								</Table.Row>
							{/each}
						</Table.Body>
						<Table.Footer>
							<Table.Row>
								<Table.Cell class="font-medium">Total</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{m.activeInstalls}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{m.churnedInstalls}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">
									{money(r.thisMonthGrossCents)}
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(r.netCents)}</Table.Cell>
								<Table.Cell class="text-right font-medium tabular-nums">
									{money(r.grossCents)}
								</Table.Cell>
								{#if data.access.canViewAffiliates}
									<Table.Cell class="text-right tabular-nums">
										{money(data.perApp.reduce((a, x) => a + x.commissionCents, 0))}
									</Table.Cell>
								{/if}
							</Table.Row>
						</Table.Footer>
					</Table.Root>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if data.access.canViewAffiliates}
	<div class="grid gap-4 lg:grid-cols-2">
		<Card.Root class="gap-0 p-0">
			<Card.Header class="border-b px-5 py-4">
				<Card.Title class="text-base">Affiliates awaiting approval</Card.Title>
				<Card.Action>
					<Button href="/admin/affiliates" variant="ghost" size="sm">View all</Button>
				</Card.Action>
			</Card.Header>
			<Card.Content class="p-0">
				{#if data.pendingAffiliates.length === 0}
					<p class="px-5 py-10 text-center text-sm text-muted-foreground">Nothing waiting.</p>
				{:else}
					<ul class="divide-y">
						{#each data.pendingAffiliates as affiliate (affiliate.id)}
							<li class="flex items-center justify-between gap-3 px-5 py-3">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium">{affiliate.name ?? affiliate.email}</p>
									<p class="truncate text-xs text-muted-foreground">
										{affiliate.company ?? affiliate.email}
									</p>
								</div>
								<div class="flex shrink-0 items-center gap-3">
									<span class="text-xs text-muted-foreground">
										{relativeTime(affiliate.createdAt)}
									</span>
									<Button href="/admin/affiliates/{affiliate.id}" size="sm" variant="outline">
										Review
									</Button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class="gap-0 p-0">
			<Card.Header class="border-b px-5 py-4">
				<Card.Title class="text-base">Claims to review</Card.Title>
				<Card.Action>
					<Button href="/admin/claims" variant="ghost" size="sm">View all</Button>
				</Card.Action>
			</Card.Header>
			<Card.Content class="p-0">
				{#if data.pendingClaims.length === 0}
					<p class="px-5 py-10 text-center text-sm text-muted-foreground">Nothing waiting.</p>
				{:else}
					<ul class="divide-y">
						{#each data.pendingClaims as claim (claim.id)}
							<li class="flex items-center justify-between gap-3 px-5 py-3">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium">{claim.shopDomain}</p>
									<p class="truncate text-xs text-muted-foreground">
										{claim.appName} · {claim.email}
									</p>
								</div>
								<span class="shrink-0 text-xs text-muted-foreground">
									{relativeTime(claim.createdAt)}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>

	<Card.Root class="gap-0 p-0">
		<Card.Header class="border-b px-5 py-4">
			<Card.Title class="text-base">Latest referrals</Card.Title>
			<Card.Action>
				<Button href="/admin/referrals" variant="ghost" size="sm">View all</Button>
			</Card.Action>
		</Card.Header>
		<Card.Content class="p-0">
			{#if data.recentReferrals.length === 0}
				<p class="px-5 py-10 text-center text-sm text-muted-foreground">No referrals yet.</p>
			{:else}
				<ul class="divide-y">
					{#each data.recentReferrals as referral (referral.id)}
						<li class="flex items-center justify-between gap-3 px-5 py-3">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{referral.shopDomain}</p>
								<p class="truncate text-xs text-muted-foreground">
									{referral.appName} · {referral.email} · {SOURCE_LABEL[referral.source]}
								</p>
							</div>
							<div class="flex shrink-0 items-center gap-3">
								<StatusBadge
									status={referral.status}
									label={REFERRAL_STATUS_LABEL[referral.status]}
								/>
								<span class="text-xs text-muted-foreground">
									{relativeTime(referral.createdAt)}
								</span>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</Card.Content>
	</Card.Root>
	{/if}
</div>
