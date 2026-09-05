<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import PageHeader from '$lib/components/page-header.svelte';
	import StatCard from '$lib/components/stat-card.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import ReportCard from '$lib/components/report-card.svelte';
	import Pagination from '$lib/components/pagination.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import StoreIcon from '@lucide/svelte/icons/store';
	import { money, shortDate, humanize, plural } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const app = $derived(data.app);
	const s = $derived(data.stats);

	const grossPoints = $derived(data.revenueSeries.map((p) => ({ period: p.period, value: p.gross })));
	const netPoints = $derived(data.revenueSeries.map((p) => ({ period: p.period, value: p.net })));
	const installPoints = $derived(
		data.lifecycleSeries.map((p) => ({ period: p.period, value: p.installed }))
	);
	const churnPoints = $derived(
		data.lifecycleSeries.map((p) => ({ period: p.period, value: p.uninstalled }))
	);

	const installsTotal = $derived(data.lifecycleSeries.reduce((sum, p) => sum + p.installed, 0));
	const churnTotal = $derived(data.lifecycleSeries.reduce((sum, p) => sum + p.uninstalled, 0));
</script>

<svelte:head><title>{app.name} · Admin</title></svelte:head>

<div class="px-5 pt-5 sm:px-8">
	<a
		href="/admin/apps"
		class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
	>
		<ArrowLeftIcon class="size-3.5" /> All apps
	</a>
</div>

<PageHeader
	title={app.name}
	description="{app.slug}{data.accountName ? ` · ${data.accountName}` : ''}"
>
	{#snippet leading()}
		{#if app.iconUrl}
			<img src={app.iconUrl} alt="" class="size-10 shrink-0 rounded-lg object-cover" />
		{:else}
			<div
				class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold"
			>
				{app.name.slice(0, 1)}
			</div>
		{/if}
	{/snippet}

	{#snippet actions()}
		<StatusBadge
			status={app.status === 'active' ? 'active' : 'paused'}
			label={app.status === 'active' ? 'Active' : 'Paused'}
		/>
		{#if app.affiliateEnabled}
			<StatusBadge status="approved" label="Affiliate on" />
		{/if}
		{#if app.listingUrl}
			<Button variant="outline" href={app.listingUrl} target="_blank" rel="noreferrer">
				<ExternalLinkIcon class="size-4" /> App Store
			</Button>
		{/if}
	{/snippet}
</PageHeader>

<div class="space-y-5 px-5 pb-10 sm:px-8">
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		<StatCard
			label="Gross revenue"
			value={money(s.grossCents)}
			hint={plural(s.transactionCount, 'transaction')}
		/>
		<StatCard label="Net revenue" value={money(s.netCents)} hint="after Shopify's cut" />
		<StatCard label="This month" value={money(s.thisMonthGrossCents)} hint="gross" />
		<StatCard
			label="Commissions"
			value={money(s.commissionCents)}
			hint={data.canViewAffiliates ? plural(s.referralCount, 'referral') : undefined}
		/>
	</div>

	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		<StatCard label="Active installs" value={String(s.activeInstalls)} icon={StoreIcon} />
		<StatCard
			label="Churned"
			value={String(s.churnedInstalls)}
			hint="{plural(s.totalInstalls, 'merchant')} ever"
		/>
		<StatCard
			label="Contactable"
			value={String(s.withEmail)}
			hint="of {s.totalInstalls} have an email"
		/>
		{#if data.canViewAffiliates}
			<StatCard label="Affiliate clicks" value={String(s.clickCount)} />
		{:else}
			<StatCard label="Merchants" value={String(s.totalInstalls)} />
		{/if}
	</div>

	<div class="grid gap-4 lg:grid-cols-2">
		<ReportCard
			title="Gross revenue"
			total={money(s.grossCents)}
			points={grossPoints}
			format={money}
		/>
		<ReportCard title="Net revenue" total={money(s.netCents)} points={netPoints} format={money} />
		<ReportCard title="Installs" total={String(installsTotal)} points={installPoints} />
		<ReportCard title="Uninstalls" total={String(churnTotal)} points={churnPoints} />
	</div>

	<Card.Root class="gap-0 overflow-hidden p-0">
		<Card.Header class="border-b px-5 py-4">
			<Card.Title class="text-base">Merchants</Card.Title>
			<Card.Description>Everyone who has installed {app.name}, newest first.</Card.Description>
		</Card.Header>

		{#if data.merchants.length === 0}
			<EmptyState
				icon={StoreIcon}
				title="No merchants yet"
				description="Installs appear here once the app reports one, or the Partner sync finds a billed shop."
			/>
		{:else}
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Shop</Table.Head>
							<Table.Head>Contact</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head>Plan</Table.Head>
							<Table.Head>Installed</Table.Head>
							<Table.Head class="text-right">Revenue</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.merchants as row (row.installId)}
							<Table.Row>
								<Table.Cell>
									<p class="font-medium">{row.shopName ?? row.shopDomain}</p>
									<p class="text-xs text-muted-foreground">
										{row.shopDomain}{row.country ? ` · ${row.country}` : ''}
									</p>
								</Table.Cell>
								<Table.Cell>
									{#if row.email}
										<a href="mailto:{row.email}" class="underline">{row.email}</a>
										{#if row.ownerName}
											<span class="block text-xs text-muted-foreground">{row.ownerName}</span>
										{/if}
									{:else}
										<span class="text-sm text-muted-foreground">—</span>
									{/if}
								</Table.Cell>
								<Table.Cell>
									<StatusBadge
										status={row.status === 'installed' ? 'active' : 'churned'}
										label={row.status === 'installed' ? 'Installed' : 'Uninstalled'}
									/>
									{#if row.uninstallReason}
										<span class="mt-0.5 block max-w-40 truncate text-xs text-muted-foreground">
											{humanize(row.uninstallReason)}
										</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-muted-foreground">
									{row.plan ?? row.shopifyPlan ?? '—'}
									{#if row.referralId}
										<span class="mt-0.5 block text-xs text-indigo-600">Referred</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-muted-foreground">
									{shortDate(row.installedAt)}
									{#if row.status === 'uninstalled' && row.uninstalledAt}
										<span class="block text-xs">left {shortDate(row.uninstalledAt)}</span>
									{:else if row.installCount > 1}
										<span class="block text-xs">reinstalled ×{row.installCount}</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(row.revenueCents)}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>

			<Pagination
				page={data.page}
				pageCount={data.pageCount}
				total={data.merchantCount}
				pageSize={data.pageSize}
				label="merchants"
			/>
		{/if}
	</Card.Root>
</div>
