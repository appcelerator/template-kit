const fs = require('fs-extra');

module.exports = {
	__esModule: true,
	default: async state => {
		return {
			data: {
				example: 'hello'
			},
			filters: [
				'.gitignore',
				'package.json',
				'README.md',
				'src/**',
				'!src/nope.txt',
				'!foo-test',
				'bar-test'
			],
			prompts: {
				firstName: {
					message: 'What is your first name?',
					required: true,
					type: 'string'
				},
				foo: {
					default: 'bar',
					message: 'Just a test',
					required: true,
					type: 'string'
				}
			},
			async complete() {
				//
			}
		};
	}
};
