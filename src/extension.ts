import * as vscode from 'vscode';

import SpellCheckerProvider from './features/SpellCheckerProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const spellchecker = new SpellCheckerProvider();
	await spellchecker.activate(context);
	console.log('Spellchecker now active!');
}

// this method is called when your extension is deactivated
export function deactivate(): void {
	// Nothing to clean up explicitly because disposables are registered on activation.
}
