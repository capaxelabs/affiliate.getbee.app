<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import Logo from '$lib/components/logo.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);
	const step = $derived(form?.step === 'code' ? 'code' : 'email');
	const email = $derived(form && 'email' in form ? (form.email as string) : '');

	const submit = () => {
		submitting = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			submitting = false;
		};
	};
</script>

<svelte:head><title>Sign in · Bee Affiliates</title></svelte:head>

<div class="flex min-h-screen items-center justify-center bg-muted/40 px-5 py-12">
	<div class="w-full max-w-sm">
		<div class="mb-8 flex justify-center"><Logo /></div>

		<div class="rounded-xl border bg-background p-7 shadow-sm">
			{#if step === 'email'}
				<h1 class="text-lg font-semibold tracking-tight">Sign in</h1>
				<p class="mt-1 mb-6 text-sm text-muted-foreground">
					We'll email you a code. No password to remember.
				</p>

				<form method="POST" action="?/requestCode" use:enhance={submit} class="space-y-4">
					<div class="space-y-2">
						<Label for="email">Email</Label>
						<Input
							id="email"
							name="email"
							type="email"
							autocomplete="email"
							placeholder="you@company.com"
							required
							autofocus
						/>
					</div>

					{#if form?.error}
						<p class="text-sm text-destructive">{form.error}</p>
					{/if}

					<input type="hidden" name="next" value={data.next ?? ''} />
					<Button type="submit" class="w-full" disabled={submitting}>
						{#if submitting}<LoaderIcon class="size-4 animate-spin" />{/if}
						Send code
					</Button>
				</form>

				<p class="mt-6 text-center text-xs text-muted-foreground">
					New here? Signing in creates your affiliate account. An admin reviews it before referrals
					start counting.
				</p>
			{:else}
				<h1 class="text-lg font-semibold tracking-tight">Check your email</h1>
				<p class="mt-1 mb-6 text-sm text-muted-foreground">
					We sent a 6-digit code to <span class="font-medium text-foreground">{email}</span>.
				</p>

				<form method="POST" action="?/verifyCode" use:enhance={submit} class="space-y-4">
					<input type="hidden" name="email" value={email} />
					<input type="hidden" name="next" value={data.next ?? ''} />

					<div class="space-y-2">
						<Label for="code">Sign-in code</Label>
						<Input
							id="code"
							name="code"
							inputmode="numeric"
							autocomplete="one-time-code"
							maxlength={6}
							placeholder="000000"
							class="text-center text-2xl tracking-[0.5em] tabular-nums"
							required
							autofocus
						/>
					</div>

					<div class="space-y-2">
						<Label for="name">Your name <span class="text-muted-foreground">(optional)</span></Label
						>
						<Input id="name" name="name" autocomplete="name" placeholder="Alex Doe" />
					</div>

					{#if form?.error}
						<p class="text-sm text-destructive">{form.error}</p>
					{:else if form && 'resent' in form && form.resent}
						<p class="text-sm text-emerald-600">New code sent.</p>
					{/if}

					<Button type="submit" class="w-full" disabled={submitting}>
						{#if submitting}<LoaderIcon class="size-4 animate-spin" />{/if}
						Sign in
					</Button>
				</form>

				<div class="mt-5 flex items-center justify-between text-xs">
					<a href="/login" class="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
						<ArrowLeftIcon class="size-3" /> Use another email
					</a>
					<form method="POST" action="?/resendCode" use:enhance>
						<input type="hidden" name="email" value={email} />
						<button type="submit" class="text-muted-foreground hover:text-foreground">
							Resend code
						</button>
					</form>
				</div>
			{/if}
		</div>
	</div>
</div>
