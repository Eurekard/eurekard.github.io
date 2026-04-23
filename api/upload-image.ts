import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function safeJsonParse(body: unknown): any {
  if (typeof body === 'string') {
    return JSON.parse(body);
  }
  return body;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = safeJsonParse(req.body);
    const fileName = typeof body?.fileName === 'string' ? body.fileName : '';
    const contentType = typeof body?.contentType === 'string' ? body.contentType : '';
    const dataBase64 = typeof body?.dataBase64 === 'string' ? body.dataBase64 : '';

    if (!fileName || !contentType || !dataBase64) {
      res.status(400).json({ error: 'Missing required upload payload' });
      return;
    }

    if (!['image/avif', 'image/webp'].includes(contentType)) {
      res.status(400).json({ error: 'Only AVIF/WebP uploads are allowed' });
      return;
    }

    const imageBuffer = Buffer.from(dataBase64, 'base64');
    if (imageBuffer.byteLength <= 0 || imageBuffer.byteLength > MAX_UPLOAD_BYTES) {
      res.status(413).json({ error: 'Compressed file is too large' });
      return;
    }

    const accountId = getRequiredEnv('CLOUDFLARE_R2_ACCOUNT_ID');
    const accessKeyId = getRequiredEnv('CLOUDFLARE_R2_ACCESS_KEY_ID');
    const secretAccessKey = getRequiredEnv('CLOUDFLARE_R2_SECRET_ACCESS_KEY');
    const bucketName = getRequiredEnv('CLOUDFLARE_R2_BUCKET_NAME');
    const publicBaseUrl = getRequiredEnv('CLOUDFLARE_R2_PUBLIC_BASE_URL').replace(/\/$/, '');

    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const extension = contentType === 'image/avif' ? 'avif' : 'webp';
    const key = `uploads/${Date.now()}-${sanitizeFileName(fileName)}.${extension}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: imageBuffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );

    res.status(200).json({
      url: `${publicBaseUrl}/${key}`,
      key,
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error?.message || 'Upload failed' });
  }
}
