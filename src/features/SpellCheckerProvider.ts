import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import jsonMinify from 'jsonminify';

import { DictionaryCode, SpellService } from '../services/SpellService';
import { sanitizeText } from '../utils/textProcessing';

type SeverityOption = 'Error' | 'Hint' | 'Information' | 'Warning';

interface SpellSettings {
	language: DictionaryCode;
	ignoreWordsList: string[];
	documentTypes: string[];
	ignoreRegExp: string[];
	ignoreFileExtensions: string[];
	ignoreFilenames: string[];
	checkInterval: number;
	suggestionSeverity: SeverityOption;
	autoCheck: boolean;
	maxDiagnostics: number;
	suggestionLimit: number;
}

const DEFAULT_SETTINGS: SpellSettings = {
	language: 'en_US',
	ignoreWordsList: [],
	documentTypes: ['markdown', 'latex', 'plaintext'],
	ignoreRegExp: [],
	ignoreFileExtensions: [],
	ignoreFilenames: [],
	checkInterval: 3000,
	suggestionSeverity: 'Warning',
	autoCheck: true,
	maxDiagnostics: 250,
	suggestionLimit: 5,
};

export default class SpellCheckerProvider implements vscode.CodeActionProvider, vscode.Disposable {
	private static suggestCommandId = 'SpellChecker.fixSuggestionCodeAction';
	private static ignoreCommandId = 'SpellChecker.ignoreCodeAction';
	private static alwaysIgnoreCommandId = 'SpellChecker.alwaysIgnoreCodeAction';
	private static toggleAutoCheckCommandId = 'SpellChecker.toggleAutoCheck';

	private readonly spellService = new SpellService();
	private readonly diagnosticCollection = vscode.languages.createDiagnosticCollection('Spelling');
	private readonly diagnosticMap = new Map<string, vscode.Diagnostic[]>();
	private readonly disposables: vscode.Disposable[] = [];
	private codeActionRegistrations: vscode.Disposable[] = [];
	private settings: SpellSettings = DEFAULT_SETTINGS;
	private extensionRoot = '';
	private lastcheck = -1;
	private timer: NodeJS.Timeout | undefined;
	private timerTextDocument: vscode.TextDocument | undefined;
	private statusBarItem: vscode.StatusBarItem | undefined;
	private autoCheckEnabled = true;

	public async activate(context: vscode.ExtensionContext): Promise<void> {
		this.extensionRoot = context.extensionPath;
		this.settings = this.loadSettings();
		this.autoCheckEnabled = this.settings.autoCheck;
		await this.loadDictionary(this.settings.language);

		this.registerCommands(context);
		this.registerEventHandlers(context);
		this.registerCodeActionProviders();

		this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.statusBarItem.command = SpellCheckerProvider.toggleAutoCheckCommandId;
		this.updateStatusBar();
		this.statusBarItem.show();
		context.subscriptions.push(this.statusBarItem);

		context.subscriptions.push(this);
	}

	public dispose(): void {
		if (this.timer) {
			clearTimeout(this.timer);
		}

		this.codeActionRegistrations.forEach((d) => d.dispose());
		this.disposables.forEach((d) => d.dispose());
		this.diagnosticCollection.clear();
		this.diagnosticCollection.dispose();
		this.statusBarItem?.dispose();
	}

