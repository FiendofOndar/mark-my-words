import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, port: 5173 },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /*
     * Not UTC, on purpose.
     *
     * Almost every date rule in this app is local: deadlines end at local
     * midnight, "days until" counts local calendar days, and the check prompt
     * is told the local date. Under TZ=UTC local and UTC are the same thing, so
     * the suite cannot tell a correct implementation from one that reaches for
     * toISOString(). It could not, and one shipped: checks run after 5pm
     * Pacific told the model it was already tomorrow.
     *
     * Pacific is west of UTC, which is the direction that breaks at the end of
     * a day rather than the start, and it is where this app is used.
     */
    env: { TZ: 'America/Los_Angeles' },
  },
});
