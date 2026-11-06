import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['pipeline', 'shared', 'web'],
  },
});
