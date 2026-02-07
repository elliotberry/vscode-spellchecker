import { strict as assert } from 'assert';

import { sanitizeText } from '../utils/textProcessing';

describe('sanitizeText', () => {
	it('removes code blocks and URLs while preserving length', () => {
		const text = 'Hello\n```code block```\nworld http://example.com';

		const sanitized = sanitizeText(text, { userPatterns: [] });

		assert.equal(sanitized.length, text.length, 'length should be preserved');
		assert.ok(!sanitized.includes('http://example.com'), 'URLs should be stripped');
		assert.ok(!sanitized.includes('code block'), 'code blocks should be stripped');
	});
});