	public provideCodeActions(
		document: vscode.TextDocument,
		_range: vscode.Range,
		context: vscode.CodeActionContext,
		_token: vscode.CancellationToken,
	): vscode.CodeAction[] | undefined {
		const diagnostic = context.diagnostics.find((d) => typeof d.code === 'string');
		if (!diagnostic || typeof diagnostic.code !== 'string') {
			return;
		}

		const word = diagnostic.code;
		const suggestions = this.safeSuggest(word);

		const actions: vscode.CodeAction[] = suggestions.map((suggestion, index) => {
			const action = new vscode.CodeAction(
				`Replace with '${suggestion}'`,
				vscode.CodeActionKind.QuickFix,
			);
			action.command = {
				command: SpellCheckerProvider.suggestCommandId,
				title: 'Apply spelling suggestion',
				arguments: [document.uri, diagnostic.range, suggestion],
			};
			action.diagnostics = [diagnostic];
			action.isPreferred = index === 0;
			return action;
		});

		const ignore = new vscode.CodeAction(
			`Ignore '${word}'`,
			vscode.CodeActionKind.QuickFix,
		);
		ignore.command = {
			command: SpellCheckerProvider.ignoreCommandId,
			title: 'Ignore word in workspace',
			arguments: [document.uri, word, vscode.ConfigurationTarget.Workspace],
		};
		ignore.diagnostics = [diagnostic];
		actions.push(ignore);

		const alwaysIgnore = new vscode.CodeAction(
			`Always ignore '${word}'`,
			vscode.CodeActionKind.QuickFix,
		);
		alwaysIgnore.command = {
			command: SpellCheckerProvider.alwaysIgnoreCommandId,
			title: 'Ignore word globally',
			arguments: [document.uri, word],
		};
		alwaysIgnore.diagnostics = [diagnostic];
		actions.push(alwaysIgnore);

		return actions;
	}

	private registerCommands(context: vscode.ExtensionContext): void {
		this.disposables.push(
			vscode.commands.registerCommand(
				'spellchecker.showDocumentType',
				this.showDocumentType,
				this,
			),
			vscode.commands.registerCommand('spellchecker.checkDocument', () =>
				this.doSpellCheck(vscode.window.activeTextEditor?.document),
			),
			vscode.commands.registerCommand('spellchecker.setLanguage', this.setLanguageCommand, this),
			vscode.commands.registerCommand(
				SpellCheckerProvider.suggestCommandId,
				this.applySuggestion,
				this,
			),
			vscode.commands.registerCommand(
				SpellCheckerProvider.ignoreCommandId,
				this.ignoreCodeAction,
				this,
			),
			vscode.commands.registerCommand(
				SpellCheckerProvider.alwaysIgnoreCommandId,
				this.alwaysIgnoreCodeAction,
				this,
			),
			vscode.commands.registerCommand(
				SpellCheckerProvider.toggleAutoCheckCommandId,
				this.toggleAutoCheck,
				this,
			),
		);

		context.subscriptions.push(...this.disposables);
	}

	private registerCodeActionProviders(): void {
		this.codeActionRegistrations.forEach((d) => d.dispose());
		this.codeActionRegistrations = this.settings.documentTypes.map((language) =>
			vscode.languages.registerCodeActionsProvider(
				{ language, scheme: 'file' },
				this,
				{ providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
			),
		);
	}

	private registerEventHandlers(context: vscode.ExtensionContext): void {
		context.subscriptions.push(
			vscode.workspace.onDidOpenTextDocument(this.maybeAutoCheck, this),
			vscode.workspace.onDidSaveTextDocument(this.maybeAutoCheck, this),
			vscode.workspace.onDidCloseTextDocument((doc) => {
				this.diagnosticCollection.delete(doc.uri);
				this.diagnosticMap.delete(doc.uri.toString());
			}),
			vscode.workspace.onDidChangeTextDocument(this.onDocumentChanged, this),
			vscode.workspace.onDidChangeConfiguration(this.settingsChanged, this),
		);
	}

	private async settingsChanged(): Promise<void> {
		this.settings = this.loadSettings();
		this.autoCheckEnabled = this.settings.autoCheck;
		await this.loadDictionary(this.settings.language);
		this.registerCodeActionProviders();
		this.updateStatusBar();
	}

	private showDocumentType(): void {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('No active document found.');
			return;
		}
		vscode.window.showInformationMessage(
			`The documentType for the current file is '${editor.document.languageId}'.`,
		);
	}

