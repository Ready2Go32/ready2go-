# Ready2Go データベース設定

Ready2Goは標準PostgreSQLへ対応しています。保存先から発行された接続URLを、Render Web Serviceの環境変数`DATABASE_URL`へ設定します。

## 動作方式

- `DATABASE_URL`が設定済み: PostgreSQL
- 未設定: `data.json`（開発用・再デプロイで消える可能性あり）
- 初回DB接続: `ready2go_state`テーブルを自動作成
- 既存`data.json`が存在する場合: 初回だけ自動移行

`https://ready2go-calendar-2026.onrender.com/health`を開き、次なら成功です。

```json
{"ok":true,"users":1,"storage":"postgresql"}
```

## Renderで設定する値

```text
DATABASE_URL=保存先から発行されたPostgreSQL接続URL
DATABASE_SSL=true
```

接続URLはパスワードを含む秘密情報です。GitHub、チャット、スクリーンショットには載せず、RenderのEnvironmentだけへ入力してください。

## 保存先を選ぶときの確認事項

- 無料期間・有効期限
- 自動停止の有無
- バックアップの有無
- 日本またはシンガポールに近いリージョン
- PostgreSQL接続URLを発行できること
- グループの責任者が利用規約と料金条件を確認すること

Render無料PostgreSQLは作成後30日で期限切れになるため、短期テスト用です。正式公開前は、グループの責任者と長期保存できるプランまたはサービスを選んでください。

