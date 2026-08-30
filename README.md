# GWS History Collector

Google Workspace 上に自然に残る「仕事の足跡」を自動収集し、あとから AI が作業内容・関連ファイル・コミュニケーション・会議などを復元できるようにする Apps Script ベースの履歴収集基盤です。

人間が日報や作業ログを手入力することを前提にしません。画面録画やキーロガーのような強い監視ではなく、Google Workspace の各 API にすでに存在するアクティビティ／メタデータを共通イベント形式に正規化して Google Sheets に蓄積します。

## 基本方針

- 人間は原則として記録しない
- まず「何をしていたか」を後から復元するための痕跡を広く集める
- メール本文、Chat本文、予定説明、Tasksのメモ、Meetの録画・文字起こしなどは原則として複製しない
- すべてのサービスを `Events` の共通形式へ正規化する
- 1つのAPIが実行時エラーになっても、ほかの Collector は動かし続ける
- 後段のAIがイベントを時間・共起・スレッド・ファイル等でまとめて `Work Episode` を推定する前提で設計する

## 現在の収集対象

### Google Drive

Drive Activity API v2 を使います。

- 作成 / アップロード / コピー
- 編集
- 移動
- 名前変更
- 削除 / 復元
- 権限変更
- コメント関連
- その他 Drive Activity API が返す ActionDetail
- 対象ファイル／フォルダ名、ID、MIME type
- 実行者（APIから識別できる範囲）

既定では My Drive 配下を対象にし、自分の操作とシステムイベントを中心に保存します。`DRIVE_INCLUDE_OTHER_ACTORS: true` にすると、取得できる他ユーザーの操作も保存対象にします。

#### 共有ドライブ / 追加フォルダ

Drive Activity API はフォルダIDを `ancestorName` に指定すると、その配下全体の活動を取得できます。そのため `DRIVE_EXTRA_ANCESTOR_IDS` に共有ドライブのルートIDや追加で追いたいフォルダIDを入れれば、それぞれ独立したカーソルで追跡します。

```javascript
DRIVE_EXTRA_ANCESTOR_IDS: [
  'SHARED_DRIVE_ROOT_ID',
  'ANOTHER_FOLDER_ID',
],
```

共有ドライブをAPIで自動列挙することもできますが、そのためには Drive API の `drive.readonly` のような、ファイル内容まで読める強い scope が必要になります。この Collector では「活動メタデータを集めるためだけに内容読取権限を増やさない」方を優先し、自動列挙はしていません。

### Gmail

Gmail API のメタデータと History API を使います。**メール本文は保存しません。**

- メッセージ追加（受信 / 送信 / 下書き等）
- 完全削除
- ラベル追加 / 削除（既読・未読等の変化も含め、APIが返すもの）
- 件名
- From / To / Cc（設定で縮小可能）
- threadId / messageId
- ラベル
- サイズ

初回は直近 `INITIAL_LOOKBACK_DAYS` 日をバックフィルし、その後は Gmail History ID を使って差分追跡します。

初回取得は Apps Script の実行時間を圧迫しないようメッセージメタデータを並列取得します。最大 `GMAIL_INITIAL_MAX_MESSAGES` 件までです。大量のメールがあり上限到達前に設定日数まで遡れなかった場合は Script Properties に `hc_gmail_bootstrap_truncated=true` が残ります。

### Google Calendar

ユーザーが参照できるカレンダーを対象にします。

- 予定が実際に開始した時刻（作業タイムライン用）
- 予定作成
- 予定更新
- 予定キャンセル
- 件名、開始・終了、場所
- 主催者
- 参加人数
- Meet の有無

**予定の説明本文は保存しません。** 参加者一覧も既定では保存せず人数だけです。

### Google Tasks

Tasks API を使います。

- タスク更新
- タスク削除
- タスク完了
- タイトル
- 期限
- 所属タスクリスト
- 親タスク
- 関連リンク
- Docs / Chat 等から割り当てられたタスクの場合、その割当元情報

**Tasks の notes 本文は保存しません。**

### Google Meet

Google Meet REST API の Conference Records を使い、Calendar の「予定」ではなく会議の実績側の痕跡を補います。

- Conference 開始
- Conference 終了
- meeting code
- Meet URI
- Conference / Space ID

**録画、文字起こし、チャット内容、参加者一覧は取得しません。**

### Google Chat

ユーザーが参加している Space / Group Chat / DM を列挙し、Space Events API と自分の Space Read State を追跡します。

- メッセージ作成 / 更新 / 削除
- リアクション追加 / 削除
- メンバーシップ作成 / 更新 / 削除
- Space 更新
- バッチイベント
- **自分の Space 最終既読時刻が進んだこと**

既読位置は「Chatを実際に見た」痕跡として `space_read_state_updated` イベントにします。既読時刻そのものだけを保存し、本文は必要ありません。

**既定では Chat 本文を保存しません。** Space 名、イベントID、メッセージ等のリソースID、送信者リソースなどのメタデータを保存します。必要な場合だけ `STORE_CHAT_TEXT: true` にしてください。

Chat のイベント履歴は永続的にAPIから取得できるわけではないため、Collector 自身の `Events` に定期退避する設計です。Space 数が多い環境では `CHAT_SPACES_PER_RUN` 件ずつ巡回します。

## 出力

`setup()` を初回実行すると `GWS History Collector` というスプレッドシートを My Drive に作成します。

### Events

すべてのサービスを同じ列に正規化します。

