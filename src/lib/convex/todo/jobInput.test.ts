import { describe, expect, it } from 'vitest';

import {
	extractLinkedInJobId,
	isLikelyJobDescription,
	normalizeJobInput,
	normalizePublicUrl
} from './jobInput';

describe('normalizeJobInput', () => {
	it('copies a URL entered as the title into jobUrl', () => {
		expect(normalizeJobInput({ title: 'https://www.linkedin.com/jobs/view/4431836707/' })).toEqual({
			title: 'https://www.linkedin.com/jobs/view/4431836707/',
			jobUrl: 'https://www.linkedin.com/jobs/view/4431836707/'
		});
	});

	it('copies a pasted description into jobDescription', () => {
		const description =
			'About the role\nYou will build supply-chain analytics products. Responsibilities include data modeling, stakeholder management, and Python development. Requirements include SQL and cloud experience.';
		expect(normalizeJobInput({ title: description })).toMatchObject({
			title: description,
			jobDescription: description
		});
	});

	it('preserves explicit job fields', () => {
		expect(
			normalizeJobInput({
				title: 'Supply Chain Analyst',
				jobUrl: 'https://example.com/job',
				jobDescription: 'Explicit description'
			})
		).toMatchObject({
			title: 'Supply Chain Analyst',
			jobUrl: 'https://example.com/job',
			jobDescription: 'Explicit description'
		});
	});
});

describe('job input helpers', () => {
	it('normalizes domains without a scheme', () => {
		expect(normalizePublicUrl('example.com/jobs/42')).toBe('https://example.com/jobs/42');
	});

	it('does not classify a normal job title as a description', () => {
		expect(isLikelyJobDescription('Senior Supply Chain Analyst')).toBe(false);
		expect(normalizePublicUrl('Engineer')).toBeUndefined();
	});

	it('extracts LinkedIn job IDs from canonical and slugged URLs', () => {
		expect(extractLinkedInJobId('https://www.linkedin.com/jobs/view/4431836707/')).toBe(
			'4431836707'
		);
		expect(
			extractLinkedInJobId('https://de.linkedin.com/jobs/view/data-engineer-at-example-4431836707')
		).toBe('4431836707');
	});
});
