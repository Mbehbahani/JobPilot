import {
	query,
	action,
	internalQuery,
	internalMutation,
	internalAction
} from './_generated/server';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { v } from 'convex/values';
import { authComponent } from './auth';
import { gmailOAuth } from './env';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_GMAIL_MESSAGES_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';

type EmailSignalType = 'interview' | 'follow_up_interview' | 'rejection' | 'acceptance';

type GmailMessageSummary = {
	id: string;
	threadId?: string;
	subject?: string;
	from?: string;
	date?: string;
	snippet?: string;
	bodyText?: string;
};

type GmailPayloadPart = {
	mimeType?: string;
	body?: { data?: string };
	headers?: Array<{ name?: string; value?: string }>;
	parts?: GmailPayloadPart[];
};

type MatchableTask = {
	id: string;
	title: string;
	columnId: 'applied' | 'interviewing';
	companyName?: string;
	position?: string;
	interviewEmail?: string;
	hasUnreadEmailSignal?: boolean;
	emailSignalMessageId?: string;
};

interface GoogleIdTokenClaims {
	email?: string;
	email_verified?: boolean;
	sub?: string;
	scope?: string;
}

type GmailConnectionDoc = Doc<'gmailConnections'>;

type GmailOAuthConfig = {
	clientId: string;
	clientSecret: string;
	scopes: string[];
	getRedirectUri: () => string;
};

function parseJwtClaims(token: string): GoogleIdTokenClaims | undefined {
	const parts = token.split('.');
	if (parts.length !== 3) return undefined;
	try {
		const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
		return JSON.parse(atob(padded));
	} catch {
		return undefined;
	}
}

function assertGmailConfigured(): GmailOAuthConfig {
	if (!gmailOAuth.enabled || !gmailOAuth.clientId || !gmailOAuth.clientSecret) {
		throw new Error(
			'Gmail OAuth is not configured. Set GMAIL_GOOGLE_CLIENT_ID and GMAIL_GOOGLE_CLIENT_SECRET in the app environment.'
		);
	}
	return {
		clientId: gmailOAuth.clientId,
		clientSecret: gmailOAuth.clientSecret,
		scopes: gmailOAuth.scopes,
		getRedirectUri: gmailOAuth.getRedirectUri
	};
}

function extractEmail(tokens: { id_token?: string; access_token: string }): string | undefined {
	for (const token of [tokens.id_token, tokens.access_token]) {
		if (!token) continue;
		const claims = parseJwtClaims(token);
		if (claims?.email) return claims.email;
	}
	return undefined;
}

async function fetchProfileEmail(accessToken: string): Promise<string | undefined> {
	try {
		const response = await fetch(GOOGLE_USERINFO_URL, {
			headers: {
				Authorization: `Bearer ${accessToken}`
			}
		});
		if (!response.ok) return undefined;
		const data = (await response.json()) as { email?: string };
		return data.email;
	} catch {
		return undefined;
	}
}

const EMAIL_STOP_WORDS = new Set([
	'the',
	'and',
	'for',
	'with',
	'this',
	'that',
	'from',
	'team',
	'role',
	'position',
	'application',
	'job',
	'update',
	'about'
]);

