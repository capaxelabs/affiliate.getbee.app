<script lang="ts">
	let { label = 'Affiliates', class: className = '' }: { label?: string; class?: string } = $props();
</script>

<div class="flex items-center gap-2.5 {className}">
	<div
		class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-sky-400 text-sm font-bold text-white"
	>
		B
	</div>
	<span class="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">{label}</span>
</div>
