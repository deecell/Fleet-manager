import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const AWS_REGION = process.env.AWS_REGION || "us-east-2";
const bucketName = process.env.S3_BUCKET_NAME || "deecell-fleet-files";

// Only pass explicit credentials when both env vars are present (typical for
// local dev). In production ECS Fargate, leaving `credentials` undefined lets
// the AWS SDK v3 default provider chain pick up the task IAM role
// automatically. Passing `accessKeyId: ""` here was causing "non-empty Access
// Key (AKID) must be provided in the credential" errors in prod.
const hasExplicitCreds =
  !!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY;

const s3Client = new S3Client({
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
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  await s3Client.send(command);
  return `https://${bucketName}.s3.${AWS_REGION}.amazonaws.com/${key}`;
}

export async function getFileUrl(key: string, expiresIn: number = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
}

export async function deleteFile(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  await s3Client.send(command);
}

export async function listFiles(prefix?: string): Promise<string[]> {
  const command = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: prefix,
  });

  const response = await s3Client.send(command);
  return response.Contents?.map((item) => item.Key || "") || [];
}

export async function getUploadPresignedUrl(key: string, contentType: string, expiresIn: number = 3600): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
}

export { s3Client, bucketName };
