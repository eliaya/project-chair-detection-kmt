import {
  adminCreateSchema,
  adminUpdateSchema,
  cameraSchema,
  deviceSchema,
  zoneSchema,
} from '../../../shared/schemas'
import { type ResourceDef } from './resource-page'

const datetime = (v: unknown) =>
  v ? new Date(String(v)).toLocaleString('ja-JP') : '—'

export const resources = {
  admins: {
    key: 'admins',
    title: '管理者',
    description: 'この管理画面にログインできるアカウントです。',
    fields: [
      { name: 'email', label: 'メールアドレス' },
      { name: 'name', label: '名前' },
      {
        name: 'password',
        label: 'パスワード',
        type: 'password',
        description: '8文字以上。編集時に空欄なら変更しません。',
      },
    ],
    createSchema: adminCreateSchema,
    updateSchema: adminUpdateSchema,
    columns: [
      { key: 'email', title: 'メールアドレス' },
      { key: 'name', title: '名前' },
      { key: 'created_at', title: '作成日時', format: datetime },
    ],
  },
  devices: {
    key: 'devices',
    title: 'デバイス',
    description:
      'Raspberry Pi などのエッジ端末です。作成時に API トークンを発行します。',
    fields: [
      { name: 'id', label: 'ID', placeholder: 'pi1', immutable: true },
      { name: 'name', label: '名前', placeholder: '店舗A 入口側' },
    ],
    createSchema: deviceSchema,
    columns: [
      { key: 'id', title: 'ID' },
      { key: 'name', title: '名前' },
      { key: 'last_seen_at', title: '最終通信', format: datetime },
      { key: 'created_at', title: '作成日時', format: datetime },
    ],
    tokenRotation: true,
  },
  cameras: {
    key: 'cameras',
    title: 'カメラ',
    description: '各デバイスに接続された USB カメラです。',
    fields: [
      { name: 'id', label: 'ID', placeholder: 'cam1', immutable: true },
      {
        name: 'device_id',
        label: 'デバイス',
        type: 'select',
        optionsFrom: 'devices',
      },
      {
        name: 'device_path',
        label: 'デバイスパス',
        placeholder: '/dev/video0',
      },
      { name: 'fps', label: 'FPS', type: 'number' },
      { name: 'width', label: '幅 (px)', type: 'number' },
      { name: 'height', label: '高さ (px)', type: 'number' },
    ],
    createSchema: cameraSchema,
    defaults: { device_path: '/dev/video0', fps: 1, width: 1920, height: 1080 },
    columns: [
      { key: 'id', title: 'ID' },
      { key: 'device_id', title: 'デバイス' },
      { key: 'device_path', title: 'デバイスパス' },
      { key: 'fps', title: 'FPS' },
      {
        key: 'resolution',
        title: '解像度',
        format: (_, r) => `${r.width}×${r.height}`,
      },
    ],
  },
  zones: {
    key: 'zones',
    title: 'ゾーン',
    description: 'カメラ画像上の座席区域（多角形）と、その中の卓・座席です。',
    fields: [
      { name: 'id', label: 'ID', placeholder: 'zone_A', immutable: true },
      {
        name: 'camera_id',
        label: 'カメラ',
        type: 'select',
        optionsFrom: 'cameras',
      },
      {
        name: 'description',
        label: '説明',
        placeholder: '2人席（向かい合わせ）× 4テーブル',
      },
      {
        name: 'vertices',
        label: '頂点 [x, y]',
        type: 'json',
        placeholder: '[[100, 100], [600, 80], [620, 350], [80, 370]]',
        description: 'カメラ画像のピクセル座標。3点以上。',
      },
      {
        name: 'seats',
        label: '卓と座席',
        type: 'json',
        placeholder: '[["A01", "A02"], ["A03", "A04"]]',
        description:
          '1卓 = 座席名の配列。main.py は i 番目の卓を「ゾーンID_s0i」として送信します。',
      },
    ],
    createSchema: zoneSchema,
    columns: [
      { key: 'id', title: 'ID' },
      { key: 'camera_id', title: 'カメラ' },
      { key: 'description', title: '説明' },
      {
        key: 'seats',
        title: '卓 / 座席',
        format: (v) => {
          const tables = v as string[][]
          return `${tables.length}卓 / ${tables.flat().length}席`
        },
      },
    ],
  },
} satisfies Record<string, ResourceDef>
