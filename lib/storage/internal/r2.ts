import {S3Client, PutObjectCommand} from '@aws-sdk/client-s3';
import {randomUUID} from 'node:crypto';
import {ImageUploader} from '../../notion/client';
import mime from 'mime-types';

export interface R2Config {
  bucket: string;
  endpoint: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
}

export const makeR2Uploader = (cfg: R2Config): ImageUploader => {
  const s3 = new S3Client({
    region: cfg.region ?? 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });

  return async ({data, sourceUrl}) => {
    const filename = sourceUrl.split('/').pop()?.split('?')[0];
    const contentType =
      mime.lookup(filename || '') || 'application/octet-stream';

    const ext = mime.extension(contentType) || 'bin';
    const key = `${randomUUID()}.${ext}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: Buffer.from(data),
        ContentType: contentType,
        ACL: 'public-read',
      }),
    );
    console.log('url', `${cfg.publicUrl.replace(/\/$/, '')}/${key}`);

    return `${cfg.publicUrl.replace(/\/$/, '')}/${key}`;
  };
};
