// Request schemas shared by the Worker (validation) and the admin UI (forms).
// Custom messages are i18n keys (src/i18n); zod's own messages follow z.config.
import { z } from 'zod'

const id = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,32}$/, 'validation.idFormat')
const name = z.string().trim().max(64)
const email = z.email().trim().toLowerCase()
// Half-width only: an IME left on in a terminal silently produces full-width text.
const password = z
  .string()
  .min(8, 'validation.passwordMin')
  .max(128)
  .regex(/^[\x21-\x7E]+$/, 'validation.passwordCharset')

export const seatStatuses = [
  'empty',
  'confirming',
  'occupied',
  'leave_confirm',
] as const
export type SeatStatus = (typeof seatStatuses)[number]

export const adminCreateSchema = z.object({ email, name, password })
export const siteNameSchema = z.object({
  site_name: name.min(1, 'validation.siteNameRequired'),
})
// First admin from the web setup wizard; setup_code must match the SETUP_TOKEN secret.
export const setupSchema = adminCreateSchema.extend({
  setup_code: z.string().min(1, 'validation.setupCodeRequired').max(256),
  ...siteNameSchema.shape,
})
// Empty password on update keeps the current one.
export const adminUpdateSchema = adminCreateSchema.extend({
  password: z.union([z.literal(''), password]).optional(),
})

export const deviceSchema = z.object({ id, name })

// A third-party program calling /api/v1/*.
export const apiKeySchema = z.object({ name: name.min(1) })

export const cameraSchema = z.object({
  id,
  device_id: id,
  // main.py parses the camera index out of this path.
  device_path: z.string().regex(/^\/dev\/video\d+$/, 'validation.devicePath'),
  fps: z.number().int().min(1).max(30),
  width: z.number().int().min(160).max(7680),
  height: z.number().int().min(120).max(4320),
})

// A seat is taken when a person's lower-body point falls in its polygon
// (camera image pixels, drawn in the zone form or with draw_zones.py).
const seat = z.object({
  name: z.string().trim().min(1).max(16),
  vertices: z
    .array(z.tuple([z.number(), z.number()]))
    .min(3, 'validation.verticesMin')
    .max(32),
})

export const zoneSchema = z.object({
  id,
  camera_id: id,
  description: z.string().trim().max(200),
  // One array per table; main.py reports seat j of table i as "<zone id>_t<ii>_s<jj>".
  seats: z.array(z.array(seat).min(1).max(16)).min(1).max(100),
})

export const thresholdsSchema = z.object({
  confidence: z.number().min(0).max(1),
  confirm_frames: z.number().int().min(1).max(60),
  leave_grace_s: z.number().min(0).max(3600),
  staff_aspect_ratio: z.number().min(0).max(10),
  staff_speed_px: z.number().min(0).max(10000),
})

// Restaurant floor plan in the blueprint3d serialized form (lengths in cm).
// Textures are not kept and items must be built-in shapes, so a stored plan
// never makes a browser fetch an outside URL.
const cm = z.number().finite().min(-100_000).max(100_000)
const uuid = z.string().max(64)
export const floorplanSchema = z.object({
  floorplan: z.object({
    corners: z
      .record(uuid, z.object({ x: cm, y: cm }))
      .refine((c) => Object.keys(c).length <= 500),
    walls: z.array(z.object({ corner1: uuid, corner2: uuid })).max(500),
  }),
  items: z
    .array(
      z.object({
        item_name: z.string().max(100),
        item_type: z.number().int().min(0).max(9),
        model_url: z.string().regex(/^proc:[a-z0-9]{1,32}$/),
        xpos: cm,
        ypos: cm,
        zpos: cm,
        rotation: z.number().finite(),
        scale_x: z.number().finite().min(0.01).max(100),
        scale_y: z.number().finite().min(0.01).max(100),
        scale_z: z.number().finite().min(0.01).max(100),
        fixed: z.boolean(),
        resizable: z.boolean().optional(),
        // Seat ("<zone>_t<ii>_s<jj>") or table ("<zone>_t<ii>") the item stands for.
        seat: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,32}_t\d{2}(_s\d{2})?$/)
          .optional(),
      })
    )
    .max(1000),
})

const cameraHealthStatuses =['ok', 'open_failed', 'read_failed'] as const

// Sent by main.py with each heartbeat.
const healthSchema = z
  .object({
    version: z.string().max(32),
    queue: z.number().int().min(0),
    infer_ms: z.number().min(0),
    cameras: z
      .record(z.string().max(64), z.enum(cameraHealthStatuses))
      .refine((c) => Object.keys(c).length <= 16),
  })
  .partial()
export type Health = z.infer<typeof healthSchema>

// Body POSTed by main.py CloudSync; extra per-seat fields are ignored.
export const occupancyPayloadSchema = z.object({
  timestamp: z.string().max(64).optional(),
  occupancy: z
    .record(z.string().max(64), z.object({ status: z.enum(seatStatuses) }))
    .refine((o) => Object.keys(o).length <= 500, 'too many seats'),
  // Malformed health is dropped rather than rejecting the seat updates with it.
  health: healthSchema.optional().catch(undefined),
})

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
})

export const idsSchema = z.object({
  ids: z.array(z.number().int()).min(1).max(1000),
})
