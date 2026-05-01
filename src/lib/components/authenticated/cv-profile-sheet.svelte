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
	const PDF_EXTRACTION_TIMEOUT_MS = 30_000;

	function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timeoutId = setTimeout(() => {
				reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`));
			}, timeoutMs);
		});
		return Promise.race([promise, timeoutPromise]).finally(() => {
			if (timeoutId) clearTimeout(timeoutId);
		});
	}

	function normalizeExtractedText(text: string): string {
		return text
			.replace(/\u00a0/g, ' ')
			.replace(/[ \t]+\n/g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.replace(/[ \t]{2,}/g, ' ')
			.trim();
	}

	async function extractPdfText(file: File): Promise<string> {
		// Always use the bundled worker — set once before getDocument
		const pdfjsLib = await import('pdfjs-dist');
		pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

		const buffer = await file.arrayBuffer();
		const pdf = await pdfjsLib.getDocument({
			data: new Uint8Array(buffer),
			useSystemFonts: true,
			stopAtErrors: false
		}).promise;

		const pages: string[] = [];
		for (let i = 1; i <= pdf.numPages; i++) {
			const page = await pdf.getPage(i);
			const content = await page.getTextContent();
			let pageText = '';
			for (const item of content.items) {
				if ('str' in item) {
					pageText += item.str;
					// hasEOL marks the end of a visual line in the PDF
					if ((item as any).hasEOL) pageText += '\n';
					else if (item.str && !item.str.endsWith(' ')) pageText += ' ';
				}
			}
			if (pageText.trim()) pages.push(pageText.trim());
		}
		pdf.destroy();

		const text = normalizeExtractedText(pages.join('\n\n'));
		if (!text)
			throw new Error(
				'No selectable text found. If this is a scanned PDF, please paste your CV text manually.'
			);
		return text;
	}

	async function handleFileUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // reset immediately so same file can be re-selected
		if (!file) return;

		if (file.size > MAX_FILE_SIZE) {
			extractError = 'File is too large. Maximum size is 10 MB.';
			return;
		}

		extracting = true;
		extractError = '';
		uploadedFileName = '';

		try {
			const ext = file.name.split('.').pop()?.toLowerCase();
			const text =
				ext === 'txt'
					? await file.text()
					: await withTimeout(extractPdfText(file), PDF_EXTRACTION_TIMEOUT_MS, 'PDF extraction');

			if (!text.trim()) {
				extractError =
					'No text found. If this is a scanned PDF, please paste your CV text manually.';
			} else {
				editResume = text.trim();
				uploadedFileName = file.name;
				haptic.trigger('light');
				toast.success(`Extracted text from ${file.name}`);
			}
		} catch (err) {
			extractError = err instanceof Error ? err.message : 'Failed to read file. Please try again.';
		} finally {
			extracting = false;
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
							disabled={extracting}
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
