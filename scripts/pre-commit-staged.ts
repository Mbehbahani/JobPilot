import { spawnSync, type SpawnSyncOptions } from 'child_process';

const colors = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	green: '\x1b[32m',
	red: '\x1b[31m'
};

function runCommand(command: string, args: string[], options?: SpawnSyncOptions): void {
	const result = spawnSync(command, args, {
		stdio: 'inherit',
		encoding: 'utf-8',
		...options
	});

	if (result.status !== 0) {
		console.error(`${colors.red}Command failed: ${command} ${args.join(' ')}${colors.reset}`);
		process.exit(result.status ?? 1);
	}
}

function getStagedFiles(): string[] {
	const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
		encoding: 'utf-8'
	});

	if (result.status !== 0) {
		console.error('Failed to get staged files');
		process.exit(1);
	}

	return result.stdout.trim().split('\n').filter(Boolean);
}

function deriveFileSets(files: string[]) {
	return {
		lintableFiles: files.filter((f) => /\.(js|ts|svelte)$/.test(f)),
		formattableFiles: files.filter((f) => /\.(js|ts|svelte|html|css|md|json)$/.test(f))
	};
}

function main(): void {
	const allFiles = getStagedFiles();

	if (allFiles.length === 0) {
		console.log('No staged files to check');
		process.exit(0);
	}

	const { lintableFiles, formattableFiles } = deriveFileSets(allFiles);

	console.log('======================================================');
	console.log(`Fast Pre-commit Checks (${allFiles.length} staged files)`);
	console.log('======================================================\n');

	console.log(`${colors.bold}1. Prettier${colors.reset}`);
	console.log('======================================================');
	if (formattableFiles.length > 0) {
		runCommand('bun', [
			'prettier',
			'--write',
			'--plugin',
			'prettier-plugin-svelte',
			...formattableFiles
		]);
	} else {
		console.log('No files to format');
	}
	console.log('');

	console.log(`${colors.bold}2. ESLint${colors.reset}`);
	console.log('======================================================');
	if (lintableFiles.length > 0) {
		runCommand('bun', ['eslint', '--fix', ...lintableFiles]);
	} else {
		console.log('No JS/TS/Svelte files to lint');
	}
	console.log('');

	if (formattableFiles.length > 0) {
		console.log('Re-staging modified files...');
		runCommand('git', ['add', ...formattableFiles]);
		console.log('');
	}

	console.log('======================================================');
	console.log(`${colors.green}Pre-commit checks passed!${colors.reset}`);
	console.log('======================================================');
}

main();
