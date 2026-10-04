# YouTube J-POP・ボカロ新着収集

YouTubeに前日投稿されたJ-POP・ボカロ動画を検索し、Googleスプレッドシートへ日別に記録するGoogle Apps Scriptです。
Shorts、カラオケ、歌ってみた、切り抜き、Playlist、AI生成音楽、海外動画などを除外し、楽曲動画を収集します。

## 主な機能

- 前日0:00〜24:00の日本時間で投稿された動画を検索
- J-POP用・ボカロ用の2つのスプレッドシートを同時更新
- 月ごとに`YYYY年M月`タブを自動作成
- 日付・タイトル・投稿チャンネル・URLを先頭へ追加
- 同じ動画の月内重複を防止
- 同じ日付の通常実行を防止し、YouTube APIの検索上限消費を抑制
- 設定値をスクリプトプロパティで管理
  > Apps ScriptではEnvファイルによる環境変数の設定ができないためスクリプトプロパティで設定している

## 導入

### 1. Apps Scriptプロジェクトを作成

Google Apps Scriptプロジェクトを作成し、`youtube_daily_release_collector.gs`を追加します。
※実行させたいスプレッドシートからApps Scriptを登録することもできる。

<img width="773" height="164" alt="image" src="https://github.com/user-attachments/assets/17aa0629-c07a-4cd4-93dc-bfb9cb3f8cf6" />


Apps Script左側の`サービス`から**YouTube Data API**を追加してください。必要に応じて、連携しているGoogle Cloudプロジェクトで**YouTube Data API v3**を有効化します。

<img width="1348" height="854" alt="image" src="https://github.com/user-attachments/assets/eab2fa85-faca-4517-b008-0b1c8533b1b6" />

### 2. スクリプトプロパティを設定

`プロジェクトの設定 → スクリプト プロパティ`で、以下を追加します。
<img width="974" height="347" alt="image" src="https://github.com/user-attachments/assets/90adb577-6152-4f2e-80c5-5b10ee2464ca" />

- プロパティ名: `COLLECTOR_SETTINGS`
- 値:　collector_settings.jsonの中身をコピペ

`minDurationSeconds: 180`は、3分以下の動画を除外する設定です。

### 3. 初回実行

Apps Scriptエディタで`collectPreviousDay`を選び、1回だけ実行します。表示される権限承認を完了してください。

この実行で前日分を取得し、設定した両方のスプレッドシートを更新します。

### 4. 毎日自動実行

Apps Scriptの左側にある時計アイコンから、時間主導型トリガーを追加します。

| 設定項目 | 設定値 |
| --- | --- |
| 実行する関数 | `collectPreviousDay` |
| イベントのソース | 時間主導型 |
| トリガーの種類 | 日付ベースのタイマー |
| 時刻 | 午前0時〜1時 |

Apps Scriptは指定時間帯のどこかで実行されるため、厳密に0:00に実行されるわけではありません。
<img width="1903" height="901" alt="image" src="https://github.com/user-attachments/assets/4c48c970-5d1b-4388-ae63-c820db52f2a8" />

## 出力形式

動画は対象月の`YYYY年M月`タブに、日付ごとのブロックとして先頭へ追加されます。

```text
YYYY年M月D日
タイトル | 投稿チャンネル | URL
...
```

## 除外条件

次の動画は集計対象外です。

- 3分以下の動画
- Shorts、および`#short`、`#youtubeshorts`、`#ショート`を含む動画
- カラオケ、歌ってみた、カバー、歌枠、切り抜き、Playlist
- AI生成を示す動画、Suno、Udio
- チャンネルの国設定が日本以外の動画
- タイ語、ハングル、キリル文字、アラビア文字をタイトルに含む動画

## 再実行とYouTube API上限

`collectPreviousDay`は、同じ日付で成功済みの場合は再検索しません。

検索条件の変更後や失敗時だけ、`forceCollectPreviousDay`を使用してください。YouTube Data APIには検索回数の1日上限があります。
