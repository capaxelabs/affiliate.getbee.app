<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';

	let { status, label }: { status: string; label?: string } = $props();

	const tone: Record<string, string> = {
		approved: 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
		active: 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
		paid: 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
		pending: 'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300',
		draft: 'border-slate-200 dark:border-neutral-500/30 bg-slate-50 dark:bg-neutral-500/10 text-slate-700 dark:text-neutral-300',
		processing: 'border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300',
		rejected: 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300',
		failed: 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300',
		suspended: 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300',
		churned: 'border-slate-200 dark:border-neutral-500/30 bg-slate-50 dark:bg-neutral-500/10 text-slate-600 dark:text-neutral-400',
		void: 'border-slate-200 dark:border-neutral-500/30 bg-slate-50 dark:bg-neutral-500/10 text-slate-600 dark:text-neutral-400',
		paused: 'border-slate-200 dark:border-neutral-500/30 bg-slate-50 dark:bg-neutral-500/10 text-slate-600 dark:text-neutral-400'
	};
</script>

<Badge variant="outline" class="font-normal capitalize {tone[status] ?? ''}">
	{label ?? status}
</Badge>
