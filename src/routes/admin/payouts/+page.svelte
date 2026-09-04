<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import PageHeader from '$lib/components/page-header.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import CardIcon from '@lucide/svelte/icons/credit-card';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { money, shortDate } from '$lib/format';
	import { PAYOUT_STATUS_LABEL } from '$lib/constants';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let references = $state<Record<string, string>>({});

	const act = () => async ({ result, update }: any) => {
		if (result.type === 'success') toast.success(result.data?.message ?? 'Done.');
		if (result.type === 'failure') toast.error(result.data?.error ?? 'That did not work.');
		await update();
	};
</script>

<svelte:head><title>Payouts · Admin</title></svelte:head>

<PageHeader title="Payouts" description="Bundle cleared commissions and record what you sent." />

<div class="space-y-5 px-5 pb-10 sm:px-8">
	<Card.Root class="gap-0 p-0">
		<Card.Header class="border-b px-5 py-4">
			<Card.Title class="text-base">Ready to pay</Card.Title>
			<Card.Description>
				Affiliates with cleared commissions not yet in a payout.
			</Card.Description>
		</Card.Header>
		<Card.Content class="p-0">
			{#if data.ready.length === 0}
				<p class="px-5 py-10 text-center text-sm text-muted-foreground">
					Nothing cleared for payout right now.
				</p>
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Affiliate</Table.Head>
							<Table.Head>Method</Table.Head>
							<Table.Head class="text-right">Lines</Table.Head>
							<Table.Head class="text-right">Minimum</Table.Head>
							<Table.Head class="text-right">Due</Table.Head>
							<Table.Head class="w-px"></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.ready as row (row.affiliateId)}
							{@const belowMinimum = row.dueCents < row.minPayoutCents}
							<Table.Row>
								<Table.Cell>
									<a href="/admin/affiliates/{row.affiliateId}" class="font-medium underline">
										{row.name ?? row.email}
									</a>
									<p class="text-xs text-muted-foreground">{row.email}</p>
								</Table.Cell>
								<Table.Cell class="capitalize">
									{#if row.payoutMethod}
										{row.payoutMethod}
										{#if row.payoutEmail}
											<span class="block text-xs text-muted-foreground">{row.payoutEmail}</span>
										{/if}
									{:else}
										<span
											class="inline-flex items-center gap-1 text-sm text-amber-600"
											title="They haven't set payout details"
										>
											<TriangleAlertIcon class="size-3.5" /> Not set
										</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{row.lineCount}</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-muted-foreground">
									{money(row.minPayoutCents)}
								</Table.Cell>
								<Table.Cell class="text-right font-medium tabular-nums">
									{money(row.dueCents)}
								</Table.Cell>
								<Table.Cell class="text-right">
									<form method="POST" action="?/create" use:enhance={act}>
										<input type="hidden" name="affiliateId" value={row.affiliateId} />
										<Button type="submit" size="sm" disabled={belowMinimum}>
											{belowMinimum ? 'Below minimum' : 'Create payout'}
										</Button>
									</form>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root class="gap-0 overflow-hidden p-0">
		<Card.Header class="border-b px-5 py-4">
			<Card.Title class="text-base">Payout history</Card.Title>
		</Card.Header>
		<Card.Content class="p-0">
			{#if data.payouts.length === 0}
				<EmptyState icon={CardIcon} title="No payouts yet" />
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Affiliate</Table.Head>
							<Table.Head>Period</Table.Head>
							<Table.Head class="text-right">Lines</Table.Head>
							<Table.Head class="text-right">Amount</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head>Reference</Table.Head>
							<Table.Head class="w-px"></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.payouts as payout (payout.id)}
							<Table.Row>
								<Table.Cell>
									<a href="/admin/affiliates/{payout.affiliateId}" class="font-medium underline">
										{payout.affiliateName ?? payout.affiliateEmail}
									</a>
								</Table.Cell>
								<Table.Cell class="text-muted-foreground">
									{shortDate(payout.periodStart)} – {shortDate(payout.periodEnd)}
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{payout.lineCount}</Table.Cell>
								<Table.Cell class="text-right font-medium tabular-nums">
									{money(payout.amountCents, payout.currency)}
								</Table.Cell>
								<Table.Cell>
									<StatusBadge status={payout.status} label={PAYOUT_STATUS_LABEL[payout.status]} />
								</Table.Cell>
								<Table.Cell>
									{#if payout.status === 'paid'}
										<span class="text-sm text-muted-foreground">{payout.reference ?? '—'}</span>
									{:else}
										<Input
											bind:value={references[payout.id]}
											placeholder={payout.reference ?? 'Transfer reference'}
											class="h-8 w-40 text-xs"
										/>
									{/if}
								</Table.Cell>
								<Table.Cell>
									<div class="flex justify-end gap-1">
										{#if payout.status === 'draft'}
											<form method="POST" action="?/markProcessing" use:enhance={act}>
												<input type="hidden" name="id" value={payout.id} />
												<input type="hidden" name="reference" value={references[payout.id] ?? ''} />
												<Button type="submit" size="sm" variant="ghost">Processing</Button>
											</form>
										{/if}
										{#if payout.status !== 'paid'}
											<form method="POST" action="?/markPaid" use:enhance={act}>
												<input type="hidden" name="id" value={payout.id} />
												<input type="hidden" name="reference" value={references[payout.id] ?? ''} />
												<Button type="submit" size="sm">Mark paid</Button>
											</form>
											<form method="POST" action="?/cancel" use:enhance={act}>
												<input type="hidden" name="id" value={payout.id} />
												<Button type="submit" size="sm" variant="ghost">Cancel</Button>
											</form>
										{/if}
									</div>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if form?.error}
		<p class="text-sm text-destructive">{form.error}</p>
	{/if}
</div>
