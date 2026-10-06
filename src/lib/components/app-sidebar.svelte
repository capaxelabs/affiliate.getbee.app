<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import NavMain, { type NavItem } from './nav-main.svelte';
	import NavUser from './nav-user.svelte';
	import BeeMark from './bee-mark.svelte';

	let {
		title,
		groups,
		footer = [],
		user,
		...restProps
	}: {
		title: string;
		groups: { label?: string; items: NavItem[] }[];
		/** Settings-type links pinned to the bottom of the sidebar. */
		footer?: NavItem[];
		user: { name: string | null; email: string };
	} & ComponentProps<typeof Sidebar.Root> = $props();

	const all = $derived([...groups.flatMap((g) => g.items), ...footer]);
</script>

<Sidebar.Root collapsible="offcanvas" {...restProps}>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton class="data-[slot=sidebar-menu-button]:!p-1.5">
					{#snippet child({ props })}
						<a href="/admin" {...props}>
							<BeeMark class="!size-5 shrink-0 text-indigo-600 dark:text-indigo-400" />
							<span class="text-base font-semibold">{title}</span>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>
	<Sidebar.Content>
		{#each groups as group, i (i)}
			<NavMain label={group.label} items={group.items} {all} />
		{/each}
		{#if footer.length}
			<NavMain items={footer} {all} class="mt-auto" />
		{/if}
	</Sidebar.Content>
	<Sidebar.Footer>
		<NavUser name={user.name} email={user.email} />
	</Sidebar.Footer>
</Sidebar.Root>
