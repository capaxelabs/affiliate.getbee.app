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
	import PageHeader from '$lib/components/page-header.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { relativeTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';

	type Account = PageData['accounts'][number];

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let open = $state(false);
	let editing = $state<Account | null>(null);
	let status = $state('active');

	function openCreate() {
		editing = null;
		status = 'active';
		open = true;
	}

	function openEdit(account: Account) {
		editing = account;
		status = account.status;
		open = true;
	}

	const submit = () => async ({ result, update }: any) => {
		if (result.type === 'success') {
			open = false;
			toast.success(result.data?.message ?? 'Saved.');
		} else if (result.type === 'failure') {
			toast.error(result.data?.error ?? 'Could not save that account.');
		}
		await update();
	};

	const act = () => async ({ result, update }: any) => {
		if (result.type === 'success') toast.success(result.data?.message ?? 'Done.');
		if (result.type === 'failure') toast.error(result.data?.error ?? 'That did not work.');
		await update();
	};
</script>

<svelte:head><title>Partner accounts · Admin</title></svelte:head>

<PageHeader
	title="Partner accounts"
	description="Connect one or more Shopify Partner organizations. Each app belongs to one."
>
	{#snippet actions()}
		<Button onclick={openCreate} disabled={!data.encryptionReady}>
			<PlusIcon class="size-4" /> Connect account
		</Button>
	{/snippet}
</PageHeader>

<div class="space-y-5 px-5 pb-10 sm:px-8">
	{#if !data.encryptionReady}
		<div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
			<code class="font-mono">ENCRYPTION_KEY</code> is not set, so API tokens cannot be stored. Run
			<code class="font-mono">wrangler secret put ENCRYPTION_KEY</code> first.
		</div>
	{/if}

	{#if data.canImportFromEnv}
		<div
			class="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background px-4 py-3 text-sm"
		>
			<div>
				<p class="font-medium">Partner credentials found in the environment</p>
				<p class="text-muted-foreground">
					Import them as your first account, then delete the PARTNER_* worker secrets.
				</p>
			</div>
			<form method="POST" action="?/importFromEnv" use:enhance={act}>
				<Button type="submit" variant="outline" disabled={!data.encryptionReady}>
					Import from environment
				</Button>
			</form>
		</div>
	{/if}

	{#if data.unassignedApps > 0 && data.accounts.length > 0}
		<div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
			{data.unassignedApps}
			{data.unassignedApps === 1 ? 'app is' : 'apps are'} not linked to a partner account, so the sync
			skips {data.unassignedApps === 1 ? 'it' : 'them'}. Set the account on the
			<a href="/admin/apps" class="underline">Apps</a> page.
		</div>
	{/if}

	<Card.Root class="gap-0 overflow-hidden p-0">
		{#if data.accounts.length === 0}
			<EmptyState
				icon={PlugIcon}
				title="No partner accounts yet"
				description="Connect a Shopify Partner organization to start syncing revenue and installs."
			>
				{#snippet action()}
					<Button onclick={openCreate} disabled={!data.encryptionReady}>Connect account</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Account</Table.Head>
						<Table.Head>Organization</Table.Head>
						<Table.Head>API token</Table.Head>
						<Table.Head>Version</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="text-right">Apps</Table.Head>
						<Table.Head>Last sync</Table.Head>
						<Table.Head class="w-px"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.accounts as account (account.id)}
						<Table.Row>
							<Table.Cell class="font-medium">{account.name}</Table.Cell>
							<Table.Cell class="font-mono text-xs text-muted-foreground">
								{account.organizationId}
							</Table.Cell>
							<Table.Cell class="font-mono text-xs">
								{#if account.hasToken}
									{account.apiTokenHint}
								{:else}
									<span class="text-amber-600">Not set</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{account.apiVersion}</Table.Cell>
							<Table.Cell>
								<StatusBadge status={account.status} />
								{#if account.lastSyncError}
									<span class="mt-0.5 block max-w-48 truncate text-xs text-destructive">
										{account.lastSyncError}
									</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{account.appCount}</Table.Cell>
							<Table.Cell class="text-muted-foreground">
								{account.lastSyncedAt ? relativeTime(account.lastSyncedAt) : 'never'}
							</Table.Cell>
							<Table.Cell>
								<div class="flex justify-end gap-1">
									<Button size="sm" variant="ghost" onclick={() => openEdit(account)}>Edit</Button>
									{#if account.appCount === 0}
										<form method="POST" action="?/remove" use:enhance={act}>
											<input type="hidden" name="id" value={account.id} />
											<Button type="submit" size="sm" variant="ghost">Disconnect</Button>
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
</div>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{editing ? `Edit ${editing.name}` : 'Connect partner account'}</Dialog.Title>
			<Dialog.Description>
				The organization id is the number in your Partner dashboard URL. Create the API token under
				Settings → Partner API clients with read access to app events and transactions.
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

			<div class="space-y-2">
				<Label for="name">Name</Label>
				<Input id="name" name="name" value={editing?.name ?? ''} placeholder="Bee Apps" required />
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="space-y-2">
					<Label for="organizationId">Organization id</Label>
					<Input
						id="organizationId"
						name="organizationId"
						value={editing?.organizationId ?? ''}
						placeholder="1234567"
						required
					/>
				</div>
				<div class="space-y-2">
					<Label for="apiVersion">API version</Label>
					<Input
						id="apiVersion"
						name="apiVersion"
						value={editing?.apiVersion ?? data.defaultApiVersion}
						placeholder="2025-01"
					/>
				</div>
			</div>

			<div class="space-y-2">
				<Label for="apiToken">
					API token
					{#if editing?.hasToken}
						<span class="text-muted-foreground">(leave blank to keep {editing.apiTokenHint})</span>
					{/if}
				</Label>
				<Input
					id="apiToken"
					name="apiToken"
					type="password"
					autocomplete="off"
					placeholder={editing?.hasToken ? 'Unchanged' : 'prtapi_...'}
				/>
				<p class="text-xs text-muted-foreground">
					Encrypted before it is stored and never shown again.
				</p>
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
				<p class="text-xs text-muted-foreground">Paused accounts are skipped by the sync.</p>
			</div>

			{#if form?.error}
				<p class="text-sm text-destructive">{form.error}</p>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit">{editing ? 'Save changes' : 'Connect'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
