<script lang="ts" module>
	import type { Component } from 'svelte';

	export type NavItem = { href: string; label: string; icon: Component; badge?: number };
</script>

<script lang="ts">
	import { page } from '$app/state';
	import * as Sidebar from '$lib/components/ui/sidebar';

	let {
		label,
		items,
		all = items,
		class: className = ''
	}: {
		label?: string;
		items: NavItem[];
		/** Every item in the sidebar, so the most specific match wins across groups. */
		all?: NavItem[];
		class?: string;
	} = $props();

	const matches = (href: string) =>
		href === page.url.pathname || page.url.pathname.startsWith(href + '/');

	// The most specific match wins, so a section root is not lit up alongside
	// every page beneath it.
	function isActive(href: string) {
		if (!matches(href)) return false;
		return !all.some((other) => other.href.length > href.length && matches(other.href));
	}
</script>

<Sidebar.Group class={className}>
	{#if label}
		<Sidebar.GroupLabel>{label}</Sidebar.GroupLabel>
	{/if}
	<Sidebar.GroupContent>
		<Sidebar.Menu>
			{#each items as item (item.href)}
				{@const Icon = item.icon}
				<Sidebar.MenuItem>
					<Sidebar.MenuButton isActive={isActive(item.href)} tooltipContent={item.label}>
						{#snippet child({ props })}
							<a href={item.href} {...props}>
								<Icon />
								<span>{item.label}</span>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
					{#if item.badge}
						<Sidebar.MenuBadge>{item.badge}</Sidebar.MenuBadge>
					{/if}
				</Sidebar.MenuItem>
			{/each}
		</Sidebar.Menu>
	</Sidebar.GroupContent>
</Sidebar.Group>
