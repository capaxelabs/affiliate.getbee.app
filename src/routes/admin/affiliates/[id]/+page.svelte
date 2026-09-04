<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import PageHeader from '$lib/components/page-header.svelte';
	import StatCard from '$lib/components/stat-card.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import { money, percent, shortDate, relativeTime } from '$lib/format';
	import {
		AFFILIATE_STATUS_LABEL,
		CHARGE_TYPE_LABEL,
		COMMISSION_STATUS_LABEL,
		PAYOUT_STATUS_LABEL,
		REFERRAL_STATUS_LABEL,
		SOURCE_LABEL
	} from '$lib/constants';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const a = $derived(data.affiliate);

	const notify = () => async ({ result, update }: any) => {
		if (result.type === 'success') toast.success(result.data?.message ?? 'Done.');
		if (result.type === 'failure') toast.error(result.data?.error ?? 'That did not work.');
		await update({ reset: false });
	};
</script>

<svelte:head><title>{data.account.name ?? data.account.email} · Admin</title></svelte:head>

<div class="px-5 pt-5 sm:px-8">
	<a
		href="/admin/affiliates"
		class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
	>
		<ArrowLeftIcon class="size-3.5" /> All affiliates
	</a>
</div>

<PageHeader
	title={data.account.name ?? data.account.email}
	description="{data.account.email} · code {a.refCode}"
