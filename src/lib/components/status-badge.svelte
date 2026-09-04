<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';

	let { status, label }: { status: string; label?: string } = $props();

	const tone: Record<string, string> = {
		approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
		active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
		paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
		pending: 'border-amber-200 bg-amber-50 text-amber-700',
		draft: 'border-slate-200 bg-slate-50 text-slate-700',
		processing: 'border-sky-200 bg-sky-50 text-sky-700',
		rejected: 'border-red-200 bg-red-50 text-red-700',
		failed: 'border-red-200 bg-red-50 text-red-700',
		suspended: 'border-red-200 bg-red-50 text-red-700',
		churned: 'border-slate-200 bg-slate-50 text-slate-600',
		void: 'border-slate-200 bg-slate-50 text-slate-600',
		paused: 'border-slate-200 bg-slate-50 text-slate-600'
	};
</script>

<Badge variant="outline" class="font-normal capitalize {tone[status] ?? ''}">
	{label ?? status}
</Badge>
