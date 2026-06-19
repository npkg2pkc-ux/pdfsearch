Vercel Migration (Full) — Overview and steps

Goal
 - Move backend to serverless Vercel functions while using external services for storage and DB.

Prerequisites
 - AWS S3 bucket (or S3-compatible storage) and credentials
 - Hosted Postgres (e.g., Supabase, PlanetScale with Postgres, ElephantSQL)
 - Vercel account to host the frontend and serverless functions

Environment variables to set in Vercel (Project Settings → Environment Variables):
 - `S3_BUCKET` — bucket name
 - `AWS_REGION` — region
 - `AWS_ACCESS_KEY_ID` — AWS key
 - `AWS_SECRET_ACCESS_KEY` — AWS secret
 - `DATABASE_URL` — Postgres connection string (e.g. `postgres://user:pass@host:5432/db`)

Steps
1. Initialize Postgres schema: run `migrations/init.sql` against your Postgres instance.
2. Add the environment variables above to Vercel.
3. Deploy the repo to Vercel. The `/api/*` endpoints will become serverless functions.
4. In `app.js`, set `API_BASE_OVERRIDE` to your Vercel deployment origin (or keep null to use same origin).

Notes & limitations
 - Folder scanning: serverless cannot scan a remote user's local filesystem. The concept of "active_folder" now maps to an S3 prefix or logical folder stored in `settings.active_folder`.
 - PDF text extraction / scanning: consider running extraction at upload time (via a background worker) or using a server process if extraction is heavy.
 - For full compatibility you may want to run a small background worker (e.g., on Render) to process PDFs and populate `tags` table.

S3 CORS
 - If you use presigned PUT uploads (recommended), you must set S3 bucket CORS to allow PUT from your frontend origin. Example minimal CORS rule:

```xml
<CORSConfiguration>
	<CORSRule>
		<AllowedOrigin>https://your-vercel-app.vercel.app</AllowedOrigin>
		<AllowedMethod>PUT</AllowedMethod>
		<AllowedMethod>GET</AllowedMethod>
		<AllowedHeader>*</AllowedHeader>
		<ExposeHeader>ETag</ExposeHeader>
		<MaxAgeSeconds>3000</MaxAgeSeconds>
	</CORSRule>
</CORSConfiguration>
```


If you want, I can:
 - Provide a worker script (Node) to run on a persistent host that scans S3 uploads and extracts annotations into the DB.
 - Or adapt existing `services/pdfExtractor.js` to run as a separate service and push results to Postgres.
