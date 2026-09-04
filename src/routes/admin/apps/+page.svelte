<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import PageHeader from '$lib/components/page-header.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import PackageIcon from '@lucide/svelte/icons/package';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { money, commissionLabel } from '$lib/format';
	import type { ActionData, PageData } from './$types';

	type AppRow = PageData['apps'][number];

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let open = $state(false);
	let editing = $state<AppRow | null>(null);
	let status = $state('active');
	let welcomeEmail = $state(false);
	let offboardEmail = $state(false);
	let partnerAccountId = $state('');

	const accountLabel = $derived(
		data.accounts.find((a) => a.id === partnerAccountId)?.name ?? 'Not linked'
	);

	function openCreate() {
		editing = null;
		status = 'active';
		welcomeEmail = false;
		offboardEmail = false;
		partnerAccountId = data.accounts[0]?.id ?? '';
		open = true;
	}

	function openEdit(app: AppRow) {
		editing = app;
		status = app.status;
		welcomeEmail = app.welcomeEmailEnabled;
		offboardEmail = app.offboardEmailEnabled;
		partnerAccountId = app.partnerAccountId ?? '';
		open = true;
	}

	const submit = () => async ({ result, update }: any) => {
		if (result.type === 'success') {
			open = false;
			toast.success(result.data?.message ?? 'Saved.');
		} else if (result.type === 'failure') {
			toast.error(result.data?.error ?? 'Could not save that app.');
		}
		await update();
	};

	const toggle = () => async ({ result, update }: any) => {
		if (result.type === 'success') toast.success(result.data?.message ?? 'Updated.');
		if (result.type === 'failure') toast.error(result.data?.error ?? 'Could not update.');
		await update();
	};
</script>

<svelte:head><title>Apps · Admin</title></svelte:head>

