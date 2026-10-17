// Request schemas shared by the Worker (validation) and the admin UI (forms).
import { z } from 'zod'

// Japanese validation messages in both the API responses and the forms.
z.config(z.locales.ja())

const id = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,32}$/, '英数字・_・- のみ、32文字以内')
const name = z.string().trim().max(64)
const email = z.email().trim().toLowerCase()
// Half-width only: an IME left on in a terminal silently produces full-width text.
const password = z
  .string()
  .min(8, '8文字以上')
  .max(128)
  .regex(/^[\x21-\x7E]+$/, '半角英数字・記号のみ（全角・空白は不可）')

export const seatStatuses = [
  'empty',
  'confirming',
  'occupied',
  'leave_confirm',
] as const
export type SeatStatus = (typeof seatStatuses)[number]

export const adminCreateSchema = z.object({ email, name, password })
// Empty password on update keeps the current one.
export const adminUpdateSchema = adminCreateSchema.extend({
  password: z.union([z.literal(''), password]).optional(),
})

export const deviceSchema = z.object({ id, name })

export const cameraSchema = z.object({
  id,
  device_id: id,
  // main.py parses the camera index out of this path.
  device_path: z.string().regex(/^\/dev\/video\d+$/, '/dev/videoN 形式'),
  fps: z.number().int().min(1).max(30),
  width: z.number().int().min(160).max(7680),
  height: z.number().int().min(120).max(4320),
})

export const zoneSchema = z.object({
  id,
  camera_id: id,
  description: z.string().trim().max(200),
  vertices: z
    .array(z.tuple([z.number(), z.number()]))
    .min(3, '3点以上')
    .max(64),
  seats: z
    .array(z.array(z.string().trim().min(1).max(16)).min(1).max(16))
    .min(1)
    .max(100),
})

export const thresholdsSchema = z.object({
  confidence: z.number().min(0).max(1),
  confirm_frames: z.number().int().min(1).max(60),
  leave_grace_s: z.number().min(0).max(3600),
  staff_aspect_ratio: z.number().min(0).max(10),
  staff_speed_px: z.number().min(0).max(10000),
})

// Body POSTed by main.py CloudSync; extra per-seat fields are ignored.
export const occupancyPayloadSchema = z.object({
  timestamp: z.string().max(64).optional(),
  occupancy: z
    .record(z.string().max(64), z.object({ status: z.enum(seatStatuses) }))
    .refine((o) => Object.keys(o).length <= 500, 'too many seats'),
})

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
})

export const idsSchema = z.object({
  ids: z.array(z.number().int()).min(1).max(1000),
})
