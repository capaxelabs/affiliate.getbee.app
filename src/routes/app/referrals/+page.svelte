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
	import { Textarea } from '$lib/components/ui/textarea';
	import PageHeader from '$lib/components/page-header.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import SearchIcon from '@lucide/svelte/icons/search';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { money, percent, shortDate } from '$lib/format';
	import { REFERRAL_STATUS_LABEL, SOURCE_LABEL } from '$lib/constants';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let open = $state(false);
	let search = $state(data.search);
	let appId = $state(data.apps[0]?.id ?? '');
	let submitting = $state(false);

	const today = new Date().toISOString().slice(0, 10);
	const selectedApp = $derived(data.apps.find((a) => a.id === appId)?.name ?? 'Select an app');

	let searchTimer: ReturnType<typeof setTimeout>;
	function onSearch(value: string) {
		search = value;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			const url = new URL(window.location.href);
			if (value) url.searchParams.set('q', value);
			else url.searchParams.delete('q');
			goto(url, { keepFocus: true, replaceState: true, noScroll: true });
		}, 250);
	}

	const submitClaim = () => {
		submitting = true;
		return async ({ result, update }: any) => {
			submitting = false;
			if (result.type === 'success') {
				open = false;
				toast.success(result.data?.message ?? 'Claim submitted.');
			} else if (result.type === 'failure') {
				toast.error(result.data?.error ?? 'Could not submit that claim.');
			}
			await update();
		};
	};
</script>

<svelte:head><title>Referrals · Bee Affiliates</title></svelte:head>

<PageHeader title="Referrals">
	{#snippet actions()}
		<Button variant="outline" onclick={() => (open = true)}>Claim referral</Button>
	{/snippet}
</PageHeader>

<div class="space-y-5 px-5 pb-10 sm:px-8">
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
			<EmptyState
				icon={UsersIcon}
				title={search ? 'No referrals match that search' : 'No referrals yet'}
				description={search
					? 'Try a different shop domain.'
					: 'Share your affiliate links to get started.'}
			/>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Shop</Table.Head>
						<Table.Head>App</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Source</Table.Head>
						<Table.Head>Rate</Table.Head>
						<Table.Head>Referred</Table.Head>
						<Table.Head class="text-right">Earned</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.referrals as referral (referral.id)}
						<Table.Row>
							<Table.Cell>
								<span class="font-medium">{referral.shopDomain}</span>
								{#if referral.shopName}
									<span class="block text-xs text-muted-foreground">{referral.shopName}</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{referral.appName}</Table.Cell>
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
								{money(referral.lifetimeCommissionCents)}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</Card.Root>

	{#if data.claims.length}
		<Card.Root class="gap-0 p-0">
			<Card.Header class="border-b px-5 py-4">
				<Card.Title class="text-base">Your claims</Card.Title>
				<Card.Description>Shops you asked us to attribute manually.</Card.Description>
			</Card.Header>
			<Card.Content class="p-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Shop</Table.Head>
							<Table.Head>App</Table.Head>
							<Table.Head>Referral date</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head>Reviewer note</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.claims as claim (claim.id)}
							<Table.Row>
								<Table.Cell class="font-medium">{claim.shopDomain}</Table.Cell>
								<Table.Cell class="text-muted-foreground">{claim.appName}</Table.Cell>
								<Table.Cell class="text-muted-foreground">{shortDate(claim.referralDate)}</Table.Cell>
								<Table.Cell><StatusBadge status={claim.status} /></Table.Cell>
								<Table.Cell class="max-w-xs truncate text-muted-foreground">
									{claim.reviewNote ?? '—'}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	{/if}
</div>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Claim referral</Dialog.Title>
			<Dialog.Description>
				Claim a shop you referred that wasn't attributed automatically. We review every claim before
				it starts earning.
			</Dialog.Description>
		</Dialog.Header>

		<form method="POST" action="?/claim" use:enhance={submitClaim} class="space-y-4">
			<div class="space-y-2">
				<Label for="appId">App</Label>
				<Select.Root type="single" bind:value={appId} name="appId">
					<Select.Trigger id="appId" class="w-full">{selectedApp}</Select.Trigger>
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
				<p class="text-xs text-muted-foreground">
					Enter the merchant's myshopify domain. For example, themerchant.myshopify.com
				</p>
			</div>

			<div class="space-y-2">
				<Label for="referralDate">Referral date</Label>
				<Input id="referralDate" name="referralDate" type="date" max={today} value={today} required />
			</div>

			<div class="space-y-2">
				<Label for="note">Note for program manager</Label>
				<Textarea
					id="note"
					name="note"
					rows={3}
					placeholder="Explain how you referred this merchant, or paste a link to a screenshot."
				/>
			</div>

			{#if form?.error}
				<p class="text-sm text-destructive">{form.error}</p>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={submitting || !appId}>Submit claim</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
