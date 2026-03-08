# Vercel Deployment

Paperclip can be deployed to Vercel in a reduced control-plane mode:

- UI is built as a static SPA from `ui/dist`
- API is served by `api/index.ts`
- heartbeat scheduler is disabled
- live WebSocket updates are disabled
- database backups are disabled

This mode is best for lightweight hosted access to the board UI. If you need persistent background heartbeats, raw WebSocket upgrades, or durable local filesystem state, deploy Paperclip on a container host instead.

## Required Environment Variables

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`

## Recommended Environment Variables

- `PAPERCLIP_STORAGE_PROVIDER=s3`
- `PAPERCLIP_STORAGE_S3_BUCKET`
- `PAPERCLIP_STORAGE_S3_REGION`
- `PAPERCLIP_STORAGE_S3_ENDPOINT` when using a non-AWS S3-compatible provider
- `PAPERCLIP_STORAGE_S3_PREFIX`
- `PAPERCLIP_STORAGE_S3_FORCE_PATH_STYLE=true` for providers that require path-style URLs

If S3 is not configured, Paperclip falls back to `local_disk` storage under `/tmp/paperclip`, which is ephemeral on Vercel.

## Auth URL Resolution

`vercel.json` sets:

- `PAPERCLIP_DEPLOYMENT_MODE=authenticated`
- `PAPERCLIP_DEPLOYMENT_EXPOSURE=public`
- `PAPERCLIP_AUTH_BASE_URL_MODE=explicit`

At runtime, Paperclip derives the public auth URL from `VERCEL_URL` when `PAPERCLIP_PUBLIC_URL` is not set.

## Notes

- `api/index.ts` requires `DATABASE_URL`; embedded PostgreSQL is not supported in this mode.
- `api/index.ts` applies pending Drizzle migrations on cold start unless `PAPERCLIP_VERCEL_AUTO_MIGRATE=false`.
- `VITE_DISABLE_LIVE_UPDATES=true` disables the browser WebSocket client because Vercel does not provide raw upgrade handling for this app's current live-event transport.
