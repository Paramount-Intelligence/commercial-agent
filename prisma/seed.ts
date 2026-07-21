/**
 * Safe no-op seed.
 *
 * Production data is managed through migrations, ingestion scripts, and the
 * admin portal. This file intentionally creates no users and embeds no secrets.
 */
export async function seed(): Promise<void> {
  // Intentionally empty.
}
