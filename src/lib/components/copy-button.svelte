<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';

	let {
		value,
		label = 'Copy',
		copiedLabel = 'Copied',
		size = 'sm',
		variant = 'outline'
	}: {
		value: string;
		label?: string;
		copiedLabel?: string;
		size?: 'sm' | 'default' | 'icon';
		variant?: 'outline' | 'ghost' | 'secondary';
	} = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout>;

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
		} catch {
			return;
		}
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 1800);
	}
</script>

<Button {variant} {size} onclick={copy} class="gap-1.5">
	{#if copied}
		<CheckIcon class="size-3.5" />
	{:else}
		<CopyIcon class="size-3.5" />
	{/if}
	{copied ? copiedLabel : label}
</Button>