| column | meaning |
|---|---|
| event_id | 重複排除用の決定的 ID |
| event_time | 実際のイベント時刻 |
| source | drive / gmail / calendar / tasks / meet / chat |
| action | edit / message_added / event_started 等 |
| actor | 実行者 |
| object_type | file / email / calendar_event / task / meet_conference / chat_message 等 |
| object_id | API 上の ID |
| object_name | ファイル名、件名、予定名など |
| container_id | thread / calendar / task list / Meet space / Chat space 等 |
| container_name | コンテナ表示名 |
| url | 元データへ戻るための URL（作れる場合） |
| direction | inbound / outbound 等 |
| details_json | 本文を避けた追加メタデータ |
| collected_at | Collector が取得した時刻 |

### Status

各 Collector の最終実行時刻・状態・今回追加した件数を記録します。

### Errors

API エラーを記録します。1サービスの**実行時**エラーは、ほかの Collector を止めません。

## セットアップ

1. Apps Script のスタンドアロンプロジェクトを作成します。
2. このリポジトリの `.gs` と `appsscript.json` を配置します。`clasp` を使っても構いません。
3. Apps Script プロジェクトを標準 Google Cloud プロジェクトに関連付けます。
4. Google Cloud 側で、使う Collector に対応する API を有効化します。
   - Google Drive Activity API
   - Gmail API
   - Google Calendar API
   - Google Tasks API
   - Google Meet REST API
   - Google Chat API
5. `setup()` を手動実行し、OAuth 権限を承認します。
6. 作成されたスプレッドシートを確認します。
7. `collectAll()` を一度手動実行します。
8. `Status` と `Errors` を見て、職場アカウントで利用できるAPIを確認します。

`setup()` は既定で10分おきの `collectAll` トリガーも作成します。重複した Collector トリガーは削除してから作り直します。

## 職場アカウントでAPIが拒否された場合

このプロジェクトは管理者ポリシーを回避しません。OAuth アプリ制御やAPI利用制限により 401 / 403 になるサービスがあれば `Errors` に記録されます。

実行時にだけ拒否されるサービスなら、`Config.gs` の `ENABLED_SOURCES` から外せば残りだけ動かせます。

```javascript
ENABLED_SOURCES: ['drive', 'gmail', 'calendar', 'tasks', 'meet', 'chat'],
```

たとえば Chat と Meet を使わない場合:

```javascript
ENABLED_SOURCES: ['drive', 'gmail', 'calendar', 'tasks'],
```

### OAuth承認そのものがブロックされる場合

Apps Script の OAuth scope は `appsscript.json` に静的に書かれています。そのため、組織が特定 scope の**承認自体を禁止**している場合は `ENABLED_SOURCES` を変えるだけでは足りません。利用しないサービスの scope も `appsscript.json` から外してください。

対応関係は次のとおりです。

| source | 主な scope |
|---|---|
| drive | `drive.activity.readonly` |
| gmail | `gmail.metadata` |
| calendar | `calendar.readonly` |
| tasks | `tasks.readonly` |
| meet | `meetings.space.readonly` |
| chat | `chat.spaces.readonly`, `chat.messages.readonly`, `chat.messages.reactions.readonly`, `chat.memberships.readonly`, `chat.users.readstate.readonly` |

`spreadsheets`, `script.scriptapp`, `script.external_request` は Collector 基盤自体で使います。

Google Chat は Workspace / Cloud Project 側の Chat API 設定や組織ポリシーによって利用できない場合があります。最初から必須とはせず、使えなければ Chat だけ無効化してください。

## 最初に調整する設定

`Config.gs` を編集します。

```javascript
INITIAL_LOOKBACK_DAYS: 7,
CALENDAR_OCCURRENCE_LOOKBACK_DAYS: 30,
TRIGGER_MINUTES: 10,
ENABLED_SOURCES: ['drive', 'gmail', 'calendar', 'tasks', 'meet', 'chat'],
DRIVE_INCLUDE_OTHER_ACTORS: false,
DRIVE_EXTRA_ANCESTOR_IDS: [],
STORE_GMAIL_COUNTERPARTIES: true,
STORE_CALENDAR_ATTENDEES: false,
STORE_CHAT_TEXT: false,
GMAIL_INITIAL_MAX_MESSAGES: 1000,
CHAT_SPACES_PER_RUN: 25,
```

「なるべく広く取る」場合でも、まず `STORE_CHAT_TEXT: false` のまま運用することを推奨します。本文まで複製すると、Collector のスプレッドシート自体が新しい機密情報集約庫になります。

## 手動実行関数

- `setup()` — 初期化と定期トリガー作成
- `collectAll()` — 有効な全サービス
- `collectDrive()`
- `collectGmail()`
- `collectCalendar()`
- `collectTasks()`
- `collectMeet()`
- `collectChat()`
- `resetState()` — 差分カーソルを全消去し、次回を初回取得扱いにする
- `removeTriggers()` — Collector の定期トリガーを削除
- `getHistorySpreadsheetUrl()` — 保存先を確認

## データの解釈上の注意

このログは「仕事そのもの」ではなく、デジタル上に観測できた足跡です。

電話、窓口、紙資料、口頭相談、思考時間などは原理的に抜けます。後段の AI では **`ログに無い = 何もしていない` と推論しない** ことを前提にしてください。

また Chat Space などでは、自分以外のユーザーが起こしたイベントのメタデータが取得されることがあります。Collector を個人の作業履歴として解釈するときは、`actor` を見て「自分の行動」と「周囲で起きた出来事」を区別する必要があります。

## 次段階

`Events` が溜まった後は、生ログをそのままAIに投げるのではなく、次のような処理を想定しています。

1. 時間的に近いイベントをまとめる
2. Gmail thread / Drive file / Calendar event / Chat space の関係を接続する
3. ファイルやサービスの共起を利用する
4. 「照会対応」「資料作成」「会議準備」などの `Work Episode` をAIで推定する
5. Episodeから「この仕事、前回どうやった？」を検索できるようにする

現時点のリポジトリは、そのための **受動的なデータ収集層** です。
