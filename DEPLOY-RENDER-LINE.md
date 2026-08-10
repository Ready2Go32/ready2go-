# Render・LINE公式アカウント 公開手順

この順番で進めます。最初はテスト用のLINE公式アカウントで確認するのがおすすめです。

## 1. GitHubへアップロード

1. GitHubで空のリポジトリを作成します。
2. このフォルダの中身をリポジトリ直下へアップロードします。
3. `.env`、`node_modules`、`data.json` はアップロードしません（`.gitignore`で除外済みです）。

ZIPそのものではなく、ZIPを展開した中身をアップロードしてください。

## 2. LINE Developersで2つのチャネルを作成

1. LINE Developersコンソールでプロバイダーを作成します。
2. 同じプロバイダー内にMessaging APIチャネル（LINE公式アカウント）を作成します。
3. 同じプロバイダー内にLINE Loginチャネルを作成します。

同じ利用者を正しく識別するため、Messaging APIとLINE Loginは必ず同じプロバイダーに置きます。

控える値:

- Messaging APIの `Channel secret`
- Messaging APIの長期 `Channel access token`
- LINE Loginの `Channel ID`

これらは公開しないでください。

## 3. Renderへ最初のデプロイ

1. Renderで「New」→「Blueprint」を選び、GitHubリポジトリを接続します。
2. `render.yaml` が読み込まれたことを確認します。
3. 環境変数を次のように入力します。

| キー | 入れる値 |
|---|---|
| `APP_URL` | 最初は空でも可。公開URL決定後に設定 |
| `LIFF_ID` | 最初は空で可 |
| `LINE_CHANNEL_SECRET` | Messaging APIのChannel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | Messaging APIの長期Channel access token |
| `LINE_LOGIN_CHANNEL_ID` | LINE LoginのChannel ID |
| `ANTHROPIC_API_KEY` | ごみ検索を使う場合のみ設定 |

4. デプロイを実行し、`https://○○.onrender.com/health` が `{"ok":true,...}` を返すことを確認します。
5. Renderの公開URLを `APP_URL` に設定します。末尾に `/` は付けません。

`render.yaml` は予定データ保持用に `/var/data` の永続ディスクを設定しています。永続ディスクを使えるRenderプランが必要です。ディスクを付けない場合、再デプロイでサーバー側データが消える可能性があります。

## 4. LIFFアプリを作成

LINE LoginチャネルのLIFF設定で追加します。

- Endpoint URL: `https://○○.onrender.com/liff-init.html`
- Size: `Full`
- Scope: `openid` と `profile`

作成後のLIFF IDをRenderの `LIFF_ID` に設定し、再デプロイします。アプリを開くURLは `https://liff.line.me/LIFF_ID` です。

## 5. Messaging APIのWebhook設定

Messaging API設定で次を行います。

1. Webhook URLに `https://○○.onrender.com/webhook` を設定します。
2. 「検証」を押して成功を確認します。
3. 「Webhookの利用」をオンにします。
4. 応答メッセージが二重になる場合は、LINE公式アカウント側の標準応答をオフにします。

## 6. リッチメニューから開く

LINE Official Account Managerでリッチメニューを作ります。

1. メニュー画像とタップ領域を設定します。
2. アクションは「リンク」を選びます。
3. URLに `https://liff.line.me/LIFF_ID` を入れます。
4. リッチメニューを公開します。

友だち追加したテスト利用者で、メニュー→同意画面→予定登録→LINEテスト通知の順に確認します。

## 7. 公開前チェック

- LINEログインできる
- 予定を登録し、再読み込み後も残る
- 都道府県・市区町村・地区を設定できる
- LINEテスト通知が届く
- 通知時刻・一時停止・前日通知が動く
- プライバシーポリシーと利用規約の公開者情報を実運用に合わせた
- 自治体公式ページへのリンクと注意表示を確認した
- Renderログに秘密情報を自分で出力していない

## よくある原因

- `Invalid signature`: Channel secretがMessaging APIチャネルと一致していません。
- LINEログイン後に401: `LINE_LOGIN_CHANNEL_ID`またはLIFFの所属チャネルが違います。
- LIFF初期化エラー: `LIFF_ID`未設定、またはEndpoint URLが違います。
- 通知が届かない: 友だち追加、アクセストークン、通知設定、一時停止期限を確認します。
- 再デプロイで予定が消える: 永続ディスクと`DATA_DIR=/var/data`を確認します。

