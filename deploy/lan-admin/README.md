# 管理画面の LAN 版（Cloudflare を使わない）

Cloudflare 版と同じ管理画面・API（ライブ映像を含む）を、店内 LAN のサーバー 1 台で動かします。
Worker のコードを workerd（`wrangler dev` のローカルモード）で実行し、D1 とライブ映像の Durable Object は
SQLite としてボリューム `data` に保存します。インターネット接続は不要です（イメージのビルド時を除く）。

- 対象: Docker と Compose plugin が入った LAN 内の PC・NAS・Raspberry Pi（amd64 / arm64）
- Pi は、このサーバーへ設定の取得・座席状態の送信・ライブ映像の送信を行います（Pi からの外向き接続のみ）

## 起動

```sh
cd deploy/lan-admin
docker compose up -d --build
docker compose logs admin | grep "setup code"
```

1. ブラウザで `http://<サーバーの IP>:8787` を開き、表示されたセットアップ画面でログの setup code を入力して最初の管理者を作る
2. 「デバイス」で Pi を登録してトークンを控え、「カメラ」「ゾーン」を設定する
3. Pi の `http://<Pi の IP>:8080/setup` で、設定 URL に `http://<サーバーの IP>:8787/api/config`、デバイストークンを入力
4. 「カメラ」→ 操作 →「ライブ映像」で映像が出れば完了

## 更新・バックアップ

- 更新: `git pull && docker compose up -d --build`（起動時に D1 のマイグレーションを適用）
- データ: ボリューム `lan-admin_data`（D1、Durable Object、`session_secret`、`setup_code`）。消すと管理者・設定・履歴がすべて消える

## 制限

- http のみ: ログインのパスワード、デバイストークン、映像は LAN 内を暗号化せずに流れる
- `wrangler dev` は開発用のランタイムで、Cloudflare 上のような可用性・監視はない
- ログイン試行の制限（5 回/分）は、全端末で 1 つの枠を共有する（接続元 IP を区別しない）
- Cloudflare 版とはデータを共有しない（別のシステムとして動く）
