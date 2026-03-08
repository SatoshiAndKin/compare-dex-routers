import rootConfig from '../../eslint.config.js';

export default [
  ...rootConfig,
  {
    files: ['src/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/generated/**/*.ts'],
    rules: {
      '@typescript-eslint/naming-convention': 'off',
    },
  },
];
