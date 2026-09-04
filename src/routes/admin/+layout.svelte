<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import SideNav from '$lib/components/side-nav.svelte';
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
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	const items = $derived([
		{ href: '/admin', label: 'Overview', icon: GaugeIcon },
		{ href: '/admin/apps', label: 'Apps', icon: PackageIcon },
		{ href: '/admin/merchants', label: 'Merchants', icon: BuildingIcon },
		...(data.access.canViewAffiliates
			? [
					{
						href: '/admin/affiliates',
						label: 'Affiliates',
						icon: UsersIcon,
						badge: data.queues.affiliates
					},
					{ href: '/admin/claims', label: 'Claims', icon: InboxIcon, badge: data.queues.claims },
					{ href: '/admin/referrals', label: 'Referrals', icon: StoreIcon },
					{ href: '/admin/commissions', label: 'Commissions', icon: ReceiptIcon }
				]
			: []),
		...(data.access.role === 'admin'
			? [
					{ href: '/admin/payouts', label: 'Payouts', icon: CardIcon },
					{ href: '/admin/partners', label: 'Partner accounts', icon: PlugIcon },
					{ href: '/admin/sync', label: 'Partner sync', icon: RefreshIcon },
					{ href: '/admin/team', label: 'Team', icon: ShieldIcon }
				]
			: [])
	]);
</script>

<Sidebar.Provider>
	<SideNav {items} label={data.access.role === 'admin' ? 'Admin' : 'Analytics'} user={data.user} />
	<Sidebar.Inset class="bg-muted/40">
		{#if data.access.role === 'staff'}
			<div class="border-b bg-background px-5 py-2 text-xs text-muted-foreground sm:px-8">
				Read-only access
				{#if data.access.appCount !== null}
					· {data.access.appCount}
					{data.access.appCount === 1 ? 'app' : 'apps'}
				{/if}
			</div>
		{/if}
		{@render children()}
	</Sidebar.Inset>
</Sidebar.Provider>
