# Login & Roles (Operator / Admin)

Every API call, image and video now requires a login. Two roles:

| Role | Can do |
|---|---|
| **Operator** | Everything an investigator needs: search (text / photo / face / plate), upload footage, review and acknowledge alerts, tag hot targets, pursuit waves, Journey Map, exports, reports, Copilot (and confirm its non-admin actions), live streams |
| **Admin** | Everything an Operator can, plus: user management, ML models and model settings, cameras and areas, webhooks, system configuration, re-indexing / backfills / clearing, permanent video deletion, deleting reports / watchlist entries / hot targets, audit log, evaluation tools, and confirming Copilot actions that change camera models or re-index videos |

The full rule table is `backend/app/auth/policy.py`; it is enforced on every request by
`backend/app/auth/middleware.py`, so hiding a button in the UI is never the only protection.

## First-time setup

No default accounts or passwords exist. Create the first Admin on the server (from `backend/`):

```
python -m app.auth.users add <username> --role admin --name "Insp. A. Shah / Badge #1001"
```

You are prompted for the password (min. 8 characters). Then create Operators the same way with
`--role operator`, or from the API (`POST /api/v1/auth/users`, Admin only).

Other commands: `list`, `passwd <user>`, `role <user> operator|admin`, `disable <user>`, `enable <user>`.
The last active Admin cannot be demoted or disabled.

Accounts live in the `users` table of `drishti.db`, so the golden S3 snapshot carries them to every machine
(passwords are bcrypt hashes). No cloud database is needed.

## How it works

- `POST /api/v1/auth/login` sets an **HttpOnly, SameSite=Lax** session cookie (12 h, `AUTH_SESSION_HOURS`).
  The frontend sends it with every request; images and videos carry it automatically. API clients can use
  the returned token as `Authorization: Bearer <token>`.
- Accounts are re-checked at least every 5 s: disabling a user or changing their role applies immediately.
- Records carry the logged-in user, not a name sent by the browser: alert acknowledgements, search logs,
  Copilot confirmations (audit log).
- Machine endpoints keep their own credentials and are not behind user login: MediaMTX auth hook, paired
  camera devices (`X-Device-Token`, stream key), and the standalone camera app.
- `/data/...` only serves the media folders the UI uses (`cameras/`, `processed/`, `areas/`, `streams/`).
  The database, config files (API keys), the session secret, model weights, the vector index, audit logs and
  backups are never served, even with login disabled.

## Settings (`backend/.env`)

| Setting | Default | Meaning |
|---|---|---|
| `AUTH_ENABLED` | `true` | `false` disables login (development only; the app then behaves as a local Admin) |
| `AUTH_SECRET` | generated | Signs session tokens; if empty, a random secret is stored in `backend/data/.auth_secret` (machine-local, not synced) |
| `AUTH_SESSION_HOURS` | `12` | Session length |
