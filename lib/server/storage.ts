import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { requiredEnv } from './secrets';
let client: S3Client | undefined;
function storage() {
  return (client ??= new S3Client({
    endpoint: requiredEnv('S3_ENDPOINT'),
    region: process.env.S3_REGION || 'auto',
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('S3_SECRET_ACCESS_KEY'),
    },
  }));
}
export async function putArtifact(key: string, body: Uint8Array, mediaType: string) {
  await storage().send(
    new PutObjectCommand({ Bucket: requiredEnv('S3_BUCKET'), Key: key, Body: body, ContentType: mediaType }),
  );
}
export async function getArtifact(key: string) {
  return storage().send(new GetObjectCommand({ Bucket: requiredEnv('S3_BUCKET'), Key: key }));
}
