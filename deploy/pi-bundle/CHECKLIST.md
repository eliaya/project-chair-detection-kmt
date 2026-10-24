# Pi オフライン導入チェックリスト

ネット接続のない Pi に、Docker・main.py・モデルを入れて起動するまでの手順です。
このフォルダ（`kmt-pi-bundle/`）は開発PCで `python3 scripts/build_pi_bundle.py` を実行して作ります。

- 対象: Raspberry Pi 4 / 5、**Raspberry Pi OS Lite 64-bit（Debian 13 trixie）**、USB カメラ 1 台（`/dev/video0`）
- 運用時（座席状態の送信）には Worker へのネット接続が必要です。未接続の間の結果は Pi に貯めて、つながった後に再送します。

## フォルダの中身

| パス | 内容 |
| --- | --- |
| `pi_initial.sh` | 導入スクリプト（このフォルダから実行するとオフラインで動作） |
| `CHECKLIST.md` | このファイル |
| `VERSION` | 元のコミット、Docker・依存パッケージ・wheel の版 |
| `SHA256SUMS` | 全ファイルのチェックサム |
| `debs/` | Docker CE・Compose plugin・whiptail と依存パッケージ（arm64 .deb）、apt 用 `Packages` |
| `images/` | ベースイメージ `python:3.13-slim-trixie`（`docker load` 形式） |
| `app/` | main.py ほか、`models/`（YOLO26n NCNN）、`wheels/`（numpy・OpenCV・ncnn） |

## A. 開発PC（ネット接続あり）

- [ ] `models/yolo26n_ncnn_model/model.ncnn.param` がある（なければ `./scripts/export_model.sh`）
- [ ] 入れたい変更がコミット済み（パッケージは git HEAD から作る。未コミットの変更は警告が出る）
- [ ] `python3 scripts/build_pi_bundle.py` → `dist/kmt-pi-bundle/`（約 290 MB）
- [ ] `dist/kmt-pi-bundle/` をフォルダごと USB メモリ等にコピー

## B. 管理画面（ネット接続のある PC。Pi の設置前でよい）

- [ ] 「デバイス」に Pi を登録し、表示されたトークンを控える（再表示されない）
- [ ] 「カメラ」を登録（デバイス、デバイスパス `/dev/video0`、解像度）
- [ ] 設定 URL を控える: `https://<worker>/api/config`
- 「ゾーン」（座席）は F で Pi のカメラ画像を撮ってから設定する

## C. Pi 本体

- [ ] SD カード 8 GB 以上（推奨 16 GB。導入後の使用量は OS を含め推定約 4.5 GB）
- [ ] Raspberry Pi Imager で **Raspberry Pi OS Lite (64-bit)** を書き込み、ユーザー名・SSH を設定
- [ ] `cat /etc/os-release` → `ID=debian`、`VERSION_CODENAME=trixie`
- [ ] `dpkg --print-architecture` → `arm64`
- [ ] USB カメラを接続し、`ls /dev/video*` で認識を確認（番号は管理画面「カメラ」のデバイスパスと合わせる。カメラがなくてもコンテナは起動し、接続後に自動で読み始める）
- [ ] `date` で時刻を確認。大きくずれていれば `sudo date -s '2026-10-23 10:00'`（オフラインでは NTP で合わない。ずれたままだと接続時に HTTPS の証明書検証に失敗する）

## D. インストール

- [ ] フォルダを Pi にコピー（例: `cp -r /media/<user>/<USB名>/kmt-pi-bundle ~/`）。**パスに空白を含めない**
- [ ] `cd ~/kmt-pi-bundle && sha256sum -c --quiet SHA256SUMS` → 何も表示されなければ OK
- [ ] `sudo bash pi_initial.sh` を実行し、画面の質問に答える
  - インストール先（既定 `/data/docker/apps/kmt-occupancy`）
  - 設定 URL とデバイストークン（空欄で進め、後で `/etc/kmt-occupancy.env` に書いてもよい）
  - 旧方式（venv + systemd）の `kmt-occupancy.service` があれば停止
  - docker グループに入れるアカウント（実行したユーザーは選択済み。`docker compose` を sudo なしで使える。root と同等の権限）
- [ ] いったんログアウトして再ログイン（docker グループを反映。`id -nG` に `docker` が出れば OK）
- [ ] 最後に `Started:` が出る。出ない場合は `WARN: Not started; missing:` に不足項目が出る → 対処して
      `cd /data/docker/apps/kmt-occupancy && docker compose up -d`

## E. 動作確認（ネット接続後）

以下は `/data/docker/apps/kmt-occupancy` で実行します。

- [ ] `docker compose ps` → `Up`
- [ ] `docker compose logs -f` → `[heartbeat]` が 30 秒ごとに出る（`[config] ... 取得失敗` が出たら URL・トークン・ネットを確認）
- [ ] 管理画面「デバイス」で接続中になる
- [ ] 同じ LAN の PC から `http://<Pi の IP>:8080` でローカル表示が開く
- [ ] `sudo reboot` 後も自動で起動している（`docker compose ps`）
- `/etc/kmt-occupancy.env` を直したら `docker compose up -d`（restart では読み直さない）

## F. 座席（ゾーン）の設定

- [ ] `docker compose stop`（カメラを空ける）
- [ ] カメラ画像を保存（解像度は B で登録した値）:
      `docker compose run --rm -v "$PWD:/out" occupancy python /app/draw_zones.py --snapshot /out/cam1.jpg --width 1920 --height 1080`
- [ ] `cam1.jpg` を PC にコピー（例: `scp <user>@<pi>:/data/docker/apps/kmt-occupancy/cam1.jpg .`）
- [ ] 管理画面「ゾーン」→ 追加 / 編集 →「卓と座席」で `cam1.jpg` を選び、座席の角をクリック → 座席を確定 → 保存
- [ ] `docker compose up -d`（main.py は起動時に設定を読む）

## G. 更新

- [ ] 開発PCで新しいパッケージを作り（A）、Pi にコピーして `sudo bash pi_initial.sh`
- [ ] 「上書きしますか」→ Yes。`/etc/kmt-occupancy.env` とコンテナのデータ（未送信キュー）は残る
