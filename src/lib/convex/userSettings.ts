import { v } from 'convex/values';
import { authedMutation, authedQuery } from './functions';
import { internalQuery } from './_generated/server';

export const getUserSettings = authedQuery({
	args: {},
	handler: async (ctx) => {
		const settings = await ctx.db
			.query('userSettings')
			.withIndex('by_user', (q) => q.eq('userId', ctx.user._id))
			.first();

		return settings
			? {
					motivationLetterFormat: settings.motivationLetterFormat ?? '',
					motivationLetterPrompt: settings.motivationLetterPrompt ?? '',
					profileResume: settings.profileResume ?? ''
				}
			: {
					motivationLetterFormat: '',
					motivationLetterPrompt: '',
					profileResume: ''
				};
	}
});

export const saveUserSettings = authedMutation({
	args: {
		motivationLetterFormat: v.optional(v.string()),
		motivationLetterPrompt: v.optional(v.string()),
		profileResume: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('userSettings')
			.withIndex('by_user', (q) => q.eq('userId', ctx.user._id))
			.first();

		const now = Date.now();

		if (existing) {
			await ctx.db.patch(existing._id, {
				...(args.motivationLetterFormat !== undefined
					? { motivationLetterFormat: args.motivationLetterFormat }
					: {}),
				...(args.motivationLetterPrompt !== undefined
					? { motivationLetterPrompt: args.motivationLetterPrompt }
					: {}),
				...(args.profileResume !== undefined ? { profileResume: args.profileResume } : {}),
				updatedAt: now
			});
		} else {
			await ctx.db.insert('userSettings', {
				userId: ctx.user._id,
				motivationLetterFormat: args.motivationLetterFormat ?? '',
				motivationLetterPrompt: args.motivationLetterPrompt ?? '',
				profileResume: args.profileResume ?? '',
				updatedAt: now
			});
		}
	}
});

export const getUserSettingsInternal = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		const settings = await ctx.db
			.query('userSettings')
			.withIndex('by_user', (q) => q.eq('userId', args.userId as any))
			.first();

		return {
			motivationLetterFormat: settings?.motivationLetterFormat ?? '',
			motivationLetterPrompt: settings?.motivationLetterPrompt ?? '',
			profileResume: settings?.profileResume ?? ''
		};
	}
});
