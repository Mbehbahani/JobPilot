import { localizedHref } from '$lib/utils/i18n';
import ListChecksIcon from '@lucide/svelte/icons/list-checks';
import ServerCogIcon from '@lucide/svelte/icons/server-cog';
import ChartBarIcon from '@lucide/svelte/icons/chart-bar';
import Logo from '$lib/components/icons/logo.svelte';
import type { SidebarConfig } from '../types';
import { env } from '$env/dynamic/public';

interface PageState {
	pathname: string;
	lang?: string;
}

export function getAppSidebarConfig(pageState: PageState, userRole?: string, userId?: string): SidebarConfig {
	const { pathname, lang } = pageState;

	const baseAnalyticsUrl = env.PUBLIC_ANALYTICS_URL || 'http://localhost:3000/dashboard';
	const analyticsUrl = userId ? `${baseAnalyticsUrl}?kanbanUser=${userId}` : baseAnalyticsUrl;

	return {
		header: {
			icon: Logo,
			titleKey: 'app.name',
			href: localizedHref('/')
		},
		navItems: [
			{
				translationKey: 'app.sidebar.my_tasks',
				url: localizedHref('/app/my-tasks'),
				icon: ListChecksIcon,
				isActive: pathname === `/${lang}/app/my-tasks`
			},
			{
				translationKey: 'app.sidebar.browse_jobs',
				url: analyticsUrl,
				icon: ChartBarIcon,
				isActive: false
			}
		],
		footerLinks:
			userRole === 'admin'
				? [
						{
							translationKey: 'app.sidebar.admin_panel',
							url: localizedHref('/admin'),
							icon: ServerCogIcon,
							condition: true
						}
					]
				: []
	};
}
