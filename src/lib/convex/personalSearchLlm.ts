import { action } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { streamText } from 'ai';
import { authComponent } from './auth';
import { getTaskLanguageModelForUser, getSupportLanguageModel } from './support/llmProvider';

const ENRICHMENT_LEVELS = [
	'Entry Level',
	'Mid-Level',
	'Senior',
	'Director',
	'Executive',
	'Internship',
	'Not Specified'
];

const ENRICHMENT_FUNCTIONS = [
	'Engineering',
	'Data Science & Analytics',
	'Supply Chain & Logistics',
	'Operations Research',
	'Information Technology',
	'Research & Development',
	'Sales & Marketing',
	'Consulting',
	'Business & Finance',
	'Management',
	'Education',
	'Product Management',
	'Healthcare',
	'Other'
];

async function getModel(ctx: any): Promise<any> {
	try {
		const user = await authComponent.getAuthUser(ctx);
		if (user?._id) {
			return await getTaskLanguageModelForUser(ctx, user._id);
		}
	} catch {
		// fall through to OpenRouter
	}
	return getSupportLanguageModel();
}

export const standardizeInputs = action({
	args: {
		keywords: v.array(v.string()),
		city: v.optional(v.string()),
		country: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		try {
			const model = await getModel(ctx);
			const result = streamText({
				model,
				system: `You are a job search input standardizer. Given search parameters, return a JSON object with:
- "keywords": array of cleaned keyword strings (fix typos, expand abbreviations)
- "city": standardized city name or null
- "country": standardized country name matching python-jobspy format (e.g. "netherlands" not "the netherlands", "usa" not "US") or null
- "warnings": array of warning strings for the user (e.g. if a keyword seems too broad)

IMPORTANT: Only fix clear typos and normalize formatting. Do NOT add new keywords the user didn't intend.
Valid countries for Indeed: argentina, australia, austria, bahrain, bangladesh, belgium, brazil, canada, chile, china, colombia, costa rica, croatia, cyprus, czechia, denmark, ecuador, egypt, estonia, finland, france, germany, greece, hong kong, hungary, india, indonesia, ireland, israel, italy, japan, kuwait, latvia, lithuania, luxembourg, malaysia, malta, mexico, morocco, netherlands, new zealand, nigeria, norway, oman, pakistan, panama, peru, philippines, poland, portugal, qatar, romania, saudi arabia, singapore, slovakia, slovenia, south africa, south korea, spain, sweden, switzerland, taiwan, thailand, türkiye, ukraine, united arab emirates, united kingdom, usa, uruguay, venezuela, vietnam

Return ONLY valid JSON, no markdown.`,
				prompt: `Keywords: ${JSON.stringify(args.keywords)}\nCity: ${args.city || 'none'}\nCountry: ${args.country || 'none'}`,
				temperature: 0.1
			});
			const text = await result.text;
			const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
			const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]);
				return {
					keywords: parsed.keywords ?? args.keywords,
					city: parsed.city ?? args.city,
					country: parsed.country ?? args.country,
					warnings: parsed.warnings ?? []
				};
			}
		} catch (e) {
			console.error('[personalSearchLlm] standardize error:', e);
		}
		return {
			keywords: args.keywords,
			city: args.city,
			country: args.country,
			warnings: []
		};
	}
});

export const interpretResult = action({
	args: {
		status: v.string(),
		totalFound: v.number(),
		totalNew: v.number(),
		sourceSummary: v.any(),
		keywords: v.array(v.string()),
		city: v.optional(v.string()),
		country: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const errors: string[] = [];
		if (args.sourceSummary && typeof args.sourceSummary === 'object') {
			for (const [src, info] of Object.entries(args.sourceSummary) as [string, any][]) {
				if (info?.error) errors.push(`${src}: ${info.error}`);
			}
		}

		try {
			const model = await getModel(ctx);
			const result = streamText({
				model,
				system: `You are a job search assistant. Given search results, write a brief 1-3 sentence summary for the user.
Include: what was found, any issues encountered, and ONE actionable suggestion if there were problems.
Be concise and conversational. Do NOT use technical jargon or mention error codes.
If everything went well, just summarize the results positively.`,
				prompt: `Search status: ${args.status}
Keywords: ${args.keywords.join(', ')}
Location: ${args.city || ''}, ${args.country || ''}
Total found: ${args.totalFound}, New: ${args.totalNew}
Source results: ${JSON.stringify(args.sourceSummary)}
Errors: ${errors.length ? errors.join('; ') : 'none'}`,
				temperature: 0.3
			});
			const text = await result.text;
			const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
			return cleaned || null;
		} catch (e) {
			console.error('[personalSearchLlm] interpret error:', e);
			return null;
		}
	}
});

