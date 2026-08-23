import { defineConfig } from 'vitest/config'

export default defineConfig({
  environment: 'node',
  include: ['tests/**/*.spec.ts'],
})
