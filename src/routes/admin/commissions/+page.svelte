<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import PageHeader from '$lib/components/page-header.svelte';
	import StatCard from '$lib/components/stat-card.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import ReceiptIcon from '@lucide/svelte/icons/receipt';
	import { money, percent, shortDate } from '$lib/format';
	import { CHARGE_TYPE_LABEL, COMMISSION_STATUS_LABEL } from '$lib/constants';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let status = $state(data.status);
	const statusLabel = $derived(
		status === 'all' ? 'All statuses' : COMMISSION_STATUS_LABEL[status as 'pending']
	);

	function changeStatus(value: string) {
		status = value as typeof status;
		const url = new URL(window.location.href);
		if (value === 'all') url.searchParams.delete('status');
		else url.searchParams.set('status', value);
		goto(url, { replaceState: true, noScroll: true });
	}

	const act = () => async ({ result, update }: any) => {
		if (result.type === 'success') toast.success(result.data?.message ?? 'Done.');
		if (result.type === 'failure') toast.error(result.data?.error ?? 'That did not work.');
		await update();
	};
</script>

<svelte:head><title>Commissions · Admin</title></svelte:head>

<PageHeader title="Commissions" description="One line per billed Partner transaction.">
	{#snippet actions()}
		{#if data.canWrite}
			<form method="POST" action="?/release" use:enhance={act}>
				<Button type="submit" variant="outline">Clear matured</Button>
			</form>
		{/if}
		<Select.Root type="single" value={status} onValueChange={changeStatus}>
			<Select.Trigger class="w-40">{statusLabel}</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="All statuses">All statuses</Select.Item>
				<Select.Item value="pending" label="Pending">Pending</Select.Item>
				<Select.Item value="approved" label="Approved">Approved</Select.Item>
				<Select.Item value="paid" label="Paid">Paid</Select.Item>
				<Select.Item value="void" label="Void">Void</Select.Item>
			</Select.Content>
		</Select.Root>
	{/snippet}
</PageHeader>

<div class="space-y-5 px-5 pb-10 sm:px-8">
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		<StatCard label="Held" value={money(data.totals.pending ?? 0)} hint="Inside refund window" />
		<StatCard label="Cleared" value={money(data.totals.approved ?? 0)} hint="Ready for payout" />
		<StatCard label="Paid" value={money(data.totals.paid ?? 0)} />
		<StatCard label="Void" value={money(data.totals.void ?? 0)} />
	</div>

	<Card.Root class="gap-0 overflow-hidden p-0">
		{#if data.commissions.length === 0}
			<EmptyState
				icon={ReceiptIcon}
				title="No commissions"
				description="They appear once the Partner sync matches a transaction to a referral."
			/>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Date</Table.Head>
						<Table.Head>Shop</Table.Head>
						<Table.Head>App</Table.Head>
						<Table.Head>Affiliate</Table.Head>
						<Table.Head>Type</Table.Head>
						<Table.Head class="text-right">Net</Table.Head>
						<Table.Head class="text-right">Rate</Table.Head>
						<Table.Head class="text-right">Commission</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="w-px"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.commissions as commission (commission.id)}
						<Table.Row>
							<Table.Cell class="text-muted-foreground">
								{shortDate(commission.occurredAt)}
							</Table.Cell>
							<Table.Cell class="font-medium">{commission.shopDomain}</Table.Cell>
							<Table.Cell class="text-muted-foreground">{commission.appName}</Table.Cell>
							<Table.Cell>
								<a href="/admin/affiliates/{commission.affiliateId}" class="underline">
									{commission.affiliateName ?? commission.affiliateEmail}
								</a>
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">
								{CHARGE_TYPE_LABEL[commission.chargeType]}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{money(commission.netAmountCents)}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{percent(commission.commissionBps)}
							</Table.Cell>
							<Table.Cell class="text-right font-medium tabular-nums">
								{money(commission.amountCents)}
							</Table.Cell>
							<Table.Cell>
								<StatusBadge
									status={commission.status}
									label={COMMISSION_STATUS_LABEL[commission.status]}
								/>
								{#if commission.status === 'pending'}
									<span class="mt-0.5 block text-xs text-muted-foreground">
										clears {shortDate(commission.availableAt)}
									</span>
								{/if}
							</Table.Cell>
							<Table.Cell>
								<div class="flex justify-end gap-1">
									{#if data.canWrite && commission.status === 'pending'}
										<form method="POST" action="?/approve" use:enhance={act}>
											<input type="hidden" name="id" value={commission.id} />
											<Button type="submit" size="sm" variant="ghost">Clear</Button>
										</form>
									{/if}
									{#if data.canWrite && commission.status !== 'paid' && commission.status !== 'void'}
										<form method="POST" action="?/void" use:enhance={act}>
											<input type="hidden" name="id" value={commission.id} />
											<Button type="submit" size="sm" variant="ghost">Void</Button>
										</form>
									{/if}
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</Card.Root>

	{#if form?.error}
		<p class="text-sm text-destructive">{form.error}</p>
	{/if}
</div>
