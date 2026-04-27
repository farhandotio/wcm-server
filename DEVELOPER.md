# Server Developer Notes

## Purpose

This document is the backend reference for `wcm-server`, the Express + MongoDB API that powers public listings, user auth, creator workflows, admin moderation, wallet/promotions, blogs, SEO, FAQ, analytics, and audit logging.

The server is the source of truth for auth, moderation, promotion state, payments, and most content. The frontend frequently calls these routes directly, so route/controller compatibility matters more here than abstract architectural purity.

## Stack

- Node.js with ES modules
- Express `5`
- MongoDB via Mongoose
- Redis client for optional caching
- Stripe for top-up checkout and webhooks
- Cloudinary + Multer for uploads
- `exceljs` for admin exports
- `jspdf` and `jspdf-autotable` for invoices
- `node-cron` for recurring promotion/earning logic

## Scripts

```bash
npm install
npm run dev
npm run start
npm run build
```

Current script behavior:

- `npm run dev`: starts `nodemon server.js`
- `npm run start`: starts `node server.js`
- `npm run build`: creates upload directory and runs `npm install`
- `npm test`: placeholder only, no real automated backend test suite exists yet

## Required Environment

At minimum:

```env
PORT=5000
MONGO_URI=...
JWT_SECRET=...
CLIENT_URL=http://localhost:3000
REDIS_URL=redis://localhost:6379
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
EXCHANGE_RATE_API_KEY=...
BUSINESS_NAME=...
```

Observed environment behavior:

- MongoDB is required. Failure in `src/config/db.js` exits the process.
- Redis is optional. Missing or failed Redis connection only disables cache.
- Stripe and Cloudinary are required for their respective flows, but not for every route.

## Runtime Boot Sequence

### Entry point

File: `server.js`

Runtime order:

1. `connectDB()`
2. `connectRedis()`
3. `app.listen(...)`
4. After listen:
   - `startPromotionCleaner()`
   - `initCronJobs()`

### Express app

File: `src/app.js`

Responsibilities:

- Enables proxy trust.
- Applies CORS using `CLIENT_URL`.
- Applies `cookieParser()`.
- Applies global rate limiting.
- Mounts payment routes before `express.json()` to preserve Stripe raw webhook parsing.
- Mounts all feature route groups under `/api/*`.
- Serves `/uploads` statically.

## Route Registry

Mounted in `src/app.js`:

- `/api/users` -> `src/routes/userRoutes.js`
- `/api/creator` -> `src/routes/creatorRoutes.js`
- `/api/listings` -> `src/routes/listingRoutes.js`
- `/api/admin` -> `src/routes/adminRoutes.js`
- `/api/audit` -> `src/routes/auditRoutes.js`
- `/api/sliders` -> `src/routes/sliderRoutes.js`
- `/api/blogs` -> `src/routes/blogRoutes.js`
- `/api/views` -> `src/routes/viewsRoutes.js`
- `/api/faqs` -> `src/routes/faqRoutes.js`
- `/api/seo` -> `src/routes/seoRoutes.js`
- `/api/payments` -> `src/routes/paymentRoutes.js`

## Config Files

- `src/config/db.js`
  - Connects Mongoose.
  - Disables `strictQuery`.
  - Exits process on DB failure.

- `src/config/redis.js`
  - Creates optional Redis client from `REDIS_URL`.
  - Exports `connectRedis`, `redisClient`, `isRedisReady`.

- `src/config/multer.js`
  - Configures Cloudinary-backed upload storage.
  - Stores images in `listings` folder.
  - Restricts formats to `jpg`, `png`, `jpeg`, `webp`.
  - Limits upload size to 5 MB.

## Middleware

- `src/middlewares/auth.js`
  - `optionalAuth`: attach user if token is valid, otherwise continue anonymously.
  - `authMiddleware`: enforce logged-in user and active/unblocked status.
  - `authorizeRoles(...roles)`: enforce role membership.

