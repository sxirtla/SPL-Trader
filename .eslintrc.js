export default {
	env: {
		browser: true,
		es2021: true,
	},
	parser: '@typescript-eslint/parser',
	parserOptions: {
		ecmaVersion: 'latest',
		sourceType: 'module',
	},
	plugins: ['@typescript-eslint'],
	rules: {
		semi: 'warn',
		quotes: ['warn', 'single'],
		// camelcase: 'warn',
		// 'prefer-const': 'error',
	},
};