export const suggestKeywordsFromProfile = action({
	args: {},
	handler: async (ctx) => {
		try {
			const user = await authComponent.getAuthUser(ctx);
			if (!user?._id) {
				return { ok: false, error: 'Not authenticated' as const };
			}

			const settings = await ctx.runQuery(internal.userSettings.getUserSettingsInternal, {
				userId: user._id
			});
			const profileResume = settings?.profileResume?.trim() ?? '';
			if (!profileResume) {
				return { ok: false, error: 'missing_profile' as const };
			}

			const model = await getModel(ctx);
			const result = streamText({
				model,
				system: `You extract job-search keyword suggestions from a user's CV/profile.
Return ONLY valid JSON with this shape:
{
  "keywords": ["keyword 1", "keyword 2", "keyword 3"]
}

Rules:
- Suggest 5 to 8 concise keywords.
- Focus on job titles, specialties, and core skill clusters useful for job search.
- Do not include cities, countries, or long phrases.
- Do not include explanations or markdown.`,
				prompt: `CV / Profile:\n${profileResume}`,
				temperature: 0.2
			});
			const text = await result.text;
			const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
			const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
			if (!jsonMatch) {
				return { ok: false, error: 'parse_failed' as const };
			}
			const parsed = JSON.parse(jsonMatch[0]);
			const keywords = Array.isArray(parsed.keywords)
				? parsed.keywords
						.map((item: unknown) => (typeof item === 'string' ? item.trim() : ''))
						.filter(Boolean)
						.slice(0, 8)
				: [];

			if (keywords.length === 0) {
				return { ok: false, error: 'parse_failed' as const };
			}

			return { ok: true, keywords };
		} catch (e) {
			console.error('[personalSearchLlm] suggest keywords error:', e);
			return { ok: false, error: 'failed' as const };
		}
	}
});

export const enrichJobForSearch = action({
	args: {
		job: v.any(),
		keywords: v.array(v.string()),
		city: v.optional(v.string()),
		country: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		try {
			const model = await getModel(ctx);
			const result = streamText({
				model,
				system: `You enrich job postings for a personal job-search product.
Return ONLY valid JSON with:
- actual_role: string
- company_name: string
- skills: array of up to 12 concise skills
- job_level_std: one of ${JSON.stringify(ENRICHMENT_LEVELS)}
- job_function_std: one of ${JSON.stringify(ENRICHMENT_FUNCTIONS)}
- company_industry_std: concise string
- education_level: array of concise strings like Bachelor, Master, PhD
- relevance_score: number from 0 to 10
- reasoning: short string

Use the user's search keywords and the job text. Do not invent unsupported facts.`,
				prompt: JSON.stringify({
					job: args.job,
					search: {
						keywords: args.keywords,
						city: args.city,
						country: args.country
					}
				}),
				temperature: 0.2
			});
			const text = await result.text;
			const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
			const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
			if (!jsonMatch) return null;
			return JSON.parse(jsonMatch[0]);
		} catch (e) {
			console.error('[personalSearchLlm] enrich job error:', e);
			return null;
		}
	}
});

export const enrichJobsForSearch = action({
	args: {
		jobs: v.array(v.any()),
		keywords: v.array(v.string()),
		city: v.optional(v.string()),
		country: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		try {
			const model = await getModel(ctx);
			const result = streamText({
				model,
				system: `You enrich job postings for a personal job-search product.
Return ONLY valid JSON with this shape:
{
  "results": [
    {
      "actual_role": string,
      "company_name": string,
      "skills": string[],
      "job_level_std": string,
      "job_function_std": string,
      "company_industry_std": string,
      "education_level": string[],
      "relevance_score": number,
      "reasoning": string
    }
  ]
}

Rules:
- Return exactly one result object per input job, in the same order.
- job_level_std must be one of ${JSON.stringify(ENRICHMENT_LEVELS)}
- job_function_std must be one of ${JSON.stringify(ENRICHMENT_FUNCTIONS)}
- skills must be concise and limited.
- Do not invent unsupported facts.`,
				prompt: JSON.stringify({
					jobs: args.jobs,
					search: {
						keywords: args.keywords,
						city: args.city,
						country: args.country
					}
				})
			});
			const text = await result.text;
			const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
			const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
			if (!jsonMatch) return null;
			const parsed = JSON.parse(jsonMatch[0]);
			return Array.isArray(parsed.results) ? parsed.results : null;
		} catch (e) {
			console.error('[personalSearchLlm] enrich jobs error:', e);
			return null;
		}
	}
});
