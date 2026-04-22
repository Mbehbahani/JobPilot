import { describe, expect, it } from 'vitest';

import { getHeuristicBestTaskMatch } from './gmail';

const greenFusionEmail = {
	id: 'green-fusion-rejection',
	subject: 'Your application at Green Fusion GmbH as Senior Data Scientist: Optimization (f/m/d)',
	from: 'Green Fusion GmbH Recruiting Team <no-reply@msg.join.com>',
	snippet:
		'We have filled the position and will therefore not be moving forward with your application.',
	bodyText:
		'Hi Mo, First of all, thank you very much for your application for the position of Senior Data Scientist: Optimization (f/m/d) at Green Fusion. We wanted to let you know that we have filled the position and will therefore not be moving forward with your application.'
};

const unrelatedInterviewEmail = {
	id: 'intercom-interview',
	subject:
		'Invitation from an unknown sender: Machine Learning Scientist Berlin Interview @ Wed 22 Apr 2026 11am - 11:30am (GMT+2) (behbahanimd@gmail.com)',
	from: 'haneen.abufarha@intercom.io - Organiser',
	snippet: 'Machine Learning Scientist Berlin Interview',
	bodyText:
		'Machine Learning Scientist Berlin Interview. On your Google Calendar. Based on this email.'
};

const philipsRejectionEmail = {
	id: 'philips-rejection',
	subject: 'Application update from Philips',
	from: 'Philips Talent Acquisition Team <no-reply@philips.com>',
	snippet: 'Thank you for applying for the role of Integrated Supply chain Strategy Leader-577121.',
	bodyText:
		'Dear Mohammad, Thank you for applying for the role of Integrated Supply chain Strategy Leader-577121. After reviewing your application, we’ve decided not to proceed with your candidacy for this position. Kind regards, Philips Talent Acquisition Team'
};

describe('getHeuristicBestTaskMatch', () => {
	it('does not match the Green Fusion rejection to an unrelated Orion task', () => {
		const tasks = [
			{
				id: 'orion-task',
				title: 'Data Scientist / Machine Learning Engineer',
				columnId: 'applied' as const,
				companyName: 'Orion Group',
				position: 'Data Scientist / Machine Learning Engineer'
			}
		];

		expect(getHeuristicBestTaskMatch(greenFusionEmail, tasks)).toBeNull();
	});

	it('does not match the Intercom calendar invite to an unrelated Real task', () => {
		const tasks = [
			{
				id: 'real-task',
				title: 'Machine Learning Engineer',
				columnId: 'applied' as const,
				companyName: 'Real',
				position: 'Machine Learning Engineer'
			}
		];

		expect(getHeuristicBestTaskMatch(unrelatedInterviewEmail, tasks)).toBeNull();
	});

	it('matches the Philips rejection to the Philips applied task', () => {
		const tasks = [
			{
				id: 'philips-task',
				title: 'Integrated Supply chain Strategy Leader',
				columnId: 'applied' as const,
				companyName: 'Philips',
				position: 'Integrated Supply chain Strategy Leader'
			}
		];

		const match = getHeuristicBestTaskMatch(philipsRejectionEmail, tasks);

		expect(match?.task.id).toBe('philips-task');
		expect(match?.score).toBeGreaterThanOrEqual(10);
	});
});
