<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import PageHeader from '$lib/components/page-header.svelte';
	import StatCard from '$lib/components/stat-card.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import ReportCard from '$lib/components/report-card.svelte';
	import MrrChart from '$lib/components/mrr-chart.svelte';
	import Pagination from '$lib/components/pagination.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import StoreIcon from '@lucide/svelte/icons/store';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import { INSTALL_STATUS_LABEL, money, shortDate, humanize, plural } from '$lib/format';
	import { CHURN_REASON_LABEL } from '$lib/constants';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let importForm = $state<HTMLFormElement | null>(null);
	let importOffset = $state(0);
	let importing = $state(false);

	/**
	 * A big export cannot be applied in one Worker request, so the same file is
	 * re-sent with a growing offset until the server reports it is done. The
	 * file input keeps its selection across requestSubmit, which is what makes
	 * the loop possible.
	 */
	const runImport = () => {
		importing = true;
		return async ({ result }: any) => {
			if (result.type === 'success' && result.data?.success) {
				if (result.data.done) {
					importing = false;
					importOffset = 0;
					if (importForm) importForm.reset();
					toast.success(result.data.message);
					await invalidateAll();
				} else {
					importOffset = result.data.nextOffset;
					toast.info(result.data.message);
					setTimeout(() => importForm?.requestSubmit(), 200);
				}
			} else {
				importing = false;
				importOffset = 0;
				toast.error(result.data?.error ?? 'Import failed.');
			}
		};
	};

	// billingOn is stamped when the charge activates and never moves, so once the
	// date passes it says nothing about the next bill.
	const upcoming = (value: Date | null) => Boolean(value && value.getTime() > Date.now());

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

	const sub = $derived(data.subscriptions);
	const hasLedger = $derived(data.movement.some((p) => p.mrr !== 0 || p.net !== 0));
	const trialsStarted = $derived(data.movement.reduce((a, p) => a + p.trialsStarted, 0));
	const trialsConverted = $derived(data.movement.reduce((a, p) => a + p.trialsConverted, 0));

	type FunnelKey =
		| 'listingViews'
		| 'addAppClicks'
		| 'affiliateClicks'
		| 'installs'
		| 'activated'
		| 'trialsStarted'
		| 'newPaying';
	const funnelSteps = $derived<{ key: FunnelKey; label: string; unit: string }[]>([
		...(data.funnel.measured
			? [
					{ key: 'listingViews' as const, label: 'Listing views', unit: 'visitors' },
					{ key: 'addAppClicks' as const, label: 'Add app clicks', unit: 'visitors' }
				]
			: []),
		...(data.canViewAffiliates
			? [{ key: 'affiliateClicks' as const, label: 'Affiliate link clicks', unit: 'clicks' }]
			: []),
		{ key: 'installs', label: 'Installs', unit: 'shops' },
		...(data.app.activationEvent
			? [{ key: 'activated' as const, label: 'Activated', unit: 'shops, within 14 days' }]
			: []),
		{ key: 'trialsStarted', label: 'Trials started', unit: 'shops' },
		{ key: 'newPaying', label: 'New paying', unit: 'shops' }
	]);
	const monthShort = (period: string) =>
		new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
	/** Step-over-step rate. Affiliate clicks are a side channel, not a step. */
	const rate = (num: number | null, den: number | null) =>
		num === null || den === null || !den ? '' : `${Math.round((num / den) * 100)}%`;

	const installsTotal = $derived(data.lifecycleSeries.reduce((sum, p) => sum + p.installed, 0));
	const churnTotal = $derived(data.lifecycleSeries.reduce((sum, p) => sum + p.uninstalled, 0));

	// Derived from the URL rather than held locally, so going Back moves the
	// controls too instead of leaving them showing a filter that is no longer on.
	const status = $derived(data.filters.status || 'all');
	const country = $derived(data.filters.country || 'all');
	const plan = $derived(data.filters.plan || 'all');
	const attribution = $derived(data.filters.attribution || 'all');

	// The one exception: the text box has to stay responsive while typing, so it
	// keeps its own copy and re-syncs whenever the loaded data changes.
	let search = $state(data.filters.search);
	$effect(() => {
		search = data.filters.search;
	});

	const statusLabel = $derived(
		status === 'all' ? 'Any status' : (INSTALL_STATUS_LABEL[status] ?? 'Any status')
	);
	const countryLabel = $derived(country === 'all' ? 'Any country' : country);
	const planLabel = $derived(plan === 'all' ? 'Any plan' : plan);
	const attributionLabel = $derived(
		attribution === 'all' ? 'Any source' : attribution === 'referred' ? 'Referred' : 'Organic'
	);

	/** Changing a filter always returns to page 1 — page 3 of the old set is meaningless. */
	function apply(next: Record<string, string>) {
		const url = new URL(window.location.href);
		for (const [key, value] of Object.entries(next)) {
			if (value && value !== 'all') url.searchParams.set(key, value);
			else url.searchParams.delete(key);
		}
		url.searchParams.delete('page');
		goto(url, { keepFocus: true, replaceState: true, noScroll: true });
	}

	let timer: ReturnType<typeof setTimeout>;
	function onSearch(value: string) {
		search = value;
		clearTimeout(timer);
		timer = setTimeout(() => apply({ q: value }), 250);
	}

	function clearFilters() {
		search = '';
		apply({ q: '', status: '', country: '', plan: '', referred: '' });
	}
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

	<Card.Root class="gap-0 p-0">
		<Card.Header class="border-b px-5 py-4">
			<Card.Title class="text-base">MRR</Card.Title>
			<Card.Description>
				{sub.payingShops} paying · {money(sub.arpuCents)} ARPU · {sub.trialShops} on trial worth
				{money(sub.trialPipelineCents)}/mo · {trialsConverted} of {trialsStarted} trials converted in
				12 months.
				<a href="/admin/subscriptions?app={app.id}" class="underline">Open the subscription report</a>
			</Card.Description>
			<Card.Action>
				<span class="text-sm font-medium tabular-nums">{money(sub.mrrCents)}/mo</span>
			</Card.Action>
		</Card.Header>
		<Card.Content class="px-5 py-4">
			{#if hasLedger}
				<MrrChart points={data.movement} class="h-48" />
			{:else}
				<p class="py-10 text-center text-sm text-muted-foreground">
					No paying subscriptions in the last 12 months.
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root class="gap-0 overflow-hidden p-0">
		<Card.Header class="border-b px-5 py-4">
			<Card.Title class="text-base">Install funnel</Card.Title>
			<Card.Description>
				{#if data.funnel.measured}
					Listing views and Add app clicks count visitors from GA4. The steps below count shops
					from Shopify, so the rate between the two is a trend, not an exact conversion.
				{:else}
					From install to paying customer. Add this app's GA4 dataset on the
					<a href="/admin/integrations" class="underline">Integrations</a> page to see listing
					views and Add app clicks above it.
				{/if}
			</Card.Description>
		</Card.Header>
		<Card.Content class="p-0">
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Step</Table.Head>
							{#each data.funnel.points as p (p.period)}
								<Table.Head class="text-right">{monthShort(p.period)}</Table.Head>
							{/each}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each funnelSteps as step, i (step.key)}
							{@const prev = funnelSteps.slice(0, i).filter((s) => s.key !== 'affiliateClicks').at(-1)}
							<Table.Row>
								<Table.Cell>
									<span class="font-medium">{step.label}</span>
									<span class="block text-xs text-muted-foreground">{step.unit}</span>
								</Table.Cell>
								{#each data.funnel.points as p (p.period)}
									{@const value = p[step.key]}
									{@const ratio = step.key !== 'affiliateClicks' && prev ? rate(value, p[prev.key]) : ''}
									<Table.Cell class="text-right tabular-nums">
										{value ?? '—'}
										{#if ratio}
											<span class="block text-xs text-muted-foreground">{ratio}</span>
										{/if}
									</Table.Cell>
								{/each}
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</Card.Content>
	</Card.Root>

	{#if data.charges.length}
		<Card.Root class="gap-0 overflow-hidden p-0">
			<Card.Header class="border-b px-5 py-4">
				<Card.Title class="text-base">Charges</Card.Title>
				<Card.Description>
					Every charge Shopify reported, newest first. A trial shows when its first bill is due,
					and a plan change shows on the charge it replaced. Gross revenue only moves once
					Shopify pays the bill out.
				</Card.Description>
				{#if s.mrrCents}
					<Card.Action>
						<span class="text-sm font-medium tabular-nums">{money(s.mrrCents)}/mo</span>
					</Card.Action>
				{/if}
			</Card.Header>
			<Card.Content class="p-0">
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Shop</Table.Head>
								<Table.Head>Plan</Table.Head>
								<Table.Head class="text-right">Amount</Table.Head>
								<Table.Head class="text-right">Per month</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head class="text-right">Bills on</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.charges as charge (charge.id)}
								<Table.Row>
									<Table.Cell class="font-medium">{charge.shopDomain}</Table.Cell>
									<Table.Cell class="text-muted-foreground">
										{charge.name ?? '—'}
										{#if charge.kind === 'one_time'}
											<span class="ml-1 text-xs">(one-time)</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="text-right tabular-nums">
										{money(charge.amountCents, charge.currency)}
										{#if charge.kind === 'recurring'}
											<span class="block text-xs text-muted-foreground">
												{charge.billingInterval === 'annual' ? 'yearly' : 'monthly'}
											</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="text-right text-muted-foreground tabular-nums">
										{charge.kind === 'recurring' ? money(charge.monthlyAmountCents, charge.currency) : '—'}
									</Table.Cell>
									<Table.Cell>
										<StatusBadge
											status={charge.status === 'active'
												? 'active'
												: charge.status === 'pending' || charge.status === 'frozen'
													? 'pending'
													: 'churned'}
											label={humanize(charge.status)}
										/>
										{#if charge.trialStatus === 'in_trial'}
											<span class="mt-0.5 block text-xs text-amber-600">
												On trial until {shortDate(charge.trialEndsAt)}
											</span>
										{:else if charge.trialStatus === 'converted'}
											<span class="mt-0.5 block text-xs text-muted-foreground">Converted from trial</span>
										{:else if charge.trialStatus === 'cancelled'}
											<span class="mt-0.5 block text-xs text-muted-foreground">Cancelled in trial</span>
										{/if}
										{#if charge.churnReason && charge.churnReason !== 'cancelled'}
											<span class="mt-0.5 block text-xs text-muted-foreground">
												{CHURN_REASON_LABEL[charge.churnReason]}
											</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="text-right text-muted-foreground tabular-nums">
										{charge.status === 'active' && upcoming(charge.billingOn)
											? shortDate(charge.billingOn)
											: '—'}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Import history</Card.Title>
			<Card.Description>
				Upload the app-history CSV from the Partner dashboard (App → Insights → App
				history → Export). The API sync reaches back two years; the export carries
				everything, so this is how an older app gets its full install, churn and charge
				history in. Safe to re-run — rows already known are skipped.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/importHistory"
				enctype="multipart/form-data"
				use:enhance={runImport}
				bind:this={importForm}
				class="flex flex-wrap items-center gap-2"
			>
				<input type="hidden" name="offset" value={importOffset} />
				<input
					type="file"
					name="history"
					accept=".csv,text/csv"
					required
					disabled={importing}
					class="max-w-xs text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
				/>
				<Button type="submit" size="sm" variant="outline" disabled={importing}>
					<UploadIcon class="size-3.5" />
					{importing ? 'Importing…' : 'Import CSV'}
				</Button>
			</form>
		</Card.Content>
	</Card.Root>

	<Card.Root class="gap-0 overflow-hidden p-0">
		<Card.Header class="border-b px-5 py-4">
			<Card.Title class="text-base">Merchants</Card.Title>
			<Card.Description>
				{#if data.filters.any}
					{plural(data.merchantCount, 'match', 'matches')} of {plural(s.totalInstalls, 'merchant')}.
				{:else}
					Everyone who has installed {app.name}, newest first.
				{/if}
			</Card.Description>
		</Card.Header>

		<div class="flex flex-wrap items-center gap-2 border-b px-5 py-3">
			<div class="relative min-w-56 flex-1">
				<SearchIcon
					class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					value={search}
					oninput={(e) => onSearch(e.currentTarget.value)}
					placeholder="Shop, name, email or owner"
					class="pl-8"
				/>
			</div>

			<Select.Root
				type="single"
				value={status}
				onValueChange={(v) => apply({ status: v })}
			>
				<Select.Trigger class="w-36">{statusLabel}</Select.Trigger>
				<Select.Content>
					<Select.Item value="all" label="Any status">Any status</Select.Item>
					<Select.Item value="installed" label="Installed">Installed</Select.Item>
					<Select.Item value="uninstalled" label="Uninstalled">Uninstalled</Select.Item>
					<Select.Item value="closed" label="Store closed">Store closed</Select.Item>
				</Select.Content>
			</Select.Root>

			{#if data.countries.length > 1}
				<Select.Root
					type="single"
					value={country}
					onValueChange={(v) => apply({ country: v })}
				>
					<Select.Trigger class="w-36">{countryLabel}</Select.Trigger>
					<Select.Content>
						<Select.Item value="all" label="Any country">Any country</Select.Item>
						{#each data.countries as code (code)}
							<Select.Item value={code} label={code}>{code}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}

			{#if data.plans.length > 1}
				<Select.Root
					type="single"
					value={plan}
					onValueChange={(v) => apply({ plan: v })}
				>
					<Select.Trigger class="w-36">{planLabel}</Select.Trigger>
					<Select.Content>
						<Select.Item value="all" label="Any plan">Any plan</Select.Item>
						{#each data.plans as name (name)}
							<Select.Item value={name} label={name}>{name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}

			{#if data.canViewAffiliates}
				<Select.Root
					type="single"
					value={attribution}
					onValueChange={(v) => apply({ referred: v })}
				>
					<Select.Trigger class="w-36">{attributionLabel}</Select.Trigger>
					<Select.Content>
						<Select.Item value="all" label="Any source">Any source</Select.Item>
						<Select.Item value="referred" label="Referred">Referred</Select.Item>
						<Select.Item value="organic" label="Organic">Organic</Select.Item>
					</Select.Content>
				</Select.Root>
			{/if}

			{#if data.filters.any}
				<Button variant="ghost" size="sm" onclick={clearFilters}>Clear</Button>
			{/if}
		</div>

		{#if data.merchants.length === 0}
			<EmptyState
				icon={StoreIcon}
				title={data.filters.any ? 'No merchants match' : 'No merchants yet'}
				description={data.filters.any
					? 'Try a different search or clear the filters.'
					: 'Installs appear here once the app reports one, or the Partner sync finds a billed shop.'}
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
										label={INSTALL_STATUS_LABEL[row.status] ?? row.status}
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