## Route-by-Route API Map

### User routes

File: `src/routes/userRoutes.js`

Public endpoints:

- `POST /api/users/register`
- `POST /api/users/login`
- `POST /api/users/logout`
- `GET /api/users/moderation-reasons`
- `GET /api/users/famous-creators`
- `GET /api/users/top-creators-dropdown`
- `GET /api/users/profile/:id`
- `POST /api/users/forgot-password`
- `PUT /api/users/reset-password/:token`

Authenticated endpoints:

- `DELETE /api/users/delete-account`
- `GET /api/users/me`
- `PUT /api/users/update-profile`

Role-guarded endpoints:

- `POST /api/users/become-creator` for `user`
- `PUT /api/users/update-creator-profile` for `creator`

Controller coverage in `src/controllers/userController.js`:

- `registerUser`
- `loginUser`
- `becomeCreator`
- `getMyProfile`
- `logoutUser`
- `updateUserProfile`
- `updateCreatorProfile`
- `deleteUserAccount`
- `getPublicProfile`
- `getFamousCreators`
- `getTopCreatorsWithDropdown`
- `getModerationReasons`
- `forgotPassword`
- `resetPassword`

### Listing routes

File: `src/routes/listingRoutes.js`

Public or optional-auth endpoints:

- `GET /api/listings/moderation-reasons`
- `GET /api/listings/public`
- `GET /api/listings/tags/by-category/:categoryId`
- `GET /api/listings/meta-data`
- `GET /api/listings/count/:creatorId`
- `POST /api/listings/:id/click`
- `GET /api/listings/:id`

Authenticated endpoints:

- `GET /api/listings/favorites`
- `POST /api/listings/favorite/:id`
- `PATCH /api/listings/:id/cancel-promotion`

Creator-only endpoints:

- `GET /api/listings/my-listings`
- `POST /api/listings/add`
- `PUT /api/listings/update/:id`
- `DELETE /api/listings/delete/:id`

Controller coverage in `src/controllers/listingController.js`:

- `handlePpcClick`
- `getCategoriesAndTags`
- `createListing`
- `updateListing`
- `getPublicListings`
- `getListingById`
- `getCreatorListingCount`
- `getMyListings`
- `toggleFavorite`
- `getMyFavorites`
- `deleteListing`
- `cancelPromotion`
- `getModerationReasons`

### Creator routes

File: `src/routes/creatorRoutes.js`

Creator-only endpoints:

- `GET /api/creator/categories`
- `GET /api/creator/tags/by-category/:categoryId`
- `GET /api/creator/stats`
- `GET /api/creator/my-transactions`
- `GET /api/creator/promotion-insights/:id`

Controller coverage in `src/controllers/creatorController.js`:

- `getMyTransactions`
- `getPromotionAnalytics`
- `getCreatorDashboardStats`

### Payment routes

File: `src/routes/paymentRoutes.js`

Endpoints:

- `POST /api/payments/webhook`
- `POST /api/payments/create-checkout-session`
- `POST /api/payments/purchase-promotion`
- `POST /api/payments/cancel-promotion`
- `POST /api/payments/toggle-pause-promotion`
- `GET /api/payments/creator/invoice/:id`

Controller coverage in `src/controllers/PaymentController.js`:

- `createCheckoutSession`
- `handleStripeWebhook`
- `purchasePromotion`
- `togglePausePromotion`
- `cancelPromotion`
- `generateInvoice`

### Admin routes

File: `src/routes/adminRoutes.js`

Public helper endpoints kept outside auth:

- `GET /api/admin/categories`
- `GET /api/admin/tags/by-category/:categoryId`
- `GET /api/admin/regions/by-category/:categoryId`
- `GET /api/admin/traditions/by-category/:categoryId`
- `GET /api/admin/category-assets/:categoryId`

Admin-only endpoints:

