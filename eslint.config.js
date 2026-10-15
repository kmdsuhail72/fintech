import sharedConfig from '@asteriq/config/eslint';

export default [
  {
    ignores: [
      '.runtime/**',
      '**/.pytest_cache/**',
      '**/.venv/**',
      '**/venv/**',
      'apps/ai-service/artifacts/**',
    ],
  },
  ...sharedConfig,
];
