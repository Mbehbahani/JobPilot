<script>
	import { fly, fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { untrack } from 'svelte';

	// ── Job pool ──────────────────────────────────────────────────────────────
	const jobPool = [
		{
			role: 'Senior Data Scientist',
			company: 'Anthropic',
			score: 9.2,
			source: 'LinkedIn',
			remote: true
		},
		{ role: 'ML Research Engineer', company: 'OpenAI', score: 8.8, source: 'Indeed', remote: true },
		{
			role: 'AI Research Scientist',
			company: 'Google DeepMind',
			score: 9.5,
			source: 'LinkedIn',
			remote: false
		},
		{ role: 'Backend Engineer', company: 'Stripe', score: 7.4, source: 'Indeed', remote: true },
		{
			role: 'Full Stack Developer',
			company: 'Vercel',
			score: 8.1,
			source: 'LinkedIn',
			remote: true
		},
		{
			role: 'MLOps Engineer',
			company: 'Hugging Face',
			score: 9.0,
			source: 'LinkedIn',
			remote: true
		},
		{ role: 'Data Engineer', company: 'Databricks', score: 8.3, source: 'Indeed', remote: false },
		{ role: 'Cloud Architect', company: 'AWS', score: 8.7, source: 'Indeed', remote: false },
		{
			role: 'Research Scientist',
			company: 'Meta AI',
			score: 9.3,
			source: 'LinkedIn',
			remote: false
		},
		{ role: 'Platform Engineer', company: 'Shopify', score: 7.8, source: 'Indeed', remote: true },
		{
			role: 'Software Engineer II',
			company: 'GitHub',
			score: 8.5,
			source: 'LinkedIn',
			remote: true
		},
		{ role: 'Applied ML Engineer', company: 'Cohere', score: 9.1, source: 'Indeed', remote: true },
		{
			role: 'DevOps Engineer',
			company: 'Cloudflare',
			score: 7.9,
			source: 'LinkedIn',
			remote: true
		},
		{ role: 'Frontend Developer', company: 'Linear', score: 7.6, source: 'Indeed', remote: true },
		{
			role: 'Analytics Engineer',
			company: 'dbt Labs',
			score: 8.4,
			source: 'LinkedIn',
			remote: true
		},
		{ role: 'Staff Engineer', company: 'Figma', score: 8.9, source: 'Indeed', remote: false }
	];

	const searches = [
		'Data Scientist',
		'ML Engineer',
		'Backend Engineer',
		'DevOps Engineer',
		'Frontend Developer'
	];

	const MAX_ROWS = 5;

	function uid() {
		return typeof crypto !== 'undefined' && crypto.randomUUID
			? crypto.randomUUID()
			: `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	}

	function scoreClass(s) {
		if (s >= 8) return 'score-green';
		if (s >= 6) return 'score-yellow';
		return 'score-red';
	}

	const prefersReducedMotion =
		typeof window !== 'undefined'
			? window.matchMedia('(prefers-reduced-motion: reduce)').matches
			: false;

	// ── State ─────────────────────────────────────────────────────────────────
	let visibleJobs = $state([]);
	let poolIdx = $state(0);
	let phase = $state('idle');
	let searchTerm = $state(searches[0]);
	let searchIdx = $state(0);
	let highlightId = $state(null);
	let sendingId = $state(null);
	let handCursor = $state(null);

	let sendIconEls = {};

	function regSendIconAction(el, id) {
		sendIconEls[id] = el;
		return {
			update(newId) {
				delete sendIconEls[id];
				id = newId;
				sendIconEls[id] = el;
			},
			destroy() {
				delete sendIconEls[id];
			}
		};
	}

	// ── Main loop ─────────────────────────────────────────────────────────────
	$effect(() => {
		if (prefersReducedMotion) {
			visibleJobs = jobPool.slice(0, MAX_ROWS).map((j, i) => ({ ...j, uid: String(i) }));
			phase = 'full';
			return;
		}

		let cancelled = false;
		let timerId;

		function wait(ms) {
			return new Promise((r) => {
				timerId = setTimeout(() => {
					if (!cancelled) r();
				}, ms);
			});
		}

		async function loop() {
			await wait(600);
			while (!cancelled) {
				phase = 'searching';
				const si = untrack(() => searchIdx);
				searchTerm = searches[si % searches.length];
				searchIdx = si + 1;
				await wait(1600);
				if (cancelled) break;

				phase = 'adding';
				while (untrack(() => visibleJobs.length) < MAX_ROWS) {
					if (cancelled) break;
					const pi = untrack(() => poolIdx);
					const job = { ...jobPool[pi % jobPool.length], uid: uid() };
					poolIdx = pi + 1;
					visibleJobs = [...untrack(() => visibleJobs), job];
					highlightId = job.uid;
					await wait(300);
					if (cancelled) break;
					highlightId = null;
					await wait(500);
				}
				if (cancelled) break;

				await wait(1400);
				if (cancelled) break;

				const jobs = untrack(() => visibleJobs);
				if (!jobs.length) continue;
				const victim = jobs[Math.floor(Math.random() * jobs.length)];

				phase = 'sending';
				sendingId = victim.uid;
				await wait(180);
				if (cancelled) break;

				const sendIconEl = sendIconEls[victim.uid];
				if (sendIconEl) {
					const r = sendIconEl.getBoundingClientRect();
					handCursor = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
				}

				await wait(950);
				if (cancelled) break;
				handCursor = null;
				sendingId = null;

				const pi2 = untrack(() => poolIdx);
				const newJob = { ...jobPool[pi2 % jobPool.length], uid: uid() };
				poolIdx = pi2 + 1;
				visibleJobs = untrack(() => [...visibleJobs.filter((j) => j.uid !== victim.uid), newJob]);
				highlightId = newJob.uid;
				await wait(350);
				if (cancelled) break;
				highlightId = null;

				phase = 'idle';
				await wait(600);
				if (cancelled) break;
			}
		}

		loop();
		return () => {
			cancelled = true;
			clearTimeout(timerId);
		};
	});
</script>

<!-- Pipeline demo panel -->
<div class="pipeline-root">
	<div class="panel">
		<!-- Panel header -->
		<div class="panel-header">
			<div>
				<h3 class="panel-title">Job Search</h3>
				<div class="panel-status">
					{#if phase === 'searching'}
						<span
							class="st-label st-searching"
							in:fade={{ duration: 160 }}
							out:fade={{ duration: 130 }}
						>
							<span class="pulse-dot"></span>
							<em>{searchTerm}</em><span class="dot d1">.</span><span class="dot d2">.</span><span
								class="dot d3">.</span
							>
						</span>
					{:else if phase === 'adding'}
						<span
							class="st-label st-adding"
							in:fade={{ duration: 160 }}
							out:fade={{ duration: 130 }}
						>
							Collecting<span class="dot d1">.</span><span class="dot d2">.</span><span
								class="dot d3">.</span
							>
						</span>
					{:else if phase === 'sending'}
						<span
							class="st-label st-sending"
							in:fade={{ duration: 160 }}
							out:fade={{ duration: 130 }}
						>
							<span class="pulse-dot"></span>
							Sending to My Tasks…
						</span>
					{:else}
						<span class="st-label st-idle">Next search soon…</span>
					{/if}
				</div>
			</div>
			<div class="src-pills">
				<span class="badge badge-li">LinkedIn</span>
				<span class="badge badge-in">Indeed</span>
			</div>
		</div>

		<!-- Table -->
		<div class="tbl-wrap" style="min-height: {MAX_ROWS * 56 + 48}px">
			<table class="tbl">
				<thead>
					<tr>
						<th class="th-score">Score</th>
						<th class="th-role">Role</th>
						<th class="th-src">Via</th>
						<th class="th-act">Send</th>
					</tr>
				</thead>
				<tbody>
					{#each visibleJobs as job (job.uid)}
						<tr
							class="tr"
							class:tr-sending={sendingId === job.uid}
							animate:flip={{ duration: 260 }}
							in:fly={{ x: -24, duration: 300, opacity: 0 }}
						>
							<td class="td td-score">
								<div class="score-wrap">
									<div class="score-track">
										<div
											class="score-fill {scoreClass(job.score)}"
											style="--w:{Math.round((job.score / 10) * 100)}%"
										></div>
									</div>
									<span class="score-num">{job.score.toFixed(1)}</span>
								</div>
							</td>
							<td class="td td-role">
								<div class="role-name">{job.role}</div>
								<div class="role-co">
									{job.company}
									{#if job.remote}<span class="remote-badge">Remote</span>{/if}
								</div>
							</td>
							<td class="td td-src">
								<span class="badge {job.source === 'LinkedIn' ? 'badge-li' : 'badge-in'}">
									{job.source}
								</span>
							</td>
							<td class="td td-act">
								<span
									class="send-icon"
									class:send-icon-active={sendingId === job.uid}
									use:regSendIconAction={job.uid}
									title="Send to My Tasks"
								>
									<svg
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<line x1="22" y1="2" x2="11" y2="13" />
										<polygon points="22 2 15 22 11 13 2 9 22 2" />
									</svg>
								</span>
							</td>
						</tr>
					{:else}
						<tr class="tr-empty">
							<td colspan="4">
								<div class="empty-state" in:fade={{ duration: 280, delay: 60 }}>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
										<circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
									</svg>
									<p>Starting search…</p>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>

<!-- Hand cursor (fixed to viewport coords) -->
{#if handCursor}
	<div class="hand-cursor" style="left: {handCursor.x}px; top: {handCursor.y}px">
		<svg viewBox="0 0 18 24" fill="none">
			<path
				d="M2 2 L2 19 L6 15 L9 22 L11.5 21 L8.5 14 L14 14 Z"
				fill="white"
				stroke="#334155"
				stroke-width="1.3"
				stroke-linejoin="round"
				stroke-linecap="round"
			/>
		</svg>
	</div>
{/if}

<style>
	/* ── CSS variables — light + dark ──────────────────────────────────────── */
	.pipeline-root {
		--p-text: #0f172a;
		--p-muted: #64748b;
		--primary: #6366f1;
		--green: #22c55e;
		--yellow: #f59e0b;
		--red: #ef4444;
		--li-bg: rgba(10, 102, 194, 0.1);
		--li-col: #0a66c2;
		--in-bg: rgba(224, 123, 0, 0.1);
		--in-col: #c47700;
		--card-bg: #ffffff;
		--card-bdr: #e2e8f0;
		--row-send: rgba(99, 102, 241, 0.12);
	}

	:global(.dark) .pipeline-root {
		--p-text: #e2e8f0;
		--p-muted: #8b949e;
		--card-bg: #161b22;
		--card-bdr: #21262d;
		--li-col: #58a6ff;
		--in-col: #f0a44a;
		--li-bg: rgba(58, 166, 255, 0.12);
		--in-bg: rgba(240, 164, 74, 0.12);
		--row-send: rgba(99, 102, 241, 0.18);
	}

	/* ── Panel ─────────────────────────────────────────────────────────────── */
	.pipeline-root {
		width: 100%;
		max-width: 680px;
		margin: 0 auto;
	}

	.panel {
		background: var(--card-bg);
		border: 1px solid var(--card-bdr);
		border-radius: 14px;
		overflow: hidden;
		box-shadow:
			0 4px 24px rgba(0, 0, 0, 0.07),
			0 1px 4px rgba(0, 0, 0, 0.04);
		color: var(--p-text);
		font-size: 0.875rem;
	}

	/* ── Panel header ──────────────────────────────────────────────────────── */
	.panel-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 1rem 1.25rem 0.75rem;
		border-bottom: 1px solid var(--card-bdr);
		gap: 0.75rem;
	}

	.panel-title {
		font-size: 0.875rem;
		font-weight: 600;
		letter-spacing: -0.01em;
		margin-bottom: 0.2rem;
	}

	.panel-status {
		font-size: 0.75rem;
		color: var(--p-muted);
		min-height: 1.3rem;
		display: flex;
		align-items: center;
	}

	.src-pills {
		display: flex;
		gap: 0.35rem;
		align-items: center;
		flex-shrink: 0;
	}

	/* ── Phase labels ──────────────────────────────────────────────────────── */
	.st-label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.st-searching,
	.st-adding {
		color: var(--primary);
	}
	.st-sending {
		color: var(--primary);
		font-weight: 600;
	}
	.st-idle {
		color: var(--p-muted);
	}
	.st-searching em {
		font-style: normal;
		font-weight: 600;
		color: var(--p-text);
	}

	/* Pulse dot */
	.pulse-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--primary);
		flex-shrink: 0;
		animation: pd 1.4s ease-in-out infinite;
	}
	@keyframes pd {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.3;
			transform: scale(0.65);
		}
	}

	/* Blinking dots */
	.dot {
		animation: db 1.2s ease-in-out infinite;
		opacity: 0.15;
	}
	.d2 {
		animation-delay: 0.2s;
	}
	.d3 {
		animation-delay: 0.4s;
	}
	@keyframes db {
		0%,
		80%,
		100% {
			opacity: 0.15;
		}
		40% {
			opacity: 1;
		}
	}

	/* ── Badges ────────────────────────────────────────────────────────────── */
	.badge {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 999px;
		font-size: 0.65rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		white-space: nowrap;
	}
	.badge-li {
		background: var(--li-bg);
		color: var(--li-col);
	}
	.badge-in {
		background: var(--in-bg);
		color: var(--in-col);
	}

	/* ── Table ─────────────────────────────────────────────────────────────── */
	.tbl-wrap {
		overflow-x: auto;
	}

	.tbl {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}

	thead th {
		padding: 0.5rem 1rem;
		text-align: left;
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--p-muted);
		border-bottom: 1px solid var(--card-bdr);
		background: var(--card-bg);
		white-space: nowrap;
	}

	.th-score {
		width: 90px;
	}
	.th-src {
		width: 80px;
	}
	.th-act {
		width: 44px;
	}

	.tr {
		border-bottom: 1px solid var(--card-bdr);
		transition: background 0.12s;
	}
	.tr:last-child {
		border-bottom: none;
	}
	.tr.tr-sending {
		background: var(--row-send) !important;
	}
	.tr-empty td {
		border: none;
	}

	.td {
		padding: 0.6rem 1rem;
		vertical-align: middle;
	}

	/* Score */
	.td-score {
		white-space: nowrap;
	}
	.score-wrap {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.score-track {
		width: 40px;
		height: 4px;
		border-radius: 999px;
		background: var(--card-bdr);
		overflow: hidden;
		flex-shrink: 0;
	}
	.score-fill {
		height: 100%;
		border-radius: 999px;
		width: var(--w);
		animation: gb 0.55s ease-out 0.15s both;
	}
	@keyframes gb {
		from {
			width: 0;
		}
		to {
			width: var(--w);
		}
	}
	.score-fill.score-green {
		background: var(--green);
	}
	.score-fill.score-yellow {
		background: var(--yellow);
	}
	.score-fill.score-red {
		background: var(--red);
	}
	.score-num {
		font-size: 0.8rem;
		font-weight: 600;
		min-width: 22px;
	}

	/* Role */
	.role-name {
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 220px;
	}
	.role-co {
		font-size: 0.7rem;
		color: var(--p-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 220px;
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin-top: 0.1rem;
	}
	.remote-badge {
		font-size: 0.6rem;
		font-weight: 600;
		padding: 1px 5px;
		border-radius: 999px;
		background: rgba(99, 102, 241, 0.1);
		color: var(--primary);
		text-transform: uppercase;
		letter-spacing: 0.01em;
		flex-shrink: 0;
	}

	/* Action cell */
	.td-act {
		text-align: center;
	}
	.send-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		color: var(--p-muted);
		opacity: 0.22;
		transition:
			opacity 0.3s,
			background 0.25s,
			color 0.25s,
			box-shadow 0.25s;
	}
	.send-icon svg {
		width: 13px;
		height: 13px;
	}
	.send-icon-active {
		background: var(--primary);
		color: #fff;
		opacity: 1;
		animation: sendPulse 0.65s ease-in-out infinite alternate;
	}
	@keyframes sendPulse {
		from {
			box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.55);
		}
		to {
			box-shadow: 0 0 0 9px rgba(99, 102, 241, 0);
		}
	}

	/* Empty state */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		padding: 3.5rem 1rem;
		color: var(--p-muted);
		font-size: 0.8rem;
		text-align: center;
	}
	.empty-state svg {
		width: 30px;
		height: 30px;
		opacity: 0.3;
	}

	/* ── Hand cursor (fixed to viewport) ───────────────────────────────────── */
	.hand-cursor {
		position: fixed;
		pointer-events: none;
		z-index: 9999;
		width: 28px;
		height: 36px;
		transform: translate(-20%, -10%);
		filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.4));
		animation: handFull 950ms cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
	}

	@keyframes handFull {
		0% {
			transform: translate(calc(-20% + 90px), calc(-10% + 58px));
			opacity: 0;
		}
		7% {
			opacity: 1;
		}
		62% {
			transform: translate(-20%, -10%) scale(1);
		}
		73% {
			transform: translate(-20%, -10%) scale(0.78);
		}
		84% {
			transform: translate(-20%, -10%) scale(1.06);
		}
		93% {
			transform: translate(-20%, -10%) scale(1);
			opacity: 1;
		}
		100% {
			transform: translate(-20%, -10%) scale(1);
			opacity: 0;
		}
	}
</style>
