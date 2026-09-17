import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier/recommended';
import hooks from 'eslint-plugin-react-hooks';

const domain = [
  'src/model.ts',
  'src/persistence.ts',
  'src/compiler/types.ts',
  'src/compiler/request.ts',
  'src/compiler/diagnostics.ts',
  'src/compiler/protocol.ts',
  'src/compiler/wasm.ts',
  'src/compiler/terminal.ts',
  'src/compiler/execution.ts',
  'src/examples.ts',
  'src/sharing.ts'
];

export default defineConfig([
  { ignores: ['**/*.d.ts', '**/__tests__/**', 'src/generated/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: {
      ...hooks.configs.recommended.rules,
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'interface',
          format: ['PascalCase'],
          custom: { regex: '^I[A-Z]', match: true }
        }
      ],
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-globals': [
        'error', 'process', 'require', 'module', 'Buffer', '__dirname'
      ],
      curly: ['error', 'all'],
      eqeqeq: 'error',
      'max-len': ['error', {
        code: 80, ignoreUrls: true, ignoreStrings: true,
        ignoreTemplateLiterals: true
      }]
    }
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/jupyter/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['@jupyterlab/*'] }]
    }
  },
  {
    files: domain,
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['@jupyterlab/*', '@lumino/*', 'react', 'react-dom/*']
      }],
      'no-restricted-globals': ['error',
        'window', 'document', 'navigator', 'localStorage', 'Worker',
        'fetch', 'performance', 'process', 'require', 'Buffer'
      ]
    }
  },
  prettier
]);
