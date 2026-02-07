export const DEFAULT_REMOVAL_PATTERNS: RegExp[] = [
	/-{3}[\s\S]*?\n(\.{3}|-{3})/g,
	/&nbsp;/g,
	/\[-?@[A-Za-z:0-9-]*\]/g,
	/\{(#|\.)[A-Za-z:0-9]+\}/g,
	/```[\s\S]*?```/g,
	/`[^`]+`/g,
	/\(.*\.(jpg|jpeg|png|md|gif|pdf|svg)\)/gi,
	/(http|https|ftp|git)\S*/g,
	/[a-zA-Z.\-0-9]+@[a-z.]+/g,
];

export interface SanitizeOptions {
	removalPatterns?: RegExp[];
	userPatterns?: RegExp[];
}

export function sanitizeText(text: string, options: SanitizeOptions): string {
	let processed = text;
	for (const regex of options.removalPatterns ?? DEFAULT_REMOVAL_PATTERNS) {
		processed = replaceWithSpaces(processed, regex);
	}

	for (const regex of options.userPatterns ?? []) {
		processed = replaceWithSpaces(processed, regex);
	}

	return processed.replace(/\t/g, ' ');
}

export function replaceWithSpaces(input: string, regex: RegExp): string {
	return input.replace(regex, (match) => ' '.repeat(match.length));
}