function normalizeEmailText(value?: string): string {
	return (value ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9@.\s]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function tokenizeMatchWords(value?: string): string[] {
	return normalizeEmailText(value)
		.split(' ')
		.filter((token) => token.length >= 3 && !EMAIL_STOP_WORDS.has(token));
}

function tokenizeCompanyWords(value?: string): string[] {
	return normalizeEmailText(value)
		.split(' ')
		.filter(
			(token) =>
				token.length >= 3 &&
				!EMAIL_STOP_WORDS.has(token) &&
				!['inc', 'llc', 'gmbh', 'bv', 'ag', 'sa', 'plc', 'ltd'].includes(token)
		);
}

function countContainedTokens(tokens: string[], text: string): number {
	if (tokens.length === 0) return 0;
	return tokens.filter((token) => text.includes(token)).length;
}

function containsPhrase(text: string, phrase?: string): boolean {
	const normalizedPhrase = normalizeEmailText(phrase);
	if (!normalizedPhrase || normalizedPhrase.length < 4) return false;
	return text.includes(normalizedPhrase);
}

function extractMentionedPosition(message: GmailMessageSummary): string | undefined {
	const text = normalizeEmailText([message.subject, message.bodyText, message.snippet].join(' '));
	const patterns = [
		/position of ([a-z0-9&/(),\- ]{4,120}?)(?: here at | at | with | however | unfortunately | thank | best |$)/,
		/application for (?:the )?([a-z0-9&/(),\- ]{4,120}?)(?: role| position| here at | at | with | however | unfortunately | thank | best |$)/,
		/applied for (?:the )?([a-z0-9&/(),\- ]{4,120}?)(?: role| position| here at | at | with | however | unfortunately | thank | best |$)/
	];

	for (const pattern of patterns) {
		const match = text.match(pattern);
		const value = match?.[1]?.trim();
		if (value && value.length >= 4) return value;
	}

	return undefined;
}

function extractMentionedCompany(message: GmailMessageSummary): string | undefined {
	const text = normalizeEmailText(
		[message.subject, message.bodyText, message.snippet, message.from].join(' ')
	);
	const patterns = [
		/here at ([a-z0-9.&\- ]{2,100}?)(?: and | we | your cv | your application | your profile | however | unfortunately | best |$)/,
		/talent acquisition at ([a-z0-9.&\- ]{2,100}?)(?:$| we | your )/,
		/recruiting team at ([a-z0-9.&\- ]{2,100}?)(?:$| we | your )/
	];

	for (const pattern of patterns) {
		const match = text.match(pattern);
		const value = match?.[1]?.trim();
		if (value && value.length >= 2) return value;
	}

	return undefined;
}

function extractInterviewLink(message: GmailMessageSummary): string | undefined {
	const text = [message.bodyText, message.snippet, message.subject].filter(Boolean).join(' ');
	const match = text.match(/https?:\/\/[^\s)>'"]+/i);
	return match?.[0];
}

function extractInterviewDateText(message: GmailMessageSummary): string | undefined {
	const text = [message.bodyText, message.snippet, message.subject].filter(Boolean).join(' ');
	const normalized = text.replace(/\s+/g, ' ').trim();

	const patterns = [
		/((?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+[a-z]{3,9}\s+\d{1,2}(?:,?\s+\d{4})?(?:\s+(?:at\s+)??\d{1,2}:\d{2}\s*(?:am|pm)?)?)/i,
		/([a-z]{3,9}\s+\d{1,2}(?:,?\s+\d{4})?(?:\s+(?:at\s+)??\d{1,2}:\d{2}\s*(?:am|pm)?)?)/i,
		/(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(?:\s+(?:at\s+)??\d{1,2}:\d{2})?)/i,
		/(\d{1,2}:\d{2}\s*(?:am|pm))/i
	];

	for (const pattern of patterns) {
		const match = normalized.match(pattern);
		const value = match?.[1]?.trim();
		if (value && value.length >= 4) return value;
	}

	return undefined;
}

function extractEmailAddress(value?: string): string | undefined {
	return value?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase();
}

function extractEmailDomain(value?: string): string | undefined {
	const email = extractEmailAddress(value);
	return email?.split('@')[1];
}

function extractEmailLocalPart(value?: string): string | undefined {
	const email = extractEmailAddress(value);
	return email?.split('@')[0];
}

const GENERIC_RECRUITING_DOMAIN_SUFFIXES = [
	'workday.com',
	'myworkday.com',
	'smartrecruiters.com',
	'greenhouse.io',
	'lever.co',
	'ashbyhq.com',
	'jobvite.com',
	'icims.com',
	'successfactors.com'
];

function isGenericRecruitingDomain(domain?: string): boolean {
	if (!domain) return false;
	return GENERIC_RECRUITING_DOMAIN_SUFFIXES.some(
		(suffix) => domain === suffix || domain.endsWith(`.${suffix}`)
	);
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (trimmed.length <= maxLength) return trimmed;
	return `${trimmed.slice(0, maxLength - 1)}…`;
}

function decodeBase64Url(value?: string): string | undefined {
	if (!value) return undefined;
	try {
		const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
		const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
		return atob(padded);
	} catch {
		return undefined;
	}
}

function stripHtml(value: string): string {
	return value
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

function extractBodyTextFromPayload(payload?: GmailPayloadPart): string | undefined {
	if (!payload) return undefined;

	const queue = [payload];
	let htmlCandidate: string | undefined;

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) continue;

		if (current.mimeType === 'text/plain') {
			const decoded = decodeBase64Url(current.body?.data);
			if (decoded?.trim()) return decoded.replace(/\s+/g, ' ').trim();
		}

		if (current.mimeType === 'text/html' && !htmlCandidate) {
			const decoded = decodeBase64Url(current.body?.data);
			if (decoded?.trim()) htmlCandidate = stripHtml(decoded);
		}

		for (const part of current.parts ?? []) {
			queue.push(part);
		}
	}

	return htmlCandidate;
}

function scoreTaskMatch(message: GmailMessageSummary, task: MatchableTask): number {
	const subjectText = normalizeEmailText(message.subject);
	const _senderText = normalizeEmailText(message.from);
	const _snippetText = normalizeEmailText(message.snippet);
	const bodyText = normalizeEmailText(message.bodyText);
	const combinedText = normalizeEmailText(
		[message.subject, message.from, message.snippet, message.bodyText].filter(Boolean).join(' ')
	);
	let score = 0;
	let penalty = 0;

	const interviewEmail = extractEmailAddress(task.interviewEmail);
	if (interviewEmail && combinedText.includes(interviewEmail)) {
		score += 12;
	}

	const interviewDomain = extractEmailDomain(task.interviewEmail);
	const senderDomain = extractEmailDomain(message.from);
	if (interviewDomain && senderDomain && interviewDomain === senderDomain) {
		score += isGenericRecruitingDomain(senderDomain) ? 2 : 6;
	}
	const senderLocalPart = normalizeEmailText(extractEmailLocalPart(message.from));

	const company = normalizeEmailText(task.companyName);
	const companyTokens = tokenizeCompanyWords(task.companyName);
	const companyMatchesInAll = countContainedTokens(companyTokens, combinedText);
	const companyMatchesInSubject = countContainedTokens(companyTokens, subjectText);
	if (company && combinedText.includes(company)) {
		score += 12;
	}
	if (company && subjectText.includes(company)) {
		score += 8;
	}
	if (companyMatchesInAll > 0) {
		score += Math.min(companyMatchesInAll * 3, 9);
	}
	if (companyMatchesInSubject > 0) {
		score += Math.min(companyMatchesInSubject * 3, 6);
	}
	if (companyTokens.length >= 2 && companyMatchesInAll === 0) {
		penalty += 7;
	}
	if (companyTokens.length >= 3 && companyMatchesInAll < Math.ceil(companyTokens.length / 2)) {
		penalty += 5;
	}
	if (senderLocalPart && companyTokens.some((token) => senderLocalPart.includes(token))) {
		score += 5;
	}

	const mentionedCompany = extractMentionedCompany(message);
	const mentionedCompanyTokens = tokenizeCompanyWords(mentionedCompany);
	const mentionedCompanyMatches = countContainedTokens(mentionedCompanyTokens, company);
	if (mentionedCompanyTokens.length >= 2) {
		if (mentionedCompanyMatches >= Math.min(2, mentionedCompanyTokens.length)) {
			score += 8;
		} else {
			penalty += 12;
		}
	}

	const positionPhrase = normalizeEmailText(task.position || task.title);
	if (containsPhrase(subjectText, positionPhrase)) {
		score += 10;
	} else if (containsPhrase(combinedText, positionPhrase)) {
		score += 6;
	}

	const positionTokens = tokenizeMatchWords(task.position || task.title);
	const titleMatches = positionTokens.filter((token) => combinedText.includes(token));
	if (titleMatches.length > 0) {
		score += Math.min(titleMatches.length * 2, 8);
	}
	const titleMatchesInSubject = positionTokens.filter((token) =>
		subjectText.includes(token)
	).length;
	if (titleMatchesInSubject > 0) {
		score += Math.min(titleMatchesInSubject * 2, 6);
	}
	if (positionTokens.length >= 2 && titleMatches.length === 0) {
		penalty += 3;
	}

	const mentionedPosition = extractMentionedPosition(message);
	const mentionedPositionText = normalizeEmailText(mentionedPosition);
	const mentionedPositionTokens = tokenizeMatchWords(mentionedPositionText);
	const mentionedPositionMatchCount = countContainedTokens(mentionedPositionTokens, positionPhrase);
	if (mentionedPositionText) {
		if (
			containsPhrase(positionPhrase, mentionedPositionText) ||
			containsPhrase(mentionedPositionText, positionPhrase)
		) {
			score += 10;
		} else if (mentionedPositionTokens.length >= 2) {
			if (mentionedPositionMatchCount >= Math.min(2, mentionedPositionTokens.length)) {
				score += 5;
			} else {
				penalty += 10;
			}
		}
	}

	if (senderDomain && companyTokens.some((token) => senderDomain.includes(token))) {
		score += 5;
	}

	if (
		bodyText.includes('we decided not to move forward') ||
		bodyText.includes('not moving forward')
	) {
		if (companyMatchesInAll === 0) {
			penalty += 6;
		}
		if (
			!containsPhrase(combinedText, task.companyName) &&
			!containsPhrase(combinedText, task.position)
		) {
			penalty += 4;
		}
	}

	return score - penalty;
}

function classifyEmailOutcome(
	message: GmailMessageSummary,
	task: MatchableTask
): {
	type: EmailSignalType;
	summary: string;
	nextAction: string;
	interviewEmail?: string;
	interviewDate?: string;
	interviewLink?: string;
} | null {
	const subject = normalizeEmailText(message.subject);
	const snippet = normalizeEmailText(message.snippet);
	const body = normalizeEmailText(message.bodyText);
	const sender = normalizeEmailText(message.from);
	const text = `${subject} ${snippet} ${body} ${sender}`;

	const hasAny = (...phrases: string[]) => phrases.some((phrase) => text.includes(phrase));
	const subjectLabel = truncateText(message.subject, 90);
	const senderLabel = truncateText(message.from, 60);
	const subjectSuffix = subjectLabel ? ` (${subjectLabel})` : '';
	const fromSuffix = senderLabel ? ` from ${senderLabel}` : '';

	if (
		hasAny(
			'unfortunately',
			'not moving forward',
			'not be moving forward',
			'regret to inform',
			'other candidates',
			'position has been filled',
			'rejected',
			'rejection'
		)
	) {
		return {
			type: 'rejection',
			summary: `A rejection-style email was detected${subjectSuffix}${fromSuffix}.`,
			nextAction: 'Review the message, then move this task to Done when you are ready.'
		};
	}

	if (
		hasAny(
			'pleased to offer',
			'offer letter',
			'job offer',
			'we are excited to offer',
			'congratulations',
			'welcome aboard',
			'offer of employment'
		)
	) {
		return {
			type: 'acceptance',
			summary: `An offer/acceptance-style email was detected${subjectSuffix}${fromSuffix}.`,
			nextAction:
				'Review the offer details and decide on your response before moving this task to Done.'
		};
	}

	if (
		hasAny(
			'second interview',
			'final interview',
			'next round',
			'follow up interview',
			'follow-up interview',
			'panel interview',
			'technical interview',
			'onsite interview'
		)
	) {
		const interviewEmail = [message.from, message.subject, message.snippet, message.bodyText]
			.filter(Boolean)
			.join('\n');
		const interviewDate = extractInterviewDateText(message);
		const interviewLink = extractInterviewLink(message);
		return {
			type: 'follow_up_interview',
			summary: `A follow-up interview email was detected${subjectSuffix}${fromSuffix}.`,
			nextAction:
				task.columnId === 'applied'
					? 'Move this task to Interviewing and update the next-round interview details.'
					: 'Keep this task in Interviewing and update the next-round interview details.',
			interviewEmail,
			interviewDate,
			interviewLink
		};
	}

	if (
		hasAny(
			'interview',
			'schedule a call',
			'schedule an interview',
			'book a time',
			'calendar invite',
			'availability for',
			'chat with the team',
			'meet with'
		)
	) {
		const interviewEmail = [message.from, message.subject, message.snippet, message.bodyText]
			.filter(Boolean)
			.join('\n');
		const interviewDate = extractInterviewDateText(message);
		const interviewLink = extractInterviewLink(message);
		return {
			type: 'interview',
			summary: `An interview-style email was detected${subjectSuffix}${fromSuffix}.`,
			nextAction:
				task.columnId === 'applied'
					? 'Move this task to Interviewing and add the interview details.'
					: 'Update the interview details and prepare for the meeting.',
			interviewEmail,
			interviewDate,
			interviewLink
		};
	}

	return null;
}

function buildEmailNoteEntry(
	message: GmailMessageSummary,
	classification: { summary: string; nextAction: string }
): string {
	return [
		`Email update: ${classification.summary}`,
		message.from ? `From: ${message.from}` : undefined,
		message.subject ? `Subject: ${message.subject}` : undefined,
		message.snippet ? `Snippet: ${truncateText(message.snippet, 220)}` : undefined,
		message.bodyText ? `Body: ${truncateText(message.bodyText, 400)}` : undefined,
		`Next action: ${classification.nextAction}`
	]
		.filter(Boolean)
		.join('\n');
}

function getMessageHeader(
	headers: Array<{ name?: string; value?: string }> | undefined,
	name: string
): string | undefined {
	return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value;
}

export const getConnection = query({
	args: {},
	handler: async (ctx) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) {
			return {
				configured: gmailOAuth.enabled,
				connection: null
			};
		}

		const connection = await ctx.db
			.query('gmailConnections')
			.withIndex('by_user', (q) => q.eq('userId', user._id))
			.unique();

		if (!connection) {
			return {
				configured: gmailOAuth.enabled,
				connection: null
			};
		}

		return {
			configured: gmailOAuth.enabled,
			connection: {
				email: connection.email,
				scope: connection.scope,
				connectedAt: connection.connectedAt,
				updatedAt: connection.updatedAt,
				lastSyncAt: connection.lastSyncAt,
				isExpired: connection.expiresAt < Date.now()
			}
		};
	}
});

