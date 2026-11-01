# JEXOLYT Admin API

The Node.js application serves the website and the MongoDB-backed admin API from one origin. Admin sessions use an HttpOnly, Secure, partitioned cookie in production so the Firebase-hosted frontend can keep its Render API session across page reloads. The login form can remember a device for up to 30 days; otherwise sessions expire after 8 hours. Admin access and every module action are checked by the API; hiding a navigation item is not treated as authorization.

## Local setup

1. Install MongoDB locally or create a MongoDB Atlas database.
2. Copy `.env.example` to `.env` and set `MONGODB_URI`, a random `JWT_SECRET` of at least 32 characters, and a one-time `SUPER_ADMIN_SETUP_KEY`. Keep `.env` private.
3. From this directory, run `npm install` and `npm start`.
4. Open `http://localhost:5000/pages/admin-setup.html` and create the first Super Admin. Setup is disabled after that account exists.
5. Sign in at `http://localhost:5000/pages/dashboard.html` (this is the new admin panel entry point; it redirects to the secure sign-in page).

The first Super Admin can create Admin accounts and configure their per-module permissions. New Admin accounts receive the default permissions defined in the blueprint; delete access is off unless explicitly granted.

## Current integration boundary

When served by this Node application, homepage hero content and project enquiry submissions use the MongoDB API. The old Firebase admin page remains available at `../pages/firebase-admin.html` for existing member, portfolio, freelancer application, and category workflows. The former `../pages/dashboard.html` URL now opens the new MongoDB admin panel. Existing Firebase records are not automatically copied into MongoDB; plan and verify a deliberate migration before retiring the legacy Firebase admin page.

For production, deploy this Node service behind HTTPS with `HOST=0.0.0.0`, set `CLIENT_URL` to the exact frontend origin, and set the `jexolyt-api-url` meta tag on admin, setup, and homepage pages to the HTTPS API origin (currently `https://jexolyt.onrender.com`). Use a same-origin HTTPS deployment where possible so the protected admin session cookie works consistently. Firebase Hosting does not proxy `/api` to this service; the frontend calls the configured API origin directly.

## Safeguards and scope

- Admin records are permission-checked, validated, and soft-deleted; audit events are append-only through the API.
- Finance totals are recorded transactions, not bank balances. Tax calculations, payroll, payment processing, and invoice numbering are not implemented.
- JSON/CSV export is available only for records the requesting account can view. Restore/import and scheduled off-site backups are intentionally unavailable until retention, storage, and recovery procedures are configured.
- Integration records hold status and notes only. Credentials must remain in server environment variables or a secrets manager.
- The setup endpoint requires the server-only setup key and can create only the first Super Admin.
