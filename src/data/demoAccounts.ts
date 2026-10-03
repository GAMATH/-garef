/** Demo accounts, shown on the sign-in screen (also created by supabase/seed.sql). */
export const DEMO_ACCOUNTS = {
  client: { id: 'a0000000-0000-4000-8000-000000000001', phone: '+242061234567', otp: '123456', firstName: 'Grâce', lastName: 'Mabiala', email: 'grace@kuzuri.demo' },
  owner: { id: 'a0000000-0000-4000-8000-000000000002', email: 'gerant@kuzuri.demo', password: 'kuzuri2026', firstName: 'Nadège', lastName: 'Okemba', phone: '+242055550101' },
  admin: { id: 'a0000000-0000-4000-8000-000000000003', email: 'admin@kuzuri.demo', password: 'kuzuri2026', firstName: 'Admin', lastName: 'Kuzuri', phone: '+242055550000' },
} as const;
