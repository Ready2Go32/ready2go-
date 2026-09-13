# Ready2GoをRender・LINEへ公開する手順

このZIPは、コードをGitHubへ置き、RenderとLINEの値を設定すれば起動できる状態です。秘密情報はZIPに含まれていません。

## 0. 公開前に用意するもの

- GitHubリポジトリ
- RenderのWeb Serviceと、長期保存できるPostgreSQL
- 同じLINE Developersプロバイダー内のMessaging APIチャネルとLINE Loginチャネル
- 公開者名と問い合わせ用メールアドレス

LINEのチャネルシークレット、アクセストークン、データベースURLは、GitHub・チャット・スクリーンショットへ載せないでください。

## 1. GitHubへ置く

1. ZIPを展開します。
2. 展開したフォルダの中身を、GitHubリポジトリの直下へ置きます。
3. `.env`、`node_modules`、`data.json`はアップロードしません。
4. GitHub Actionsを使う場合は、`npm ci && npm run check`を実行するよう設定します。

## 2. RenderでBlueprintを作る

1. Renderで「New」→「Blueprint」を選び、GitHubリポジトリを接続します。
2. リポジトリ直下の`render.yaml`を読み込ませます。
3. PostgreSQLから発行された接続URLを`DATABASE_URL`へ入れます。
4. 次の環境変数を設定します。

`render.yaml`は、意図しない料金が発生しないよう最初は`plan: free`で作成します。初期テスト後、定時通知を本番運用するときだけ、内容と料金を確認して常時稼働プランへ手動で変更してください。

| キー | 値 | 必須 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL接続URL | 公開時は必須 |
| `DATABASE_SSL` | 通常は`true` | 必須 |
| `APP_URL` | `https://○○.onrender.com`（末尾`/`なし） | 必須 |
| `LINE_CHANNEL_SECRET` | Messaging APIのChannel secret | 必須 |
| `LINE_CHANNEL_ACCESS_TOKEN` | Messaging APIの長期Channel access token | 必須 |
| `LINE_LOGIN_CHANNEL_ID` | LINE LoginのChannel ID | 必須 |
| `LIFF_ID` | LIFFアプリ作成後のID | 必須 |
| `OPERATOR_NAME` | プライバシーポリシーに出す公開者名 | 必須 |
| `CONTACT_EMAIL` | 問い合わせ用メール | 必須 |
| `TEST_MODE` | 招待制なら`true`、一般公開なら`false` | 必須 |
| `TEST_INVITE_CODE` | 招待制のときだけ設定 | 条件付き |
| `ANTHROPIC_API_KEY` | 未登録地域のごみ検索を使う場合だけ | 任意 |

最初のデプロイでURLが確定していない場合は、先にWeb Serviceを作り、公開URLが出た後で`APP_URL`を設定して再デプロイします。

## 3. サーバー状態を確認する

ブラウザで次を開きます。

```text
https://○○.onrender.com/health
```

公開準備が完了していれば、次が表示されます。

```json
{
  "ok": true,
  "ready": true,
  "version": "1.0.0",
  "storage": "postgresql",
  "databaseConfigured": true,
  "missingEnvironment": []
}
```

`ready:false`なら、`missingEnvironment`に出た環境変数をRenderへ追加します。`storage:file`のまま公開すると、再起動や再デプロイでデータが消える可能性があります。

## 4. LINE LoginとLIFFを設定する

1. LINE DevelopersでLINE Loginチャネルを開きます。
2. LIFFタブでアプリを追加します。
3. Endpoint URLを`https://○○.onrender.com/liff-init.html`にします。
4. Sizeは`Full`、Scopeは少なくとも`openid`を有効にします。`profile`も選択できます。
5. 発行されたLIFF IDをRenderの`LIFF_ID`へ入れて再デプロイします。
6. 友達など開発者以外にも使ってもらう前に、LINE Loginチャネルを「Published（公開済み）」へ変更します。開発中のままだと開発者権限のない人はログインできません。

アプリを開くURLは次です。

```text
https://liff.line.me/LIFF_ID
```

## 5. Messaging APIのWebhookを設定する

1. Messaging API設定でWebhook URLを`https://○○.onrender.com/webhook`にします。
2. 「検証」を押して成功を確認します。
3. 「Webhookの利用」をオンにします。
4. LINE公式アカウント側の標準応答とReady2Goの応答が重なる場合は、標準応答をオフにします。
5. LINE Official Account Managerのリッチメニューから、上のLIFF URLを開くよう設定します。

## 6. 通知を確実に動かすための重要事項

Ready2Goの通知処理はWeb Service内で1分ごとに動きます。RenderのFree Web Serviceは受信アクセスが15分ないと停止するため、停止中は予定時刻の通知を送れません。通知を本番運用する場合は、Web Serviceを常時稼働する有料インスタンスに変更してください。

PostgreSQLはWeb Serviceとは別に必ず設定します。無料PostgreSQLを使う場合は有効期限とバックアップ条件を確認し、長期運用前に永続プランへ移行してください。

## 7. 招待テストから一般公開へ

最初は次を推奨します。

```text
TEST_MODE=true
TEST_INVITE_CODE=他人が推測しにくい長めの文字列
```

動作確認後、一般公開する場合は`TEST_MODE=false`へ変更します。変更後もLINE LoginチャネルがPublishedになっていることを確認します。

## 8. 公開前の実機チェック

- [ ] `/health`が`ready:true`かつ`storage:postgresql`
- [ ] LINE LoginチャネルがPublished
- [ ] 自分以外のテスターがLIFF URLから開ける
- [ ] ホーム・予定・天気・ごみ・設定の5タブを移動できる
- [ ] 予定を登録し、再読み込み後も残る
- [ ] 忠生1丁目のごみ予定と対応期間（2027年9月まで）が表示される
- [ ] LINEテスト通知が届く
- [ ] 通知時刻、一時停止、前日通知を確認した
- [ ] バックアップを保存し、テスト用データで復元できる
- [ ] プライバシーポリシーの公開者名・問い合わせ先が正しい
- [ ] Renderログへ秘密情報が出ていない
- [ ] Freeではなく常時稼働するインスタンスを通知本番用に選んだ

## 公式資料

- [Renderのデプロイ](https://render.com/docs/deploys)
- [Render Free Web Serviceの制限](https://render.com/docs/free)
- [LINE LIFFアプリの追加](https://developers.line.biz/en/docs/liff/registering-liff-apps/)
