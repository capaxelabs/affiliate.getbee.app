<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import SideNav from '$lib/components/side-nav.svelte';
	import HomeIcon from '@lucide/svelte/icons/house';
	import UsersIcon from '@lucide/svelte/icons/users';
	import CardIcon from '@lucide/svelte/icons/credit-card';
	import ChartIcon from '@lucide/svelte/icons/chart-column';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	const items = [
		{ href: '/app', label: 'Home', icon: HomeIcon },
		{ href: '/app/referrals', label: 'Referrals', icon: UsersIcon },
		{ href: '/app/payouts', label: 'Payouts', icon: CardIcon },
		{ href: '/app/reports', label: 'Reports', icon: ChartIcon },
		{ href: '/app/settings', label: 'Settings', icon: SettingsIcon }
	];
</script>

<Sidebar.Provider>
	<SideNav {items} label="Affiliates" user={data.user} />
	<Sidebar.Inset class="bg-muted/40">
		{#if data.user.affiliateStatus === 'pending'}
			<div class="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800 sm:px-8">
				Your account is awaiting approval — referrals start counting once you're approved.
			</div>
		{:else if data.user.affiliateStatus === 'suspended'}
			<div class="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800 sm:px-8">
				Your account is suspended. Existing commissions are safe, but new referrals won't be
				tracked.
			</div>
		{:else if data.user.affiliateStatus === 'rejected'}
			<div class="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800 sm:px-8">
				Your application wasn't approved. Reply to our email if you'd like another look.
			</div>
		{/if}
		{@render children()}
	</Sidebar.Inset>
</Sidebar.Provider>
