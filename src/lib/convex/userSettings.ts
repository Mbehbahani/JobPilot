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
					motivationLetterPrompt: settings.motivationLetterPrompt ?? '',
					profileResume: settings.profileResume ?? ''
				}
			: {
					motivationLetterPrompt: '',
					profileResume: ''
				};
	}
});

export const saveUserSettings = authedMutation({
	args: {
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
				...(args.motivationLetterPrompt !== undefined
					? { motivationLetterPrompt: args.motivationLetterPrompt }
					: {}),
				...(args.profileResume !== undefined ? { profileResume: args.profileResume } : {}),
				updatedAt: now
			});
		} else {
			await ctx.db.insert('userSettings', {
				userId: ctx.user._id,
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
			motivationLetterPrompt: settings?.motivationLetterPrompt ?? '',
			profileResume: settings?.profileResume ?? ''
		};
	}
});
