<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import PageHeader from '$lib/components/page-header.svelte';
	import Pagination from '$lib/components/pagination.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import StarIcon from '@lucide/svelte/icons/star';
	import { shortDate } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let editing = $state<string | null>(null);

	const appLabel = $derived(data.apps.find((a) => a.id === data.filters.appId)?.name ?? 'All apps');
	const ratingLabel = $derived(data.filters.rating ? `${data.filters.rating} stars` : 'Any rating');
	const SHOW: Record<string, string> = {
		'': 'All reviews',
		unreplied: 'Not replied',
		unmatched: 'Not matched',
		removed: 'Removed'
	};
	const totalLive = $derived(data.distribution.reduce((a, d) => a + d.count, 0));
	const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

	function apply(next: Record<string, string>) {
		const url = new URL(window.location.href);
		for (const [key, value] of Object.entries(next)) {
			if (value && value !== 'all') url.searchParams.set(key, value);
			else url.searchParams.delete(key);
		}
		url.searchParams.delete('page');
		goto(url, { replaceState: true, noScroll: true });
	}

	const link = () => {
		return async ({ result, update }: any) => {
			if (result.type === 'success') {
				toast.success(result.data?.message);
				editing = null;
			} else if (result.type === 'failure') toast.error(result.data?.error ?? 'Unable to link.');
			await update();
		};
	};
</script>

<svelte:head><title>Reviews · Admin</title></svelte:head>

<PageHeader title="Reviews" description="App Store reviews for every app, checked once a day.">
	{#snippet actions()}
		<Select.Root type="single" value={data.filters.appId || 'all'} onValueChange={(v) => apply({ app: v })}>
			<Select.Trigger class="w-44">{appLabel}</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="All apps">All apps</Select.Item>
				{#each data.apps as app (app.id)}
					<Select.Item value={app.id} label={app.name}>{app.name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{/snippet}
</PageHeader>

<div class="space-y-5 px-5 pb-10 sm:px-8">
	<div class="grid gap-4 lg:grid-cols-3">
		<Card.Root class="lg:col-span-1">
			<Card.Header>
				<Card.Title class="text-base">Ratings</Card.Title>
				<Card.Description>Reviews still on the listing.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-1.5">
				{#each data.distribution as d (d.rating)}
					<button
						type="button"
						onclick={() => apply({ rating: data.filters.rating === String(d.rating) ? '' : String(d.rating) })}
						class="flex w-full items-center gap-2 text-sm hover:opacity-80"
					>
						<span class="w-10 text-left tabular-nums">{d.rating} ★</span>
						<span class="h-2 flex-1 overflow-hidden rounded-full bg-muted">
							<span
								class="block h-full rounded-full bg-amber-500"
								style="width: {totalLive ? (d.count / totalLive) * 100 : 0}%"
							></span>
						</span>
						<span class="w-8 text-right tabular-nums text-muted-foreground">{d.count}</span>
					</button>
				{/each}
			</Card.Content>
		</Card.Root>

		<Card.Root class="lg:col-span-2">
			<Card.Header>
				<Card.Title class="text-base">By app</Card.Title>
				<Card.Description>The rating and count Shopify shows on each listing.</Card.Description>
			</Card.Header>
			<Card.Content>
				<ul class="grid gap-2 sm:grid-cols-2">
					{#each data.apps.filter((a) => a.reviewCount !== null) as app (app.id)}
						<li class="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
							<span class="truncate font-medium">{app.name}</span>
							<span class="shrink-0 tabular-nums text-muted-foreground">
								{((app.ratingHundredths ?? 0) / 100).toFixed(1)} ★ · {app.reviewCount}
							</span>
						</li>
					{:else}
						<li class="text-sm text-muted-foreground">
							No listings checked yet. Run a check from
							<a href="/admin/integrations" class="underline">Integrations</a>.
						</li>
					{/each}
				</ul>
			</Card.Content>
		</Card.Root>
	</div>

	<Card.Root class="gap-0 overflow-hidden p-0">
		<div class="flex flex-wrap items-center gap-2 border-b px-5 py-3">
			<Select.Root type="single" value={data.filters.rating || 'all'} onValueChange={(v) => apply({ rating: v })}>
				<Select.Trigger class="w-36">{ratingLabel}</Select.Trigger>
				<Select.Content>
					<Select.Item value="all" label="Any rating">Any rating</Select.Item>
					{#each [5, 4, 3, 2, 1] as n (n)}
						<Select.Item value={String(n)} label="{n} stars">{n} stars</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<Select.Root type="single" value={data.filters.show || 'all'} onValueChange={(v) => apply({ show: v })}>
				<Select.Trigger class="w-40">{SHOW[data.filters.show] ?? 'All reviews'}</Select.Trigger>
				<Select.Content>
					{#each Object.entries(SHOW) as [value, label] (value)}
						<Select.Item value={value || 'all'} {label}>{label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		{#if data.reviews.length === 0}
			<EmptyState
				icon={StarIcon}
				title="No reviews here"
				description="Reviews appear after the daily check reads each app's listing. Clear the filters to see everything."
			/>
		{:else}
			<ul class="divide-y">
				{#each data.reviews as review (review.id)}
					<li class="space-y-1.5 px-5 py-4 {review.removedAt ? 'opacity-60' : ''}">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<p class="text-sm">
								<span class="text-amber-500" title="{review.rating} out of 5">{stars(review.rating)}</span>
								<span class="ml-2 font-medium">{review.author ?? 'Unknown store'}</span>
								<span class="text-muted-foreground">
									· {review.appName}{review.country ? ` · ${review.country}` : ''}
								</span>
							</p>
							<p class="text-xs text-muted-foreground">
								{shortDate(review.postedAt ?? review.firstSeenAt)}
								{#if review.removedAt}· removed {shortDate(review.removedAt)}{/if}
								{#if review.replied}· replied{/if}
							</p>
						</div>
						{#if review.body}
							<p class="text-sm whitespace-pre-line">{review.body}</p>
						{:else}
							<p class="text-sm text-muted-foreground">Rating only, no text.</p>
						{/if}
						<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							{#if review.usage}<span>{review.usage}</span>{/if}
							{#if review.shopDomain}
								<span>
									· {review.shopDomain}
									{review.matchedBy === 'name' ? '(matched by name)' : '(linked by hand)'}
								</span>
							{/if}
							{#if data.canWrite && editing !== review.id}
								<button type="button" class="underline" onclick={() => (editing = review.id)}>
									{review.shopDomain ? 'Change merchant' : 'Link to a merchant'}
								</button>
							{/if}
						</div>
						{#if editing === review.id}
							<form method="POST" action="?/link" use:enhance={link} class="flex flex-wrap items-center gap-2">
								<input type="hidden" name="reviewId" value={review.id} />
								<Input
									name="shopDomain"
									value={review.shopDomain ?? ''}
									placeholder="store-name.myshopify.com"
									class="h-8 max-w-64"
								/>
								<Button type="submit" size="sm">Save link</Button>
								<Button type="button" size="sm" variant="ghost" onclick={() => (editing = null)}>Cancel</Button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
			<Pagination
				page={data.page}
				pageCount={data.pageCount}
				total={data.total}
				pageSize={data.pageSize}
				label="reviews"
			/>
		{/if}
	</Card.Root>
</div>
