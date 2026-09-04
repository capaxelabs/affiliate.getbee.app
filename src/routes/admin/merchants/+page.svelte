<script lang="ts">
	import { goto } from '$app/navigation';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as Select from '$lib/components/ui/select';
	import PageHeader from '$lib/components/page-header.svelte';
	import StatCard from '$lib/components/stat-card.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import SearchIcon from '@lucide/svelte/icons/search';
	import StoreIcon from '@lucide/svelte/icons/store';
	import UsersIcon from '@lucide/svelte/icons/users';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import UnplugIcon from '@lucide/svelte/icons/unplug';
	import MailIcon from '@lucide/svelte/icons/mail';
	import { humanize, money, shortDate } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let search = $state(data.search);
	let appId = $state(data.appId || 'all');
	let status = $state(data.status || 'all');

	const appLabel = $derived(
		appId === 'all' ? 'All apps' : (data.apps.find((a) => a.id === appId)?.name ?? 'All apps')
	);
	const statusLabel = $derived(
		status === 'all' ? 'All merchants' : status === 'installed' ? 'Installed' : 'Uninstalled'
	);

	function apply(next: Record<string, string>) {
		const url = new URL(window.location.href);
		for (const [key, value] of Object.entries(next)) {
			if (value && value !== 'all') url.searchParams.set(key, value);
			else url.searchParams.delete(key);
		}
		goto(url, { keepFocus: true, replaceState: true, noScroll: true });
	}

	let timer: ReturnType<typeof setTimeout>;
	function onSearch(value: string) {
		search = value;
		clearTimeout(timer);
		timer = setTimeout(() => apply({ q: value }), 250);
	}
</script>

<svelte:head><title>Merchants · Admin</title></svelte:head>

<PageHeader title="Merchants" description="Every shop that has installed one of your apps.">
	{#snippet actions()}
		<Select.Root
			type="single"
			bind:value={appId}
			onValueChange={(v) => {
				appId = v;
				apply({ app: v });
			}}
		>
			<Select.Trigger class="w-44">{appLabel}</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="All apps">All apps</Select.Item>
				{#each data.apps as app (app.id)}
					<Select.Item value={app.id} label={app.name}>{app.name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<Select.Root
			type="single"
			bind:value={status}
			onValueChange={(v) => {
				status = v;
				apply({ status: v });
			}}
		>
			<Select.Trigger class="w-40">{statusLabel}</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="All merchants">All merchants</Select.Item>
				<Select.Item value="installed" label="Installed">Installed</Select.Item>
				<Select.Item value="uninstalled" label="Uninstalled">Uninstalled</Select.Item>
			</Select.Content>
		</Select.Root>
	{/snippet}
</PageHeader>

<div class="space-y-5 px-5 pb-10 sm:px-8">
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
		<StatCard label="Merchants" value={String(data.totals.total)} icon={UsersIcon} />
		<StatCard label="Active installs" value={String(data.totals.activeInstalls)} icon={PlugIcon} />
		<StatCard label="Churned" value={String(data.totals.churnedInstalls)} icon={UnplugIcon} />
		<StatCard label="New this month" value={String(data.totals.newThisMonth)} icon={StoreIcon} />
		<StatCard
			label="Contactable"
			value={String(data.totals.withEmail)}
			hint="Have an email on file"
			icon={MailIcon}
		/>
	</div>

	<Card.Root class="gap-0 overflow-hidden p-0">
		<div class="relative border-b">
			<SearchIcon
				class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<input
				value={search}
				oninput={(e) => onSearch(e.currentTarget.value)}
				placeholder="Search by shop domain, name or email..."
				class="w-full bg-transparent py-3.5 pr-4 pl-11 text-sm outline-none placeholder:text-muted-foreground"
			/>
		</div>

		{#if data.installs.length === 0}
			<EmptyState
				icon={StoreIcon}
				title="No merchants yet"
				description="They appear as soon as your apps start posting installs to /api/track/install."
			/>
		{:else}
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Shop</Table.Head>
							<Table.Head>App</Table.Head>
							<Table.Head>Contact</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head>Installed</Table.Head>
							<Table.Head class="text-right">Revenue</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.installs as row (row.installId)}
							<Table.Row>
								<Table.Cell>
									<p class="font-medium">{row.shopName ?? row.shopDomain}</p>
									<p class="text-xs text-muted-foreground">
										{row.shopDomain}{row.country ? ` · ${row.country}` : ''}{row.shopifyPlan
											? ` · ${row.shopifyPlan}`
											: ''}
									</p>
								</Table.Cell>
								<Table.Cell class="text-muted-foreground">
									{row.appName}
									{#if row.referralId}
										<span class="mt-0.5 block text-xs text-indigo-600">Referred</span>
									{/if}
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
		{/if}
	</Card.Root>

	{#if data.installs.some((i) => i.uninstallFeedback)}
		<Card.Root class="gap-0 p-0">
			<Card.Header class="border-b px-5 py-4">
				<Card.Title class="text-base">Recent uninstall feedback</Card.Title>
				<Card.Description>What merchants told us when they left.</Card.Description>
			</Card.Header>
			<Card.Content class="p-0">
				<ul class="divide-y">
					{#each data.installs.filter((i) => i.uninstallFeedback).slice(0, 10) as row (row.installId)}
						<li class="px-5 py-3">
							<p class="text-sm">{row.uninstallFeedback}</p>
							<p class="mt-1 text-xs text-muted-foreground">
								{row.shopDomain} · {row.appName} · {shortDate(row.uninstalledAt)}
							</p>
						</li>
					{/each}
				</ul>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
