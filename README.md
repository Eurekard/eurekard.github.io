<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/2815a3d0-5a71-4c57-920f-136afc94b2c7

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

## Image Upload (Cloudflare R2)

This project now uploads images to Cloudflare R2 instead of Firebase Storage.

1. Configure environment variables in `.env.local` (see `.env.example`):
   - `CLOUDFLARE_R2_ACCOUNT_ID`
   - `CLOUDFLARE_R2_ACCESS_KEY_ID`
   - `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
   - `CLOUDFLARE_R2_BUCKET_NAME`
   - `CLOUDFLARE_R2_PUBLIC_BASE_URL`
2. The editor compresses selected images to AVIF (fallback WebP) before upload.
3. Only compressed images are uploaded to R2. Original files are not stored.
