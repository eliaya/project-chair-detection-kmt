// GET /api/v1/openapi.json, generated from the zod schemas that validate and shape /api/v1,
// so client generators (openapi-generator, Postman, Swagger UI) follow the code.
import { z } from 'zod'
import { historyKinds, historyQuerySchema } from '../shared/history'
import { seatStatuses } from '../shared/schemas'

const time = z.string().describe('ISO 8601 (UTC)')
const seconds = z.number().describe('秒')

const historyPage = z.object({
  items: z.array(
    z.object({
      id: z.number().int(),
      kind: z.enum(historyKinds),
      target: z.string().describe('座席 ID またはテーブル ID'),
      started_at: time,
      ended_at: time,
      duration_s: seconds,
    })
  ),
  next_after: z
    .number()
    .int()
    .nullable()
    .describe('続きがあれば次の after に渡す id、なければ null'),
})

const live = z
  .boolean()
  .describe('カメラが正常に稼働中。false の間は状態が古い可能性がある')
const current = z.object({
  now: time,
  seats: z.array(
    z.object({
      seat_id: z.string(),
      status: z.enum(seatStatuses),
      used: z.boolean().describe('occupied / leave_confirm なら true（利用中）'),
      since: time.nullable().describe('現在の利用中／空席の期間の開始'),
      duration_s: seconds.nullable(),
      live,
    })
  ),
  tables: z.array(
    z.object({
      table_id: z.string(),
      empty: z.boolean().describe('全座席が空席'),
      since: time,
      duration_s: seconds,
      live,
    })
  ),
})

const jsonSchema = (s: z.ZodType) => {
  const { $schema: _, ...rest } = z.toJSONSchema(s, { io: 'input' })
  return rest
}
const ok = (s: z.ZodType) => ({
  200: { description: 'OK', content: { 'application/json': { schema: jsonSchema(s) } } },
  401: { description: 'API キーがない、または無効' },
})

export const openapi = (origin: string) => ({
  openapi: '3.1.0',
  info: {
    title: 'テーブル稼働監視 History API',
    version: '1',
    description:
      '座席・テーブルの利用／空席の履歴と現在の状態。API キーは管理画面の「API キー」で発行し、Authorization: Bearer <キー> で送る。',
  },
  servers: [{ url: `${origin}/api/v1` }],
  security: [{ apiKey: [] }],
  components: {
    securitySchemes: { apiKey: { type: 'http', scheme: 'bearer' } },
  },
  paths: {
    '/history': {
      get: {
        summary: '終了した期間（利用中の座席、空席、空きテーブル）',
        parameters: Object.entries(
          jsonSchema(historyQuerySchema).properties as Record<string, object>
        ).map(([name, schema]) => ({ name, in: 'query', schema })),
        responses: {
          ...ok(historyPage),
          400: { description: 'クエリが不正' },
        },
      },
    },
    '/current': {
      get: {
        summary: '進行中の期間（座席・テーブルごとの現在の状態と経過時間）',
        responses: ok(current),
      },
    },
  },
})
