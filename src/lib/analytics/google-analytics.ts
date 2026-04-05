const CONSENT_STORAGE_KEY = 'JobFlow:analytics-consent';

let initializedMeasurementId: string | null = null;
let lastTrackedPath: string | null = null;

declare global {
	interface Window {
		dataLayer?: unknown[];
		gtag?: (...args: unknown[]) => void;
	}
}

function ensureGtag(): void {
	window.dataLayer = window.dataLayer ?? [];
	window.gtag =
		window.gtag ??
		function gtag(...args: unknown[]) {
			window.dataLayer?.push(args);
		};
}

/** Returns true if the user has already accepted analytics consent in this browser. */
export function hasAnalyticsConsent(): boolean {
	if (typeof localStorage === 'undefined') return false;
	return localStorage.getItem(CONSENT_STORAGE_KEY) === 'granted';
}

/** Updates consent to granted and persists the choice. Call when user clicks Accept. */
export function grantAnalyticsConsent(): void {
	if (typeof window === 'undefined') return;
	ensureGtag();
	window.gtag!('consent', 'update', {
		ad_storage: 'granted',
		ad_user_data: 'granted',
		ad_personalization: 'granted',
		analytics_storage: 'granted'
	});
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(CONSENT_STORAGE_KEY, 'granted');
	}
}

export function initGoogleAnalytics(measurementId: string): void {
	if (typeof window === 'undefined' || typeof document === 'undefined') return;

	const id = measurementId.trim();
	if (!id) return;

	if (initializedMeasurementId === id) return;
	initializedMeasurementId = id;

	ensureGtag();

	// Set consent defaults to denied BEFORE loading the tag (consent mode v2 requirement)
	window.gtag!('consent', 'default', {
		ad_storage: 'denied',
		ad_user_data: 'denied',
		ad_personalization: 'denied',
		analytics_storage: 'denied'
	});

	window.gtag!('js', new Date());
	window.gtag!('config', id, { send_page_view: false });

	const scriptSrc = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
	const hasScript = Array.from(document.scripts).some((script) => script.src === scriptSrc);
	if (!hasScript) {
		const script = document.createElement('script');
		script.async = true;
		script.src = scriptSrc;
		document.head.append(script);
	}

	// Restore granted state if user already consented in a previous session
	if (hasAnalyticsConsent()) {
		grantAnalyticsConsent();
	}
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
