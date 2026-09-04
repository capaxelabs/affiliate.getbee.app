<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import Logo from '$lib/components/logo.svelte';
</script>

<div class="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
	<Logo />
	<div>
		<p class="text-5xl font-semibold tracking-tight">{page.status}</p>
		<p class="mt-2 text-sm text-muted-foreground">
			{page.error?.message ?? 'Something went wrong.'}
		</p>
	</div>
	<Button href="/">Go back</Button>
</div>
