import { defineConfig } from 'drizzle-kit';

// Genera las migraciones SQL a partir del esquema: `npm run db:generate`.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/adapters/sqlite/schema.ts',
  out: './drizzle',
});
