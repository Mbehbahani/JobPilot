<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import SaveIcon from '@lucide/svelte/icons/save';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { toast } from 'svelte-sonner';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

	let { open = $bindable(false) }: { open: boolean } = $props();

	const client = useConvexClient();
	const userSettings = useQuery(api.userSettings.getUserSettings, {});

	let editResume = $state('');
	let saving = $state(false);
	let extracting = $state(false);
	let extractError = $state('');
	let uploadedFileName = $state('');
	let synced = $state(false);

	// Sync from server only once when sheet opens
	$effect(() => {
		if (open && userSettings.data && !synced) {
			editResume = userSettings.data.profileResume;
			extractError = '';
			uploadedFileName = '';
			synced = true;
		}
		if (!open) {
			synced = false;
		}
	});

	const ACCEPTED_TYPES = '.txt,.pdf';
	const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
	const MIN_ACCEPTABLE_PDF_TEXT_LENGTH = 80;
	type PositionedTextItem = { str: string; x: number; y: number };

	function normalizeExtractedText(text: string): string {
		return text
			.replace(/\u00a0/g, ' ')
			.replace(/[ \t]+\n/g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.replace(/[ \t]{2,}/g, ' ')
			.trim();
	}

	function readPageText(content: any): string {
		const rawItems = Array.isArray(content?.items) ? content.items : [];
		const textItems = rawItems
			.filter((item: any) => typeof item?.str === 'string' && item.str.trim().length > 0)
			.map((item: any) => {
				const x = Array.isArray(item.transform) ? Number(item.transform[4] ?? 0) : 0;
				const y = Array.isArray(item.transform) ? Number(item.transform[5] ?? 0) : 0;
				return { str: String(item.str), x, y };
			}) as PositionedTextItem[];

		if (textItems.length === 0) return '';

		textItems.sort((a: PositionedTextItem, b: PositionedTextItem) => {
			if (Math.abs(a.y - b.y) > 2) return b.y - a.y;
			return a.x - b.x;
		});

		const parts: string[] = [];
		let prevY: number | null = null;
		for (const item of textItems) {
			if (prevY !== null && Math.abs(item.y - prevY) > 6) {
				parts.push('\n');
			}
			parts.push(item.str);
			parts.push(' ');
			prevY = item.y;
		}

		return normalizeExtractedText(parts.join(''));
	}

	async function extractPdfText(arrayBuffer: ArrayBuffer, disableWorker: boolean): Promise<string> {
		const pdfjsLib = await import('pdfjs-dist');

		if (!disableWorker) {
			pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
		}

		const pdf = await pdfjsLib.getDocument({
			data: new Uint8Array(arrayBuffer),
			useSystemFonts: true,
			disableWorker,
			stopAtErrors: false
		} as any).promise;

		try {
			const pages: string[] = [];
			for (let i = 1; i <= pdf.numPages; i++) {
				const page = await pdf.getPage(i);
				const content = await page.getTextContent();
				const pageText = readPageText(content);
				if (pageText) pages.push(pageText);
			}
			return normalizeExtractedText(pages.join('\n\n'));
		} finally {
			pdf.destroy();
		}
	}

	async function extractPdfViaServer(file: File): Promise<string> {
		const formData = new FormData();
		formData.append('file', file);
		const res = await fetch('/api/extract-pdf', { method: 'POST', body: formData });
		if (!res.ok) throw new Error(`Server extraction failed: ${res.status}`);
		const data = await res.json();
		return typeof data.text === 'string' ? data.text : '';
	}

	async function extractTextFromFile(file: File): Promise<string> {
		const ext = file.name.split('.').pop()?.toLowerCase();

		if (ext === 'txt') {
			return await file.text();
		}

		if (ext === 'pdf') {
			// Strategy 1: Server-side extraction (most reliable, no browser worker/WASM issues)
			try {
				const serverText = await extractPdfViaServer(file);
				if (serverText.length >= MIN_ACCEPTABLE_PDF_TEXT_LENGTH) return serverText;
			} catch {
				// Server extraction failed, try client-side
			}

			// Strategy 2: Client-side pdfjs with worker
			const arrayBuffer = await file.arrayBuffer();
			let primaryText = '';
			try {
				primaryText = await extractPdfText(arrayBuffer, false);
			} catch {
				// Worker failed
			}
			if (primaryText.length >= MIN_ACCEPTABLE_PDF_TEXT_LENGTH) return primaryText;

			// Strategy 3: Client-side pdfjs without worker
			try {
				const fallbackText = await extractPdfText(arrayBuffer, true);
				if (fallbackText.length >= MIN_ACCEPTABLE_PDF_TEXT_LENGTH) return fallbackText;
				if (fallbackText.length > primaryText.length) primaryText = fallbackText;
			} catch {
				// Fallback also failed
			}

			if (primaryText.length > 0) return primaryText;
			throw new Error('No selectable text found in PDF');
		}

		throw new Error(`Unsupported file type: .${ext}`);
	}

	async function handleFileUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		if (file.size > MAX_FILE_SIZE) {
			extractError = 'File is too large. Maximum size is 10 MB.';
			return;
		}

		extracting = true;
		extractError = '';
		uploadedFileName = '';

		try {
			const text = await extractTextFromFile(file);
			if (!text.trim()) {
				extractError =
					'Could not extract readable text from this file. If this is a scanned/image-only PDF, please paste text manually.';
			} else {
				editResume = text.trim();
				uploadedFileName = file.name;
				haptic.trigger('light');
				toast.success(`Extracted text from ${file.name}`);
			}
		} catch (err) {
			extractError = `Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`;
		} finally {
			extracting = false;
			// Reset input so the same file can be re-selected
			input.value = '';
		}
	}

	async function handleSave() {
		saving = true;
		try {
			await client.mutation(api.userSettings.saveUserSettings, {
				profileResume: editResume.trim()
			});
			haptic.trigger('success');
			toast.success('Profile saved');
			open = false;
		} catch {
			haptic.trigger('error');
			toast.error('Failed to save profile');
		} finally {
			saving = false;
		}
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="right" class="flex w-full flex-col sm:max-w-lg">
		<Sheet.Header>
			<Sheet.Title>CV / Profile</Sheet.Title>
			<Sheet.Description>
				Your resume or profile text. Nova uses this to personalize motivation letters for each job
				application.
			</Sheet.Description>
		</Sheet.Header>

		<div class="flex flex-1 flex-col gap-4 overflow-y-auto px-1 py-4">
			<Tabs.Root value="paste">
				<Tabs.List class="w-full">
					<Tabs.Trigger value="paste" class="flex-1">
						<FileTextIcon class="mr-1.5 size-4" />
						Paste Text
					</Tabs.Trigger>
					<Tabs.Trigger value="upload" class="flex-1">
						<UploadIcon class="mr-1.5 size-4" />
						Upload File
					</Tabs.Trigger>
				</Tabs.List>

				<Tabs.Content value="paste" class="pt-4">
					<div class="flex flex-col gap-2">
						<Label for="resume-text">Resume / Profile</Label>
						<p class="text-xs text-muted-foreground">
							Paste your CV, resume, or key qualifications below.
						</p>
						<Textarea
							id="resume-text"
							bind:value={editResume}
							placeholder="Paste your resume or key qualifications here..."
							rows={14}
						/>
					</div>
				</Tabs.Content>

				<Tabs.Content value="upload" class="pt-4">
					<div class="flex flex-col gap-4">
						<div class="flex flex-col gap-2">
							<Label for="cv-upload">Upload CV File</Label>
							<p class="text-xs text-muted-foreground">
								Supported formats: <strong>.txt</strong>, <strong>.pdf</strong>. The text will be
								extracted and saved as your profile.
							</p>
						</div>

						<label
							for="cv-upload"
							class="flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 transition-colors hover:border-muted-foreground/50 hover:bg-muted/30"
						>
							{#if extracting}
								<LoaderCircleIcon class="size-8 animate-spin text-muted-foreground" />
								<span class="text-sm text-muted-foreground">Extracting text...</span>
							{:else}
								<UploadIcon class="size-8 text-muted-foreground" />
								<span class="text-sm text-muted-foreground">
									Click to select a file or drag and drop
								</span>
								<span class="text-xs text-muted-foreground/60">PDF or TXT, up to 10 MB</span>
							{/if}
						</label>
						<input
							id="cv-upload"
							type="file"
							accept={ACCEPTED_TYPES}
							onchange={handleFileUpload}
							class="hidden"
						/>

						{#if extractError}
							<div
								class="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
							>
								<AlertCircleIcon class="mt-0.5 size-4 shrink-0" />
								<span>{extractError}</span>
							</div>
						{/if}

						{#if uploadedFileName}
							<div
								class="flex items-center gap-2 rounded-md bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400"
							>
								<FileTextIcon class="size-4 shrink-0" />
								<span>Extracted from <strong>{uploadedFileName}</strong></span>
							</div>
						{/if}

						{#if uploadedFileName || editResume}
							<div class="flex flex-col gap-2">
								<Label>Preview</Label>
								<Textarea bind:value={editResume} rows={10} class="text-xs" />
							</div>
						{/if}
					</div>
				</Tabs.Content>
			</Tabs.Root>
		</div>

		<Sheet.Footer class="flex flex-row gap-2 border-t pt-4">
			<Button variant="outline" onclick={() => (open = false)} class="flex-1">Cancel</Button>
			<Button onclick={handleSave} disabled={saving} class="flex-1">
				{#if saving}
					<LoaderCircleIcon class="mr-1.5 size-4 animate-spin" />
				{:else}
					<SaveIcon class="mr-1.5 size-4" />
				{/if}
				Save
			</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
