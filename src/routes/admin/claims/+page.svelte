<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import PageHeader from '$lib/components/page-header.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import { shortDate, relativeTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let notes = $state<Record<string, string>>({});

	function changeTab(value: string) {
		const url = new URL(window.location.href);
		url.searchParams.set('status', value);
		goto(url, { replaceState: true, noScroll: true });
	}

	const review = () => async ({ result, update }: any) => {
		if (result.type === 'success') toast.success(result.data?.message ?? 'Done.');
		if (result.type === 'failure') toast.error(result.data?.error ?? 'Could not review that claim.');
		await update();
	};
</script>

<svelte:head><title>Claims · Admin</title></svelte:head>

<PageHeader
	title="Claims"
	description="Shops affiliates say they referred but that weren't tracked automatically."
/>

<div class="px-5 pb-10 sm:px-8">
	<Tabs.Root value={data.status} onValueChange={changeTab}>
		<Tabs.List>
			<Tabs.Trigger value="pending">Pending</Tabs.Trigger>
			<Tabs.Trigger value="approved">Approved</Tabs.Trigger>
			<Tabs.Trigger value="rejected">Rejected</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value={data.status}>
			{#if data.claims.length === 0}
				<Card.Root class="p-0">
					<EmptyState
						icon={InboxIcon}
						title="Nothing here"
						description="No {data.status} claims right now."
					/>
				</Card.Root>
			{:else}
				<div class="space-y-4">
					{#each data.claims as claim (claim.id)}
						<Card.Root>
							<Card.Header>
								<Card.Title class="text-base">{claim.shopDomain}</Card.Title>
								<Card.Description>
									{claim.appName} · referred {shortDate(claim.referralDate)} · submitted
									{relativeTime(claim.createdAt)}
								</Card.Description>
								<Card.Action><StatusBadge status={claim.status} /></Card.Action>
							</Card.Header>

							<Card.Content class="space-y-3 text-sm">
								<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
									<a href="/admin/affiliates/{claim.affiliateId}" class="font-medium text-foreground underline">
										{claim.affiliateName ?? claim.affiliateEmail}
									</a>
									<span>·</span>
									<span>{claim.affiliateEmail}</span>
									<span>·</span>
									<span class="font-mono text-xs">{claim.refCode}</span>
								</div>

								{#if claim.note}
									<div class="rounded-lg bg-muted p-3 whitespace-pre-wrap">{claim.note}</div>
								{/if}

								{#if claim.status !== 'pending' && claim.reviewNote}
									<div class="border-t pt-3">
										<p class="mb-1 text-xs text-muted-foreground">
											Reviewed {shortDate(claim.reviewedAt)}
										</p>
										<p class="whitespace-pre-wrap">{claim.reviewNote}</p>
									</div>
								{/if}
							</Card.Content>

							{#if claim.status === 'pending' && data.canWrite}
								<Card.Footer class="flex-col items-stretch gap-3 border-t pt-5">
									<Textarea
										bind:value={notes[claim.id]}
										rows={2}
										placeholder="Note for the affiliate (optional)"
									/>
									<div class="flex justify-end gap-2">
										<form method="POST" action="?/reject" use:enhance={review}>
											<input type="hidden" name="id" value={claim.id} />
											<input type="hidden" name="note" value={notes[claim.id] ?? ''} />
											<Button type="submit" variant="outline">Reject</Button>
										</form>
										<form method="POST" action="?/approve" use:enhance={review}>
											<input type="hidden" name="id" value={claim.id} />
											<input type="hidden" name="note" value={notes[claim.id] ?? ''} />
											<Button type="submit">Approve &amp; attribute</Button>
										</form>
									</div>
								</Card.Footer>
							{/if}
						</Card.Root>
					{/each}
				</div>
			{/if}
		</Tabs.Content>
	</Tabs.Root>

	{#if form?.error}
		<p class="mt-4 text-sm text-destructive">{form.error}</p>
	{/if}
</div>
