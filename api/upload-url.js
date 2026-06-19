const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.S3_BUCKET;

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).end();
    const body = req.body || {};
    const filename = body.filename || body.name;
    const contentType = body.contentType || "application/pdf";
    if (!filename) return res.status(400).json({ error: "filename required" });
    if (!BUCKET || !REGION) return res.status(500).json({ error: "S3 not configured" });

    const s3 = new S3Client({ region: REGION });
    const key = `uploads/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${filename.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
    const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType });
    const url = await getSignedUrl(s3, cmd, { expiresIn: 900 }); // 15 minutes
    return res.status(200).json({ url, key });
  } catch (err) {
    console.error('/api/upload-url error', err && err.message);
    res.status(500).json({ error: err.message });
  }
};
