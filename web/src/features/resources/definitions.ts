import { type I18n } from '@/i18n'
import {
  adminCreateSchema,
  adminUpdateSchema,
  cameraSchema,
  deviceSchema,
  zoneSchema,
} from '../../../shared/schemas'
import { type ResourceDef } from './resource-page'

const datetime = (v: unknown, _: unknown, { lang }: I18n) =>
  v ? new Date(String(v)).toLocaleString(lang) : '—'

export const resources = {
  admins: {
    key: 'admins',
    title: 'nav.admins',
    item: 'field.admin',
    description: 'admins.desc',
    fields: [
      { name: 'email', label: 'field.email' },
      { name: 'name', label: 'field.name' },
      {
        name: 'password',
        label: 'field.password',
        type: 'password',
        description: 'admins.passwordHint',
      },
    ],
    createSchema: adminCreateSchema,
    updateSchema: adminUpdateSchema,
    columns: [
      { key: 'email', title: 'field.email' },
      { key: 'name', title: 'field.name' },
      { key: 'created_at', title: 'field.createdAt', format: datetime },
    ],
  },
  devices: {
    key: 'devices',
    title: 'nav.devices',
    item: 'field.device',
    description: 'devices.desc',
    fields: [
      { name: 'id', label: 'field.id', placeholder: 'pi1', immutable: true },
      {
        name: 'name',
        label: 'field.name',
        placeholder: 'devices.namePlaceholder',
      },
    ],
    createSchema: deviceSchema,
    columns: [
      { key: 'id', title: 'field.id' },
      { key: 'name', title: 'field.name' },
      { key: 'last_seen_at', title: 'field.lastSeen', format: datetime },
      { key: 'created_at', title: 'field.createdAt', format: datetime },
    ],
    tokenRotation: true,
  },
  cameras: {
    key: 'cameras',
    title: 'nav.cameras',
    item: 'field.camera',
    description: 'cameras.desc',
    fields: [
      { name: 'id', label: 'field.id', placeholder: 'cam1', immutable: true },
      {
        name: 'device_id',
        label: 'field.device',
        type: 'select',
        optionsFrom: 'devices',
      },
      {
        name: 'device_path',
        label: 'field.devicePath',
        placeholder: '/dev/video0',
      },
      { name: 'fps', label: 'field.fps', type: 'number' },
      { name: 'width', label: 'field.width', type: 'number' },
      { name: 'height', label: 'field.height', type: 'number' },
    ],
    createSchema: cameraSchema,
    defaults: { device_path: '/dev/video0', fps: 1, width: 1920, height: 1080 },
    columns: [
      { key: 'id', title: 'field.id' },
      { key: 'device_id', title: 'field.device' },
      { key: 'device_path', title: 'field.devicePath' },
      { key: 'fps', title: 'field.fps' },
      {
        key: 'resolution',
        title: 'field.resolution',
        format: (_, r) => `${r.width}×${r.height}`,
      },
    ],
  },
  zones: {
    key: 'zones',
    title: 'nav.zones',
    item: 'field.zone',
    description: 'zones.desc',
    fields: [
      { name: 'id', label: 'field.id', placeholder: 'zone_A', immutable: true },
      {
        name: 'camera_id',
        label: 'field.camera',
        type: 'select',
        optionsFrom: 'cameras',
      },
      {
        name: 'description',
        label: 'field.description',
        placeholder: 'zones.descPlaceholder',
      },
      {
        name: 'vertices',
        label: 'field.vertices',
        type: 'json',
        placeholder: '[[100, 100], [600, 80], [620, 350], [80, 370]]',
        description: 'zones.verticesHint',
      },
      {
        name: 'seats',
        label: 'field.seats',
        type: 'json',
        placeholder: '[["A01", "A02"], ["A03", "A04"]]',
        description: 'zones.seatsHint',
      },
    ],
    createSchema: zoneSchema,
    columns: [
      { key: 'id', title: 'field.id' },
      { key: 'camera_id', title: 'field.camera' },
      { key: 'description', title: 'field.description' },
      {
        key: 'seats',
        title: 'field.tablesSeats',
        format: (v, _, { t }) => {
          const tables = v as string[][]
          return t('zones.count', {
            tables: tables.length,
            seats: tables.flat().length,
          })
        },
      },
    ],
  },
} satisfies Record<string, ResourceDef>
