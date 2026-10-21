import { createElement } from 'react'
import { type I18n } from '@/i18n'
import {
  adminCreateSchema,
  adminUpdateSchema,
  apiKeySchema,
  cameraSchema,
  deviceSchema,
  type Health,
  zoneSchema,
} from '../../../shared/schemas'
import {
  CameraBadge,
  type CameraStatus,
  DeviceBadge,
  type DeviceStatus,
} from './connection'
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
      {
        key: 'status',
        title: 'field.status',
        format: (v, _, { t }) => t(`deviceStatus.${v as DeviceStatus}`),
        cell: (r) =>
          createElement(DeviceBadge, { status: r.status as DeviceStatus }),
      },
      {
        key: 'health',
        title: 'field.health',
        format: (v, _, { t }) => {
          const h = v as Health | null
          return h?.version
            ? t('devices.healthDetail', {
                version: h.version,
                ms: h.infer_ms ?? '—',
                queue: h.queue ?? '—',
              })
            : '—'
        },
      },
      { key: 'last_seen_at', title: 'field.lastSeen', format: datetime },
      { key: 'created_at', title: 'field.createdAt', format: datetime },
    ],
    tokenRotation: true,
    refetchInterval: 5000,
  },
  apiKeys: {
    key: 'api_keys',
    title: 'nav.apiKeys',
    item: 'field.apiKey',
    description: 'apiKeys.desc',
    fields: [
      {
        name: 'name',
        label: 'field.name',
        placeholder: 'apiKeys.namePlaceholder',
      },
    ],
    createSchema: apiKeySchema,
    columns: [
      { key: 'id', title: 'field.id' },
      { key: 'name', title: 'field.name' },
      { key: 'created_at', title: 'field.createdAt', format: datetime },
    ],
    tokenRotation: true,
    tokenDesc: 'apiKeys.tokenDesc',
    rotateDesc: 'apiKeys.rotateDesc',
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
      {
        key: 'status',
        title: 'field.status',
        format: (v, _, { t }) => t(`cameraStatus.${v as CameraStatus}`),
        cell: (r) =>
          createElement(CameraBadge, { status: r.status as CameraStatus }),
      },
    ],
    refetchInterval: 5000,
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
        name: 'seats',
        label: 'field.seats',
        type: 'json',
        placeholder:
          '[[{"name": "A01", "vertices": [[100, 300], [300, 300], [300, 500], [100, 500]]}]]',
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
          const tables = v as unknown[][]
          return t('zones.count', {
            tables: tables.length,
            seats: tables.flat().length,
          })
        },
      },
    ],
  },
} satisfies Record<string, ResourceDef>
