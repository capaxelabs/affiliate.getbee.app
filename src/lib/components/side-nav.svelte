<script lang="ts">
	import type { Component } from 'svelte';
	import { page } from '$app/state';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import Logo from './logo.svelte';
	import NavUser from './nav-user.svelte';

	type Item = { href: string; label: string; icon: Component; badge?: number };

	let {
		items,
		label,
		user
	}: { items: Item[]; label: string; user: { name: string | null; email: string } } = $props();

	const matches = (href: string) =>
		href === page.url.pathname || page.url.pathname.startsWith(href + '/');

	// The most specific match wins, so the section root (/admin) is not lit up
	// alongside every page beneath it.
	function isActive(href: string) {
		if (!matches(href)) return false;
		return !items.some((other) => other.href.length > href.length && matches(other.href));
	}
</script>

<Sidebar.Root collapsible="offcanvas">
	<Sidebar.Header class="px-2 py-3">
		<Logo {label} class="px-1" />
	</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each items as item (item.href)}
						{@const Icon = item.icon}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={isActive(item.href)}>
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
	</Sidebar.Content>
	<Sidebar.Footer>
		<NavUser name={user.name} email={user.email} />
	</Sidebar.Footer>
</Sidebar.Root>
