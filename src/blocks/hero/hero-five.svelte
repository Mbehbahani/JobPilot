<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { localizedHref } from '$lib/utils/i18n';
	import Button from '$lib/components/ui/button/button.svelte';
	import Logo from '$lib/components/icons/logo.svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import SearchIcon from '@lucide/svelte/icons/search';
	import HeroOctopusAnimation from './hero-octopus-animation.svelte';
	import PipelineDemo from './pipeline-demo.svelte';

	const tutorials = [
		{
			id: 'X4gX67QjKVQ',
			emoji: '🔌',
			title: 'Use ChatGPT Inside Apps (No API Needed)'
		},
		{
			id: 'N92yHginPRw',
			emoji: '📘',
			title: 'Add Jobs Faster with AI'
		},
		{
			id: 'PKUBM6oVpmk',
			emoji: '🗂️',
			title: 'Manage CV & Motivation Letters with AI'
		},
		{
			id: 'hFBIUkhTLcc',
			emoji: '🔎',
			title: 'AI Job Search Automation'
		},
		{
			id: 'FQtYAEoMMyM',
			emoji: '📬',
			title: 'Gmail Job Tracker with AI'
		}
	];

	let activeVideo: { id: string; title: string } | null = $state(null);

	function openVideo(t: { id: string; emoji: string; title: string }) {
		activeVideo = { id: t.id, title: t.title };
	}

	function closeVideo() {
		activeVideo = null;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') closeVideo();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<main class="overflow-hidden">
	<section class="flex items-center justify-center">
		<div class="w-full pt-20 pb-24 lg:pt-40 lg:pb-28">
			<div
				class="relative mx-auto grid max-w-6xl grid-cols-1 items-center px-6 lg:grid-cols-2 lg:gap-12 lg:px-12"
			>
				<div class="mx-auto max-w-lg text-center lg:ml-0 lg:max-w-full lg:text-left">
					<h1 class="mt-8 max-w-4xl font-serif text-4xl font-bold md:text-5xl lg:mt-16 xl:text-6xl">
						<T keyName="hero.tagline" />
					</h1>
					<p class="mt-8 max-w-3xl text-lg text-balance">
						<T keyName="hero.description" />
					</p>
					<div
						class="mt-12 flex flex-col items-center justify-center gap-2 sm:flex-row lg:justify-start"
					>
						<Button
							size="lg"
							href={localizedHref('/signin?tab=signup')}
							class="h-12 rounded-full pr-3 pl-5 text-sm"
						>
							<span class="text-nowrap"><T keyName="hero.cta" /></span>
							<ChevronRight class="ml-1" />
						</Button>
						<Button
							size="lg"
							variant="ghost"
							href={localizedHref('/app/my-job-search')}
							class="h-12 rounded-full px-5 text-base hover:bg-zinc-950/5 dark:hover:bg-white/5"
						>
							<SearchIcon class="mr-1 size-4" />
							<span class="text-nowrap">
								<T keyName="app.sidebar.my_job_search" defaultValue="My Job Search" />
							</span>
						</Button>
						<Button
							size="lg"
							variant="ghost"
							href="https://oploy.eu"
							target="_blank"
							rel="noopener noreferrer"
							class="h-12 rounded-full px-5 text-base hover:bg-zinc-950/5 dark:hover:bg-white/5"
						>
							<span class="text-nowrap">
								<T keyName="hero.cta_sourcecode" defaultValue="View website" />
							</span>
						</Button>

						<Button
							size="lg"
							variant="ghost"
							href="https://ko-fi.com/W7W41XLNI2"
							target="_blank"
							rel="noopener noreferrer"
							class="h-12 rounded-full px-5 text-base hover:bg-zinc-950/5 dark:hover:bg-white/5"
						>
							<Logo class="support-logo mr-1 size-4 text-primary" />
							<span class="text-nowrap">Help Keep It Running</span>
						</Button>
					</div>
				</div>
				<div class="hidden lg:flex lg:items-center lg:justify-end">
					<HeroOctopusAnimation />
				</div>
			</div>
		</div>
	</section>

	<!-- ── Pipeline demo section ─────────────────────────────────────────── -->
	<section class="pb-24 lg:pb-32">
		<div class="mx-auto max-w-6xl px-6 lg:px-12">
			<!-- Section heading -->
			<div class="mb-10 text-center">
				<h2 class="font-serif text-3xl font-bold md:text-4xl">Search → Pipeline, Automatically</h2>
				<p class="mt-4 mx-auto max-w-xl text-base text-muted-foreground text-balance">
					Nova scans LinkedIn and Indeed in real time, scores every match against your profile, and
					lets you send the best ones to your Kanban with a single click.
				</p>
			</div>
			<!-- Animated table -->
			<PipelineDemo />
		</div>
	</section>

	<!-- ── Tutorial videos section ─────────────────────────────────────────── -->
	<section class="pb-24 lg:pb-32">
		<div class="mx-auto max-w-6xl px-6 lg:px-12">
			<div class="mb-8 text-center">
				<p class="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					Video Guides
				</p>
				<h2 class="font-serif text-2xl font-bold md:text-3xl">Learn in Minutes</h2>
				<p class="mt-3 mx-auto max-w-md text-sm text-muted-foreground">
					Short tutorials to help you get the most out of JobPilot.
				</p>
			</div>

			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
				{#each tutorials as t (t.id)}
					<button
						type="button"
						onclick={() => openVideo(t)}
						class="group flex flex-col gap-2 text-left"
						aria-label="Play: {t.title}"
					>
						<div
							class="relative aspect-video overflow-hidden rounded-xl bg-muted ring-1 ring-border transition-all duration-200 group-hover:ring-2 group-hover:ring-primary/50 group-hover:shadow-lg group-hover:shadow-primary/10"
						>
							<img
								src="https://img.youtube.com/vi/{t.id}/mqdefault.jpg"
								alt={t.title}
								class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
								loading="lazy"
							/>
							<!-- Play button -->
							<div class="absolute inset-0 flex items-center justify-center">
								<div
									class="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm transition-all duration-200 group-hover:scale-110 group-hover:bg-primary"
								>
									<svg
										class="ml-0.5 h-4 w-4 text-white"
										viewBox="0 0 24 24"
										fill="currentColor"
										aria-hidden="true"
									>
										<path d="M8 5v14l11-7z" />
									</svg>
								</div>
							</div>
						</div>
						<p
							class="text-xs font-medium leading-snug text-foreground/75 line-clamp-2 transition-colors group-hover:text-foreground"
						>
							{t.emoji}
							{t.title}
						</p>
					</button>
				{/each}
			</div>
		</div>
	</section>

	<!-- ── Video lightbox ──────────────────────────────────────────────────── -->
	{#if activeVideo}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
			onclick={closeVideo}
			role="dialog"
			aria-modal="true"
			aria-label={activeVideo.title}
		>
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div
				class="relative w-full max-w-3xl rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10"
				onclick={(e) => e.stopPropagation()}
			>
				<!-- Header bar -->
				<div class="flex items-center justify-between gap-2 bg-zinc-900 px-4 py-2.5">
					<p class="text-sm font-medium text-white/80 line-clamp-1">{activeVideo.title}</p>
					<button
						type="button"
						onclick={closeVideo}
						class="ml-2 shrink-0 rounded-full p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
						aria-label="Close video"
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							class="h-4 w-4"
						>
							<path d="M18 6 6 18M6 6l12 12" stroke-linecap="round" />
						</svg>
					</button>
				</div>
				<!-- Embed -->
				<div class="aspect-video w-full bg-black">
					<iframe
						src="https://www.youtube.com/embed/{activeVideo.id}?autoplay=1&rel=0"
						title={activeVideo.title}
						class="h-full w-full"
						allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
						allowfullscreen
					></iframe>
				</div>
			</div>
		</div>
	{/if}
</main>