<PageHeader title="Apps" description="The Shopify apps affiliates can promote.">
	{#snippet actions()}
		{#if data.canWrite}
			<Button onclick={openCreate}><PlusIcon class="size-4" /> Add app</Button>
		{/if}
	{/snippet}
</PageHeader>

<div class="space-y-5 px-5 pb-10 sm:px-8">
	{#if data.emailStats.welcome.pending + data.emailStats.offboard.pending > 0 || data.emailStats.welcome.sent + data.emailStats.offboard.sent > 0}
		<div class="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border bg-background px-4 py-3 text-sm">
			<span class="font-medium">Lifecycle email</span>
			<span class="text-muted-foreground">
				Welcome: {data.emailStats.welcome.sent} sent · {data.emailStats.welcome.pending} queued
			</span>
			<span class="text-muted-foreground">
				Offboarding: {data.emailStats.offboard.sent} sent · {data.emailStats.offboard.pending} queued
			</span>
			{#if data.emailStats.welcome.failed + data.emailStats.offboard.failed > 0}
				<span class="text-destructive">
					{data.emailStats.welcome.failed + data.emailStats.offboard.failed} failed
				</span>
			{/if}
		</div>
	{/if}

	<Card.Root class="gap-0 overflow-hidden p-0">
		{#if data.apps.length === 0}
			<EmptyState
				icon={PackageIcon}
				title="No apps yet"
				description="Add your first Shopify app so affiliates have something to promote."
			>
				{#snippet action()}
					{#if data.canWrite}
						<Button onclick={openCreate}>Add app</Button>
					{/if}
				{/snippet}
			</EmptyState>
		{:else}
			<div class="overflow-x-auto">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>App</Table.Head>
						<Table.Head>Slug</Table.Head>
						<Table.Head>Commission</Table.Head>
						<Table.Head>Cookie</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="text-right">Installs</Table.Head>
						<Table.Head class="text-right">This month</Table.Head>
						<Table.Head class="text-right">Gross</Table.Head>
						<Table.Head class="text-right">Referrals</Table.Head>
						<Table.Head class="text-right">Commissions</Table.Head>
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
									<div class="min-w-0">
										<p class="font-medium">{app.name}</p>
										{#if !app.partnerAccountId}
											<p class="text-xs text-amber-600">No partner account — sync will skip it</p>
										{:else if !app.partnerAppId}
											<p class="text-xs text-amber-600">No Partner app id — sync will skip it</p>
										{/if}
									</div>
								</div>
							</Table.Cell>
							<Table.Cell class="font-mono text-xs text-muted-foreground">{app.slug}</Table.Cell>
							<Table.Cell class="text-muted-foreground">
								{commissionLabel(app.commissionBps, app.commissionMonths)}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{app.cookieDays}d</Table.Cell>
							<Table.Cell><StatusBadge status={app.status} /></Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{app.activeInstalls}
								{#if app.churnedInstalls}
									<span class="block text-xs text-muted-foreground">
										{app.churnedInstalls} churned
									</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{money(app.thisMonthGrossCents)}
							</Table.Cell>
							<Table.Cell class="text-right font-medium tabular-nums">
								{money(app.grossCents)}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{app.referralCount}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{money(app.commissionCents)}</Table.Cell>
							<Table.Cell>
								{#if data.canWrite}
									<div class="flex justify-end gap-1">
										<Button size="sm" variant="ghost" onclick={() => openEdit(app)}>Edit</Button>
										<form method="POST" action="?/toggleStatus" use:enhance={toggle}>
											<input type="hidden" name="id" value={app.id} />
											<Button type="submit" size="sm" variant="ghost">
												{app.status === 'active' ? 'Pause' : 'Activate'}
											</Button>
										</form>
									</div>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
			</div>
		{/if}
	</Card.Root>
</div>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{editing ? `Edit ${editing.name}` : 'Add app'}</Dialog.Title>
			<Dialog.Description>
				The slug becomes part of every affiliate link, so avoid changing it once links are out.
			</Dialog.Description>
		</Dialog.Header>

		<form
			method="POST"
			action={editing ? '?/update' : '?/create'}
			use:enhance={submit}
			class="space-y-4"
		>
			{#if editing}
				<input type="hidden" name="id" value={editing.id} />
			{/if}

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="space-y-2">
					<Label for="name">Name</Label>
					<Input id="name" name="name" value={editing?.name ?? ''} required />
				</div>
				<div class="space-y-2">
					<Label for="slug">Slug</Label>
					<Input
						id="slug"
						name="slug"
						value={editing?.slug ?? ''}
						placeholder="kaching-bundles"
						required
					/>
				</div>
			</div>

			<div class="space-y-2">
				<Label for="listingUrl">App Store listing URL</Label>
				<Input
					id="listingUrl"
					name="listingUrl"
					type="url"
					value={editing?.listingUrl ?? ''}
					placeholder="https://apps.shopify.com/kaching-bundles"
					required
				/>
			</div>

			<div class="space-y-2">
				<Label for="iconUrl">Icon URL <span class="text-muted-foreground">(optional)</span></Label>
				<Input id="iconUrl" name="iconUrl" type="url" value={editing?.iconUrl ?? ''} />
			</div>

			<div class="space-y-2">
				<Label for="partnerAccountId">Partner account</Label>
				<Select.Root type="single" bind:value={partnerAccountId} name="partnerAccountId">
					<Select.Trigger id="partnerAccountId" class="w-full">{accountLabel}</Select.Trigger>
					<Select.Content>
						{#each data.accounts as account (account.id)}
							<Select.Item value={account.id} label={account.name}>{account.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				{#if data.accounts.length === 0}
					<p class="text-xs text-amber-600">
						No partner accounts yet — <a href="/admin/partners" class="underline">connect one</a> so
						this app can sync.
					</p>
				{/if}
			</div>

			<div class="space-y-2">
				<Label for="partnerAppId">
					Partner app id <span class="text-muted-foreground">(for automatic sync)</span>
				</Label>
				<Input
					id="partnerAppId"
					name="partnerAppId"
					value={editing?.partnerAppId ?? ''}
					placeholder="gid://partners/App/1234567"
				/>
			</div>

			<div class="grid gap-4 sm:grid-cols-3">
				<div class="space-y-2">
					<Label for="commissionPercent">Commission %</Label>
					<Input
						id="commissionPercent"
						name="commissionPercent"
						type="number"
						min="0"
						max="100"
						step="0.5"
						value={(editing?.commissionBps ?? 2000) / 100}
						required
					/>
				</div>
				<div class="space-y-2">
					<Label for="commissionMonths">Months</Label>
					<Input
						id="commissionMonths"
						name="commissionMonths"
						type="number"
						min="0"
						max="120"
						value={editing?.commissionMonths ?? 0}
						placeholder="0"
					/>
					<p class="text-xs text-muted-foreground">0 = lifetime</p>
				</div>
				<div class="space-y-2">
					<Label for="cookieDays">Cookie days</Label>
					<Input
						id="cookieDays"
						name="cookieDays"
						type="number"
						min="1"
						max="365"
						value={editing?.cookieDays ?? 90}
						required
					/>
				</div>
			</div>

			<div class="space-y-2">
				<Label for="status">Status</Label>
				<Select.Root type="single" bind:value={status} name="status">
					<Select.Trigger id="status" class="w-full capitalize">{status}</Select.Trigger>
					<Select.Content>
						<Select.Item value="active" label="Active">Active</Select.Item>
						<Select.Item value="paused" label="Paused">Paused</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>

			<div class="space-y-3 rounded-lg border p-4">
				<div>
					<p class="text-sm font-medium">Merchant lifecycle email</p>
					<p class="text-xs text-muted-foreground">
						Sent from this program to merchants of this app. Both are off until you turn them on.
					</p>
				</div>

				<div class="space-y-2">
					<Label for="supportEmail">Reply-to address</Label>
					<Input
						id="supportEmail"
						name="supportEmail"
						type="email"
						value={editing?.supportEmail ?? ''}
						placeholder="support@getbee.app"
					/>
				</div>

				<!-- Hidden inputs carry the value; an empty string parses back to false. -->
				<input type="hidden" name="welcomeEmailEnabled" value={welcomeEmail ? 'true' : ''} />
				<input type="hidden" name="offboardEmailEnabled" value={offboardEmail ? 'true' : ''} />

				<label class="flex items-start gap-2.5 text-sm">
					<Checkbox bind:checked={welcomeEmail} />
					<span>
						Welcome email on install
						<span class="block text-xs text-muted-foreground">
							Sent 15 minutes after install, only when we have the merchant's email.
						</span>
					</span>
				</label>

				<label class="flex items-start gap-2.5 text-sm">
					<Checkbox bind:checked={offboardEmail} />
					<span>
						Offboarding email on uninstall
						<span class="block text-xs text-muted-foreground">
							Sent an hour after uninstall, asking what went wrong. Cancelled if they reinstall.
						</span>
					</span>
				</label>
			</div>

			{#if form?.error}
				<p class="text-sm text-destructive">{form.error}</p>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit">{editing ? 'Save changes' : 'Add app'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
