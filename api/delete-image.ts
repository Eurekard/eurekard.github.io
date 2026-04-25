import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const url: string = typeof body?.url === 'string' ? body.url.trim() : '';

    if (!url) {
      res.status(400).json({ error: 'Missing url' });
      return;
    }

    const publicBaseUrl = getRequiredEnv('CLOUDFLARE_R2_PUBLIC_BASE_URL').replace(/\/$/, '');

    // Only allow deleting files that belong to this R2 bucket
    if (!url.startsWith(publicBaseUrl + '/')) {
      res.status(400).json({ error: 'URL does not belong to this bucket' });
      return;
    }

    const key = url.slice(publicBaseUrl.length + 1); // e.g. "uploads/timestamp-name.webp"

    const accountId = getRequiredEnv('CLOUDFLARE_R2_ACCOUNT_ID');
    const accessKeyId = getRequiredEnv('CLOUDFLARE_R2_ACCESS_KEY_ID');
    const secretAccessKey = getRequiredEnv('CLOUDFLARE_R2_SECRET_ACCESS_KEY');
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');

    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });

    await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));

    res.status(200).json({ ok: true, key });
  } catch (error: any) {
    console.error('delete-image error:', error);
    res.status(500).json({ error: error?.message || 'Delete failed' });
  }
}
