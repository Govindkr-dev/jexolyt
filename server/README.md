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

When served by this Node application, homepage hero content and project enquiry submissions use the MongoDB API. The former `../pages/dashboard.html` URL now opens the MongoDB-backed Super Admin panel. The panel's Super Admin dashboard also reads aggregate workforce metrics from Firebase through the protected `/api/admin/firebase/overview` endpoint; the service account remains server-side and the endpoint returns counts only. This endpoint requires `FIREBASE_PROJECT_ID=govindkr-dev` and an active MongoDB Super Admin session. The Firebase Admin page remains available at `../pages/firebase-admin.html` for existing member, portfolio, freelancer application, and category workflows. The Super Admin panel's protected Firebase workspace supports staff profile/status updates, employee invitations, task assignment and submission review, staff-project tracking, member moderation, and leave/attendance-correction decisions. Attendance, work logs, messages, support tickets, announcements, and resources are currently review/read views; they do not yet provide every management action in the full portal specification. Existing Firebase records are copied only by the explicit migration script below; the live website is not switched automatically.

The admin panel's **Client Chats** shortcut opens the Firebase-hosted customer chat in the same tab, preserving the active Mongo-backed admin session. The server verifies the active admin session and issues a short-lived Firebase custom token; only `admin` and `super_admin` accounts can request it. Existing admin accounts do not need an additional support permission. Firebase Admin credentials must remain server-side: set `FIREBASE_PROJECT_ID=govindkr-dev` plus `FIREBASE_SERVICE_ACCOUNT_JSON` (recommended on Render) or `GOOGLE_APPLICATION_CREDENTIALS`. Deploy the updated Firestore rules so time-limited admin chat claims can read, reply to, and delete conversations. Admin chat access expires after 30 minutes and must be reopened from the signed-in admin panel.

The first visitor message in each chat is emailed privately to `govindsh.dev@gmail.com` by default; set `SUPPORT_INBOX_EMAIL` to override the recipient. Project estimate requests use that same inbox and email service, including the client's name, email, phone number, selected services, and starting totals; estimates are not added to chat. Chat remains for client support questions. Employee invitations are emailed to the invited address and can be retried from Invitations & Onboarding if delivery fails. To enable delivery, create a Resend account, verify a sender domain you control, and set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (for example `JEXOLYT <chat@your-domain.com>`) in the server's private environment. On Render, add these under the service's **Environment** settings; locally, put them in the private `server/.env`. The Firebase Admin service-account configuration above is additionally required for chat notifications and workforce actions, but not for estimate emails.

Client sign-up uses Firebase Authentication and creates a private `clients/{uid}` profile. Client sign-in returns to the public website; the account page shows future payment-history and receipt areas as unavailable until a payment provider and billing workflow are configured. Freelancer network applications remain separate and do not create client or member sign-in accounts.

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
