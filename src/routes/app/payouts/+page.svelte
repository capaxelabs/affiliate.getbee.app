<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import PageHeader from '$lib/components/page-header.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import CardIcon from '@lucide/svelte/icons/credit-card';
	import { money, shortDate } from '$lib/format';
	import { CHARGE_TYPE_LABEL, PAYOUT_STATUS_LABEL } from '$lib/constants';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let expanded = $state<string | null>(null);
</script>

<svelte:head><title>Payouts · Bee Affiliates</title></svelte:head>

<PageHeader title="Payouts" />

<div class="px-5 pb-10 sm:px-8">
	<Card.Root class="gap-0 overflow-hidden p-0">
		{#if data.payouts.length === 0}
			<EmptyState
				icon={CardIcon}
				title="No payouts yet"
				description="They appear once your commissions cross the minimum."
			/>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Period</Table.Head>
						<Table.Head>Method</Table.Head>
						<Table.Head>Reference</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Paid</Table.Head>
						<Table.Head class="text-right">Amount</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.payouts as payout (payout.id)}
						<Table.Row
							class="cursor-pointer"
							onclick={() => (expanded = expanded === payout.id ? null : payout.id)}
						>
							<Table.Cell class="font-medium">
								{shortDate(payout.periodStart)} – {shortDate(payout.periodEnd)}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground capitalize">
								{payout.method ?? '—'}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{payout.reference ?? '—'}</Table.Cell>
							<Table.Cell>
								<StatusBadge status={payout.status} label={PAYOUT_STATUS_LABEL[payout.status]} />
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{shortDate(payout.paidAt)}</Table.Cell>
							<Table.Cell class="text-right font-medium tabular-nums">
								{money(payout.amountCents, payout.currency)}
							</Table.Cell>
						</Table.Row>
						{#if expanded === payout.id && payout.lines.length}
							<Table.Row class="bg-muted/40 hover:bg-muted/40">
								<Table.Cell colspan={6} class="p-0">
									<div class="px-5 py-3">
										<p class="mb-2 text-xs font-medium text-muted-foreground">
											{payout.lines.length} commission {payout.lines.length === 1 ? 'line' : 'lines'}
										</p>
										<div class="space-y-1.5">
											{#each payout.lines as line (line.id)}
												<div class="flex items-center justify-between text-sm">
													<span class="text-muted-foreground">
														{shortDate(line.occurredAt)} · {line.appName} ·
														{CHARGE_TYPE_LABEL[line.chargeType]}
													</span>
													<span class="tabular-nums">{money(line.amountCents)}</span>
												</div>
											{/each}
										</div>
									</div>
								</Table.Cell>
							</Table.Row>
						{/if}
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</Card.Root>
</div>
