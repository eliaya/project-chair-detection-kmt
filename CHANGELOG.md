# 変更履歴

## v0.3.0 (2026-10-24)

- 管理画面「カメラ」の操作メニューに「ライブ映像」を追加：処理済みのカメラ映像（約 1 秒ごと）に、座席の多角形（赤＝着席、緑＝空席、橙＝確認中）と追跡中の人物枠・追跡 ID を重ねて表示。Pi のアドレスを開く必要はなく、店外からも見られる
- 仕組み：main.py が Worker へ WebSocket を張り（`/api/live`、デバイストークンで認証。Pi からの外向き接続のみ）、Worker の Durable Object `LiveRelay`（デバイスごと）が管理画面へ中継する。見ている人がいるカメラの画像だけを作って送る
- Pi に `websockets==17.2` を追加（`requirements-pi.txt`。オフラインパッケージの wheel にも入る）
- `wrangler.jsonc` に Durable Object（`LIVE` / `LiveRelay`）を追加。D1 のマイグレーションは不要
- ログイン Cookie の `Secure` を、https でアクセスしたときだけ付けるように変更（http の LAN 版でログインできるように）
- 管理画面の LAN 版を追加（`deploy/lan-admin/`）：Cloudflare を使わず、同じ管理画面・API・ライブ映像を店内 LAN のサーバーで Docker（workerd）により動かす

## v0.2.0 (2026-10-24)

- Pi の設定（`API_TOKEN`・`CONFIG_URL`）を、ローカル表示の設定ページ `http://<Pi の IP>:8080/setup` で入力するように変更。`scripts/pi_initial.sh` は入力を求めず、インストール後すぐにコンテナを起動する
- 保存の前に、入力した URL とトークンで設定を取得できるか確認し、失敗した場合は理由を表示して保存しない。保存後は main.py が終了し、Docker が新しい設定で再起動する
- 未設定の間は設定ページだけを表示し、カメラと検出は動かさない。設定済みの Pi で変更するときは現在のトークンが必要（忘れた場合は `conf/kmt-occupancy.env` を削除してコンテナを再起動）
- `compose.yaml`：`env_file` をやめ、`./conf` を `/conf` にマウント（設定ファイルは main.py が読み書き）
- 管理画面のトークン表示：設定 URL とトークンを別々にコピーできるように変更し、`/setup` への案内に変更。接続しない場合のログ確認を `docker compose logs -f` に変更

## v0.1.0 (2026-10-24)

- 版番号を v0.1.0 から振り直し（内容は v1.7.0 と同じ）。以下の v1.2.0〜v1.7.0 は旧番号の履歴（タグは削除済み、コミットは main に残る）
- GitHub Release に Pi のオフライン導入パッケージ（`kmt-pi-bundle-v0.1.0.tar.gz`）を添付

## v1.7.0 (2026-10-24)

- Pi の設定ファイルを `/etc/kmt-occupancy.env` からアプリのディレクトリ内の `conf/kmt-occupancy.env`（既定 `/data/docker/apps/kmt-occupancy/conf/`）に移動。ホストの `/etc` には何も置かない。`conf/` は git の対象外
- `scripts/pi_initial.sh` を再実行すると、既存の `/etc/kmt-occupancy.env` を `conf/` に移動する（両方ある場合は `conf/` を使い、`/etc` 側の削除を促す）
- `scripts/pi_initial.sh` の再実行時、既存のチェックアウトを `git pull --ff-only` で更新（古い `compose.yaml` の `devices: /dev/video0` が残り、カメラなしで起動できなかった問題の修正）
- `scripts/install_pi.sh`（venv + systemd による導入）と `deploy/kmt-occupancy.service` を削除。Pi の導入は Docker（`pi_initial.sh`）のみ
- 管理画面のトークン表示の案内を新しい設定ファイルの場所と `docker compose up -d` に変更

## v1.6.1 (2026-10-24)

- Pi：`docker compose` を sudo なしで実行できるように変更。`scripts/pi_initial.sh` は実行したアカウントを docker グループの候補として選択済みにし、`/etc/kmt-occupancy.env` を `root:docker 0640` にする（`docker compose` が env_file を自分で読むため）
- 既存の Pi では `sudo usermod -aG docker $USER`、`sudo chgrp docker /etc/kmt-occupancy.env && sudo chmod 640 /etc/kmt-occupancy.env` の後、再ログイン

