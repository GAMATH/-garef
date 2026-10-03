# Kuzuri

> « Votre beauté, réservée en un instant. »

Plateforme de réservation beauté pour l'Afrique francophone : marketplace client + logiciel de gestion de salon + administration. MVP fonctionnel : chaque créneau est calculé dynamiquement, chaque donnée est persistée, chaque bouton fonctionne.

## Démarrer

```bash
npm install
npm run dev            # http://localhost:5173
```

Sans configuration, l'application tourne en **mode démo autonome** : la base est générée dans le navigateur (localStorage) et synchronisée entre onglets en temps réel (BroadcastChannel). Pour utiliser Supabase, voir plus bas.

### Comptes de test (affichés sur l'écran de connexion)

| Rôle | Identifiant | Secret |
|---|---|---|
| Cliente | `+242 06 123 45 67` | code OTP `123456` |
| Gérante (Maison Nzinga, Brazzaville) | `gerant@kuzuri.demo` | `kuzuri2026` |
| Admin | `admin@kuzuri.demo` | `kuzuri2026` |

Paiement simulé : un numéro Mobile Money se terminant par `0000` est **refusé** (pour tester la libération du créneau).

### Scripts

| Commande | Rôle |
|---|---|
| `npm test` | Tests unitaires (moteur de créneaux, paiements, adaptateur démo : concurrence, expiration, temps réel…) |
| `npm run test:sql` | Lance un Postgres 16 jetable, applique migrations + seed, exécute les tests SQL et une **course concurrente réelle** (4 réservations simultanées → 1 seule réussit) |
| `npm run test:e2e` | Playwright mobile : réservation invité < 60 s et ≤ 8 taps, paiement refusé → créneau libéré, réservation visible dans l'agenda pro < 2 s |
| `npm run build && npm run size` | Build + vérification du budget JS initial (< 180 Ko gzip) et des images (< 120 Ko) |
| `npm run perf:lcp` | Mesure du LCP en 4G lente et 3G émulées (serveur `vite preview` sur :4173) |
| `npm run seed:sql` | Régénère `supabase/seed.sql` depuis le jeu de données partagé |

## Architecture

```
src/
  lib/            domaine pur : types, moteur de créneaux, fuseaux (Intl), montants FCFA,
                  téléphone/E.164, adaptateurs PaymentProvider & NotificationChannel, .ics
  data/
    api.ts        contrat unique consommé par l'UI (TanStack Query)
    demo/         adaptateur autonome (localStorage + BroadcastChannel), jobs « pg_cron » simulés
    supabase/     adaptateur Supabase (RLS + RPC + Realtime), chargé à la demande
    seed.ts       jeu de démo déterministe, source unique du mode démo ET de supabase/seed.sql
  components/     design system (Button, Chip, BottomSheet, DatePickerStrip, TimeSlotGrid, SalonCard…)
  pages/
    client/       accueil, recherche + pages SEO /:ville/:categorie, salon, tunnel, confirmation, compte
    business/     espace pro (bundle séparé) : Aujourd'hui, Agenda, Réservations, Clients, …, onboarding
    admin/        administration (bundle séparé)
  i18n/           fr.ts (source, typée) + en.ts (chargé à la demande) — clé manquante = erreur de compilation
supabase/
  migrations/     schéma, moteur de réservation (RPC), RLS + Realtime + pg_cron
  functions/payments/   Edge Function : adaptateurs PaymentProvider + webhook opérateur
  seed.sql        généré
  tests/          tests SQL + course concurrente
```

### Moteur de réservation

- Calcul côté serveur : `get_available_slots()` / `get_available_days()` (Postgres) à partir des horaires salon ∩ horaires pro, pauses, congés, fermetures exceptionnelles, durée cumulée des prestations, rendez-vous et blocages actifs, délai minimal et pas configurable (15 min par défaut). Le module TypeScript `src/lib/booking-engine.ts` est son jumeau, couvert par les mêmes cas de test.
- **Anti double-réservation garanti par la base** : `time_range tstzrange` + `EXCLUDE USING gist (staff_id WITH =, time_range WITH &&)` filtrée sur les statuts actifs. « Peu importe » essaie les pros libres par ordre de priorité ; un conflit renvoie `SLOT_TAKEN` et l'UI propose les 3 créneaux les plus proches.
- Blocage 10 min : rendez-vous `pending_payment` + `hold_expires_at`, minuteur visible ; un blocage expiré cesse immédiatement de bloquer, `pg_cron` l'annule chaque minute. Paiement refusé/expiré → créneau libéré, retour au choix d'heure.
- Fuseaux par ville (Africa/Brazzaville, Africa/Abidjan…), stockage UTC.

### Paiements & notifications

- `PaymentProvider` (`initiate`, `verify`, `refund`, `handleWebhook`) avec `MockMobileMoneyProvider` ; opérateurs par pays (Airtel Money, MTN MoMo, Orange Money, Moov Money, Wave) + carte. Aucune donnée bancaire stockée.
- `NotificationChannel` (WhatsApp, SMS, email) simulés → table `notifications`, visible dans *Admin › Messages envoyés (démo)*. Événements : confirmation, rappel J-1 (job), annulation, nouvelle réservation (salon).

### Performance (mesurée)

| Budget | Cible | Mesuré |
|---|---|---|
| JS initial | < 180 Ko gzip | ~131 Ko |
| LCP 4G lente (4× CPU) | < 2,5 s | ~2,0 s |
| LCP 3G | < 4 s | ~3,4 s |
| Images | < 120 Ko | aucune image bitmap : visuels SVG générés ; photos uploadées compressées en WebP ≤ 120 Ko |

Découpage par route, espace pro/admin/anglais/Leaflet/SDK Supabase chargés à la demande, polices auto-hébergées (sous-ensemble latin, `font-display: swap`), PWA (service worker pour le shell), cache stale-while-revalidate, bannière hors ligne, brouillons de formulaires conservés (sessionStorage).

## Utiliser Supabase

```bash
supabase start                 # ou un projet hébergé
supabase db reset              # applique supabase/migrations + supabase/seed.sql
supabase functions deploy payments
cp .env.example .env.local     # renseigner VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

Toutes les tables ont la RLS activée (rôles `client`, `staff`, `business_owner`, `admin`) ; les écritures sensibles (blocage, paiement, déplacement, annulation, avis) passent par des RPC `security definer` ; les helpers internes ne sont pas exposés à l'API. Les tables de la feuille de route (abonnements, promotions, fidélité, liste d'attente, produits, stock, cartes cadeaux) existent dans le schéma sans interface.

## Limites connues du MVP

- Le mode démo synchronise les onglets d'un même navigateur ; la garantie d'unicité entre appareils est celle de Postgres (mode Supabase).
- L'OTP téléphone est simulé en démo ; en mode Supabase il passe par Supabase Auth (SMS de test configurés dans `supabase/config.toml`).
- L'adaptateur Supabase est vérifié par les tests SQL (schéma, RPC, RLS) mais pas encore par un test E2E contre une instance réelle.
- L'upload de photos est persisté dans l'adaptateur démo ; côté Supabase, le branchement vers Storage (`business_photos`) reste à câbler.
