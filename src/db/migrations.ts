import { connectDatabase } from './client';

export async function initializeDatabase() {
  await connectDatabase();
  console.log('Schema gerenciado via Supabase SQL Editor. Execute supabase_schema.sql manualmente.');
}
