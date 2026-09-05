<script lang="ts">
	import { page as current } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	let {
		page,
		pageCount,
		total,
		pageSize,
		label = 'rows'
	}: {
		page: number;
		pageCount: number;
		total: number;
		pageSize: number;
		label?: string;
	} = $props();

	const first = $derived(total === 0 ? 0 : (page - 1) * pageSize + 1);
	const last = $derived(Math.min(page * pageSize, total));

	/** Keeps every other filter in the URL when the page changes. */
	function href(target: number) {
		const url = new URL(current.url);
		if (target <= 1) url.searchParams.delete('page');
		else url.searchParams.set('page', String(target));
		return url.pathname + url.search;
	}

	// First, last, and a window around the current page. `null` renders an ellipsis.
	const numbers = $derived.by(() => {
		const wanted = new Set([1, pageCount, page - 1, page, page + 1]);
		const shown = [...wanted].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);

		const out: (number | null)[] = [];
		for (const [i, n] of shown.entries()) {
			if (i > 0 && n - shown[i - 1] > 1) out.push(null);
			out.push(n);
		}
		return out;
	});
</script>

{#if total > 0}
	<div class="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
		<p class="text-sm text-muted-foreground">
			{first}–{last} of {total}
			{label}
		</p>

		{#if pageCount > 1}
			<div class="flex items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					href={page > 1 ? href(page - 1) : undefined}
					disabled={page === 1}
				>
					<ChevronLeftIcon class="size-4" /> Previous
				</Button>

				{#each numbers as number, i (number === null ? `gap-${i}` : number)}
					{#if number === null}
						<span class="px-1.5 text-sm text-muted-foreground">…</span>
					{:else}
						<Button
							variant={number === page ? 'secondary' : 'ghost'}
							size="sm"
							href={href(number)}
							class="min-w-9 tabular-nums"
						>
							{number}
						</Button>
					{/if}
				{/each}

				<Button
					variant="ghost"
					size="sm"
					href={page < pageCount ? href(page + 1) : undefined}
					disabled={page === pageCount}
				>
					Next <ChevronRightIcon class="size-4" />
				</Button>
			</div>
		{/if}
	</div>
{/if}
