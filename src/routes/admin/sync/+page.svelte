<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import PageHeader from '$lib/components/page-header.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import { relativeTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let running = $state<string | null>(null);

	const run = (key: string) => () => {
		running = key;
		return async ({ result, update }: any) => {
			running = null;
			if (result.type === 'success') {
				if (result.data?.success) toast.success(result.data.message);
				else toast.error(result.data?.message ?? 'Sync failed.');
			} else if (result.type === 'failure') {
				toast.error(result.data?.error ?? 'Sync failed.');
			}
			await update();
		};
	};

	function duration(started: Date, finished: Date | null) {
		if (!finished) return 'running';
		const seconds = Math.max(1, Math.round((+finished - +started) / 1000));
		return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
	}
</script>

<svelte:head><title>Partner sync · Admin</title></svelte:head>

<PageHeader
	title="Partner sync"
	description="Pulls installs and billing transactions from every connected Partner account."
>
	{#snippet actions()}
		<form method="POST" action="?/syncAll" use:enhance={run('all')}>
			<Button type="submit" disabled={!data.syncableCount || running !== null}>
				{#if running === 'all'}
					<LoaderIcon class="size-4 animate-spin" />
				{:else}
					<RefreshIcon class="size-4" />
				{/if}
				Sync all accounts
			</Button>
		</form>
	{/snippet}
</PageHeader>

<div class="space-y-5 px-5 pb-10 sm:px-8">
	{#if data.untracked > 0}
		<div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
			{data.untracked}
			{data.untracked === 1 ? 'app is' : 'apps are'} missing a partner account or a Partner app id, so
			the sync skips {data.untracked === 1 ? 'it' : 'them'}. Fix that on the
			<a href="/admin/apps" class="underline">Apps</a> page.
		</div>
	{/if}

	<Card.Root class="gap-0 p-0">
		<Card.Header class="border-b px-5 py-4">
			<Card.Title class="text-base">Connected accounts</Card.Title>
			<Card.Action>
				<Button href="/admin/partners" variant="ghost" size="sm">Manage</Button>
			</Card.Action>
		</Card.Header>
		<Card.Content class="p-0">
			{#if data.accounts.length === 0}
				<EmptyState
					icon={PlugIcon}
					title="No partner accounts connected"
					description="Connect a Shopify Partner organization to start syncing."
				>
					{#snippet action()}
						<Button href="/admin/partners">Connect account</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<ul class="divide-y">
					{#each data.accounts as account (account.id)}
						<li class="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
							<div class="min-w-0">
								<p class="font-medium">{account.name}</p>
								<p class="text-xs text-muted-foreground">
									org {account.organizationId} · {account.appCount}
									{account.appCount === 1 ? 'app' : 'apps'} ·
									{account.lastSyncedAt ? `synced ${relativeTime(account.lastSyncedAt)}` : 'never synced'}
								</p>
								{#if account.lastSyncError}
									<p class="mt-0.5 text-xs text-destructive">{account.lastSyncError}</p>
								{/if}
							</div>
							<div class="flex shrink-0 flex-wrap items-center gap-2">
								{#if account.status !== 'active'}
									<StatusBadge status="paused" />
								{:else if !account.hasToken}
									<StatusBadge status="pending" label="No token" />
								{/if}
								<form method="POST" action="?/installs" use:enhance={run(`i-${account.id}`)}>
									<input type="hidden" name="partnerAccountId" value={account.id} />
									<Button
										type="submit"
										size="sm"
										variant="ghost"
										disabled={!account.hasToken || running !== null}
									>
										{#if running === `i-${account.id}`}
											<LoaderIcon class="size-3.5 animate-spin" />
										{/if}
										Installs
									</Button>
								</form>
								<form method="POST" action="?/transactions" use:enhance={run(`t-${account.id}`)}>
									<input type="hidden" name="partnerAccountId" value={account.id} />
									<Button
										type="submit"
										size="sm"
										variant="outline"
										disabled={!account.hasToken || running !== null}
									>
										{#if running === `t-${account.id}`}
											<LoaderIcon class="size-3.5 animate-spin" />
										{/if}
										Transactions
									</Button>
								</form>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Merchant lifecycle email</Card.Title>
			<Card.Description>
				Welcome {data.emailStats.welcome.sent} sent / {data.emailStats.welcome.pending} queued ·
				Offboarding {data.emailStats.offboard.sent} sent / {data.emailStats.offboard.pending} queued
			</Card.Description>
		</Card.Header>
		<Card.Footer class="border-t pt-5">
			<form method="POST" action="?/lifecycle" use:enhance={run('lifecycle')}>
				<Button type="submit" variant="outline" disabled={running !== null}>
					{#if running === 'lifecycle'}
						<LoaderIcon class="size-4 animate-spin" />
					{:else}
						<MailIcon class="size-4" />
					{/if}
					Send queued email
				</Button>
			</form>
		</Card.Footer>
	</Card.Root>

	<Card.Root class="gap-0 overflow-hidden p-0">
		<Card.Header class="border-b px-5 py-4">
			<Card.Title class="text-base">Run history</Card.Title>
		</Card.Header>
		<Card.Content class="p-0">
			{#if data.runs.length === 0}
				<EmptyState
					icon={RefreshIcon}
					title="No sync runs yet"
					description="Trigger one above, or point a scheduler at POST /api/cron/sync."
				/>
			{:else}
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Started</Table.Head>
								<Table.Head>Account</Table.Head>
								<Table.Head>Kind</Table.Head>
								<Table.Head>Trigger</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head class="text-right">Seen</Table.Head>
								<Table.Head class="text-right">Matched</Table.Head>
								<Table.Head class="text-right">Commissions</Table.Head>
								<Table.Head class="text-right">Took</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.runs as run (run.id)}
								<Table.Row>
									<Table.Cell class="text-muted-foreground">{relativeTime(run.startedAt)}</Table.Cell>
									<Table.Cell>{run.accountName ?? '—'}</Table.Cell>
									<Table.Cell class="capitalize">{run.kind}</Table.Cell>
									<Table.Cell class="text-muted-foreground capitalize">{run.trigger}</Table.Cell>
									<Table.Cell>
										<StatusBadge
											status={run.status === 'success'
												? 'approved'
												: run.status === 'failed'
													? 'failed'
													: 'processing'}
											label={run.status}
										/>
										{#if run.error}
											<span class="mt-0.5 block max-w-xs truncate text-xs text-destructive">
												{run.error}
											</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{run.recordsSeen}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{run.recordsMatched}</Table.Cell>
									<Table.Cell class="text-right tabular-nums">{run.commissionsCreated}</Table.Cell>
									<Table.Cell class="text-right text-muted-foreground">
										{duration(run.startedAt, run.finishedAt)}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if form?.error}
		<p class="text-sm text-destructive">{form.error}</p>
	{/if}
</div>
