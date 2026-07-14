import { json, type RequestHandler } from '@sveltejs/kit';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const PDF_EXTRACTION_TIMEOUT_MS = 60_000;

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

function normalizeExtractedText(text: string): string {
	return text
		.replace(/\u00a0/g, ' ')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]{2,}/g, ' ')
		.trim();
}

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

function installPdfJsNodePolyfills() {
	const globalScope = globalThis as typeof globalThis & {
		DOMMatrix?: typeof DOMMatrix;
		ImageData?: typeof ImageData;
		Path2D?: typeof Path2D;
	};

	if (typeof globalScope.DOMMatrix === 'undefined') {
		class SimpleDOMMatrix {
			a = 1;
			b = 0;
			c = 0;
			d = 1;
			e = 0;
			f = 0;

			multiplySelf() {
				return this;
			}

			preMultiplySelf() {
				return this;
			}

			translateSelf() {
				return this;
			}

			scaleSelf() {
				return this;
			}

			rotateSelf() {
				return this;
			}

			invertSelf() {
				return this;
			}

			transformPoint(point?: { x?: number; y?: number }) {
				return { x: point?.x ?? 0, y: point?.y ?? 0 };
			}

			static fromMatrix() {
				return new SimpleDOMMatrix();
			}
		}

		globalScope.DOMMatrix = SimpleDOMMatrix as typeof DOMMatrix;
	}

	if (typeof globalScope.ImageData === 'undefined') {
		class SimpleImageData {
			data: Uint8ClampedArray;
			width: number;
			height: number;

			constructor(width: number, height: number) {
				this.width = width;
				this.height = height;
				this.data = new Uint8ClampedArray(width * height * 4);
			}
		}

		globalScope.ImageData = SimpleImageData as typeof ImageData;
	}

	if (typeof globalScope.Path2D === 'undefined') {
		class SimplePath2D {
			constructor(_path?: string | Path2D) {}
		}

		globalScope.Path2D = SimplePath2D as typeof Path2D;
	}
}

async function loadPdfJs(): Promise<PdfJsModule> {
	installPdfJsNodePolyfills();
	return import('pdfjs-dist/legacy/build/pdf.mjs');
}

async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
	const pdfjsLib = await loadPdfJs();
	const pdf = await pdfjsLib.getDocument({
		data: new Uint8Array(buffer),
		useSystemFonts: true,
		stopAtErrors: false
	}).promise;

	try {
		const pages: string[] = [];
		for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
			const page = await pdf.getPage(pageNumber);
			const content = await page.getTextContent();
			const parts: string[] = [];

			for (const item of content.items) {
				if (!('str' in item)) continue;
				parts.push(item.str);
				if (item.hasEOL) parts.push('\n');
				else if (item.str && !item.str.endsWith(' ')) parts.push(' ');
			}

			const pageText = parts.join('').trim();
			if (pageText) pages.push(pageText);
		}

		const text = normalizeExtractedText(pages.join('\n\n'));
		if (!text) {
			throw new Error('No selectable text found. Please paste your CV text manually.');
		}
		return text;
	} finally {
		await pdf.destroy();
	}
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.token) {
		return json({ error: 'Not authenticated' }, { status: 401 });
	}

	const formData = await request.formData();
	const file = formData.get('file');

	if (!(file instanceof File)) {
		return json({ error: 'Missing PDF file.' }, { status: 400 });
	}

	if (file.size > MAX_FILE_SIZE) {
		return json({ error: 'File is too large. Maximum size is 10 MB.' }, { status: 400 });
	}

	if (file.type && file.type !== 'application/pdf') {
		return json({ error: 'Only PDF files are supported.' }, { status: 400 });
	}

	try {
		const text = await withTimeout(
			extractPdfText(await file.arrayBuffer()),
			PDF_EXTRACTION_TIMEOUT_MS,
			'PDF extraction'
		);
		return json({ text });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to extract PDF text.';
		return json({ error: message }, { status: 422 });
	}
};
