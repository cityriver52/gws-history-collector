# GWS History Collector

Google Workspace 上に自然に残る「仕事の足跡」を自動収集し、あとから AI が作業内容・関連ファイル・コミュニケーション・会議などを復元できるようにするための Apps Script ベースの履歴収集基盤です。

人間が日報や作業ログを手入力することを前提にしません。画面録画やキーロガーのような強い監視ではなく、Google Workspace の各 API に既に存在するアクティビティ／メタデータを共通イベント形式に正規化して Google Sheets に蓄積します。

## 現在収集するもの

### Google Drive

Drive Activity API v2 を使い、My Drive 配下で発生したアクティビティを取得します。

- 作成 / アップロード / コピー
- 編集
- 移動
- 名前変更
- 削除 / 復元
- 権限変更
- コメント関連
- その他 Drive Activity API が返す ActionDetail
- 対象ファイル／フォルダ名、ID、MIME type
- 実行者（自分／他ユーザー／システムを識別できる範囲）

既定では自分の操作とシステムイベントを中心に保存します。`Config.gs` の `DRIVE_INCLUDE_OTHER_ACTORS` を `true` にすると、他ユーザーが自分の Drive 上のアイテムへ行った操作も保存できます。

### Gmail

Gmail API のメタデータと History API を使います。メール本文は保存しません。

- 受信 / 送信 / 下書き等のメッセージ追加
- 完全削除
- ラベル追加 / 削除
- 件名
- From / To / Cc（設定で縮小可能）
- threadId / messageId
- ラベル
- サイズ

初回は直近 `INITIAL_LOOKBACK_DAYS` 日をバックフィルし、その後は Gmail History ID を使って差分追跡します。

### Google Calendar

ユーザーが参照できる全カレンダーを対象にします。

- 予定の開始（作業タイムライン用）
- 予定作成
- 予定更新
- 予定キャンセル
- 件名、開始・終了、場所
- 主催者
- 参加人数
- Meet URL の有無

予定の説明本文は保存しません。

### Google Chat

ユーザーが参加している Space / Group Chat / DM を列挙し、Space Events API で次のイベントを追跡します。

- メッセージ作成 / 更新 / 削除
- リアクション追加 / 削除
- メンバーシップ作成 / 更新 / 削除
- Space 更新
- バッチイベントも展開

**既定では Chat 本文を保存しません。** Space 名、メッセージ ID、スレッド ID、送信者リソース、添付数などのメタデータだけを保存します。必要な場合だけ `STORE_CHAT_TEXT` を `true` にしてください。

Chat の Space Events API は過去 28 日まで取得できるため、Space 数が多い環境では複数回の実行に分けて巡回します。

## 出力

`setup()` を初回実行すると `GWS History Collector` というスプレッドシートを My Drive に作成します。

### Events

すべてのサービスを同じ列に正規化します。

| column | meaning |
|---|---|
| event_id | 重複排除用の決定的 ID |
| event_time | 実際のイベント時刻 |
| source | drive / gmail / calendar / chat |
| action | edit / message_added / event_started 等 |
| actor | 実行者 |
| object_type | file / email / calendar_event / chat_message 等 |
| object_id | API 上の ID |
| object_name | ファイル名、件名、予定名など |
| container_id | thread / calendar / space 等 |
| container_name | コンテナ表示名 |
| url | 復帰に使える URL（作れる場合） |
| direction | inbound / outbound 等 |
| details_json | 本文を除いた追加メタデータ |
| collected_at | collector が取得した時刻 |

### Status

各 Collector の最終実行時刻・結果・件数を記録します。

### Errors

API エラーを記録します。1サービスが失敗しても、ほかの Collector は継続します。

## セットアップ

1. Apps Script のスタンドアロンプロジェクトを作成します。
2. このリポジトリの `.gs` と `appsscript.json` を配置します（clasp を使っても構いません）。
3. Apps Script プロジェクトを **標準 Google Cloud プロジェクト** に関連付けます。
4. Google Cloud 側で以下を有効化します。
   - Google Drive Activity API
   - Gmail API
   - Google Calendar API
   - Google Chat API
5. `setup()` を手動実行し、OAuth 権限を承認します。
6. 作成されたスプレッドシートを確認します。
7. `collectAll()` を一度手動実行します。

`setup()` は既定で 10 分おきの `collectAll` トリガーも作成します。重複トリガーは削除してから作り直します。

## OAuth scopes

`appsscript.json` では読み取り中心の scope を明示しています。Chat / Gmail / Drive Activity は Workspace 管理者側の OAuth アプリ制御によって拒否される場合があります。その場合は `Errors` シートに 401 / 403 が残ります。

職場環境では、管理者ポリシーを回避する実装にはしないでください。利用できないサービスだけ無効化し、許可された API の範囲で運用できます。

## 最初に調整する設定

`Config.gs` を編集します。

```javascript
INITIAL_LOOKBACK_DAYS: 7,
TRIGGER_MINUTES: 10,
DRIVE_INCLUDE_OTHER_ACTORS: false,
STORE_GMAIL_COUNTERPARTIES: true,
STORE_CALENDAR_ATTENDEES: false,
STORE_CHAT_TEXT: false,
CHAT_SPACES_PER_RUN: 25,
```

データを広く取りたい場合でも、まず `STORE_CHAT_TEXT: false` のまま運用することを推奨します。本文まで複製すると、Collector のスプレッドシート自体が新しい機密情報集約庫になります。

## 手動実行関数

- `setup()` — 初期化とトリガー作成
- `collectAll()` — 全サービス
- `collectDrive()`
- `collectGmail()`
- `collectCalendar()`
- `collectChat()`
- `resetState()` — 差分カーソルを全消去（次回バックフィル）
- `removeTriggers()` — Collector の定期トリガーを削除

## 設計上の注意

このログは「仕事そのもの」ではなく、デジタル上に観測できた足跡です。電話、窓口、紙資料、口頭相談、思考時間などは原理的に抜けます。後段の AI では `ログに無い = 何もしていない` と推論しないことを前提にしてください。

次段階では、Events を時間近接・ファイル共起・メールスレッド・Calendar 予定などでクラスタリングして `Work Episode` を自動生成する層を追加できます。
