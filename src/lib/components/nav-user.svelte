<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Avatar from '$lib/components/ui/avatar';
	import { Button } from '$lib/components/ui/button';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import { initials } from '$lib/format';

	let { name, email }: { name: string | null; email: string } = $props();
</script>

<div class="flex items-center gap-2.5 border-t px-2 py-3">
	<Avatar.Root class="size-8 rounded-lg">
		<Avatar.Fallback class="rounded-lg bg-indigo-500 text-xs font-semibold text-white">
			{initials(name, email)}
		</Avatar.Fallback>
	</Avatar.Root>
	<div class="min-w-0 flex-1">
		<p class="truncate text-sm font-medium">{name ?? email.split('@')[0]}</p>
		<p class="truncate text-xs text-muted-foreground">{email}</p>
	</div>
	<form method="POST" action="/logout" use:enhance>
		<Button type="submit" variant="ghost" size="icon" class="size-8" title="Sign out">
			<LogOutIcon class="size-4" />
		</Button>
	</form>
</div>
