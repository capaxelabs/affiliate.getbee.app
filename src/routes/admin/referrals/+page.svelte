<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import PageHeader from '$lib/components/page-header.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import SearchIcon from '@lucide/svelte/icons/search';
	import StoreIcon from '@lucide/svelte/icons/store';
	import { money, percent, shortDate } from '$lib/format';
	import { REFERRAL_STATUS_LABEL, SOURCE_LABEL } from '$lib/constants';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let open = $state(false);
	let search = $state(data.search);
	let appId = $state(data.apps[0]?.id ?? '');
	let affiliateId = $state(data.affiliates[0]?.id ?? '');

	const appLabel = $derived(data.apps.find((a) => a.id === appId)?.name ?? 'Select an app');
	const affiliateLabel = $derived(
		(() => {
			const a = data.affiliates.find((x) => x.id === affiliateId);
			return a ? `${a.name ?? a.email} (${a.refCode})` : 'Select an affiliate';
		})()
	);

	let timer: ReturnType<typeof setTimeout>;
	function onSearch(value: string) {
		search = value;
		clearTimeout(timer);
		timer = setTimeout(() => {
			const url = new URL(window.location.href);
			if (value) url.searchParams.set('q', value);
			else url.searchParams.delete('q');
			goto(url, { keepFocus: true, replaceState: true, noScroll: true });
		}, 250);
	}

	const submit = () => async ({ result, update }: any) => {
		if (result.type === 'success') {
			open = false;
			toast.success(result.data?.message ?? 'Done.');
		} else if (result.type === 'failure') {
			toast.error(result.data?.error ?? 'That did not work.');
		}
		await update();
	};
</script>

<svelte:head><title>Referrals · Admin</title></svelte:head>

<PageHeader title="Referrals" description="Every shop attributed to an affiliate.">
	{#snippet actions()}
		{#if data.canWrite}
			<Button variant="outline" onclick={() => (open = true)}>Attribute manually</Button>
		{/if}
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
				placeholder="Search by shop domain..."
				class="w-full bg-transparent py-3.5 pr-4 pl-11 text-sm outline-none placeholder:text-muted-foreground"
			/>
		</div>

		{#if data.referrals.length === 0}
			<EmptyState icon={StoreIcon} title="No referrals match" />
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Shop</Table.Head>
						<Table.Head>App</Table.Head>
						<Table.Head>Affiliate</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Source</Table.Head>
						<Table.Head>Rate</Table.Head>
						<Table.Head>Referred</Table.Head>
						<Table.Head class="text-right">Revenue</Table.Head>
						<Table.Head class="text-right">Commission</Table.Head>
						<Table.Head class="w-px"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.referrals as referral (referral.id)}
						<Table.Row>
							<Table.Cell class="font-medium">{referral.shopDomain}</Table.Cell>
							<Table.Cell class="text-muted-foreground">{referral.appName}</Table.Cell>
							<Table.Cell>
								<a href="/admin/affiliates/{referral.affiliateId}" class="underline">
									{referral.affiliateName ?? referral.affiliateEmail}
								</a>
							</Table.Cell>
							<Table.Cell>
								<StatusBadge
									status={referral.status}
									label={REFERRAL_STATUS_LABEL[referral.status]}
								/>
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{SOURCE_LABEL[referral.source]}</Table.Cell>
							<Table.Cell class="tabular-nums">{percent(referral.commissionBps)}</Table.Cell>
							<Table.Cell class="text-muted-foreground">
								{shortDate(referral.installedAt ?? referral.createdAt)}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{money(referral.lifetimeRevenueCents)}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{money(referral.lifetimeCommissionCents)}
							</Table.Cell>
							<Table.Cell class="text-right">
								{#if data.canWrite && referral.status !== 'rejected'}
									<form method="POST" action="?/reject" use:enhance={submit}>
										<input type="hidden" name="id" value={referral.id} />
										<Button type="submit" size="sm" variant="ghost">Reject</Button>
									</form>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</Card.Root>
</div>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Attribute a shop</Dialog.Title>
			<Dialog.Description>
				Credits a shop to an affiliate directly. Commissions start on its next Partner transaction.
			</Dialog.Description>
		</Dialog.Header>

		<form method="POST" action="?/attribute" use:enhance={submit} class="space-y-4">
			<div class="space-y-2">
				<Label for="affiliateId">Affiliate</Label>
				<Select.Root type="single" bind:value={affiliateId} name="affiliateId">
					<Select.Trigger id="affiliateId" class="w-full">{affiliateLabel}</Select.Trigger>
					<Select.Content>
						{#each data.affiliates as affiliate (affiliate.id)}
							<Select.Item
								value={affiliate.id}
								label="{affiliate.name ?? affiliate.email} ({affiliate.refCode})"
							>
								{affiliate.name ?? affiliate.email} ({affiliate.refCode})
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<div class="space-y-2">
				<Label for="appId">App</Label>
				<Select.Root type="single" bind:value={appId} name="appId">
					<Select.Trigger id="appId" class="w-full">{appLabel}</Select.Trigger>
					<Select.Content>
						{#each data.apps as app (app.id)}
							<Select.Item value={app.id} label={app.name}>{app.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<div class="space-y-2">
				<Label for="shopDomain">Shop domain</Label>
				<Input id="shopDomain" name="shopDomain" placeholder="themerchant.myshopify.com" required />
			</div>

			{#if form?.error}
				<p class="text-sm text-destructive">{form.error}</p>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={!appId || !affiliateId}>Attribute</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
