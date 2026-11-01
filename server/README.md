# JEXOLYT Admin API

The Node.js application serves the website and the MongoDB-backed admin API from one origin. Admin sessions use a 15-minute access token and a rotating, hashed refresh token in HttpOnly cookies; production cookies are Secure and partitioned so the Firebase-hosted frontend can keep its Render API session across page reloads. Refresh sessions have a fixed maximum lifetime of 30 days when “remember me” is selected, or 8 hours otherwise. Logout revokes the active refresh session, and the API checks the backing session for each protected request. Admin access and every module action are checked by the API; hiding a navigation item is not treated as authorization.

## Local setup

1. Install MongoDB locally or create a MongoDB Atlas database.
2. Copy `.env.example` to `.env` and set `MONGODB_URI`, a random `JWT_SECRET` of at least 32 characters, and a one-time `SUPER_ADMIN_SETUP_KEY`. Keep `.env` private.
3. From this directory, run `npm install` and `npm start`.
4. Open `http://localhost:5000/pages/admin-setup.html` and create the first Super Admin. Setup is disabled after that account exists.
5. Sign in at `http://localhost:5000/pages/dashboard.html` (this is the new admin panel entry point; it redirects to the secure sign-in page).

The first Super Admin can create Admin accounts and configure their per-module permissions. New Admin accounts receive the default permissions defined in the blueprint; delete access is off unless explicitly granted.

## Current integration boundary

When served by this Node application, homepage hero content and project enquiry submissions use the MongoDB API. The old Firebase admin page remains available at `../pages/firebase-admin.html` for existing member, portfolio, freelancer application, and category workflows. The former `../pages/dashboard.html` URL now opens the new MongoDB admin panel. Existing Firebase records are copied only by the explicit migration script below; the live website is not switched automatically.

### Firestore data copy (staging step)

The migration script copies documents from `adminActivity`, `applications`, `attendance`, `categories`, `chats`, `contacts`, `members`, `notifications`, `publicProfiles`, `team`, `users`, and `worklogs`, including nested collections such as member projects and chat messages. It preserves each Firestore document path and IDs in MongoDB's `firebase_documents` collection and serializes Firestore timestamps, references, geopoints, and bytes without changing the source. It is resumable and updates MongoDB records by source path; it never deletes Firestore or MongoDB documents.

Configure `MONGODB_URI`, `FIREBASE_PROJECT_ID=govindkr-dev`, and either `FIREBASE_SERVICE_ACCOUNT_JSON` (the service-account JSON stored as a private server environment variable) or Google Application Default Credentials via `GOOGLE_APPLICATION_CREDENTIALS`. The importer checks that it targets `govindkr-dev`, which is the Firebase project configured by the JEXOLYT website. Never put service-account credentials in website files, git, or chat.

1. Run `npm run migrate:firestore -- --dry-run` to list source counts.
2. Before copying, coordinate a write freeze or a final synchronization window for Firestore writes. Run `npm run migrate:firestore -- --apply` to copy, then compare the verified MongoDB counts with Firestore.
3. Keep the Firebase site and legacy admin available until every reader and writer has been migrated and verified. This copy alone does not cut over live website traffic; do not treat it as a completed migration.

On Render Free, where Shell and One-Off Jobs are unavailable, a signed-in Super Admin can use `POST /api/admin/migration/firestore` with `{"mode":"dry-run"}` to obtain read-only counts. The same endpoint accepts `{"mode":"copy","confirm":"COPY_FIRESTORE_TO_MONGODB","writesPaused":true}` only after Firestore writes have been paused. Both modes use the server-side service-account credentials, and every run is recorded in the admin audit log.

For production, deploy this Node service behind HTTPS with `HOST=0.0.0.0`, set `CLIENT_URL` to the exact frontend origin, and set the `jexolyt-api-url` meta tag on admin, setup, and homepage pages to the HTTPS API origin (currently `https://jexolyt.onrender.com`). Use a same-origin HTTPS deployment where possible so the protected admin session cookie works consistently. Firebase Hosting does not proxy `/api` to this service; the frontend calls the configured API origin directly.

## Safeguards and scope

- Admin records are permission-checked, validated, and soft-deleted; audit events are append-only through the API.
- Finance totals are recorded transactions, not bank balances. Tax calculations, payroll, payment processing, and invoice numbering are not implemented.
- JSON/CSV export is available only for records the requesting account can view. Restore/import and scheduled off-site backups are intentionally unavailable until retention, storage, and recovery procedures are configured.
- Integration records hold status and notes only. Credentials must remain in server environment variables or a secrets manager.
- The setup endpoint requires the server-only setup key and can create only the first Super Admin.
