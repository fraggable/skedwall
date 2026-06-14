# skedwall

A Next.js app that generates daily iPhone wallpapers with a sanitized Google Calendar agenda overlay.

## Local Development

Install dependencies:

```powershell
npm install
```

Run the development server:

```powershell
npm run dev
```

Open http://localhost:3000.

## Required Services

- Google OAuth web client with this redirect URI: `http://localhost:3000/api/auth/callback/google`
- Google Calendar API enabled
- Supabase Postgres database
- Supabase Storage bucket named by `SUPABASE_STORAGE_BUCKET`

The storage bucket can be private. Server-side routes use `SUPABASE_SERVICE_ROLE_KEY` to upload and serve generated images.

## Local Environment

Copy `.env.example` to `.env` and fill in the values. Auth.js expects `AUTH_SECRET`; `BETTER_AUTH_SECRET` is not used by this app.

## Python Renderer

Install Pillow locally if you want manual generation from the dashboard:

```powershell
python -m pip install -r python-renderer/requirements.txt
```

Test the renderer:

```powershell
python python-renderer/render.py --input python-renderer/mock-input.json --output python-renderer/mock-output.jpg
```

## Daily Worker

The GitHub Actions workflow in `.github/workflows/generate-wallpapers.yml` runs at 21:00 UTC, which is 5:00 AM Asia/Manila. It also supports manual `workflow_dispatch` runs.

Required GitHub secrets:

- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

## Security Notes

Do not commit `.env`. Google refresh tokens are stored in the Auth.js `accounts` table for now; encrypting them is marked as a hardening task before production use.
