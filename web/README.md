# テーブル稼働監視 管理画面（web/）

[shadcn-admin](https://github.com/satnaing/shadcn-admin)（MIT, v2.2.1）をベースにした管理画面と、
同じ Cloudflare Worker で動く API です。映像は扱わず、`main.py` が送る数値データだけを保存します。

| パス               | 内容                                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`             | 管理画面（ダッシュボード、履歴、ゾーン/カメラ/デバイス/閾値/サイト名/管理者の設定）と、ログイン不要の公開ボード `/portal`（空きテーブル・空席・利用中の席を大きく表示）                  |
| `worker/`          | API `/api/*`（管理者ログイン、CRUD、Pi 向けの `GET /api/config`・`POST /api/occupancy`、公開ボード向けの集計 `GET /api/public/occupancy`）                                               |
| `shared/`          | 画面と API で共有する入力チェック（`schemas.ts`、zod）と座席の集計ルール（`occupancy.ts`）                                                                                               |
| `src/i18n/`        | 画面の文言（English・日本語・繁體中文・简体中文）。ヘッダーの言語メニューで切り替え、初回はブラウザの言語に合わせます。`en.ts` に追加したキーは他の 3 言語にも必要です（ないと型エラー） |
| `migrations/`      | D1 スキーマ                                                                                                                                                                              |
| `scripts/smoke.ts` | API の端から端までのテスト                                                                                                                                                               |

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

お試しデータ（サイト名、デバイス `pi1`、`config.json` のカメラとゾーン、約 100 席のランダムな平面図）は、
`./dev.sh --seed` で入れます（ローカル D1 にデバイス・カメラ・ゾーン・平面図がひとつでもあれば何もしません）。
入れ直すときは `web/` で `-- --force`（同じ ID のデータを上書き。セットアップで決めたサイト名はそのまま）:

```sh
./dev.sh --reset --seed     # まっさらな状態 + お試しデータ
npm run seed -- --force     # 既存のデータに上書き
```

デバイスのトークンは捨てているので、Pi をつなぐときは「デバイス」で「トークン再発行」してください。

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

リポジトリ直下のファイルを使います（`main.py`、`draw_zones.py`、`scripts/`、`deploy/`）。

1. **開発PC**: 人物検出モデル（YOLO26n）を NCNN 形式に変換します（PyTorch を使うため Pi では行いません）。

   ```sh
   ./scripts/export_model.sh          # → models/yolo26n_ncnn_model/
   ```

2. **Pi**（Raspberry Pi OS Lite）: リポジトリを取得してセットアップし、開発PCからモデルをコピーします。
   リポジトリは private なので、Pi の公開鍵（`ssh-keygen -t ed25519` で作成）を GitHub の
   Settings → Deploy keys に読み取り専用で登録しておきます。

   ```sh
   git clone git@github.com:eliottom/project-chair-detection.git && cd project-chair-detection
   ./scripts/install_pi.sh            # venv・依存パッケージ・systemd（自動起動・自動再起動）・NTP
   # 開発PCで: scp -r models <user>@<pi>:~/project-chair-detection/
   ```

3. 管理画面の「デバイス」で Pi を登録し、表示された API トークンを控えます（再表示できません。紛失時は
   「トークン再発行」）。続けて「カメラ」を登録します。
4. **座席を描く**: Pi でカメラ画像を保存し、開発PCで座席ごとに多角形を描きます。

   ```sh
   # Pi
   .venv/bin/python draw_zones.py --snapshot cam1.jpg --device /dev/video0
   # 開発PC（opencv-python が必要）
   scp <user>@<pi>:~/project-chair-detection/cam1.jpg . && python3 draw_zones.py --image cam1.jpg --prefix A
   ```

   クリックで頂点、Enter で座席を確定、`t` で次の卓、`s` で保存します。出力の `seats` を「ゾーン」の
   「卓と座席」に貼り付けます。座席は人物枠の下 1/3 の中心点が入る範囲（座面〜足元）を囲みます。

5. **起動**: `/etc/kmt-occupancy.env` に `API_TOKEN` と `CONFIG_URL=https://<worker のドメイン>/api/config` を書き、
   `sudo systemctl restart kmt-occupancy`（ログ: `journalctl -u kmt-occupancy -f`）。
   管理画面の「デバイス」で状態が「オンライン」になれば接続完了です（トークン発行時のダイアログも自動で
   「接続しました」に変わります）。「カメラ異常」なら「カメラ」画面で原因（開けません／映像を取得できません）を
   確認します。そのカメラの座席はダッシュボードで「不明」になります。カメラを追加したら main.py を再起動します。

設定は起動時に取得してキャッシュし（`config.cache.json`）、取得できないときはキャッシュ、なければ `config.json`
を使います。送信できなかった状態変化は `queue.db` に保存し、復旧後に古い順に再送します。設定変更は
`sudo systemctl restart kmt-occupancy` で反映されます。更新は `git pull` 後に同じく再起動します。

カメラなしの動作確認: `python3 main.py --mock --duration 60`（http://localhost:8080 に座席の状態を表示）。

## 無料枠について

- Workers は 100,000 リクエスト/日、D1 は書き込み 100,000 行/日。`main.py` は状態変化時と 30 秒ごとの
  ハートビートだけ送信し、ダッシュボードと公開ボード `/portal` は 5 秒ごとに更新します（1 画面を開きっぱなしで約 17,000 リクエスト/日）。
  公開ボードはログイン不要のため、レート制限はありません。
- 無料プランの CPU 時間は 1 リクエスト 10ms。ログイン（PBKDF2 10 万回）はこれに近いため、デプロイ後に
  Workers Logs で CPU 時間を確認してください。
- 90 秒以上通信のないデバイスの卓は「不明」と表示します。
