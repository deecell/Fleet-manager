import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs/promises";
import path from "path";

const AWS_REGION = process.env.AWS_REGION || "us-east-2";
const bucketName = process.env.S3_BUCKET_NAME || "deecell-fleet-files";

// Only pass explicit credentials when both env vars are present (typical for
// local dev). In production ECS Fargate, leaving `credentials` undefined lets
// the AWS SDK v3 default provider chain pick up the task IAM role
// automatically. Passing `accessKeyId: ""` here was causing "non-empty Access
// Key (AKID) must be provided in the credential" errors in prod.
const hasExplicitCreds =
  !!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY;

/**
 * Local dev fallback. Production always sets S3_BUCKET_NAME (ECS task env),
 * so this only activates when it's absent — which also means there's no
 * real bucket to fall back to (the hardcoded `bucketName` default above was
 * never provisioned). Rather than every upload failing with NoSuchBucket,
 * write to disk and serve back through the `/local-uploads/*` route
 * registered in routes.ts.
 */
export const useLocalFileMock = !process.env.S3_BUCKET_NAME;
export const LOCAL_UPLOADS_DIR = path.join(process.cwd(), ".local-uploads");

if (useLocalFileMock) {
  console.warn(
    `[s3] S3_BUCKET_NAME not set — storing uploads on disk at ${LOCAL_UPLOADS_DIR} ` +
    "instead of real S3, served via /local-uploads/<key>. Set S3_BUCKET_NAME to use real S3.",
  );
}

const s3Client = useLocalFileMock
  ? null
  : new S3Client({
      region: AWS_REGION,
      ...(hasExplicitCreds
        ? {
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
          }
        : {}),
    });

export async function uploadFile(key: string, body: Buffer, contentType: string): Promise<string> {
  if (useLocalFileMock) {
    const filePath = path.join(LOCAL_UPLOADS_DIR, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);
    return `/local-uploads/${key}`;
  }

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  await s3Client!.send(command);
  return `https://${bucketName}.s3.${AWS_REGION}.amazonaws.com/${key}`;
}

export async function getFileUrl(key: string, expiresIn: number = 3600): Promise<string> {
  if (useLocalFileMock) {
    return `/local-uploads/${key}`;
  }

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  return await getSignedUrl(s3Client!, command, { expiresIn });
}

export async function deleteFile(key: string): Promise<void> {
  if (useLocalFileMock) {
    await fs.rm(path.join(LOCAL_UPLOADS_DIR, key), { force: true });
    return;
  }

  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  await s3Client!.send(command);
}

export async function listFiles(prefix?: string): Promise<string[]> {
  if (useLocalFileMock) {
    const root = prefix ? path.join(LOCAL_UPLOADS_DIR, prefix) : LOCAL_UPLOADS_DIR;
    const keys: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else keys.push(path.relative(LOCAL_UPLOADS_DIR, full));
      }
    };
    await walk(root);
    return keys;
  }

  const command = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: prefix,
  });

  const response = await s3Client!.send(command);
  return response.Contents?.map((item) => item.Key || "") || [];
}

export async function getUploadPresignedUrl(key: string, contentType: string, expiresIn: number = 3600): Promise<string> {
  if (useLocalFileMock) {
    // No real presigned PUT exists for local disk. The only local consumer
    // that matters (the export job worker) uses uploadFile()/getFileUrl()
    // above, not this direct-upload path.
    return `/local-uploads/${key}`;
  }

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
  });

  return await getSignedUrl(s3Client!, command, { expiresIn });
}

export { s3Client, bucketName };
