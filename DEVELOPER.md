# Server Developer Notes

## Stack

- Node.js + Express
- MongoDB via Mongoose
- Redis for cache acceleration
- Stripe for payments
- Cloudinary/Multer for uploads

## Entry Points

- App bootstrap: `server.js`
- Express app: `src/app.js`
- Database config: `src/config/db.js`
- Redis config: `src/config/redis.js`
- Cache helpers: `src/utils/cache.js`

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file with at least:

```env
PORT=5000
MONGO_URI=...
JWT_SECRET=...
CLIENT_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000
REDIS_URL=redis://localhost:6379
```

3. Start the server:

```bash
npm run dev
```

## Current Runtime Notes

- The app exits on MongoDB connection failure in `src/config/db.js`.
- Redis is optional now. If `REDIS_URL` is missing or Redis is down, the API continues without cache.
- The last observed startup failure in this workspace was MongoDB DNS/connectivity related, not Redis related.

## Main Backend Areas

- `src/controllers/userController.js`: auth, profiles, creator onboarding, public creator endpoints
- `src/controllers/listingController.js`: listing CRUD, public explore, detail pages, favorites, promotions
- `src/controllers/adminController.js`: moderation, categories, tags, stats, finance exports
- `src/controllers/PaymentController.js`: Stripe payment flow

## Cache Design

- Cache helpers live in `src/utils/cache.js`.
- Public list endpoints use versioned namespace keys instead of Redis `KEYS` scans.
- Direct entity pages use explicit detail keys:
  - `listing:detail:<id-or-slug>`
  - `user:profile:<id-or-username-or-slug>`
- Mutation handlers should call one of:
  - `invalidateListingCaches(...)`
  - `invalidateUserProfileCaches(...)`
  - `invalidateMetaCaches()`

## Known Issues

- Public listings do not yet exclude blocked or suspended creators.
- `getPublicListings` still has an N+1 count pattern for creator listing counts.
- Listing detail cache can return stale `views` until TTL expiry.

## Change Rules

- If you add a new public read-heavy endpoint, cache it through `src/utils/cache.js`.
- If you change category, tag, listing, or profile data that affects public pages, add invalidation in the same write path.
- Prefer `lean()` on read-heavy Mongoose queries unless document methods are required.

## Suggested Next Tasks

1. Fix public listing visibility for blocked and suspended creators.
2. Remove N+1 counting from public listings.
3. Add a real backend test setup. `package.json` currently has no usable test suite.
