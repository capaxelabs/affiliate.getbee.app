<script lang="ts">
	import { goto } from '$app/navigation';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import PageHeader from '$lib/components/page-header.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import SearchIcon from '@lucide/svelte/icons/search';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { money, shortDate } from '$lib/format';
	import { AFFILIATE_STATUS_LABEL } from '$lib/constants';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let search = $state(data.search);
	let status = $state(data.status || 'all');

	const statusLabel = $derived(
		status === 'all' ? 'All statuses' : AFFILIATE_STATUS_LABEL[status as 'pending']
	);

	function apply(next: { q?: string; status?: string }) {
		const url = new URL(window.location.href);
		if (next.q !== undefined) {
			if (next.q) url.searchParams.set('q', next.q);
			else url.searchParams.delete('q');
		}
		if (next.status !== undefined) {
			if (next.status && next.status !== 'all') url.searchParams.set('status', next.status);
			else url.searchParams.delete('status');
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

<svelte:head><title>Affiliates · Admin</title></svelte:head>

<PageHeader title="Affiliates" description="Approve applications and manage rates.">
	{#snippet actions()}
		<Select.Root
			type="single"
			bind:value={status}
			onValueChange={(v) => {
				status = v;
				apply({ status: v });
			}}
		>
			<Select.Trigger class="w-44">{statusLabel}</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="All statuses">All statuses</Select.Item>
				<Select.Item value="pending" label="Awaiting approval">Awaiting approval</Select.Item>
				<Select.Item value="approved" label="Approved">Approved</Select.Item>
				<Select.Item value="rejected" label="Rejected">Rejected</Select.Item>
				<Select.Item value="suspended" label="Suspended">Suspended</Select.Item>
			</Select.Content>
		</Select.Root>
	{/snippet}
</PageHeader>

<div class="px-5 pb-10 sm:px-8">
	<Card.Root class="gap-0 overflow-hidden p-0">
		<div class="relative border-b">
			<SearchIcon
				class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<input
				value={search}
				oninput={(e) => onSearch(e.currentTarget.value)}
				placeholder="Search by name, email or referral code..."
				class="w-full bg-transparent py-3.5 pr-4 pl-11 text-sm outline-none placeholder:text-muted-foreground"
			/>
		</div>

		{#if data.affiliates.length === 0}
			<EmptyState icon={UsersIcon} title="No affiliates match those filters" />
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Affiliate</Table.Head>
						<Table.Head>Code</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Joined</Table.Head>
						<Table.Head class="text-right">Referrals</Table.Head>
						<Table.Head class="text-right">Earned</Table.Head>
						<Table.Head class="w-px"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.affiliates as affiliate (affiliate.id)}
						<Table.Row>
							<Table.Cell>
								<p class="font-medium">{affiliate.name ?? affiliate.email}</p>
								<p class="text-xs text-muted-foreground">
									{affiliate.company ? `${affiliate.company} · ` : ''}{affiliate.email}
								</p>
							</Table.Cell>
							<Table.Cell class="font-mono text-xs">{affiliate.refCode}</Table.Cell>
							<Table.Cell>
								<StatusBadge
									status={affiliate.status}
									label={AFFILIATE_STATUS_LABEL[affiliate.status]}
								/>
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{shortDate(affiliate.createdAt)}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{affiliate.referralCount}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{money(affiliate.earnedCents)}</Table.Cell>
							<Table.Cell class="text-right">
								<Button href="/admin/affiliates/{affiliate.id}" size="sm" variant="outline">
									{data.canWrite ? 'Open' : 'View'}
								</Button>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</Card.Root>
</div>
