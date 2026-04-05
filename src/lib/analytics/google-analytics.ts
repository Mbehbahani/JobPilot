let initializedMeasurementId: string | null = null;
let lastTrackedPath: string | null = null;

declare global {
	interface Window {
		dataLayer?: unknown[];
		gtag?: (...args: unknown[]) => void;
	}
}

export function initGoogleAnalytics(measurementId: string): void {
	if (typeof window === 'undefined' || typeof document === 'undefined') return;

	const id = measurementId.trim();
	if (!id) return;

	if (initializedMeasurementId === id) return;
	initializedMeasurementId = id;

	window.dataLayer = window.dataLayer || [];
	window.gtag =
		window.gtag ||
		function gtag(...args: unknown[]) {
			window.dataLayer?.push(args);
		};

	window.gtag('js', new Date());
	window.gtag('config', id, {
		send_page_view: false
	});

	const scriptSrc = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
	const hasScript = Array.from(document.scripts).some((script) => script.src === scriptSrc);
	if (hasScript) return;

	const script = document.createElement('script');
	script.async = true;
	script.src = scriptSrc;
	document.head.append(script);
}

export function trackGooglePageView(url: URL): void {
	if (typeof window === 'undefined') return;
	if (initializedMeasurementId === null) return;
	if (typeof window.gtag !== 'function') return;

	const path = `${url.pathname}${url.search}`;
	if (lastTrackedPath === path) return;
	lastTrackedPath = path;

	window.gtag('event', 'page_view', {
		page_title: document.title,
		page_location: url.toString(),
		page_path: path
	});
}