- `GET /api/admin/stats`
- `GET /api/admin/transactions`
- `GET /api/admin/export-transactions`
- `GET /api/admin/export-transactions-range`
- `GET /api/admin/listings`
- `GET /api/admin/promoted-listings`
- `PUT /api/admin/update-status/:id`
- `GET /api/admin/users`
- `GET /api/admin/users/:id`
- `GET /api/admin/export-users`
- `GET /api/admin/creator-requests`
- `PUT /api/admin/approve-creator/:userId`
- `PUT /api/admin/reject-creator/:userId`
- `PUT /api/admin/toggle-status/:userId`
- `PUT /api/admin/update-ppc-balance/:id`
- `POST /api/admin/categories`
- `PUT /api/admin/categories/reorder`
- `PUT /api/admin/categories/:id`
- `DELETE /api/admin/categories/:id`
- `POST /api/admin/tags`
- `PUT /api/admin/tags/:id`
- `DELETE /api/admin/tags/:id`
- `GET /api/admin/regions`
- `POST /api/admin/regions`
- `PUT /api/admin/regions/:id`
- `DELETE /api/admin/regions/:id`
- `GET /api/admin/traditions`
- `POST /api/admin/traditions`
- `PUT /api/admin/traditions/:id`
- `DELETE /api/admin/traditions/:id`

Controller coverage in `src/controllers/adminController.js`:

- Region CRUD and queries
- Tradition CRUD and queries
- `getCategoryAssets`
- Category CRUD and ordering
- Tag CRUD
- `getAllUsers`
- `getCreatorRequests`
- `approveCreator`
- `rejectCreator`
- `toggleUserStatus`
- `manageListings`
- `deleteListingByAdmin`
- `updateListingStatus`
- `exportUsersExcel`
- `exportTransactionsExcel`
- `getAllTransactions`
- `exportTransactionsByRange`
- `updatePpcBalanceManual`
- `getPromotedListings`
- `getAdminStats`
- `getUserById`

### Audit routes

File: `src/routes/auditRoutes.js`

Endpoints:

- `GET /api/audit/creator/logs`
- `GET /api/audit/admin/logs`

Controller coverage in `src/controllers/auditController.js`:

- `getCreatorAuditLogs`
- `getAdminAuditLogs`

### Blog routes

File: `src/routes/blogRoutes.js`

Endpoints:

- `GET /api/blogs`
- `GET /api/blogs/:id`
- `POST /api/blogs`
- `PUT /api/blogs/:id`
- `DELETE /api/blogs/:id`
- `GET /api/blogs/:id/comments`
- `POST /api/blogs/comments`
- `DELETE /api/blogs/comments/:id`

Controller coverage:

- `src/controllers/blogController.js`
  - `createBlog`
  - `updateBlog`
  - `getBlogs`
  - `getBlogById`
  - `deleteBlog`
- `src/controllers/commentController.js`
  - `createComment`
  - `getCommentsByBlog`
  - `deleteComment`

### Slider routes

File: `src/routes/sliderRoutes.js`

Endpoints:

- `GET /api/sliders`
- `POST /api/sliders/add`
- `DELETE /api/sliders/:id`
- `PUT /api/sliders/:id`

Controller coverage in `src/controllers/sliderController.js`:

- `getSliders`
- `addSlider`
- `deleteSlider`
- `updateSlider`

### FAQ routes

File: `src/routes/faqRoutes.js`

Endpoints:

- `GET /api/faqs`
- `POST /api/faqs`
- `PUT /api/faqs/:id`
- `DELETE /api/faqs/:id`

Controller coverage in `src/controllers/faqController.js`:

- `getAllFaqs`
- `createFaq`
- `updateFaq`
- `deleteFaq`

### SEO routes

File: `src/routes/seoRoutes.js`

Endpoints:

- `POST /api/seo/update`
- `GET /api/seo/all`
- `GET /api/seo/:pageName`
- `DELETE /api/seo/delete/:id`

Controller coverage in `src/controllers/seoController.js`:

