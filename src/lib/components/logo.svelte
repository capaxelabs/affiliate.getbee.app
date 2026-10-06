<script lang="ts">
	import BeeMark from './bee-mark.svelte';

	let { label = 'Affiliates', class: className = '' }: { label?: string; class?: string } = $props();
</script>

<div class="flex items-center gap-2.5 {className}">
	<BeeMark class="size-7 shrink-0 text-indigo-600 dark:text-indigo-400" />
	<span class="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">{label}</span>
</div>