export const storeTokens = internalMutation({
	args: {
		userId: v.string(),
		accessToken: v.string(),
		refreshToken: v.string(),
		expiresAt: v.number(),
		email: v.optional(v.string()),
		scope: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('gmailConnections')
			.withIndex('by_user', (q) => q.eq('userId', args.userId))
			.unique();

		const now = Date.now();

		if (existing) {
			await ctx.db.patch(existing._id, {
				accessToken: args.accessToken,
				refreshToken: args.refreshToken,
				expiresAt: args.expiresAt,
				email: args.email ?? existing.email,
				scope: args.scope ?? existing.scope,
				updatedAt: now
			});
		} else {
			await ctx.db.insert('gmailConnections', {
				userId: args.userId,
				accessToken: args.accessToken,
				refreshToken: args.refreshToken,
				expiresAt: args.expiresAt,
				email: args.email,
				scope: args.scope,
				connectedAt: now,
				updatedAt: now
			});
		}
	}
});

export const markSynced = internalMutation({
	args: {
		userId: v.string(),
		lastSyncAt: v.number(),
		historyId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('gmailConnections')
			.withIndex('by_user', (q) => q.eq('userId', args.userId))
			.unique();
		if (!existing) return;

		await ctx.db.patch(existing._id, {
			lastSyncAt: args.lastSyncAt,
			historyId: args.historyId ?? existing.historyId,
			updatedAt: Date.now()
		});
	}
});

