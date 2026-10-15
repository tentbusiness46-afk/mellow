// Storage abstraction so the rest of the app doesn't care whether files
// live on local disk (dev/testing) or in Cloudflare R2 (production on Render,
// whose filesystem is wiped on every deploy).
const fs = require('fs');
const path = require('path');
const { nanoid } = require('nanoid');

const STORAGE_MODE = process.env.STORAGE_MODE || 'local';
const LOCAL_UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

if (STORAGE_MODE === 'local' && !fs.existsSync(LOCAL_UPLOAD_DIR)) {
  fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
}

let s3Client = null;
function getS3Client() {
  if (s3Client) return s3Client;
  const { S3Client } = require('@aws-sdk/client-s3');
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return s3Client;
}

/**
 * Save an uploaded file buffer. Returns a storage "key" you should save in the DB
 * (not a public URL - use getFileUrl() to turn a key into something viewable).
 */
async function saveFile(buffer, originalName, folder) {
  const ext = path.extname(originalName || '') || '.jpg';
  const key = `${folder}/${nanoid()}${ext}`;

  if (STORAGE_MODE === 'r2') {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: guessContentType(ext),
      })
    );
    return key;
  }

  // local mode
  const fullPath = path.join(LOCAL_UPLOAD_DIR, key);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, buffer);
  return key;
}

/**
 * Turn a stored key into something the admin dashboard can load in an <img>/<a> tag.
 * Local: a short-lived signed path served by our own authenticated route.
 * R2: a presigned URL straight to Cloudflare, valid for 10 minutes.
 */
async function getFileUrl(key) {
  if (!key) return null;

  if (STORAGE_MODE === 'r2') {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const command = new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key });
    return getSignedUrl(getS3Client(), command, { expiresIn: 600 });
  }

  // local mode: served through /api/admin/files/:key (admin-only, checked in route)
  return `/api/admin/files/${encodeURIComponent(key)}`;
}

function readLocalFile(key) {
  const fullPath = path.join(LOCAL_UPLOAD_DIR, key);
  if (!fullPath.startsWith(LOCAL_UPLOAD_DIR)) throw new Error('Invalid file key');
  return fs.readFileSync(fullPath);
}

function guessContentType(ext) {
  const map = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf', '.webp': 'image/webp' };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

module.exports = { saveFile, getFileUrl, readLocalFile, STORAGE_MODE };
