# Ready2Go

LINEと連携し、予定・天気・ごみ収集日をまとめて確認／通知できるスマホ向けWebアプリです。

## 主な機能

- 今日の予定・天気・次のごみをまとめるホーム画面
- 月表示／7日表示カレンダー、繰り返し予定
- 都道府県・市区町村・地区を住所から設定
- 自治体公式情報に基づくごみ収集日と分別検索
- ユーザー別の複数通知時刻、一時停止、前日通知、テスト通知
- オフライン保存、再接続後の同期、JSONエクスポート
- PWA、スマホ向け下部ナビ、ダークモード、文字サイズ変更
- 位置情報とLINE連携の同意画面

## ローカル起動

Node.js 18以上で実行します。

```bash
npm ci
cp .env.example .env
npm start
```

ブラウザで `http://localhost:3000` を開きます。LINE連携機能にはLINE Developersの設定が必要です。

## 公開

RenderとLINE公式アカウントへの詳しい設定は [DEPLOY-RENDER-LINE.md](DEPLOY-RENDER-LINE.md) を上から順に進めてください。`render.yaml` も同梱しています。

## データベース

- `DATABASE_URL`あり: PostgreSQLへ保存
- `DATABASE_URL`なし: 開発用の`data.json`へ保存
- PostgreSQLへの初回接続時、既存の`data.json`があれば自動的に取り込みます。
- `/health`の`storage`が`postgresql`ならDB接続中、`file`ならファイル保存です。

接続方法と注意点は [DATABASE-SETUP.md](DATABASE-SETUP.md) を確認してください。

## 大切な注意

- `.env`、チャネルシークレット、アクセストークン、APIキーはGitHubへ登録しないでください。
- `DATABASE_URL`を設定するとPostgreSQLへ保存し、未設定時は開発用の`data.json`へ保存します。
- ごみ収集日や祝日変更は自治体公式ページでも確認してください。
- プライバシーポリシーと利用規約はひな型です。公開者名・問い合わせ窓口・実際の運用に合わせて確認・修正してください。
