<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Input from '$lib/components/ui/input/input.svelte';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import XIcon from '@lucide/svelte/icons/x';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import Markdown from '$lib/components/prompt-kit/markdown/Markdown.svelte';
	import Logo from '$lib/components/icons/logo.svelte';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { cmdOrCtrl } from '$lib/hooks/is-mac.svelte.js';
	import type { TodoItem } from './types.js';
	import TaskSpecRenderer from './render/TaskSpecRenderer.svelte';
	import type { Spec } from '@json-render/core';

	let {
		task,
		open = $bindable(false),
		onSave,
		onDelete,
		onMoveToDone,
		canMoveToDone = false,
		onApprove,
		onReject,
		onBlockAction,
		onRetry
	}: {
		task: TodoItem;
		open: boolean;
		onSave: (id: string, updates: Partial<TodoItem>) => void;
		onDelete: (id: string) => void;
		onMoveToDone?: (id: string) => void;
		canMoveToDone?: boolean;
		onApprove?: (id: string) => void;
		onReject?: (id: string, feedback: string) => void;
		onBlockAction?: (taskId: string, threadId: string, action: string) => void;
		onRetry?: (id: string) => void;
	} = $props();

	let parsedSpec: Spec | null = $derived.by(() => {
		if (!task.agentSpec) return null;
		try {
			return JSON.parse(task.agentSpec) as Spec;
		} catch {
			return null;
		}
	});

	let editTitle = $state('');
	let editNotes = $state('');
	let notesDirty = $state(false);
	let rejectFeedback = $state('');
	let initialTaskId = $state('');

	function countWords(value: string): number {
		return value.trim().split(/\s+/).filter(Boolean).length;
	}

	function isLikelyPastedDescription(value: string): boolean {
		const text = value.trim();
		if (!text) return false;
		if (text.includes('\n')) return true;
		if (text.length > 90) return true;
		if (countWords(text) > 14) return true;
		return /what to expect|about the role|responsibilities|requirements|job description/i.test(
			text
		);
	}

	function buildNiceTitle(args: {
		title?: string;
		position?: string;
		companyName?: string;
	}): string {
		const title = args.title?.trim() ?? '';
		const position = args.position?.trim() ?? '';
		const companyName = args.companyName?.trim() ?? '';

		if (position && companyName) return `${position} at ${companyName}`;
		if (position) return position;
		if (companyName && title && isLikelyPastedDescription(title)) return `Role at ${companyName}`;
		if (!title) return position || companyName || '';
		return title;
	}

	function fmtDate(ts: number): string {
		return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	// Job fields
	let editCompanyName = $state('');
	let editPosition = $state('');
	let editJobUrl = $state('');
	let editJobDescription = $state('');
	let editSkills = $state('');
	let editCountry = $state('');
	let editPlatform = $state('');
	let editJobLevel = $state('');
	let editJobType = $state('');
	let editMotivationLetter = $state('');
	let editInterviewDate = $state('');
	let editInterviewLink = $state('');
	let editInterviewEmail = $state('');
	let letterCopied = $state(false);
	let jobUrlCopied = $state(false);

	async function copyMotivationLetter() {
		if (!editMotivationLetter.trim()) return;
		await navigator.clipboard.writeText(editMotivationLetter.trim());
		letterCopied = true;
		setTimeout(() => (letterCopied = false), 2000);
	}

	function buildLetterFilename(): string {
		const parts = [editCompanyName.trim(), editPosition.trim(), 'motivation-letter']
			.filter(Boolean)
			.map((value) =>
				value
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-+|-+$/g, '')
			)
			.filter(Boolean);

		if (parts.length === 0) return 'motivation-letter.txt';
		return `${parts.join('-')}.txt`;
	}

	function downloadMotivationLetter(): void {
		const content = editMotivationLetter.trim();
		if (!content || typeof document === 'undefined') return;

		const file = new Blob([content], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(file);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = buildLetterFilename();
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL(url);
	}

	function normalizeUrl(value: string): string | null {
		const trimmed = value.trim();
		if (!trimmed) return null;

		const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
		try {
			return new URL(normalized).toString();
		} catch {
			return null;
		}
	}

	function openJobUrl(): void {
		if (typeof window === 'undefined') return;
		const url = normalizeUrl(editJobUrl);
		if (!url) return;
		window.open(url, '_blank', 'noopener,noreferrer');
	}

	async function copyJobUrl(): Promise<void> {
		const url = normalizeUrl(editJobUrl);
		if (!url) return;
		await navigator.clipboard.writeText(url);
		jobUrlCopied = true;
		setTimeout(() => (jobUrlCopied = false), 2000);
	}

	$effect(() => {
		if (open && task.id !== initialTaskId) {
			initialTaskId = task.id;
			const suggestedTitle = buildNiceTitle({
				title: task.title,
				position: task.position,
				companyName: task.companyName
			});
			editTitle = isLikelyPastedDescription(task.title) ? suggestedTitle || task.title : task.title;
			editNotes = task.notes ?? '';
			notesDirty = false;
			rejectFeedback = '';
			// Job fields
			editCompanyName = task.companyName ?? '';
			editPosition = task.position ?? '';
			editJobUrl = task.jobUrl ?? '';
			editJobDescription = task.jobDescription ?? '';
			editSkills = task.skills ?? '';
			editCountry = task.country ?? '';
			editPlatform = task.platform ?? '';
			editJobLevel = task.jobLevel ?? '';
			editJobType = task.jobType ?? '';
			editMotivationLetter = task.motivationLetter ?? '';
			editInterviewDate = task.interviewDate ?? '';
			editInterviewLink = task.interviewLink ?? '';
			editInterviewEmail = task.interviewEmail ?? '';
		}
		if (!open) {
			initialTaskId = '';
		}
	});

	$effect(() => {
		if (open && !notesDirty) {
			const liveNotes = task.notes ?? '';
			if (liveNotes !== editNotes) {
				editNotes = liveNotes;
			}
		}
	});

	$effect(() => {
		if (!editJobUrl.trim() && jobUrlCopied) {
			jobUrlCopied = false;
		}
	});

	function handleSave() {
		const trimmedTitle = editTitle.trim();
		if (!trimmedTitle) return;
		onSave(task.id, {
			title: trimmedTitle,
			notes: editNotes.trim() || undefined,
			companyName: editCompanyName.trim() || undefined,
			position: editPosition.trim() || undefined,
			jobUrl: editJobUrl.trim() || undefined,
			jobDescription: editJobDescription.trim() || undefined,
			skills: editSkills.trim() || undefined,
			country: editCountry.trim() || undefined,
			platform: editPlatform.trim() || undefined,
			jobLevel: editJobLevel.trim() || undefined,
			jobType: editJobType.trim() || undefined,
			motivationLetter: editMotivationLetter.trim() || undefined,
			interviewDate: editInterviewDate.trim() || undefined,
			interviewLink: editInterviewLink.trim() || undefined,
			interviewEmail: editInterviewEmail.trim() || undefined
		});
		open = false;
	}

	function handleDelete() {
		onDelete(task.id);
		open = false;
	}

	function handleMoveToDone() {
		onMoveToDone?.(task.id);
		open = false;
	}

	function handleDialogKeydown(e: KeyboardEvent) {
		const mod = e.metaKey || e.ctrlKey;
		if (!mod) return;

		if (e.key === 's') {
			e.preventDefault();
			handleSave();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			handleSave();
		}
	}

	function handleTitleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSave();
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="flex max-h-[85vh] flex-col {parsedSpec ? 'sm:max-w-3xl' : 'sm:max-w-2xl'}"
		onkeydown={handleDialogKeydown}
	>
		<Dialog.Header>
			<Dialog.Title>Job Application Details</Dialog.Title>
		</Dialog.Header>
		<div
			class="grid min-h-0 flex-1 gap-4 overflow-x-hidden overflow-y-auto py-4 pr-6 [scrollbar-gutter:stable]"
		>
			<!-- Title (max 10 words shown, full value kept) -->
			<div class="grid gap-2">
				<label for="todo-title" class="text-sm font-medium">Job Title</label>
				<Input
					id="todo-title"
					bind:value={editTitle}
					onkeydown={handleTitleKeydown}
					placeholder="e.g. Senior Frontend Developer at Google"
				/>
			</div>

			<!-- Company & Position row -->
			<div class="grid grid-cols-2 gap-3">
				<div class="grid gap-2">
					<label for="company-name" class="text-sm font-medium">Company</label>
					<Input id="company-name" bind:value={editCompanyName} placeholder="Company name" />
				</div>
				<div class="grid gap-2">
					<label for="position" class="text-sm font-medium">Position</label>
					<Input id="position" bind:value={editPosition} placeholder="Role / Position" />
				</div>
			</div>

			<!-- URL & Platform row -->
			<div class="grid grid-cols-2 gap-3">
				<div class="grid gap-2">
					<div class="flex items-center justify-between gap-2">
						<label for="job-url" class="text-sm font-medium">Job URL</label>
						{#if editJobUrl.trim()}
							<div class="flex items-center gap-1">
								<Button
									variant="ghost"
									size="sm"
									class="h-7 gap-1 px-2 text-xs"
									onclick={openJobUrl}
								>
									<ExternalLinkIcon class="size-3.5" />
									Open
								</Button>
								<Button
									variant="ghost"
									size="sm"
									class="h-7 gap-1 px-2 text-xs"
									onclick={copyJobUrl}
								>
									{#if jobUrlCopied}
										<CheckIcon class="size-3.5" />
										Copied
									{:else}
										<CopyIcon class="size-3.5" />
										Copy
									{/if}
								</Button>
							</div>
						{/if}
					</div>
					<Input id="job-url" bind:value={editJobUrl} placeholder="https://..." />
				</div>
				<div class="grid gap-2">
					<label for="platform" class="text-sm font-medium">Platform</label>
					<Input id="platform" bind:value={editPlatform} placeholder="LinkedIn, Indeed, etc." />
				</div>
			</div>

			<!-- Country, Level, Type row -->
			<div class="grid grid-cols-3 gap-3">
				<div class="grid gap-2">
					<label for="country" class="text-sm font-medium">Country</label>
					<Input id="country" bind:value={editCountry} placeholder="Country" />
				</div>
				<div class="grid gap-2">
					<label for="job-level" class="text-sm font-medium">Level</label>
					<Input id="job-level" bind:value={editJobLevel} placeholder="Junior, Senior, etc." />
				</div>
				<div class="grid gap-2">
					<label for="job-type" class="text-sm font-medium">Type</label>
					<Input id="job-type" bind:value={editJobType} placeholder="Full-time, Remote, etc." />
				</div>
			</div>

			<!-- Skills -->
			<div class="grid gap-2">
				<label for="skills" class="text-sm font-medium">Skills</label>
				<Textarea
					id="skills"
					bind:value={editSkills}
					placeholder="React, TypeScript, Node.js..."
					rows={2}
					class="break-words"
				/>
			</div>

			<!-- Notes -->
			<div class="grid gap-2">
				<label for="todo-notes" class="text-sm font-medium"
					>Notes <span class="font-normal text-muted-foreground">(add your own notes here)</span
					></label
				>
				<Textarea
					id="todo-notes"
					bind:value={editNotes}
					placeholder="Add your personal notes here..."
					rows={4}
					oninput={() => {
						notesDirty = true;
					}}
					style="field-sizing: content; overflow: hidden; min-height: 6rem;"
				/>
			</div>

			<!-- Stage History Timeline -->
			<div class="grid gap-1.5">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					Stage history
				</p>
				<div class="grid grid-cols-4 gap-1">
					{#each [{ label: 'Preparing', ts: task.preparingAt }, { label: 'Applied', ts: task.appliedAt }, { label: 'Interview', ts: task.interviewingAt }, { label: 'Done', ts: task.doneAt }] as stage (stage.label)}
						<div
							class="flex flex-col items-center gap-1 rounded border bg-muted/30 px-1 py-1.5 text-center"
						>
							<span class="text-[10px] leading-none font-medium">{stage.label}</span>
							<span class="text-[10px] text-muted-foreground tabular-nums">
								{stage.ts ? fmtDate(stage.ts) : '—'}
							</span>
						</div>
					{/each}
				</div>
			</div>

			<!-- Application Review Panel -->
			<div class="grid gap-3 rounded-md border bg-muted/30 p-3">
				<div class="grid gap-2">
					<label
						for="job-description"
						class="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
						>Job Description</label
					>
					<Textarea
						id="job-description"
						bind:value={editJobDescription}
						placeholder="Paste the job description here..."
						rows={3}
						class="break-words"
						style="field-sizing: content;"
					/>
				</div>

				{#if parsedSpec}
					<Separator />
					<TaskSpecRenderer
						spec={parsedSpec}
						onStateChange={(changes) => {
							if (task.threadId && onBlockAction) {
								const actionChange = changes.find((c) => c.path.includes('pendingAction'));
								if (actionChange) {
									onBlockAction(task.id, task.threadId, String(actionChange.value));
								}
							}
						}}
					/>
				{/if}

				<Separator />
				<div class="grid gap-2">
					<div class="flex items-center justify-between">
						<label
							for="motivation-letter"
							class="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
							>Motivation Letter</label
						>
						{#if editMotivationLetter.trim()}
							<div class="flex items-center gap-1">
								<Button
									variant="ghost"
									size="sm"
									class="h-7 gap-1.5 text-xs"
									onclick={downloadMotivationLetter}
								>
									<DownloadIcon class="size-3.5" />
									Download
								</Button>
								<Button
									variant="ghost"
									size="sm"
									class="h-7 gap-1.5 text-xs"
									onclick={copyMotivationLetter}
								>
									{#if letterCopied}
										<CheckIcon class="size-3.5" />
										Copied
									{:else}
										<CopyIcon class="size-3.5" />
										Copy
									{/if}
								</Button>
							</div>
						{/if}
					</div>
					<Textarea
						id="motivation-letter"
						bind:value={editMotivationLetter}
						placeholder="Motivation letter will be generated by Nova..."
						rows={4}
						class="text-[13px] break-words"
						style="field-sizing: content; min-height: 5rem;"
					/>
				</div>
			</div>

			<!-- Interview Details -->
			<div class="grid gap-3 rounded-lg border bg-muted/20 p-3">
				<p class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Interview</p>
				<div class="grid grid-cols-2 gap-3">
					<div class="grid gap-2">
						<label for="interview-date" class="text-sm font-medium">Date / Time</label>
						<Input
							id="interview-date"
							bind:value={editInterviewDate}
							placeholder="e.g. Apr 5, 10:00 AM"
						/>
					</div>
					<div class="grid gap-2">
						<label for="interview-link" class="text-sm font-medium">Call Link</label>
						<Input
							id="interview-link"
							bind:value={editInterviewLink}
							placeholder="https://meet.google.com/..."
							class="truncate"
						/>
					</div>
				</div>
				<div class="grid gap-2">
					<label for="interview-email" class="text-sm font-medium"
						>Interview Email <span class="font-normal text-muted-foreground"
							>(paste invitation here)</span
						></label
					>
					<Textarea
						id="interview-email"
						bind:value={editInterviewEmail}
						placeholder="Paste the interview invitation email here..."
						rows={5}
						class="break-words"
					/>
				</div>
			</div>

			{#if task.agentStatus === 'working'}
				<div class="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
					<Logo class="size-4 agent-working text-primary" />
					<span class="text-sm text-muted-foreground">Nova is working...</span>
				</div>
			{:else if task.agentStatus === 'done' && task.agentSummary}
				<div class="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2">
					<Logo class="mt-0.5 size-4 shrink-0 text-primary" />
					<Markdown
						content={task.agentSummary}
						class="prose-sm text-sm break-words text-muted-foreground"
					/>
				</div>
			{:else if task.agentStatus === 'error'}
				<div
					class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
				>
					<TriangleAlertIcon class="mt-0.5 size-4 shrink-0 text-destructive" />
					<div class="flex flex-1 items-start justify-between gap-2">
						<span class="text-sm text-destructive"
							>{task.agentSummary || 'Nova encountered an error.'}</span
						>
						{#if onRetry}
							<Button variant="outline" size="sm" class="shrink-0" onclick={() => onRetry(task.id)}>
								<RotateCcwIcon class="mr-1.5 size-3.5" />
								Retry
							</Button>
						{/if}
					</div>
				</div>
			{:else if task.agentStatus === 'awaiting_approval'}
				<div class="grid gap-3">
					<Separator />
					<div class="flex items-center gap-2">
						<Logo class="size-4 text-primary" />
						<span class="text-sm font-medium">Nova needs approval</span>
					</div>
					{#if task.agentDraft}
						<div class="max-h-40 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm">
							<Markdown content={task.agentDraft} class="prose-sm break-words" />
						</div>
					{/if}
					<Textarea
						bind:value={rejectFeedback}
						placeholder="Feedback (required to reject)"
						rows={2}
					/>
					<div class="flex gap-2">
						<Button variant="default" size="sm" onclick={() => onApprove?.(task.id)}>
							<CheckIcon class="mr-1.5 size-3.5" />
							Approve
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={!rejectFeedback.trim()}
							onclick={() => onReject?.(task.id, rejectFeedback.trim())}
						>
							<XIcon class="mr-1.5 size-3.5" />
							Reject
						</Button>
					</div>
				</div>
			{/if}
		</div>

		<Dialog.Footer class="!flex-row items-center !justify-between">
			<div class="flex gap-2">
				<Button variant="destructive" size="sm" onclick={handleDelete}>
					<Trash2Icon class="mr-1.5 size-3.5" />
					Delete
				</Button>
				{#if canMoveToDone}
					<Button variant="outline" size="sm" onclick={handleMoveToDone}>
						<CheckIcon class="mr-1.5 size-3.5" />
						Move to Done
					</Button>
				{/if}
			</div>
			<div class="flex gap-2">
				<Button variant="outline" onclick={() => (open = false)}>
					Cancel
					<kbd class="ml-1.5 text-[10px] opacity-60">Esc</kbd>
				</Button>
				<Button onclick={handleSave} disabled={!editTitle.trim()}>
					Save
					<kbd class="ml-1.5 text-[10px] opacity-60">{cmdOrCtrl}S</kbd>
				</Button>
			</div>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
