import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { inflate } from 'node:zlib';
import { promisify } from 'node:util';

const inflateAsync = promisify(inflate);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MIN_ACCEPTABLE_LENGTH = 80;

export const POST: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	const file = formData.get('file');
	if (!(file instanceof File)) return error(400, 'No file provided');
	if (file.size > MAX_FILE_SIZE) return error(413, 'File too large');

	const buffer = await file.arrayBuffer();
	const uint8 = new Uint8Array(buffer);

	// Strategy 1: pdfjs-dist server-side (no worker, Node mode)
	let pdfjsText = '';
	try {
		pdfjsText = await extractWithPdfjs(uint8);
	} catch {
		// pdfjs failed, continue to fallback
	}

	if (pdfjsText.length >= MIN_ACCEPTABLE_LENGTH) {
		return json({ text: normalize(pdfjsText) });
	}

	// Strategy 2: Raw binary text extraction (decompresses FlateDecode streams)
	let rawText = '';
	try {
		rawText = await extractRawPdfText(uint8);
	} catch {
		// raw extraction failed
	}

	if (rawText.length >= MIN_ACCEPTABLE_LENGTH) {
		return json({ text: normalize(rawText) });
	}

	// Return whatever we got, even if short
	const best = pdfjsText.length >= rawText.length ? pdfjsText : rawText;
	if (best.length > 0) {
		return json({ text: normalize(best) });
	}

	return error(
		422,
		'Could not extract text. This may be a scanned/image-only PDF. Please paste text manually.'
	);
};

function normalize(text: string): string {
	return text
		.replace(/\u00a0/g, ' ')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]{2,}/g, ' ')
		.trim();
}

async function extractWithPdfjs(data: Uint8Array): Promise<string> {
	const pdfjsLib = await import('pdfjs-dist');

	const pdf = await pdfjsLib.getDocument({
		data,
		useSystemFonts: true,
		disableWorker: true,
		stopAtErrors: false
	} as any).promise;

	try {
		const pages: string[] = [];
		for (let i = 1; i <= pdf.numPages; i++) {
			const page = await pdf.getPage(i);
			const content = await page.getTextContent();
			const items = (content.items as any[])
				.filter((item) => typeof item.str === 'string')
				.map((item) => ({
					str: String(item.str),
					x: Array.isArray(item.transform) ? Number(item.transform[4] ?? 0) : 0,
					y: Array.isArray(item.transform) ? Number(item.transform[5] ?? 0) : 0
				}));

			items.sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));

			const parts: string[] = [];
			let prevY: number | null = null;
			for (const item of items) {
				if (prevY !== null && Math.abs(item.y - prevY) > 6) parts.push('\n');
				parts.push(item.str, ' ');
				prevY = item.y;
			}

			const pageText = parts.join('').trim();
			if (pageText) pages.push(pageText);
		}
		return pages.join('\n\n');
	} finally {
		pdf.destroy();
	}
}

/**
 * Raw PDF binary text extraction fallback.
 * Finds stream/endstream pairs, decompresses FlateDecode streams,
 * and extracts text from PostScript text operators (Tj, TJ).
 */
async function extractRawPdfText(data: Uint8Array): Promise<string> {
	const raw = new TextDecoder('latin1').decode(data);
	const textParts: string[] = [];

	// Find stream boundaries
	let searchFrom = 0;
	while (searchFrom < raw.length) {
		const streamStart = raw.indexOf('stream', searchFrom);
		if (streamStart === -1) break;

		// Skip past stream keyword and newline
		let contentStart = streamStart + 6;
		if (raw[contentStart] === '\r') contentStart++;
		if (raw[contentStart] === '\n') contentStart++;

		const endMarker = raw.indexOf('endstream', contentStart);
		if (endMarker === -1) break;

		const streamContent = raw.substring(contentStart, endMarker);
		searchFrom = endMarker + 9;

		// Try to decompress the stream (FlateDecode)
		let decoded = '';
		try {
			const bytes = new Uint8Array(streamContent.length);
			for (let i = 0; i < streamContent.length; i++) {
				bytes[i] = streamContent.charCodeAt(i);
			}
			const inflated = await inflateAsync(Buffer.from(bytes));
			decoded = inflated.toString('latin1');
		} catch {
			// Not compressed or different compression — use raw content
			decoded = streamContent;
		}

		// Extract text from PostScript operators
		const extracted = extractPostScriptText(decoded);
		if (extracted.trim()) textParts.push(extracted.trim());
	}

	return textParts.join('\n');
}

function extractPostScriptText(stream: string): string {
	const parts: string[] = [];

	// Match (text) Tj — single text draw
	const tjRegex = /\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
	let match: RegExpExecArray | null;
	while ((match = tjRegex.exec(stream)) !== null) {
		parts.push(decodePsString(match[1]));
	}

	// Match [...] TJ — text array with kerning
	const tjArrayRegex = /\[((?:[^[\]]*?))\]\s*TJ/g;
	while ((match = tjArrayRegex.exec(stream)) !== null) {
		const arrayContent = match[1];
		const strRegex = /\(((?:[^()\\]|\\.)*)\)/g;
		let strMatch: RegExpExecArray | null;
		while ((strMatch = strRegex.exec(arrayContent)) !== null) {
			parts.push(decodePsString(strMatch[1]));
		}
	}

	// Also look for BT ... ET blocks with simple text
	if (parts.length === 0) {
		const btRegex = /BT\s([\s\S]*?)ET/g;
		while ((match = btRegex.exec(stream)) !== null) {
			const block = match[1];
			// Extract (text) operators within BT/ET
			const innerRegex = /\(((?:[^()\\]|\\.)*)\)/g;
			let innerMatch: RegExpExecArray | null;
			while ((innerMatch = innerRegex.exec(block)) !== null) {
				const decoded = decodePsString(innerMatch[1]);
				if (decoded.trim()) parts.push(decoded);
			}
		}
	}

	return parts.join('');
}

function decodePsString(s: string): string {
	return s
		.replace(/\\n/g, '\n')
		.replace(/\\r/g, '\r')
		.replace(/\\t/g, '\t')
		.replace(/\\\(/g, '(')
		.replace(/\\\)/g, ')')
		.replace(/\\\\/g, '\\')
		.replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}
