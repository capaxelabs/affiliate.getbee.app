<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import PageHeader from '$lib/components/page-header.svelte';
	import CopyButton from '$lib/components/copy-button.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import { AFFILIATE_STATUS_LABEL } from '$lib/constants';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let payoutMethod = $state(data.profile.payoutMethod ?? '');
	const methodLabels: Record<string, string> = {
		paypal: 'PayPal',
		wise: 'Wise',
		bank: 'Bank transfer'
	};
	const methodLabel = $derived(methodLabels[payoutMethod] ?? 'Choose a method');
	const bank = $derived(data.profile.payoutDetails ?? {});

	const notify = () => async ({ result, update }: any) => {
		if (result.type === 'success') toast.success(result.data?.message ?? 'Saved.');
		if (result.type === 'failure') toast.error(result.data?.error ?? 'Could not save that.');
		await update({ reset: false });
	};
</script>

<svelte:head><title>Settings · Bee Affiliates</title></svelte:head>

<PageHeader title="Settings" />

<div class="max-w-2xl space-y-5 px-5 pb-10 sm:px-8">
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Your account</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="flex items-center justify-between gap-4 text-sm">
				<span class="text-muted-foreground">Status</span>
				<StatusBadge
					status={data.profile.status}
					label={AFFILIATE_STATUS_LABEL[data.profile.status]}
				/>
			</div>
			<div class="flex items-center justify-between gap-4 text-sm">
				<span class="text-muted-foreground">Email</span>
				<span class="font-medium">{data.email}</span>
			</div>
			<div class="flex items-center justify-between gap-4 text-sm">
				<span class="text-muted-foreground">Referral code</span>
				<span class="font-mono font-medium">{data.profile.refCode}</span>
			</div>
			<div class="space-y-2">
				<Label>Link format</Label>
				<div class="flex gap-2">
					<Input readonly value={data.baseLink} class="font-mono text-xs" />
					<CopyButton value={data.baseLink} label="Copy" />
				</div>
				<p class="text-xs text-muted-foreground">
					Per-app links with the app slug filled in are on the Home page.
				</p>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Profile</Card.Title>
			<Card.Description>How we know you and where you promote.</Card.Description>
		</Card.Header>
		<form method="POST" action="?/profile" use:enhance={notify}>
			<Card.Content class="space-y-4">
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-2">
						<Label for="name">Name</Label>
						<Input id="name" name="name" value={data.name ?? ''} placeholder="Alex Doe" />
					</div>
					<div class="space-y-2">
						<Label for="company">Company</Label>
						<Input id="company" name="company" value={data.profile.company ?? ''} />
					</div>
				</div>
				<div class="space-y-2">
					<Label for="website">Website</Label>
					<Input
						id="website"
						name="website"
						type="url"
						value={data.profile.website ?? ''}
						placeholder="https://example.com"
					/>
				</div>
				<div class="space-y-2">
					<Label for="promotionMethod">How do you promote apps?</Label>
					<Textarea
						id="promotionMethod"
						name="promotionMethod"
						rows={3}
						value={data.profile.promotionMethod ?? ''}
						placeholder="Agency clients, YouTube channel, newsletter..."
					/>
				</div>
			</Card.Content>
			<Card.Footer class="justify-end border-t pt-5">
				<Button type="submit">Save profile</Button>
			</Card.Footer>
		</form>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Payout details</Card.Title>
			<Card.Description>Where your commissions go once they clear.</Card.Description>
		</Card.Header>
		<form method="POST" action="?/payout" use:enhance={notify}>
			<Card.Content class="space-y-4">
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-2">
						<Label for="payoutMethod">Method</Label>
						<Select.Root type="single" bind:value={payoutMethod} name="payoutMethod">
							<Select.Trigger id="payoutMethod" class="w-full">{methodLabel}</Select.Trigger>
							<Select.Content>
								<Select.Item value="paypal" label="PayPal">PayPal</Select.Item>
								<Select.Item value="wise" label="Wise">Wise</Select.Item>
								<Select.Item value="bank" label="Bank transfer">Bank transfer</Select.Item>
							</Select.Content>
						</Select.Root>
					</div>
					<div class="space-y-2">
						<Label for="minPayout">Minimum payout (USD)</Label>
						<Input
							id="minPayout"
							name="minPayout"
							type="number"
							min="0"
							step="10"
							value={data.profile.minPayoutCents / 100}
						/>
					</div>
				</div>

				{#if payoutMethod === 'bank'}
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="space-y-2">
							<Label for="accountName">Account name</Label>
							<Input id="accountName" name="accountName" value={bank.accountName ?? ''} />
						</div>
						<div class="space-y-2">
							<Label for="accountNumber">Account number / IBAN</Label>
							<Input id="accountNumber" name="accountNumber" value={bank.accountNumber ?? ''} />
						</div>
						<div class="space-y-2 sm:col-span-2">
							<Label for="routing">Routing / SWIFT</Label>
							<Input id="routing" name="routing" value={bank.routing ?? ''} />
						</div>
					</div>
				{:else}
					<div class="space-y-2">
						<Label for="payoutEmail">Payout email</Label>
						<Input
							id="payoutEmail"
							name="payoutEmail"
							type="email"
							value={data.profile.payoutEmail ?? ''}
						/>
					</div>
				{/if}
			</Card.Content>
			<Card.Footer class="justify-end border-t pt-5">
				<Button type="submit">Save payout details</Button>
			</Card.Footer>
		</form>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Tax info</Card.Title>
			<Card.Description>Needed before we can send larger payouts.</Card.Description>
		</Card.Header>
		<form method="POST" action="?/tax" use:enhance={notify}>
			<Card.Content class="grid gap-4 sm:grid-cols-2">
				<div class="space-y-2">
					<Label for="taxCountry">Country</Label>
					<Input id="taxCountry" name="taxCountry" value={data.profile.taxCountry ?? ''} />
				</div>
				<div class="space-y-2">
					<Label for="taxId">Tax ID / VAT number</Label>
					<Input id="taxId" name="taxId" value={data.profile.taxId ?? ''} />
				</div>
			</Card.Content>
			<Card.Footer class="justify-end border-t pt-5">
				<Button type="submit">Save tax info</Button>
			</Card.Footer>
		</form>
	</Card.Root>
</div>
