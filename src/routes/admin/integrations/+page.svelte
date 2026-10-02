<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import PageHeader from '$lib/components/page-header.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import { relativeTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let running = $state<string | null>(null);
	let datasets = $state<string[]>([]);

	const submit = (key: string) => () => {
		running = key;
		return async ({ result, update }: any) => {
			running = null;
			if (result.type === 'success' && result.data?.success) {
				toast.success(result.data.message);
				if (result.data.datasets) datasets = result.data.datasets;
			} else if (result.type === 'success') {
				toast.error(result.data?.message ?? 'That did not work.');
			} else if (result.type === 'failure') {
				const d = result.data ?? {};
				toast.error(
					d.slackError ?? d.bigqueryError ?? d.datasetError ?? d.storeError ?? d.activationError ?? 'That did not work.'
				);
			}
			await update({ reset: false });
		};
	};

	const rating = (hundredths: number | null) => (hundredths === null ? '—' : (hundredths / 100).toFixed(1));

	const snippet = $derived(`import { createHmac } from 'node:crypto';

// Call from a loader or job, not per click. Never await it in a request path.
export function trackUsage(shopDomain: string, events: { name: string; properties?: object }[]) {
	const body = JSON.stringify({
		app: process.env.AFFILIATES_APP_SLUG,
		apiKey: process.env.SHOPIFY_API_KEY,
		shopDomain,
		events
	});
	const signature = createHmac('sha256', process.env.AFFILIATES_SECRET!).update(body).digest('hex');
	return fetch('${data.origin}/api/track/event', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'X-Bee-Signature': signature },
		body
	}).catch(() => {});
}

// trackUsage(session.shop, [{ name: 'page_view', properties: { path: '/rules' } }]);
// trackUsage(session.shop, [{ name: 'rule_created' }]);`);
</script>

<svelte:head><title>Integrations · Admin</title></svelte:head>

<PageHeader title="Integrations" description="Slack alerts, GA4 listing traffic, App Store tracking and in-app events." />

