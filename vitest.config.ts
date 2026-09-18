import { defineConfig } from 'vitest/config'
import { config } from 'dotenv'

config()
config({ path: '.env.example' })

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    poolOptions: {
      threads: { singleThread: true },
    },
    testTimeout: 15_000,
  },
})