## v1.6.0 (2026-10-24)

- 管理画面「ゾーン」：カメラ画像の上で座席の角をクリックして多角形を描き、そのまま保存（`draw_zones.py` の JSON を貼り付ける手順は不要）
- Pi の main.py を Docker コンテナで実行（`Dockerfile`、`compose.yaml`）。`scripts/pi_initial.sh` で Docker CE・Compose plugin の導入、アプリの取得、YOLO26n NCNN モデルの書き出し、イメージのビルドと起動まで行う。単体で Pi にコピーして実行でき、既定のインストール先は `/data/docker/apps/kmt-occupancy`
- オフライン導入パッケージ：`python3 scripts/build_pi_bundle.py` で `dist/kmt-pi-bundle/` を作成（.deb・ベースイメージ・wheel・モデル）。手順は `deploy/pi-bundle/CHECKLIST.md`
- カメラが接続されていなくてもコンテナは起動し、後から接続したカメラ（`/dev/video*` のどの番号でも）を自動で読み始める
- `/etc/kmt-occupancy.env` の `CONFIG_URL` が空のときは、Traceback ではなく設定を促すメッセージを出して終了
- `scripts/deploy-prod-append.sh`（既存の D1 に未適用のマイグレーションだけ適用してデプロイ）、`scripts/deploy-prod-fresh.sh`（D1 の全テーブルを削除してからデプロイ）
- README に概要・仕組み・ファイル一覧・画面・API を追加

## v1.5.0 (2026-10-21)

- 外部連携 API（History）：座席の利用中・空席の期間とテーブルが空いていた期間を、Pi からの報告時に D1 の `history` に記録
- `GET /api/v1/history`（終了した期間、種類・座席/テーブル・期間で絞り込み、ページ送り）、`GET /api/v1/current`（進行中の期間と経過秒数、カメラ異常時は `live: false`）。API キーで認証
- `GET /api/v1/openapi.json`：入力チェックと同じ zod スキーマから OpenAPI 3.1 を生成（キー不要）
- 管理画面「API キー」：発行・再発行・削除（DB にはハッシュのみ保存）
- 管理画面を `/admin/*` に移動し、公開ボードを `/portal` から `/` に変更。テンプレートの「表示」設定ページを削除
- 公開ボードの平面図タブを 2D 表示に変更し、ゾーンの枠と空席数を表示。管理画面「平面図」に「ゾーン」タブを追加
- 平面図の椅子・スツールを座席、テーブルをテーブルに対応付けて色分け（緑＝空き、赤＝利用中、灰色＝不明・未設定）
- `GET /api/public/occupancy` に平面図の家具ごとの状態とゾーンごとの集計を追加。`GET /api/public/floorplan` は対応付けをゾーン ID だけにして返す
- デプロイ時は `npm run db:migrate:remote` で `0005_history.sql` を適用

## v1.4.0 (2026-10-21)

- `/portal` を左右分割に変更。左はカメラごとの座席状態（空席・使用中・不明）、右は空きテーブル・空席・使用中座席の大きな数字。映像は表示しない
- `GET /api/public/occupancy` にカメラごとの座席名と状態を追加（ID と座標は返さない）
- `./dev.sh`：ポート指定がなく 5173 が使用中なら、次の空きポートで起動
- `scripts/dev.sh`：本プロジェクト用の起動スクリプト（`./dev.sh` を呼ぶ）

## v1.3.0 (2026-10-21)

- `/portal`：ログイン不要の掲示用画面。空きテーブル・空席・使用中座席を大きな文字で表示し、5 秒ごとに更新
- `GET /api/public/occupancy` は集計値のみ返す（ゾーン・カメラ・端末の ID は返さない）
- 座席の集計規則をダッシュボードと公開 API で共通化（`web/shared/occupancy.ts`）
- `./dev.sh --seed` で空のローカル D1 にサンプルデータを投入

## v1.2.0 (2026-10-19)

- 店舗フロアプラン編集画面（blueprint3d-modern, three.js）：壁は 2D、テーブルと椅子は 3D
- `GET/PUT /api/settings/floorplan`（スキーマ検証付き）
- `npm run seed:floorplan` でランダムなサンプルデータを生成
- Worker でリクエスト本文サイズをストリーミングで制限