export const getConnectionInternal = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, { userId }): Promise<GmailConnectionDoc | null> => {
		return await ctx.db
			.query('gmailConnections')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.unique();
	}
});

export const deleteConnectionInternal = internalMutation({
	args: { connectionId: v.id('gmailConnections') },
	handler: async (ctx, { connectionId }) => {
		await ctx.db.delete(connectionId);
	}
});

export const deleteConnection = action({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) throw new Error('Not authenticated');

		const connection = await ctx.runQuery(internal.gmail.getConnectionInternal, {
			userId: user._id
		});

		if (connection) {
			await ctx.runMutation(internal.gmail.deleteConnectionInternal, {
				connectionId: connection._id
			});
		}

		return null;
	}
});

export const getAuthorizationUrl = action({
	args: {
		redirectUri: v.optional(v.string()),
		state: v.optional(v.string())
	},
	returns: v.object({
		authorizationUrl: v.string(),
		redirectUri: v.string(),
		state: v.string()
	}),
	handler: async (
		ctx,
		args
	): Promise<{ authorizationUrl: string; redirectUri: string; state: string }> => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) throw new Error('Not authenticated');

		const config = assertGmailConfigured();
		const redirectUri = args.redirectUri ?? config.getRedirectUri();
		const state = args.state ?? crypto.randomUUID();
		const authorizationUrl = `${GOOGLE_AUTH_URL}?${new URLSearchParams({
			client_id: config.clientId,
			redirect_uri: redirectUri,
			response_type: 'code',
			scope: config.scopes.join(' '),
			access_type: 'offline',
			include_granted_scopes: 'true',
			prompt: 'consent',
			state
		}).toString()}`;

		return {
			authorizationUrl,
			redirectUri,
			state
		};
	}
});