>
	{#snippet actions()}
		<StatusBadge status={a.status} label={AFFILIATE_STATUS_LABEL[a.status]} />
		{#if !data.canWrite}
			<!-- read-only: no lifecycle actions -->
		{:else if a.status === 'pending' || a.status === 'rejected'}
			<form method="POST" action="?/approve" use:enhance={notify}>
				<Button type="submit">Approve</Button>
			</form>
		{:else if a.status === 'suspended'}
			<form method="POST" action="?/reinstate" use:enhance={notify}>
				<Button type="submit">Reinstate</Button>
			</form>
		{/if}
	{/snippet}
</PageHeader>

<div class="space-y-5 px-5 pb-10 sm:px-8">
	{#if data.showTotals}
		<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
			<StatCard label="Total earnings" value={money(data.summary.totalEarningsCents)} />
			<StatCard label="Ready to pay" value={money(data.summary.pendingPayoutCents)} />
			<StatCard label="Paid out" value={money(data.summary.paidOutCents)} />
			<StatCard label="Referrals" value={String(data.summary.referralCount)} />
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">
			Showing only the referrals and commissions for apps you have access to.
		</p>
	{/if}

	<div class="grid gap-4 lg:grid-cols-3">
		<Card.Root class="lg:col-span-2">
			<Card.Header>
				<Card.Title class="text-base">Application</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-3 text-sm">
				<div class="flex justify-between gap-4">
					<span class="text-muted-foreground">Company</span>
					<span>{a.company ?? '—'}</span>
				</div>
				<div class="flex justify-between gap-4">
					<span class="text-muted-foreground">Website</span>
					{#if a.website}
						<a href={a.website} target="_blank" rel="noreferrer" class="underline">{a.website}</a>
					{:else}
						<span>—</span>
					{/if}
				</div>
				<div class="flex justify-between gap-4">
					<span class="text-muted-foreground">Last sign-in</span>
					<span>{relativeTime(data.account.lastLoginAt)}</span>
				</div>
				<div class="flex justify-between gap-4">
					<span class="text-muted-foreground">Payout</span>
					<span class="capitalize">
						{a.payoutMethod ?? 'not set'}{a.payoutEmail ? ` · ${a.payoutEmail}` : ''}
					</span>
				</div>
				<div class="flex justify-between gap-4">
					<span class="text-muted-foreground">Tax</span>
					<span>{a.taxCountry ?? '—'}{a.taxId ? ` · ${a.taxId}` : ''}</span>
				</div>
				{#if a.promotionMethod}
					<div class="border-t pt-3">
						<p class="mb-1 text-muted-foreground">How they promote</p>
						<p class="whitespace-pre-wrap">{a.promotionMethod}</p>
					</div>
				{/if}
				{#if a.reviewNote}
					<div class="border-t pt-3">
						<p class="mb-1 text-muted-foreground">Review note</p>
						<p class="whitespace-pre-wrap">{a.reviewNote}</p>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<div class="space-y-4">
			{#if data.canWrite}
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-base">Commission override</Card.Title>
					<Card.Description>Leave empty to use each app's default rate.</Card.Description>
				</Card.Header>
				<form method="POST" action="?/setRate" use:enhance={notify}>
					<Card.Content class="space-y-2">
						<Label for="commissionPercent">Rate %</Label>
						<Input
							id="commissionPercent"
							name="commissionPercent"
							type="number"
							min="0"
							max="100"
							step="0.5"
							value={a.commissionBpsOverride ? a.commissionBpsOverride / 100 : ''}
							placeholder="App default"
						/>
					</Card.Content>
					<Card.Footer class="justify-end border-t pt-5">
						<Button type="submit" size="sm">Save rate</Button>
					</Card.Footer>
				</form>
			</Card.Root>

			{#if a.status !== 'rejected' && a.status !== 'suspended'}
				<Card.Root>
					<Card.Header>
						<Card.Title class="text-base">
							{a.status === 'pending' ? 'Reject application' : 'Suspend affiliate'}
						</Card.Title>
						<Card.Description>
							{a.status === 'pending'
								? 'They get an email with your reason.'
								: 'Existing commissions stay; new referrals stop being tracked.'}
						</Card.Description>
					</Card.Header>
					<form
						method="POST"
						action={a.status === 'pending' ? '?/reject' : '?/suspend'}
						use:enhance={notify}
					>
						<Card.Content>
							<Textarea name="note" rows={3} placeholder="Reason (shared with the affiliate)" />
						</Card.Content>
						<Card.Footer class="justify-end border-t pt-5">
							<Button type="submit" variant="destructive" size="sm">
								{a.status === 'pending' ? 'Reject' : 'Suspend'}
							</Button>
						</Card.Footer>
					</form>
				</Card.Root>
			{/if}
			{/if}
		</div>
	</div>

	{#if form?.error}
		<p class="text-sm text-destructive">{form.error}</p>
	{/if}

	<Tabs.Root value="referrals">
		<Tabs.List>
			<Tabs.Trigger value="referrals">Referrals ({data.referrals.length})</Tabs.Trigger>
			<Tabs.Trigger value="commissions">Commissions ({data.commissions.length})</Tabs.Trigger>
			{#if data.showTotals}
				<Tabs.Trigger value="payouts">Payouts ({data.payouts.length})</Tabs.Trigger>
			{/if}
		</Tabs.List>

		<Tabs.Content value="referrals">
			<Card.Root class="gap-0 overflow-hidden p-0">
				{#if data.referrals.length === 0}
					<p class="px-5 py-12 text-center text-sm text-muted-foreground">No referrals yet.</p>
				{:else}
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Shop</Table.Head>
								<Table.Head>App</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head>Source</Table.Head>
								<Table.Head>Rate</Table.Head>
								<Table.Head class="text-right">Earned</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.referrals as referral (referral.id)}
								<Table.Row>
									<Table.Cell class="font-medium">{referral.shopDomain}</Table.Cell>
									<Table.Cell class="text-muted-foreground">{referral.appName}</Table.Cell>
									<Table.Cell>
										<StatusBadge
											status={referral.status}
											label={REFERRAL_STATUS_LABEL[referral.status]}
										/>
									</Table.Cell>
									<Table.Cell class="text-muted-foreground">
										{SOURCE_LABEL[referral.source]}
									</Table.Cell>
									<Table.Cell class="tabular-nums">{percent(referral.commissionBps)}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">
										{money(referral.lifetimeCommissionCents)}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{/if}
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="commissions">
			<Card.Root class="gap-0 overflow-hidden p-0">
				{#if data.commissions.length === 0}
					<p class="px-5 py-12 text-center text-sm text-muted-foreground">No commissions yet.</p>
				{:else}
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Date</Table.Head>
								<Table.Head>App</Table.Head>
								<Table.Head>Type</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head class="text-right">Amount</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.commissions as commission (commission.id)}
								<Table.Row>
									<Table.Cell class="text-muted-foreground">
										{shortDate(commission.occurredAt)}
									</Table.Cell>
									<Table.Cell>{commission.appName}</Table.Cell>
									<Table.Cell class="text-muted-foreground">
										{CHARGE_TYPE_LABEL[commission.chargeType]}
									</Table.Cell>
									<Table.Cell>
										<StatusBadge
											status={commission.status}
											label={COMMISSION_STATUS_LABEL[commission.status]}
										/>
									</Table.Cell>
									<Table.Cell class="text-right tabular-nums">
										{money(commission.amountCents)}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{/if}
			</Card.Root>
		</Tabs.Content>

		{#if data.showTotals}
		<Tabs.Content value="payouts">
			<Card.Root class="gap-0 overflow-hidden p-0">
				{#if data.payouts.length === 0}
					<p class="px-5 py-12 text-center text-sm text-muted-foreground">No payouts yet.</p>
				{:else}
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Created</Table.Head>
								<Table.Head>Method</Table.Head>
								<Table.Head>Reference</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head class="text-right">Amount</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.payouts as payout (payout.id)}
								<Table.Row>
									<Table.Cell class="text-muted-foreground">{shortDate(payout.createdAt)}</Table.Cell>
									<Table.Cell class="capitalize">{payout.method ?? '—'}</Table.Cell>
									<Table.Cell class="text-muted-foreground">{payout.reference ?? '—'}</Table.Cell>
									<Table.Cell>
										<StatusBadge status={payout.status} label={PAYOUT_STATUS_LABEL[payout.status]} />
									</Table.Cell>
									<Table.Cell class="text-right tabular-nums">
										{money(payout.amountCents, payout.currency)}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{/if}
			</Card.Root>
		</Tabs.Content>
		{/if}
	</Tabs.Root>
</div>
