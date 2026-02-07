declare module 'hunspell-spellchecker' {
	interface DictionaryFiles {
		aff: Buffer | string;
		dic: Buffer | string;
	}

	class SpellChecker {
		public parse(files: DictionaryFiles): unknown;
		public use(dictionary: unknown): void;
		public check(word: string): boolean;
		public suggest(word: string): string[];
	}

	export = SpellChecker;
}

declare module 'jsonminify' {
	function jsonminify(json: string): string;
	export default jsonminify;
}
