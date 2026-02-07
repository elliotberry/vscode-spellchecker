import * as path from 'path';
import { strict as assert } from 'assert';

import { SpellService } from '../services/SpellService';

describe('SpellService', () => {
	it('loads the dictionary and validates words', async () => {
		const service = new SpellService();
		const extensionRoot = path.resolve(__dirname, '..', '..');

		await service.load('en_US', extensionRoot);

		assert.ok(service.isReady(), 'service should be ready after load');
		assert.ok(service.check('hello'), 'hello should be a valid word');
		assert.ok(!service.check('helo'), 'misspelled word should be flagged');

		const suggestions = service.suggest('helo');
		assert.ok(suggestions.includes('hello'), 'suggestions should include likely replacement');
	});
});
