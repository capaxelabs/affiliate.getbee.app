<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import PageHeader from '$lib/components/page-header.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import { relativeTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let inviteOpen = $state(false);
	let inviteAffiliates = $state(false);
	let grantFor = $state<Record<string, string>>({});

	const grantOptions = $derived([
		...data.accounts.map((a) => ({
			value: `account:${a.id}`,
			label: `${a.name} — every app`
		})),
		...data.apps.map((a) => ({ value: `app:${a.id}`, label: a.name }))
	]);

	function grantLabel(userId: string) {
		const value = grantFor[userId];
		return grantOptions.find((o) => o.value === value)?.label ?? 'Choose an app or account';
	}

	function toggleVisibility(userId: string) {
		const form = document.getElementById(`visibility-${userId}`);
		if (form instanceof HTMLFormElement) form.requestSubmit();
	}

	const act = () => async ({ result, update }: any) => {
		if (result.type === 'success') {
			inviteOpen = false;
			toast.success(result.data?.message ?? 'Done.');
		} else if (result.type === 'failure') {
			toast.error(result.data?.error ?? 'That did not work.');
		}
		await update();
	};
</script>

<svelte:head><title>Team · Admin</title></svelte:head>

<PageHeader
	title="Team"
	description="Full admins see everything. Staff are read-only and see only the apps you grant."
>
	{#snippet actions()}
		<Button onclick={() => (inviteOpen = true)}><PlusIcon class="size-4" /> Add staff</Button>
	{/snippet}
</PageHeader>

<div class="space-y-4 px-5 pb-10 sm:px-8">
	{#each data.team as member (member.id)}
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">{member.name ?? member.email}</Card.Title>
				<Card.Description>
					{member.email} · {member.lastLoginAt
						? `last signed in ${relativeTime(member.lastLoginAt)}`
						: 'has not signed in yet'}
				</Card.Description>
				<Card.Action>
					{#if member.role === 'admin'}
						<Badge variant="outline" class="border-indigo-200 bg-indigo-50 text-indigo-700">
							Full admin
						</Badge>
					{:else}
						<Badge variant="outline">Staff · read-only</Badge>
					{/if}
				</Card.Action>
			</Card.Header>

			{#if member.role === 'staff'}
				<Card.Content class="space-y-4">
					<div>
						<p class="mb-2 text-sm font-medium">Access</p>
						{#if member.scopes.length === 0}
							<p class="text-sm text-muted-foreground">
								Nothing granted yet — they can sign in but will see no data.
							</p>
						{:else}
							<div class="flex flex-wrap gap-2">
								{#each member.scopes as scope (scope.id)}
									<span
										class="inline-flex items-center gap-1.5 rounded-full border bg-background py-1 pr-1 pl-3 text-sm"
									>
										{#if scope.appId}
											{scope.appName}
										{:else}
											{scope.accountName} — every app
										{/if}
										<form method="POST" action="?/revoke" use:enhance={act}>
											<input type="hidden" name="scopeId" value={scope.id} />
											<button
												type="submit"
												class="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
												title="Revoke"
											>
												<XIcon class="size-3.5" />
											</button>
										</form>
									</span>
								{/each}
							</div>
						{/if}
					</div>

					<form
						method="POST"
						action="?/grant"
						use:enhance={act}
						class="flex flex-wrap items-end gap-2"
					>
						<input type="hidden" name="userId" value={member.id} />
						<div class="min-w-56 flex-1 space-y-1.5">
							<Label for="grant-{member.id}">Grant access to</Label>
							<Select.Root
								type="single"
								value={grantFor[member.id] ?? ''}
								onValueChange={(v) => (grantFor[member.id] = v)}
								name="target"
							>
								<Select.Trigger id="grant-{member.id}" class="w-full">
									{grantLabel(member.id)}
								</Select.Trigger>
								<Select.Content>
									{#each grantOptions as option (option.value)}
										<Select.Item value={option.value} label={option.label}>
											{option.label}
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
						<Button type="submit" variant="outline" disabled={!grantFor[member.id]}>Grant</Button>
					</form>

					<div class="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
						<form
							id="visibility-{member.id}"
							method="POST"
							action="?/setAffiliateVisibility"
							use:enhance={act}
							class="min-w-0"
						>
							<input type="hidden" name="userId" value={member.id} />
							<input type="hidden" name="value" value={member.viewAffiliateData ? '' : 'true'} />
							<label class="flex items-start gap-2.5 text-sm">
								<!-- Submitting on change keeps this a single click. -->
								<Checkbox
									checked={member.viewAffiliateData}
									onCheckedChange={() => toggleVisibility(member.id)}
								/>
								<span>
									Can see the affiliate program
									<span class="block text-xs text-muted-foreground">
										Off means they only see app analytics, merchants and revenue.
									</span>
								</span>
							</label>
						</form>

						<div class="flex gap-2">
							<form method="POST" action="?/makeOwner" use:enhance={act}>
								<input type="hidden" name="userId" value={member.id} />
								<Button type="submit" size="sm" variant="ghost">Make full admin</Button>
							</form>
							<form method="POST" action="?/removeStaff" use:enhance={act}>
								<input type="hidden" name="userId" value={member.id} />
								<Button type="submit" size="sm" variant="ghost">Remove access</Button>
							</form>
						</div>
					</div>
				</Card.Content>
			{/if}
		</Card.Root>
	{/each}

	{#if form?.error}
		<p class="text-sm text-destructive">{form.error}</p>
	{/if}
</div>

<Dialog.Root bind:open={inviteOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Add staff</Dialog.Title>
			<Dialog.Description>
				They sign in with an emailed code like everyone else. Grant them apps after adding.
			</Dialog.Description>
		</Dialog.Header>

		<form method="POST" action="?/invite" use:enhance={act} class="space-y-4">
			<div class="space-y-2">
				<Label for="email">Email</Label>
				<Input id="email" name="email" type="email" placeholder="colleague@getbee.app" required />
			</div>

			<div class="space-y-2">
				<Label for="name">Name <span class="text-muted-foreground">(optional)</span></Label>
				<Input id="name" name="name" placeholder="Jordan Lee" />
			</div>

			<input type="hidden" name="viewAffiliateData" value={inviteAffiliates ? 'true' : ''} />
			<label class="flex items-start gap-2.5 text-sm">
				<Checkbox bind:checked={inviteAffiliates} />
				<span>
					Can see the affiliate program
					<span class="block text-xs text-muted-foreground">
						Leave off for someone who should only look at app analytics.
					</span>
				</span>
			</label>

			{#if form?.error}
				<p class="text-sm text-destructive">{form.error}</p>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (inviteOpen = false)}>Cancel</Button>
				<Button type="submit">Add staff</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
