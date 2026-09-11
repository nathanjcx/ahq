import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { equalSecret } from './secrets';
export const inboxPayload = z.object({
  items: z
    .array(
      z.object({
        externalId: z.string().min(1).max(300),
        title: z.string().min(1).max(500),
        preview: z.string().max(5000),
        sourceUrl: z
          .string()
          .url()
          .refine((url) => new URL(url).protocol === 'https:')
          .optional(),
        createdAt: z.number().finite().nonnegative(),
      }),
    )
    .max(100),
  cursor: z.string().max(1000).optional(),
});
export function verifyInboxSignature(
  body: string,
  timestamp: string | null,
  signature: string | null,
  secret: string,
  now = Date.now(),
) {
  if (!timestamp || !signature || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300)
    throw new Error('Invalid or expired webhook signature');
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  if (!equalSecret(signature, expected)) throw new Error('Invalid webhook signature');
}
