# テーブル稼働監視 管理画面（web/）

[shadcn-admin](https://github.com/satnaing/shadcn-admin)（MIT, v2.2.1）をベースにした管理画面と、
同じ Cloudflare Worker で動く API です。映像は扱わず、`main.py` が送る数値データだけを保存します。

| パス                      | 内容                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `src/`                    | 管理画面（ダッシュボード、履歴、ゾーン/カメラ/デバイス/閾値/管理者の CRUD）              |
| `worker/`                 | API `/api/*`（管理者ログイン、CRUD、Pi 向けの `GET /api/config`・`POST /api/occupancy`） |
| `shared/schemas.ts`       | 画面と API で共有する入力チェック（zod）                                                 |
| `migrations/`             | D1 スキーマ                                                                              |
| `scripts/create-admin.ts` | 管理者アカウントの作成（既存のメールならパスワード再設定）                               |
| `scripts/smoke.ts`        | API の端から端までのテスト                                                               |

## ローカル開発

```sh
npm install
cp .dev.vars.example .dev.vars        # SESSION_SECRET と SETUP_TOKEN を長いランダム文字列に変更
npm run db:migrate:local
npm run dev                            # http://localhost:5173
```

管理者がまだいなければ、開いた画面がセットアップウィザード（`/setup`）になります。
SETUP_TOKEN の値で最初の管理者を作成し、続けてデバイス・カメラ・ゾーン・閾値を設定します。
CLI で作る場合は `npm run admin:create -- you@example.com "名前"`（既存のメールならパスワード再設定）。

API テスト（`smoke-*` のデータを作って消します。ログインは 1 分 5 回までなので連続実行は 2 回まで）:

```sh
SMOKE_EMAIL=you@example.com SMOKE_PASSWORD=... npm run smoke
# 任意: SMOKE_SETUP_CODE=<SETUP_TOKEN> で「初期化後は /api/setup が閉じている」ことも確認
```

## デプロイ

```sh
npx wrangler login
npx wrangler d1 create kmt-occupancy
# 表示された database_id を wrangler.jsonc の既存の DB エントリに "database_id" として追記
npm run db:migrate:remote
npm run deploy
npx wrangler secret put SESSION_SECRET      # 値は `openssl rand -hex 32` などで生成
npx wrangler secret put SETUP_TOKEN         # 最初の管理者の作成に使う初期化コード
```

デプロイした URL を開くとセットアップウィザードが表示されます。Setup code（SETUP_TOKEN）を入力して最初の管理者を
作成してください。管理者が 1 人でも存在すると `/api/setup` は閉じます。
CLI で作る場合は `npm run admin:create -- you@example.com "名前" --remote`。

## Raspberry Pi 側

1. セットアップウィザード（またはダッシュボードの「セットアップを開始」）でデバイスを登録し、表示された API トークンを
   控えます（再表示できません。紛失時は「デバイス」画面で「トークン再発行」）。
2. 続けてカメラ・ゾーンを登録します（既存の `config.json` の値をそのまま貼れます）。
3. Pi で起動します。

```sh
export API_TOKEN=<トークン>
python3 main.py --config https://<worker のドメイン>/api/config
```

設定は起動時に取得し、失敗した場合はローカルの `config.json` を使います。送信先は `/api/config` の
`cloud.api_url` で自動設定されます。設定変更は `main.py` の再起動後に反映されます。

## 無料枠について

- Workers は 100,000 リクエスト/日、D1 は書き込み 100,000 行/日。`main.py` は状態変化時と 30 秒ごとの
  ハートビートだけ送信し、ダッシュボードは 5 秒ごとに更新します（開きっぱなしで約 17,000 リクエスト/日）。
- 無料プランの CPU 時間は 1 リクエスト 10ms。ログイン（PBKDF2 10 万回）はこれに近いため、デプロイ後に
  Workers Logs で CPU 時間を確認してください。
- 90 秒以上通信のないデバイスの卓は「不明」と表示します。
