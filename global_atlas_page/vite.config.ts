import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Automatically handles https://username.github.io/repo-name/ on Pages.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
const isRootPagesSite = repoName.toLowerCase().endsWith('.github.io');
const base = process.env.GITHUB_PAGES === 'true' && repoName && !isRootPagesSite
  ? `/${repoName}/`
  : '/';

export default defineConfig({ plugins: [react()], base });