- `updateSeoSettings`
- `getSeoSettingsByPage`
- `getAllSeoSettings`
- `deleteSeoSetting`

### View tracking routes

File: `src/routes/viewsRoutes.js`

Endpoints:

- `POST /api/views/track`

Controller coverage in `src/controllers/viewsController.js`:

- `trackVisitor`

## Data Model Map

### Core marketplace models

- `src/models/User.js`
  - Core auth/account model.
  - Includes role, status, creator request, profile, VAT/compliance data, wallet balance, cached dashboard stats, reset token fields.

- `src/models/Listing.js`
  - Main creator asset/listing model.
  - Includes moderation status, cultural metadata, favorites, views, and nested promotion state:
    - `promotion.level`
    - `promotion.boost`
    - `promotion.ppc`
    - `promotion.isPromoted`

- `src/models/Category.js`
  - Listing/blog categorization with `order`.

- `src/models/Tag.js`
  - Tags per category.

- `src/models/Region.js`
  - Regions per category.

- `src/models/Tradition.js`
  - Traditions per category.

### Promotion, finance, and analytics models

- `src/models/Transaction.js`
  - Stores promotion spend, wallet top-ups, refunds, and invoice fields.

- `src/models/Analytics.js`
  - Per-listing and per-creator daily counts for `views` and `clicks`.

- `src/models/InteractionLog.js`
  - Short-lived duplicate-protection log for `view` and `ppc_click` events.
  - TTL index expires entries after 24 hours.

- `src/models/AuditLog.js`
  - Structured admin/creator system audit trail.

### Content and public-site models

- `src/models/Blog.js`
  - Blog entries with content blocks and author metadata.

- `src/models/Comment.js`
  - Nested blog comments with parent-child relations and soft-delete flags.

- `src/models/Faq.js`
  - FAQ entries grouped by category.

- `src/models/SeoSetting.js`
  - SEO metadata rows by page name.

- `src/models/Slider.js`
  - Homepage/public slider items.

### Support/system models

- `src/models/Visitor.js`
  - Visitor/device/IP aggregate tracking.

- `src/models/SystemSettings.js`
  - Generic key/data settings holder.

## Utility Map

- `src/utils/cache.js`
  - Redis-backed cache helpers.
  - Versioned namespace keys for invalidation.
  - Entity invalidators:
    - `invalidateUserProfileCaches`
    - `invalidateListingCaches`
    - `invalidateMetaCaches`

- `src/utils/promotionHelper.js`
  - Promotion cleanup and derived state updates.
  - `resetBoost`
  - `resetPPC`
  - `checkAndCleanupExpiry`
  - `applyPromotionLogic`

- `src/utils/promotionCleaner.js`
  - Startup loop that deactivates expired/depleted promotions and recomputes promotion state.

- `src/utils/cronJobs.js`
  - Recurring jobs, including promotion earning progression.

- `src/utils/trackAnalytics.js`
  - Daily analytics updates for views/clicks.

- `src/utils/logger.js`
  - Central audit log creation helper.

- `src/utils/vatHelper.js`
  - VAT calculation and optional VIES validation helpers.

- `src/utils/invoiceGenerator.js`
  - Invoice PDF helper.

- `src/utils/levelCalculator.js`
  - Listing level/ranking helper logic.

- `src/utils/jwt.js`
  - Token/cookie response helper.

- `src/utils/rateLimiter.js`
  - Global Express rate limiter.

## Feature Boundaries

### Authentication and user lifecycle

- Registration/login/logout live entirely in `userController`.
- Auth is cookie-based.
- Backend blocks blocked users in `authMiddleware`.
- Role changes and moderation happen in `adminController`.

### Creator onboarding

- Creator application submission is `becomeCreator`.
- Admin approval/rejection is handled by:
  - `approveCreator`
  - `rejectCreator`
- Public creator discovery is served by:
  - `getFamousCreators`
  - `getTopCreatorsWithDropdown`
  - `getPublicProfile`