	private async setLanguageCommand(): Promise<void> {
		const qpOptions: vscode.QuickPickOptions = {
			placeHolder: 'Select one of the available languages:',
		};

		const options = [
			{ label: 'English US', value: 'en_US' as DictionaryCode },
			{ label: 'English UK (-ize/Oxford)', value: 'en_GB-ize' as DictionaryCode },
			{ label: 'English UK (-ise)', value: 'en_GB-ise' as DictionaryCode },
			{ label: 'Spanish', value: 'es_ANY' as DictionaryCode },
			{ label: 'French', value: 'fr' as DictionaryCode },
			{ label: 'Greek', value: 'el_GR' as DictionaryCode },
			{ label: 'Swedish', value: 'sv_SE' as DictionaryCode },
		];

		const picked = await vscode.window.showQuickPick(
			options.map((o) => `${o.label} (${o.value})`),
			qpOptions,
		);
		if (!picked) {
			return;
		}

		const match = picked.match(/\((.*)\)/);
		const language = this.normalizeLanguage(match ? match[1] : '');
		await this.setLanguage(language);
	}

	private async onDocumentChanged(event: vscode.TextDocumentChangeEvent): Promise<void> {
		if (!this.shouldCheck(event.document)) {
			return;
		}

		if (this.settings.checkInterval < 0 || !this.autoCheckEnabled) {
			return;
		}

		if (Date.now() - this.lastcheck > this.settings.checkInterval) {
			if (this.timer) {
				clearTimeout(this.timer);
				this.timer = undefined;
			}
			await this.doSpellCheck(event.document);
		} else {
			if (this.timer) {
				clearTimeout(this.timer);
			}
			this.timerTextDocument = event.document;
			this.timer = setTimeout(
				() => void this.doSpellCheck(this.timerTextDocument ?? event.document),
				2 * this.settings.checkInterval,
			);
		}
	}

	private maybeAutoCheck(document: vscode.TextDocument): void {
		if (this.settings.checkInterval < 0 || !this.autoCheckEnabled) {
			return;
		}
		if (!this.shouldCheck(document)) {
			return;
		}
		void this.doSpellCheck(document);
	}

