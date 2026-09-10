import { GetObjectCommand, PutObjectCommand, S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

const client = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }
});

export async function putPrivateObject(key: string, content: Buffer): Promise<void> {
  await client.send(new PutObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: key,
    Body: content,
    ContentType: "application/pdf",
    ServerSideEncryption: "AES256"
  }));
}

export async function getPrivateObject(key: string): Promise<Buffer> {
  const result = await client.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
  if (!result.Body) throw new Error("Stored document has no body");
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function createPrivateDownloadUrl(key: string): Promise<string> {
  return getSignedUrl(client, new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), { expiresIn: 60 });
}

export async function deletePrivateObject(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
}