<div class="space-y-5 px-5 pb-10 sm:px-8">
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Slack</Card.Title>
			<Card.Description>
				Posts to one channel through an incoming webhook. Each alert is sent once, even after a
				rebuild or a backfill, and a backfill never replays old history into the channel.
			</Card.Description>
			<Card.Action>
				{#if data.slack.connected}
					<StatusBadge status="approved" label="Connected {data.slack.hint}" />
				{:else}
					<StatusBadge status="pending" label="Not connected" />
				{/if}
			</Card.Action>
		</Card.Header>
		<Card.Content>
			<form method="POST" action="?/saveSlack" use:enhance={submit('slack')} class="space-y-4">
				<div class="space-y-1.5">
					<Label for="webhook">Incoming webhook URL</Label>
					<Input
						id="webhook"
						name="webhook"
						type="url"
						autocomplete="off"
						placeholder={data.slack.connected
							? 'Leave empty to keep the current webhook'
							: 'https://hooks.slack.com/services/…'}
					/>
					{#if form?.slackError}
						<p class="text-sm text-destructive">{form.slackError}</p>
					{/if}
				</div>
				<fieldset class="space-y-2">
					<legend class="text-sm font-medium">Send alerts for</legend>
					{#each data.topics as topic (topic.key)}
						<label class="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								name="topics"
								value={topic.key}
								checked={data.slack.topics.includes(topic.key as never)}
								class="size-4 rounded border-input"
							/>
							{topic.label}
						</label>
					{/each}
				</fieldset>
				<div class="flex flex-wrap gap-2">
					<Button type="submit" disabled={running !== null}>
						{#if running === 'slack'}<LoaderIcon class="size-4 animate-spin" />{/if}
						Save Slack alerts
					</Button>
					{#if data.slack.connected}
						<Button
							type="submit"
							variant="outline"
							formaction="?/testSlack"
							disabled={running !== null}
						>
							Send test message
						</Button>
						<Button
							type="submit"
							variant="ghost"
							formaction="?/disconnectSlack"
							disabled={running !== null}
						>
							Disconnect Slack
						</Button>
					{/if}
				</div>
			</form>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">GA4 listing traffic</Card.Title>
			<Card.Description>
				Adds listing views and Add app clicks to each app's install funnel, read once a day from
				the GA4 BigQuery export. Put a GA4 measurement ID on the listing, link the GA4 property to
				BigQuery with daily export, then create a service account with BigQuery Job User on the
				project and BigQuery Data Viewer on the dataset.
			</Card.Description>
			<Card.Action>
				{#if data.bigquery.connected}
					<StatusBadge status="approved" label="Connected" />
				{:else}
					<StatusBadge status="pending" label="Not connected" />
				{/if}
			</Card.Action>
		</Card.Header>
		<Card.Content class="space-y-6">
			<form method="POST" action="?/saveBigQuery" use:enhance={submit('bq')} class="space-y-4">
				{#if data.bigquery.connected}
					<p class="text-sm text-muted-foreground">
						Signed in as <span class="font-medium text-foreground">{data.bigquery.clientEmail}</span>
						on project {data.bigquery.projectId}, {data.bigquery.location}.
					</p>
				{/if}
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-1.5">
						<Label for="projectId">Google Cloud project ID</Label>
						<Input
							id="projectId"
							name="projectId"
							value={data.bigquery.projectId ?? ''}
							placeholder="acme-web-402118"
						/>
					</div>
					<div class="space-y-1.5">
						<Label for="location">Dataset location</Label>
						<Input id="location" name="location" value={data.bigquery.location ?? 'US'} placeholder="US" />
					</div>
				</div>
				<div class="space-y-1.5">
					<Label for="key">Service-account key (JSON)</Label>
					<Textarea
						id="key"
						name="key"
						rows={4}
						class="font-mono text-xs"
						placeholder={data.bigquery.connected
							? 'Leave empty to keep the current key'
							: '{"type": "service_account", …}'}
					/>
					<p class="text-xs text-muted-foreground">
						Paste the downloaded file as is. The key stays on the server and is never shown again.
					</p>
				</div>
				{#if form?.bigqueryError}
					<p class="text-sm text-destructive">{form.bigqueryError}</p>
				{/if}
				<div class="flex flex-wrap gap-2">
					<Button type="submit" disabled={running !== null}>
						{#if running === 'bq'}<LoaderIcon class="size-4 animate-spin" />{/if}
						Save connection
					</Button>
					{#if data.bigquery.connected}
						<Button type="submit" variant="outline" formaction="?/testBigQuery" disabled={running !== null}>
							Test connection
						</Button>
						<Button type="submit" variant="outline" formaction="?/syncTraffic" disabled={running !== null}>
							Read traffic now
						</Button>
						<Button type="submit" variant="ghost" formaction="?/disconnectBigQuery" disabled={running !== null}>
							Disconnect BigQuery
						</Button>
					{/if}
				</div>
			</form>

			<div class="overflow-x-auto rounded-lg border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>App</Table.Head>
							<Table.Head>GA4 export dataset</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.apps as app (app.id)}
							<Table.Row>
								<Table.Cell class="font-medium">{app.name}</Table.Cell>
								<Table.Cell>
									<form
										method="POST"
										action="?/saveDataset"
										use:enhance={submit(`ds-${app.id}`)}
										class="flex items-center gap-2"
									>
										<input type="hidden" name="appId" value={app.id} />
										<Input
											name="dataset"
											value={app.ga4Dataset ?? ''}
											placeholder="analytics_123456789"
											list="datasets"
											class="h-8 max-w-56"
										/>
										<Button type="submit" size="sm" variant="outline" disabled={running !== null}>
											{#if running === `ds-${app.id}`}<LoaderIcon class="size-3.5 animate-spin" />{/if}
											Save
										</Button>
									</form>
									{#if form?.datasetError && form?.appId === app.id}
										<p class="mt-1 text-xs text-destructive">{form.datasetError}</p>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
				<datalist id="datasets">
					{#each datasets as name (name)}
						<option value={name}></option>
					{/each}
				</datalist>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">App Store search rank and competitors</Card.Title>
			<Card.Description>
				Checked once a day: where each of your listings and each competitor ranks for these searches,
				and every competitor's rating and review count. Results show on Insights → Acquisition.
			</Card.Description>
			<Card.Action>
				<form method="POST" action="?/checkStore" use:enhance={submit('store')}>
					<Button type="submit" size="sm" variant="outline" disabled={running !== null}>
						{#if running === 'store'}<LoaderIcon class="size-3.5 animate-spin" />{/if}
						Check now
					</Button>
				</form>
			</Card.Action>
		</Card.Header>
		<Card.Content class="grid gap-6 lg:grid-cols-2">
			<div class="space-y-3">
				<form method="POST" action="?/addKeyword" use:enhance={submit('kw')} class="flex gap-2">
					<div class="flex-1 space-y-1.5">
						<Label for="keyword">Search terms</Label>
						<Input id="keyword" name="keyword" placeholder="sort collections" />
					</div>
					<Button type="submit" variant="outline" class="self-end" disabled={running !== null}>Add term</Button>
				</form>
				<ul class="flex flex-wrap gap-1.5">
					{#each data.keywords as k (k.id)}
						<li class="flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2.5 text-xs">
							{k.keyword}
							<form method="POST" action="?/removeKeyword" use:enhance={submit(`rk-${k.id}`)}>
								<input type="hidden" name="id" value={k.id} />
								<button type="submit" class="rounded-full px-1 text-muted-foreground hover:text-foreground" aria-label="Remove {k.keyword}">×</button>
							</form>
						</li>
					{:else}
						<li class="text-sm text-muted-foreground">No search terms yet.</li>
					{/each}
				</ul>
			</div>
			<div class="space-y-3">
				<form method="POST" action="?/addCompetitor" use:enhance={submit('cmp')} class="flex gap-2">
					<div class="flex-1 space-y-1.5">
						<Label for="competitor">Competitors</Label>
						<Input id="competitor" name="competitor" placeholder="https://apps.shopify.com/their-app" />
					</div>
					<Button type="submit" variant="outline" class="self-end" disabled={running !== null}>Follow</Button>
				</form>
				<ul class="flex flex-wrap gap-1.5">
					{#each data.competitors as c (c.id)}
						<li class="flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2.5 text-xs">
							{c.name ?? c.handle}
							<form method="POST" action="?/removeCompetitor" use:enhance={submit(`rc-${c.id}`)}>
								<input type="hidden" name="id" value={c.id} />
								<button type="submit" class="rounded-full px-1 text-muted-foreground hover:text-foreground" aria-label="Stop following {c.name ?? c.handle}">×</button>
							</form>
						</li>
					{:else}
						<li class="text-sm text-muted-foreground">No competitors yet.</li>
					{/each}
				</ul>
			</div>
			{#if form?.storeError}
				<p class="text-sm text-destructive lg:col-span-2">{form.storeError}</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">In-app events</Card.Title>
			<Card.Description>
				Each Bee app posts what merchants do inside it to <code>/api/track/event</code>, signed with
				the same ingest key as installs. That adds active shops, activation and inactivity warnings to
				Insights → Engagement. Set <code>AFFILIATES_APP_SLUG</code> to the slug shown on Apps.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-5">
			<pre class="overflow-x-auto rounded-lg bg-muted p-4 text-xs leading-relaxed"><code>{snippet}</code></pre>
			<div class="overflow-x-auto rounded-lg border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>App</Table.Head>
							<Table.Head>Activation event</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.apps as app (app.id)}
							<Table.Row>
								<Table.Cell class="font-medium">{app.name}</Table.Cell>
								<Table.Cell>
									<form
										method="POST"
										action="?/saveActivation"
										use:enhance={submit(`act-${app.id}`)}
										class="flex items-center gap-2"
									>
										<input type="hidden" name="appId" value={app.id} />
										<Input
											name="activationEvent"
											value={app.activationEvent ?? ''}
											placeholder={app.events[0] ?? 'rule_created'}
											list="events-{app.id}"
											class="h-8 max-w-56 font-mono text-xs"
										/>
										<datalist id="events-{app.id}">
											{#each app.events as name (name)}
												<option value={name}></option>
											{/each}
										</datalist>
										<Button type="submit" size="sm" variant="outline" disabled={running !== null}>Save</Button>
									</form>
									{#if form?.activationError && form?.appId === app.id}
										<p class="mt-1 text-xs text-destructive">{form.activationError}</p>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root class="gap-0 overflow-hidden p-0">
		<Card.Header class="border-b px-5 py-4">
			<Card.Title class="text-base">App Store reviews</Card.Title>
			<Card.Description>
				Read once a day from each app's public listing, using the listing URL on the Apps page.
				A review that disappears is marked removed. Reviews are matched to merchants by store name.
			</Card.Description>
			<Card.Action>
				<form method="POST" action="?/syncReviews" use:enhance={submit('reviews')}>
					<Button type="submit" size="sm" variant="outline" disabled={running !== null}>
						{#if running === 'reviews'}<LoaderIcon class="size-3.5 animate-spin" />{/if}
						Check reviews now
					</Button>
				</form>
			</Card.Action>
		</Card.Header>
		<Card.Content class="p-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>App</Table.Head>
						<Table.Head>Listing</Table.Head>
						<Table.Head class="text-right">Rating</Table.Head>
						<Table.Head class="text-right">Reviews</Table.Head>
						<Table.Head class="text-right">Checked</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.apps as app (app.id)}
						<Table.Row>
							<Table.Cell class="font-medium">{app.name}</Table.Cell>
							<Table.Cell class="text-muted-foreground">
								{#if app.handle}
									{app.handle}
								{:else}
									<a href="/admin/apps" class="underline">Add a listing URL</a>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{rating(app.ratingHundredths)}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{app.reviewCount ?? '—'}</Table.Cell>
							<Table.Cell class="text-right text-muted-foreground">
								{app.reviewsSyncedAt ? relativeTime(app.reviewsSyncedAt) : 'never'}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>