export const exchangeAuthCode = action({
	args: {
		code: v.string(),
		redirectUri: v.optional(v.string())
	},
	returns: v.object({
		email: v.optional(v.string()),
		connectedAt: v.number()
	}),
	handler: async (ctx, args): Promise<{ email?: string; connectedAt: number }> => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) throw new Error('Not authenticated');

		const config = assertGmailConfigured();
		const redirectUri = args.redirectUri ?? config.getRedirectUri();
		const existing: GmailConnectionDoc | null = await ctx.runQuery(
			internal.gmail.getConnectionInternal,
			{
				userId: user._id
			}
		);

		const response = await fetch(GOOGLE_TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				code: args.code,
				client_id: config.clientId,
				client_secret: config.clientSecret,
				redirect_uri: redirectUri,
				grant_type: 'authorization_code'
			}).toString()
		});

		if (!response.ok) {
			throw new Error(`Failed to exchange Gmail auth code: ${response.status}`);
		}

		const tokens = (await response.json()) as {
			access_token: string;
			refresh_token?: string;
			expires_in?: number;
			id_token?: string;
			scope?: string;
		};

		const refreshToken = tokens.refresh_token ?? existing?.refreshToken;
		if (!refreshToken) {
			throw new Error('No Gmail refresh token returned');
		}

		const email: string | undefined =
			extractEmail({
				id_token: tokens.id_token,
				access_token: tokens.access_token
			}) ??
			(await fetchProfileEmail(tokens.access_token)) ??
			existing?.email;

		await ctx.runMutation(internal.gmail.storeTokens, {
			userId: user._id,
			accessToken: tokens.access_token,
			refreshToken,
			expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
			email,
			scope: tokens.scope ?? existing?.scope
		});

		return {
			email,
			connectedAt: Date.now()
		};
	}
});

