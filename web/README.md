# テーブル稼働監視 管理画面（web/）

[shadcn-admin](https://github.com/satnaing/shadcn-admin)（MIT, v2.2.1）をベースにした管理画面と、
同じ Cloudflare Worker で動く API です。映像は扱わず、`main.py` が送る数値データだけを保存します。

| パス                | 内容                                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`              | 管理画面（ダッシュボード、履歴、ゾーン/カメラ/デバイス/閾値/サイト名/管理者の設定）                                                                                                      |
| `worker/`           | API `/api/*`（管理者ログイン、CRUD、Pi 向けの `GET /api/config`・`POST /api/occupancy`）                                                                                                 |
| `shared/schemas.ts` | 画面と API で共有する入力チェック（zod）                                                                                                                                                 |
| `src/i18n/`         | 画面の文言（English・日本語・繁體中文・简体中文）。ヘッダーの言語メニューで切り替え、初回はブラウザの言語に合わせます。`en.ts` に追加したキーは他の 3 言語にも必要です（ないと型エラー） |
| `migrations/`       | D1 スキーマ                                                                                                                                                                              |
| `scripts/smoke.ts`  | API の端から端までのテスト                                                                                                                                                               |

## ローカル開発

リポジトリ直下で実行します（依存のインストール、`web/.dev.vars` の生成、ローカル D1 のマイグレーション、起動まで行います）。

```sh
./dev.sh            # http://localhost:5173
./dev.sh --reset    # ローカルのデータ（D1・.dev.vars）をすべて削除し、まっさらな状態から起動
```

管理者がまだいなければ、開いた画面がセットアップウィザード（`/setup`）になります。
サイト名と最初の管理者を設定します（Setup code は `web/.dev.vars` の SETUP_TOKEN）。

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

デプロイした URL を開くとセットアップウィザードが表示されます。サイト名と Setup code（SETUP_TOKEN）を入力して
最初の管理者を作成してください。管理者が 1 人でも存在すると `/api/setup` は閉じます。
パスワードを忘れた場合は、他の管理者が「管理者」画面で再設定できます。管理者が 1 人だけの場合は
`npx wrangler d1 execute kmt-occupancy --remote --command "DELETE FROM admins"` で管理者を削除すると、
ウィザードから作り直せます（SETUP_TOKEN が必要。他のデータは残ります）。

## Raspberry Pi 側

1. 「デバイス」画面（またはダッシュボードの「デバイスを登録」）でデバイスを登録し、表示された API トークンを
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
