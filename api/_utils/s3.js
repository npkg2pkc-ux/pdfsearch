const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.S3_BUCKET;

if (!REGION || !BUCKET) {
  // not fatal at import time — functions will check when called
}

const s3 = new S3Client({ region: REGION });

async function uploadBuffer(key, buffer, contentType) {
  if (!BUCKET) throw new Error("S3_BUCKET not configured");
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType });
  await s3.send(cmd);
  return { bucket: BUCKET, key };
}

function getObjectStream(key) {
  if (!BUCKET) throw new Error("S3_BUCKET not configured");
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return s3.send(cmd);
}

module.exports = { uploadBuffer, getObjectStream };
