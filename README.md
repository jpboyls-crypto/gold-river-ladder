# Gold River Tennis Ladder

Member app for the Gold River Sports Club adult tennis ladder (Spare Time Sports Clubs).

- `index.html` + `app.js` — the ladder app (PWA). Firebase Auth email-link sign-in, Firestore for all data.
- `signup.html` — public sign-up form; writes to the `signups` collection, which the admin approves inside the app.
- `firestore.rules` — the security rules deployed in the Firebase console (keep this file in sync when they change).
- `manifest.json`, `icon-*.png` — PWA install metadata.

Hosted on GitHub Pages. Admin emails are listed in `app.js` (`ADMIN_EMAILS`) and in `firestore.rules` — change both together.
