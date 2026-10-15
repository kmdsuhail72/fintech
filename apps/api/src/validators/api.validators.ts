import { z } from 'zod';

const uuid = z.string().uuid();
const page = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();
const currency = z.string().regex(/^[A-Z]{3}$/);
const decimal = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/)
  .refine((value) => {
    const [whole, fraction = ''] = value.split('.');
    return whole!.length <= 12 && fraction.length <= 8;
  }, 'Value exceeds the supported decimal precision');

export const profileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).nullable().optional(),
    locale: z.string().trim().min(2).max(12).optional(),
    timeZone: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const marketSearchSchema = page
  .extend({
    q: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
export const marketSnapshotsSchema = z
  .object({
    symbols: z
      .string()
      .min(1)
      .max(600)
      .transform((value) => value.split(',').map((symbol) => symbol.trim().toUpperCase()))
      .refine(
        (symbols) =>
          symbols.length <= 50 && symbols.every((symbol) => /^[A-Z0-9.^_-]{1,24}$/.test(symbol)),
        'Provide up to 50 valid ticker symbols',
      ),
  })
  .strict();
export const symbolPathSchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .min(1)
      .max(24)
      .regex(/^[A-Za-z0-9.^_-]+$/),
  })
  .strict();
export const newsSearchSchema = marketSearchSchema;
export const watchlistPathSchema = z.object({ watchlistId: uuid }).strict();
export const symbolIdPathSchema = z.object({ symbolId: uuid }).strict();
export const watchlistItemPathSchema = z.object({ watchlistId: uuid, symbolId: uuid }).strict();
export const notificationPathSchema = z.object({ notificationId: uuid }).strict();
export const orderPathSchema = z.object({ orderId: uuid }).strict();
export const alertPathSchema = z.object({ alertId: uuid }).strict();
export const pageQuerySchema = page;
export const sentimentQuerySchema = page
  .extend({
    symbol: z
      .string()
      .trim()
      .min(1)
      .max(24)
      .regex(/^[A-Za-z0-9.^_-]+$/)
      .optional(),
  })
  .strict();

export const createWatchlistSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
  })
  .strict();
export const renameWatchlistSchema = createWatchlistSchema;
export const addWatchlistItemSchema = z.object({ symbolId: uuid }).strict();
export const submitOrderSchema = z
  .object({
    portfolioId: uuid.optional(),
    symbolId: uuid,
    side: z.enum(['BUY', 'SELL']),
    quantity: decimal.refine((value) => Number(value) > 0, 'Quantity must be positive'),
    idempotencyKey: z
      .string()
      .trim()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
  })
  .strict();
export const createAlertSchema = z
  .object({
    symbolId: uuid,
    condition: z.enum(['ABOVE', 'BELOW', 'CHANGE_PERCENT']),
    targetPrice: decimal
      .refine((value) => Number(value) > 0, 'Target price must be positive')
      .optional(),
    targetChangePercent: decimal
      .refine(
        (value) => Number(value) > 0 && Number(value) <= 1000,
        'Percent must be between 0 and 1000',
      )
      .optional(),
    currency,
    channels: z
      .array(z.enum(['IN_APP', 'EMAIL', 'PUSH']))
      .min(1)
      .max(3)
      .default(['IN_APP'])
      .refine(
        (channels) => channels.includes('IN_APP') && new Set(channels).size === channels.length,
        'Choose unique channels including IN_APP',
      ),
  })
  .strict()
  .refine(
    (value) =>
      value.condition === 'CHANGE_PERCENT'
        ? value.targetChangePercent !== undefined && value.targetPrice === undefined
        : value.targetPrice !== undefined && value.targetChangePercent === undefined,
    'Provide the correct threshold for the condition',
  );
export const alertStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']),
  })
  .strict();
export const adminSymbolSchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .min(1)
      .max(24)
      .regex(/^[A-Za-z0-9.^_-]+$/),
    exchangeCode: z.string().trim().min(1).max(16),
    companyName: z.string().trim().min(1).max(160),
    assetType: z.string().trim().min(1).max(24).default('EQUITY'),
    quoteCurrency: currency,
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable()
      .optional(),
    dataProvider: z.string().trim().min(1).max(80),
    providerSymbol: z.string().trim().min(1).max(80),
  })
  .strict();
export const adminQuoteSchema = z
  .object({
    price: z
      .string()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/)
      .refine((v) => Number(v) > 0),
    open: z
      .string()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/)
      .refine((v) => Number(v) > 0),
    high: z
      .string()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/)
      .refine((v) => Number(v) > 0),
    low: z
      .string()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/)
      .refine((v) => Number(v) > 0),
    previousClose: z
      .string()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/)
      .refine((v) => Number(v) > 0),
    change: z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,8})?$/),
    changePercent: z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,8})?$/),
    volume: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    currency,
    quoteStatus: z.literal('SIMULATED'),
    source: z.literal('synthetic-simulator'),
    timestamp: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (quote) =>
      Number(quote.high) >= Math.max(Number(quote.open), Number(quote.low), Number(quote.price)) &&
      Number(quote.low) <= Math.min(Number(quote.open), Number(quote.high), Number(quote.price)),
    'Quote OHLC values are inconsistent',
  )
  .refine(
    (quote) =>
      Math.abs(Number(quote.change) - (Number(quote.price) - Number(quote.previousClose))) < 1e-7,
    'Quote change must match price and previous close',
  );

export type PageInput = z.infer<typeof page>;

export const candleQuerySchema = z
  .object({
    interval: z.enum(['1m', '5m', '15m', '1h', '1d']).default('5m'),
    limit: z.coerce.number().int().min(1).max(2000).default(100),
  })
  .strict();

export const pushDeviceSchema = z
  .object({
    installationId: uuid,
    token: z
      .string()
      .max(256)
      .regex(/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/),
    platform: z.enum(['ios', 'android']),
  })
  .strict();
export const pushDevicePathSchema = z.object({ installationId: uuid }).strict();

export const researchAssistantSchema = z
  .object({
    question: z.string().trim().min(3).max(2000),
    symbols: z
      .array(
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z0-9.^_-]{1,24}$/),
      )
      .max(4)
      .refine((values) => new Set(values).size === values.length, 'Provide unique symbols')
      .default([]),
    interval: z.enum(['1m', '5m', '15m', '1h', '1d']).default('1d'),
    include_portfolio: z.boolean().nullable().optional(),
    include_documents: z.boolean().default(false),
    document_ids: z.array(z.string().uuid()).max(20).default([]),
  })
  .strict();
