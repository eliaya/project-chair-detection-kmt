# テーブル稼働監視（KMT FaceDetection）

店内のカメラ映像から、座席とテーブルの利用状況をリアルタイムに把握するシステムです。
Raspberry Pi 上の `main.py` が人物を検出して座席ごとの状態を判定し、数値データだけを Cloudflare Workers に送ります。
映像は Pi の外に出ません。

## 構成

```
USB カメラ → Raspberry Pi（main.py） ──数値データ──▶ Cloudflare Worker + D1（web/）
              YOLO26n (NCNN)                          ├─ 管理画面  /admin
              ByteTrack                               ├─ 公開ボード /
              座席ごとの状態判定                       └─ 外部連携 API /api/v1
```

## 仕組み（main.py）

1. USB カメラのフレームを取得します（既定は 1 fps、1920×1080）。
2. YOLO26n（NCNN 形式）で人物を検出し、ByteTrack で追跡します。
3. 人物枠の下部の点が、座席の多角形に入っているかで座席を判定します。
   立っている人（縦長の枠）や速く動く人（スタッフ・通行人）は座席に数えません。
4. 座席ごとに状態機械で判定します: `empty`（空席）→ `confirming`（確認中）→ `occupied`（利用中）→ `leave_confirm`（離席確認中）。
   連続 3 フレームで利用中、10 秒の離席猶予で空席に戻ります。
5. 状態変化と 30 秒ごとのハートビートを Worker に送ります。送れなかったものは `queue.db` に保存し、復旧後に古い順に再送します。
6. カメラが開けない・映像が取れないときは、そのカメラの座席を「不明」として報告します。

設定（カメラ、ゾーン、座席の多角形、閾値）は Worker の `GET /api/config` から取得してキャッシュします（`config.cache.json`）。
取得できないときはキャッシュ、なければ `config.json` を使います。

## 主なファイル

| パス                         | 内容                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `main.py`                    | Pi 側のメインプログラム（検出・追跡・状態判定・送信）                          |
| `utils.py`                   | 設定の読み込み、点の多角形内判定、枠の下端中心                                 |
| `draw_zones.py`              | カメラ画像の保存（`--snapshot`）。座席の多角形は管理画面「ゾーン」でその画像の上に描いて保存 |
| `config.json`                | 管理画面から設定を取得できないときのフォールバック                             |
| `scripts/`                   | モデル変換（`export_model.sh`）、Pi のセットアップ（Docker: `pi_initial.sh`／venv + systemd: `install_pi.sh`）、開発用の起動 |
| `Dockerfile`, `compose.yaml` | Pi で main.py を Docker コンテナとして動かす（`pi_initial.sh` 単体を Pi にコピーして `sudo bash pi_initial.sh`：Docker CE・Compose・git の導入、リポジトリの clone、モデルの書き出し、ビルド・起動） |
| `deploy/`                    | systemd ユニット（Pi の自動起動・自動再起動）、オフライン導入チェックリスト（`pi-bundle/CHECKLIST.md`） |
| `scripts/build_pi_bundle.py` | Pi のオフライン導入パッケージ（Docker・ベースイメージ・wheel・モデル・アプリ）を `dist/kmt-pi-bundle/` に作成 |
| `web/`                       | 管理画面と API（Cloudflare Workers + D1）。詳細は [web/README.md](web/README.md) |
| `docs/`                      | 研究計画                                                                       |
| `archived/`                  | 過去の実験コード（メイク除去など）                                             |
| `CHANGELOG.md`               | 変更履歴                                                                       |

## 画面と API

- **公開ボード `/`**（ログイン不要）: カメラごとの座席状態、2D 平面図、空きテーブル・空席・利用中の座席の数。5 秒ごとに更新します。
- **管理画面 `/admin`**: ダッシュボード、履歴、ゾーン・カメラ・デバイス・閾値・平面図・API キー・管理者の設定。画面は English・日本語・繁體中文・简体中文に対応します。
- **外部連携 API `/api/v1`**: 座席・テーブルの利用期間（`/history`）と進行中の状態（`/current`）を、API キーで取得できます。仕様は `/api/v1/openapi.json`（OpenAPI 3.1）です。

## 動作確認

カメラなしで、模擬フレームによる動作を確認できます。

```sh
python3 main.py --mock --duration 60    # http://localhost:8080 に座席の状態を表示
```

## 関連ドキュメント

- [web/README.md](web/README.md): 管理画面・API・Pi 連携・外部連携 API の詳細
- [CHANGELOG.md](CHANGELOG.md): 変更履歴
