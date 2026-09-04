<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import PageHeader from '$lib/components/page-header.svelte';
	import StatCard from '$lib/components/stat-card.svelte';
	import CopyButton from '$lib/components/copy-button.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import { money, commissionLabel } from '$lib/format';
	import HandCoinsIcon from '@lucide/svelte/icons/hand-coins';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import HourglassIcon from '@lucide/svelte/icons/hourglass';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import DollarIcon from '@lucide/svelte/icons/circle-dollar-sign';
	import UsersIcon from '@lucide/svelte/icons/users';
	import PackageIcon from '@lucide/svelte/icons/package';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Home · Bee Affiliates</title></svelte:head>

<PageHeader title="Home" />

<div class="space-y-5 px-5 pb-10 sm:px-8">
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
		<StatCard
			label="Outstanding commissions"
			value={money(data.summary.outstandingCents)}
			hint="Held until the refund window closes"
			icon={HandCoinsIcon}
		/>
		<StatCard
			label="Pending payouts"
			value={money(data.summary.pendingPayoutCents)}
			hint="Cleared and waiting on the next run"
			icon={WalletIcon}
		/>
		<StatCard
			label="Processing"
			value={money(data.summary.processingCents)}
			icon={HourglassIcon}
		/>
		<StatCard label="Paid out" value={money(data.summary.paidOutCents)} icon={CircleCheckIcon} />
		<StatCard
			label="Total earnings"
			value={money(data.summary.totalEarningsCents)}
			icon={DollarIcon}
		/>
		<StatCard label="Referrals" value={String(data.summary.referralCount)} icon={UsersIcon} />
	</div>

	<Card.Root class="gap-0 p-0">
		<Card.Header class="border-b px-5 py-4">
			<Card.Title class="text-base">Affiliated apps</Card.Title>
		</Card.Header>
		<Card.Content class="p-0">
			{#if data.apps.length === 0}
				<EmptyState
					icon={PackageIcon}
					title="No apps in the program yet"
					description="Once an admin adds an app it shows up here with your link."
				/>
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>App</Table.Head>
							<Table.Head>Commission</Table.Head>
							<Table.Head class="text-right">Referrals</Table.Head>
							<Table.Head class="text-right">Total earnings</Table.Head>
							<Table.Head class="w-px"></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.apps as app (app.id)}
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
										<span class="font-medium">{app.name}</span>
									</div>
								</Table.Cell>
								<Table.Cell class="text-muted-foreground">
									{commissionLabel(app.commissionBps, app.commissionMonths)}
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{app.referralCount}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(app.earnedCents)}</Table.Cell>
								<Table.Cell class="text-right">
									<CopyButton value={app.link} label="Copy affiliate link" />
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
