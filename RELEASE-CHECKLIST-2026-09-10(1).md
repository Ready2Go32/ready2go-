# Ready2Go 9月10日公開チェックリスト

## コード側（完了）

- [x] ホーム・予定・天気・ごみ・設定の5画面
- [x] 予定、繰り返し予定、持ち物チェック
- [x] 詳細天気、主要花粉、UV、風速目安、暑さの参考案内
- [x] LINEログイン、複数時刻通知、前日通知、30分前通知、テスト通知
- [x] 通知履歴、失敗時の再試行、手動再送
- [x] 町田市地区1の公式ごみ日程（2027年9月まで）
- [x] オフライン保存、再同期、バックアップ保存／復元
- [x] 招待テスト、改善報告、グループ共有・退出・削除
- [x] アカウントと保存データの削除
- [x] PWA、スマホ下部メニュー、設定画面の余白
- [x] API入力検査、回数制限、セキュリティヘッダー
- [x] 公開ファイルの許可リスト化（保存データ・サーバー内部ファイルは非公開）
- [x] 自動テストとサーバー起動テスト

## 9月10日にサーバーで行うこと

- [ ] ZIPの中身をGitHubのリポジトリ直下へ置く
- [ ] Render Blueprintで`render.yaml`を読み込む
- [ ] 長期保存用PostgreSQLの`DATABASE_URL`を設定する
- [ ] `DEPLOY-RENDER-LINE.md`の環境変数をすべて入れる
- [ ] `/health`で`ready:true`、`storage:postgresql`を確認する
- [ ] LIFF Endpoint URLを`/liff-init.html`へ設定する
- [ ] LINE LoginチャネルをPublishedにする
- [ ] Messaging APIのWebhookを`/webhook`へ設定する
- [ ] 通知本番用に常時稼働するWeb Serviceを選ぶ
- [ ] 自分以外のテスターでログイン、予定保存、LINE通知を確認する

詳しい操作は`DEPLOY-RENDER-LINE.md`を上から順に進めてください。