	private async doSpellCheck(textDocument?: vscode.TextDocument): Promise<void> {
		const document =
			textDocument ??
			vscode.window.activeTextEditor?.document ??
			(this.timerTextDocument ?? undefined);

		if (!document || !document.fileName) {
			return;
		}

		if (!this.shouldCheck(document)) {
			return;
		}

		const text = document.getText().replace(/\r?\n/g, '\n');
		const sanitized = sanitizeText(text, { userPatterns: this.getUserRegexps() });
		const diagnostics: vscode.Diagnostic[] = [];
		let processedTokens = 0;

		const wordRegex = /[A-Za-z][A-Za-z'’]{3,}/g;
		for (const match of sanitized.matchAll(wordRegex)) {
			if (match.index === undefined) {
				continue;
			}
			processedTokens += 1;

			const originalWord = match[0];
			const normalizedWord = originalWord.replace(/’/g, '\'');

			if (/\d/.test(normalizedWord)) {
				continue;
			}

			if (this.settings.ignoreWordsList.includes(normalizedWord)) {
				continue;
			}

			if (!this.spellService.check(normalizedWord)) {
				const start = document.positionAt(match.index);
				const end = document.positionAt(match.index + originalWord.length);
				const range = new vscode.Range(start, end);
				const diag = new vscode.Diagnostic(
					range,
					`Spelling: ${normalizedWord}`,
					this.getSeverity(),
				);
				diag.source = 'Spell Checker';
				diag.code = normalizedWord;
				diagnostics.push(diag);

				if (diagnostics.length >= this.settings.maxDiagnostics) {
					vscode.window.setStatusBarMessage(
						`Over ${this.settings.maxDiagnostics} spelling errors found!`,
						5000,
					);
					break;
				}
			}

			if (processedTokens >= this.settings.maxDiagnostics * 20) {
				// avoid processing massive files for too long
				break;
			}
		}

		this.diagnosticCollection.set(document.uri, diagnostics);
		this.diagnosticMap.set(document.uri.toString(), diagnostics);
		this.lastcheck = Date.now();
	}

	private getUserRegexps(): RegExp[] {
		const result: RegExp[] = [];
		for (const value of this.settings.ignoreRegExp) {
			try {
				const flags = value.replace(/.*\/([gimy]*)$/, '$1');
				const pattern = value.replace(new RegExp(`^/(.*?)/${flags}$`), '$1').replace(/\\\\/g, '\\');
				result.push(new RegExp(pattern, flags));
			} catch (error) {
				console.warn('Invalid ignoreRegExp entry skipped', error);
			}
		}
		return result;
	}

	private getSeverity(): vscode.DiagnosticSeverity {
		switch (this.settings.suggestionSeverity) {
			case 'Error':
				return vscode.DiagnosticSeverity.Error;
			case 'Hint':
				return vscode.DiagnosticSeverity.Hint;
			case 'Information':
				return vscode.DiagnosticSeverity.Information;
			case 'Warning':
			default:
				return vscode.DiagnosticSeverity.Warning;
		}
	}

	private safeSuggest(word: string): string[] {
		try {
			return this.spellService.suggest(word, this.settings.suggestionLimit);
		} catch {
			return [];
		}
	}

	private async applySuggestion(uri: vscode.Uri, range: vscode.Range, suggestion: string): Promise<void> {
		const edit = new vscode.WorkspaceEdit();
		edit.replace(uri, range, suggestion);
		await vscode.workspace.applyEdit(edit);
		const document = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
		if (document) {
			await this.doSpellCheck(document);
		}
	}

	private async ignoreCodeAction(
		uri: vscode.Uri,
		word: string,
		target: vscode.ConfigurationTarget,
	): Promise<void> {
		if (this.addWordToIgnoreList(word, target)) {
			const document = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
			if (document) {
				await this.doSpellCheck(document);
			}
		} else {
			vscode.window.showWarningMessage(
				'The word has already been added to the ignore list.',
			);
		}
	}

	private async alwaysIgnoreCodeAction(uri: vscode.Uri, word: string): Promise<void> {
		await this.ignoreCodeAction(uri, word, vscode.ConfigurationTarget.Global);
	}

	private addWordToIgnoreList(word: string, target: vscode.ConfigurationTarget): boolean {
		if (this.settings.ignoreWordsList.includes(word)) {
			return false;
		}

		this.settings.ignoreWordsList = this.getUniqueArray([...this.settings.ignoreWordsList, word]);
		const userSettingsData = vscode.workspace.getConfiguration('spellchecker');
		const inspection = userSettingsData.inspect<string[]>('ignoreWordsList');

		let updated: string[] = [];
		if (target === vscode.ConfigurationTarget.Workspace && Array.isArray(inspection?.workspaceValue)) {
			updated = inspection?.workspaceValue ?? [];
		} else if (target === vscode.ConfigurationTarget.Global && Array.isArray(inspection?.globalValue)) {
			updated = inspection?.globalValue ?? [];
		}

		updated.push(word);
		userSettingsData.update('ignoreWordsList', this.getUniqueArray(updated), target);
		return true;
	}

	private async setLanguage(language: DictionaryCode): Promise<void> {
		await this.loadDictionary(language);
		this.settings.language = language;
		await this.doSpellCheck(vscode.window.activeTextEditor?.document);
		this.updateStatusBar();
	}

	private async loadDictionary(language: DictionaryCode): Promise<void> {
		try {
			await this.spellService.load(language, this.extensionRoot);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to load dictionary ${language}: ${String(error)}`);
		}
	}

	private getUniqueArray(array: string[]): string[] {
		return Array.from(new Set(array));
	}

	private shouldCheck(document: vscode.TextDocument): boolean {
		if (!this.spellService.isReady()) {
			return false;
		}

		if (document.uri.scheme !== 'file') {
			return false;
		}

		if (!this.settings.documentTypes.includes(document.languageId)) {
			return false;
		}

		if (this.settings.ignoreFileExtensions.includes(path.extname(document.fileName))) {
			return false;
		}

		if (this.settings.ignoreFilenames.includes(path.basename(document.fileName))) {
			return false;
		}

		return true;
	}

	private loadSettings(): SpellSettings {
		const config = vscode.workspace.getConfiguration('spellchecker');
		const merged: SpellSettings = { ...DEFAULT_SETTINGS };

		merged.language = this.normalizeLanguage(config.get<string>('language', merged.language));
		merged.ignoreWordsList = this.ensureStringArray(config.get('ignoreWordsList', merged.ignoreWordsList));
		merged.documentTypes = this.ensureStringArray(config.get('documentTypes', merged.documentTypes));
		merged.ignoreRegExp = this.ensureStringArray(config.get('ignoreRegExp', merged.ignoreRegExp));
		merged.ignoreFileExtensions = this.ensureStringArray(
			config.get('ignoreFileExtensions', merged.ignoreFileExtensions),
		);
		merged.ignoreFilenames = this.ensureStringArray(
			config.get('ignoreFilenames', merged.ignoreFilenames),
		);
		const checkInterval = config.get<number>('checkInterval', merged.checkInterval);
		merged.checkInterval = Number.isFinite(checkInterval) ? checkInterval : merged.checkInterval;
		merged.suggestionSeverity = this.normalizeSeverity(
			config.get<SeverityOption>('suggestionSeverity', merged.suggestionSeverity),
		);
		merged.autoCheck = config.get<boolean>('autoCheck', merged.autoCheck);
		const maxDiagnostics = config.get<number>('maxDiagnostics', merged.maxDiagnostics);
		merged.maxDiagnostics = Number.isFinite(maxDiagnostics) ? maxDiagnostics : merged.maxDiagnostics;
		const suggestionLimit = config.get<number>('suggestionLimit', merged.suggestionLimit);
		merged.suggestionLimit = Number.isFinite(suggestionLimit) ? suggestionLimit : merged.suggestionLimit;

		const legacy = this.loadLegacySettings();
		if (legacy) {
			merged.ignoreWordsList = this.getUniqueArray([
				...merged.ignoreWordsList,
				...(legacy.ignoreWordsList ?? []),
			]);
			merged.ignoreRegExp = this.getUniqueArray([...merged.ignoreRegExp, ...(legacy.ignoreRegExp ?? [])]);
		}

		return merged;
	}

	private loadLegacySettings(): Partial<SpellSettings> | undefined {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			return;
		}

		const configFile = path.join(workspaceFolder.uri.fsPath, '.vscode', 'spellchecker.json');
		if (!fs.existsSync(configFile)) {
			return;
		}

		try {
			const raw = fs.readFileSync(configFile, 'utf-8');
			const minified = jsonMinify(raw);
			const parsed = JSON.parse(minified);
			return parsed as Partial<SpellSettings>;
		} catch (error) {
			vscode.window.showWarningMessage(
				`Could not read legacy spellchecker.json: ${String(error)}`,
			);
			return;
		}
	}

	private ensureStringArray(value: unknown): string[] {
		if (!Array.isArray(value)) {
			return [];
		}
		return value.filter((item): item is string => typeof item === 'string');
	}

	private normalizeSeverity(value: SeverityOption): SeverityOption {
		if (['Error', 'Hint', 'Information', 'Warning'].includes(value)) {
			return value;
		}
		return 'Warning';
	}

	private normalizeLanguage(language: string): DictionaryCode {
		const allowed: DictionaryCode[] = [
			'en_US',
			'en_GB-ize',
			'en_GB-ise',
			'es_ANY',
			'fr',
			'el_GR',
			'sv_SE',
		];
		return allowed.includes(language as DictionaryCode) ? (language as DictionaryCode) : 'en_US';
	}

	private toggleAutoCheck(): void {
		this.autoCheckEnabled = !this.autoCheckEnabled;
		this.updateStatusBar();
		const message = this.autoCheckEnabled ? 'Spell Checker enabled.' : 'Spell Checker paused.';
		vscode.window.setStatusBarMessage(message, 3000);
		if (this.autoCheckEnabled && vscode.window.activeTextEditor) {
			void this.doSpellCheck(vscode.window.activeTextEditor.document);
		}
	}

	private updateStatusBar(): void {
		if (!this.statusBarItem) {
			return;
		}
		const language = this.spellService.getLanguage() ?? this.settings.language;
		const icon = this.autoCheckEnabled ? 'checklist' : 'circle-slash';
		this.statusBarItem.text = `$(${icon}) Spell ${language}`;
		this.statusBarItem.tooltip = this.autoCheckEnabled
			? 'Spell Checker is enabled. Click to pause.'
			: 'Spell Checker is paused. Click to enable.';
	}
}