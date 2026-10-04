<script lang="ts">
	import { setContext } from 'svelte';
	import { page } from '$app/state';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import SiteHeader from '$lib/components/site-header.svelte';
	import type { NavItem } from '$lib/components/nav-main.svelte';
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import PackageIcon from '@lucide/svelte/icons/package';
	import BuildingIcon from '@lucide/svelte/icons/building-2';
	import UsersIcon from '@lucide/svelte/icons/users';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import StoreIcon from '@lucide/svelte/icons/store';
	import ReceiptIcon from '@lucide/svelte/icons/receipt';
	import CardIcon from '@lucide/svelte/icons/credit-card';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import StarIcon from '@lucide/svelte/icons/star';
	import BlocksIcon from '@lucide/svelte/icons/blocks';
	import ChartIcon from '@lucide/svelte/icons/chart-line';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	setContext('site-header', true);

	const groups = $derived<{ label?: string; items: NavItem[] }[]>([
		{
			items: [
				{ href: '/admin', label: 'Overview', icon: GaugeIcon },
				{ href: '/admin/subscriptions', label: 'Subscriptions', icon: RepeatIcon },
				{ href: '/admin/insights', label: 'Insights', icon: ChartIcon }
			]
		},
		{
			label: 'Customers',
			items: [
				{ href: '/admin/apps', label: 'Apps', icon: PackageIcon },
				{ href: '/admin/merchants', label: 'Merchants', icon: BuildingIcon },
				{ href: '/admin/reviews', label: 'Reviews', icon: StarIcon }
			]
		},
		...(data.access.canViewAffiliates
			? [
					{
						label: 'Affiliate program',
						items: [
							{
								href: '/admin/affiliates',
								label: 'Affiliates',
								icon: UsersIcon,
								badge: data.queues.affiliates
							},
							{ href: '/admin/claims', label: 'Claims', icon: InboxIcon, badge: data.queues.claims },
							{ href: '/admin/referrals', label: 'Referrals', icon: StoreIcon },
							{ href: '/admin/commissions', label: 'Commissions', icon: ReceiptIcon },
							...(data.access.role === 'admin'
								? [{ href: '/admin/payouts', label: 'Payouts', icon: CardIcon }]
								: [])
						]
					}
				]
			: [])
	]);

	const footer = $derived<NavItem[]>(
		data.access.role === 'admin'
			? [
					{ href: '/admin/partners', label: 'Partner accounts', icon: PlugIcon },
					{ href: '/admin/sync', label: 'Partner sync', icon: RefreshIcon },
					{ href: '/admin/integrations', label: 'Integrations', icon: BlocksIcon },
					{ href: '/admin/team', label: 'Team', icon: ShieldIcon }
				]
			: []
	);

	const title = $derived.by(() => {
		const path = page.url.pathname;
		const all = [...groups.flatMap((g) => g.items), ...footer];
		const match = all
			.filter((i) => path === i.href || path.startsWith(i.href + '/'))
			.sort((a, b) => b.href.length - a.href.length)[0];
		return match?.label ?? 'Admin';
	});
</script>

<Sidebar.Provider
	style="--sidebar-width: calc(var(--spacing) * 64); --header-height: calc(var(--spacing) * 12);"
>
	<AppSidebar
		variant="inset"
		title={data.access.role === 'admin' ? 'Bee Affiliates' : 'Bee Analytics'}
		{groups}
		{footer}
		user={data.user}
	/>
	<Sidebar.Inset>
		<SiteHeader {title}>
			{#snippet actions()}
				{#if data.access.role === 'staff'}
					<span class="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
						Read-only{data.access.appCount !== null
							? ` · ${data.access.appCount} ${data.access.appCount === 1 ? 'app' : 'apps'}`
							: ''}
					</span>
				{/if}
			{/snippet}
		</SiteHeader>
		<div class="@container/main flex flex-1 flex-col">
			{@render children()}
		</div>
	</Sidebar.Inset>
</Sidebar.Provider>
