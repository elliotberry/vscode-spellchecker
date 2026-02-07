import * as fs from 'fs';
import * as path from 'path';

import SpellChecker from 'hunspell-spellchecker';

export type DictionaryCode =
	| 'en_US'
	| 'en_GB-ize'
	| 'en_GB-ise'
	| 'es_ANY'
	| 'fr'
	| 'el_GR'
	| 'sv_SE';

export class SpellService {
	private spellChecker = new SpellChecker();
	private loadedLanguage?: DictionaryCode;

	public async load(language: DictionaryCode, extensionRoot: string): Promise<void> {
		const dictionaryFolder = path.join(extensionRoot, 'languages');
		const affPath = path.join(dictionaryFolder, `${language}.aff`);
		const dicPath = path.join(dictionaryFolder, `${language}.dic`);

		const [aff, dic] = await Promise.all([
			fs.promises.readFile(affPath),
			fs.promises.readFile(dicPath),
		]);

		const dict = this.spellChecker.parse({ aff, dic });
		this.spellChecker.use(dict);
		this.loadedLanguage = language;
	}

	public isReady(): boolean {
		return Boolean(this.loadedLanguage);
	}

	public getLanguage(): DictionaryCode | undefined {
		return this.loadedLanguage;
	}

	public check(word: string): boolean {
		this.assertReady();
		return this.spellChecker.check(word);
	}

	public suggest(word: string, limit = 5): string[] {
		this.assertReady();
		const suggestions = this.spellChecker.suggest(word) || [];
		return suggestions.slice(0, limit);
	}

	private assertReady(): void {
		if (!this.loadedLanguage) {
			throw new Error('SpellService is not loaded with a dictionary.');
		}
	}
}
