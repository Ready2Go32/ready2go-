# Ready2Go：最初に読むファイル

このフォルダは、アプリ本体の実装と自動検査が済んだ公開準備版です。秘密情報は入っていません。

## 最短の進め方

1. このフォルダの中身をGitHubリポジトリ直下へアップロードします。
2. RenderでBlueprintを作り、`render.yaml`を読み込ませます。
3. Renderの入力画面でLINE・LIFF・PostgreSQL・公開者情報の値を設定します。
4. デプロイ後、`https://あなたのURL/health`を開きます。
5. `ready:true`かつ`storage:postgresql`ならサーバー設定は正常です。
6. LINE DevelopersでLIFF URLとWebhook URLを設定し、実機テストを行います。

入力する値と画面ごとの操作は、`DEPLOY-RENDER-LINE.md`に順番どおり記載しています。

## 既存のReady2Goを更新する場合

- GitHub上のアプリファイルをこの版へ置き換えます。
- Renderに登録済みの秘密情報や`DATABASE_URL`は削除しません。
- 同じPostgreSQLへ接続すれば、既存の予定と設定を引き継げます。
- デプロイ後は古いPWAキャッシュを避けるため、アプリを完全に閉じて開き直します。

## 料金に関する注意

`render.yaml`は最初の確認用としてFreeプランを指定しています。Free Web Serviceは停止中に定時通知を実行できません。通知を本番運用する場合だけ、Renderの現在の料金と条件を保護者または管理者と確認してから、常時稼働プランへ変更してください。