### Listings and public explore

- Listing creation/update/delete and creator-side listing fetch live in `listingController`.
- Public explore and listing detail also live there.
- Tag/category meta-data and creator listing counts are exposed there too.

### Favorites and view/click tracking

- Favorites are stored directly on `Listing.favorites`.
- PPC clicks use `InteractionLog` dedupe logic.
- Visitor/device tracking is separate in `viewsController` and `Visitor`.

### Wallet, promotions, and payments

- Stripe checkout top-ups:
  - create checkout session
  - webhook credits wallet
- Internal wallet spend/refund:
  - purchase promotion
  - pause/resume promotion
  - cancel promotion
- Creator insight data is assembled in `creatorController`.
- Invoices are generated on demand in `PaymentController`.

### Admin back office

- User management, moderation, exports, promoted asset monitoring, dashboard stats, and master data CRUD all live in `adminController`.
- Category/tag/region/tradition helper endpoints are reused by creator-facing forms.

## Cache Design

Caching is implemented in `src/utils/cache.js`.

Important patterns:

- Namespace version bumps instead of Redis `KEYS` scans.
- Entity detail keys:
  - `listing:detail:<id-or-slug>`
  - `user:profile:<id-or-username-or-slug>`
- Mutation paths should invalidate relevant listing/profile/meta caches in the same code path.

Redis behavior:

- If Redis is unavailable, the API should continue serving without cache.
- Public read-heavy endpoints benefit most from cache; write paths should never assume Redis exists.

## Promotion State Notes

Promotion state is spread across:

- `Listing.promotion.boost`
- `Listing.promotion.ppc`
- `Listing.promotion.isPromoted`
- top-level `listing.isPromoted` assignments in some controller/helper code

This is an important codebase caveat:

- the schema defines `promotion.isPromoted`
- helper logic and some queries still assign or read top-level `listing.isPromoted`

When changing promotion logic, inspect all of:

- `src/models/Listing.js`
- `src/utils/promotionHelper.js`
- `src/utils/promotionCleaner.js`
- `src/controllers/listingController.js`
- `src/controllers/creatorController.js`
- `src/controllers/PaymentController.js`
- `src/controllers/adminController.js`

Do not assume one single `isPromoted` field is the only source of truth.

## Frontend Compatibility Notes

The frontend currently depends on these backend behaviors:

- `/api/users/me` returns the current user for dashboard gating.
- `/api/listings/my-listings` returns computed `isPromoted` and `activePromoTypes` for creator views.
- `/api/creator/promotion-insights/:id` returns normalized:
  - `ppc.isActive`
  - `ppc.isPaused`
  - `boost.isActive`
  - `boost.isPaused`
- `/api/admin/categories` is intentionally public because both creator and public forms use it.

Known mismatches discovered during codebase review:

- Client sitemap expects `/api/users/creators`, but backend does not expose that endpoint.
- Client sitemap builds `/listing/...` URLs, while the actual route shape is `/listings/[id]`.
- SEO route usage is inconsistent in the client:
  - some pages call `/api/seo/:pageName`
  - one file still expects a query-style variant

## Practical Change Rules

- If you add or change a public read-heavy endpoint, consider cache integration immediately.
- If you change listing, category, tag, region, tradition, or profile data that affects public rendering, add cache invalidation in the write path.
- Prefer `lean()` on heavy read queries unless document methods are required.
- Keep payment routes mounted before `express.json()` if Stripe raw webhook support remains.
- Treat admin/creator dashboards as API consumers with many direct assumptions about response shape. Small response changes can break pages quickly.

## Current Risks and Cleanup Candidates

1. Standardize promotion truth fields and remove the top-level vs nested `isPromoted` ambiguity.
2. Add real automated tests, especially for auth, moderation, and promotion/payment flows.
3. Fix frontend/backend sitemap and SEO route mismatches.
4. Review public listing visibility rules for blocked/suspended creator handling across all public queries.