export const getValidAccessToken = internalAction({
	args: { userId: v.string() },
	handler: async (ctx, { userId }): Promise<{ accessToken: string; email?: string } | null> => {
		const connection = await ctx.runQuery(internal.gmail.getConnectionInternal, {
			userId
		});

		if (!connection) return null;

		if (connection.expiresAt > Date.now() + 60_000) {
			return {
				accessToken: connection.accessToken,
				email: connection.email ?? undefined
			};
		}

		const config = assertGmailConfigured();
		const response = await fetch(GOOGLE_TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: config.clientId,
				client_secret: config.clientSecret,
				refresh_token: connection.refreshToken,
				grant_type: 'refresh_token'
			}).toString()
		});

		if (!response.ok) {
			console.error('Gmail token refresh failed:', response.status);
			return null;
		}

		const tokens = (await response.json()) as {
			access_token: string;
			expires_in?: number;
			id_token?: string;
			scope?: string;
		};

		const email =
			extractEmail({
				id_token: tokens.id_token,
				access_token: tokens.access_token
			}) ??
			(await fetchProfileEmail(tokens.access_token)) ??
			connection.email;

		await ctx.runMutation(internal.gmail.storeTokens, {
			userId,
			accessToken: tokens.access_token,
			refreshToken: connection.refreshToken,
			expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
			email,
			scope: tokens.scope ?? connection.scope
		});

		return {
			accessToken: tokens.access_token,
			email: email ?? undefined
		};
	}
});

export const readRecentEmails = action({
	args: {
		maxResults: v.optional(v.number())
	},
	returns: v.object({
		count: v.number(),
		checkedAt: v.number(),
		messages: v.array(
			v.object({
				id: v.string(),
				threadId: v.optional(v.string()),
				subject: v.optional(v.string()),
				from: v.optional(v.string()),
				date: v.optional(v.string()),
				snippet: v.optional(v.string())
			})
		)
	}),
	handler: async (ctx, args) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) throw new Error('Not authenticated');

		const auth = await ctx.runAction(internal.gmail.getValidAccessToken, {
			userId: user._id
		});
		if (!auth) {
			throw new Error('Gmail is not connected');
		}

		const maxResults = Math.min(Math.max(args.maxResults ?? 10, 1), 20);
		const listParams = new URLSearchParams();
		listParams.set('maxResults', String(maxResults));
		listParams.append('labelIds', 'INBOX');

		const listResponse = await fetch(`${GOOGLE_GMAIL_MESSAGES_URL}?${listParams.toString()}`, {
			headers: {
				Authorization: `Bearer ${auth.accessToken}`
			}
		});

		if (!listResponse.ok) {
			throw new Error(`Failed to read Gmail inbox: ${listResponse.status}`);
		}

		const listData = (await listResponse.json()) as {
			messages?: Array<{ id: string; threadId?: string }>;
		};

		const checkedAt = Date.now();
		const messages = await Promise.all(
			(listData.messages ?? []).slice(0, maxResults).map(async (message) => {
				const detailParams = new URLSearchParams();
				detailParams.set('format', 'full');
				detailParams.append('metadataHeaders', 'Subject');
				detailParams.append('metadataHeaders', 'From');
				detailParams.append('metadataHeaders', 'Date');

				const detailResponse = await fetch(
					`${GOOGLE_GMAIL_MESSAGES_URL}/${message.id}?${detailParams.toString()}`,
					{
						headers: {
							Authorization: `Bearer ${auth.accessToken}`
						}
					}
				);

				if (!detailResponse.ok) {
					return {
						id: message.id,
						threadId: message.threadId,
						subject: undefined,
						from: undefined,
						date: undefined,
						snippet: undefined,
						bodyText: undefined
					};
				}

				const detail = (await detailResponse.json()) as {
					id: string;
					threadId?: string;
					snippet?: string;
					payload?: GmailPayloadPart;
				};

				return {
					id: detail.id,
					threadId: detail.threadId,
					subject: getMessageHeader(detail.payload?.headers, 'Subject'),
					from: getMessageHeader(detail.payload?.headers, 'From'),
					date: getMessageHeader(detail.payload?.headers, 'Date'),
					snippet: detail.snippet,
					bodyText: extractBodyTextFromPayload(detail.payload)
				};
			})
		);

		const candidateTasks = ((await ctx.runQuery(internal.todos.getTasksForEmailMatchingInternal, {
			userId: user._id
		})) ?? []) as MatchableTask[];
		const touchedTaskIds = new Set<string>();

		for (const message of messages) {
			const scoredTasks = candidateTasks
				.filter((task) => !touchedTaskIds.has(task.id))
				.map((task) => ({ task, score: scoreTaskMatch(message, task) }))
				.sort((a, b) => b.score - a.score);

			const best = scoredTasks[0];
			const runnerUp = scoredTasks[1];
			if (!best || best.score < 5) continue;
			if (runnerUp && best.score < runnerUp.score + 2) continue;
			if (best.task.emailSignalMessageId === message.id && best.task.hasUnreadEmailSignal) {
				continue;
			}

			const classification = classifyEmailOutcome(message, best.task);
			if (!classification) continue;

			await ctx.runMutation(internal.todos.updateTaskEmailSignalInternal, {
				userId: user._id,
				taskId: best.task.id,
				messageId: message.id,
				emailSignalType: classification.type,
				emailSignalSummary: classification.summary,
				emailSignalNextAction: classification.nextAction,
				emailSignalAt: checkedAt,
				noteEntry: buildEmailNoteEntry(message, classification),
				interviewEmail: classification.interviewEmail,
				interviewDate: classification.interviewDate,
				interviewLink: classification.interviewLink
			});

			touchedTaskIds.add(best.task.id);
		}

		await ctx.runMutation(internal.gmail.markSynced, {
			userId: user._id,
			lastSyncAt: checkedAt
		});

		return {
			count: messages.length,
			checkedAt,
			messages: messages.map(({ bodyText: _bodyText, ...message }) => message)
		};
	}
});
