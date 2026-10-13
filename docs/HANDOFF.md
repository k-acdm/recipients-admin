# 引き継ぎメモ（recipients-admin）

## 最終更新
2026-10-14 新規作成：line-recipients の入力画面（GAS Webアプリ）

## プロジェクト概要
- 共有スプレッドシート **line-recipients** の `Families` / `Students` への入力を、
  シート直接編集ではなく**専用フォーム**から行うツール
- schedule-line / proposal-line / billing-line が参照する受信者データを**家族単位**で編集する
- Google Apps Script（GAS）+ clasp 運用。見た目は schedule-line の管理画面と同じCSS系統
- 対象シートは `RECIPIENTS_SPREADSHEET_ID`（schedule-line / proposal-line と同じ値）で参照

## 対象シート
- **Families**：家族ID | 宛名 | 配信区分 | 保護者LINE_USER_ID | 登録日 | 配信有効フラグ
- **Students**：生徒ID | 家族ID | 学年 | 生徒氏名 | 兄弟順位 | 在籍フラグ | 生徒LINE_USER_ID
- 列は**ヘッダ名**で特定（列順が変わっても可。ヘッダ名は変えないこと）

## 画面
### 1. 家族一覧・検索
- 登録済みの家族を一覧表示（家族ID／宛名／所属生徒の氏名／配信有効フラグ）
- 宛名・生徒氏名で絞り込む検索ボックス
- 「新規family追加」ボタン

### 2. 家族の編集（一覧から1件選ぶと開く）
- Families の各項目を編集
- その家族に属する Students を並べて各項目を編集
- 「この家族に生徒を追加」ボタン
- 「保存」で Families・Students の該当行をまとめて書き戻す

## 入力仕様
- **家族ID**：新規時は入力欄にあらかじめ「F」を入れておく。残りは手入力（自動採番しない）
- **生徒ID**：手入力（自動採番しない）
- **配信有効フラグ / 在籍フラグ**：TRUE / FALSE のチェックボックス（チェック＝TRUE）
- **LINE_USER_ID**：空欄可（LINE未所持の生徒がいるため）。
  入力がある場合のみ形式チェック（**U で始まる33文字**）。不正でも**警告のみ・保存はブロックしない**
- **生徒氏名**：入力文字列を**そのまま保存**（空白除去などの加工は一切しない。
  schedule-line 側が照合時に空白を無視するため加工不要）
- **兄弟順位**：数値。兄弟がいない場合も 1
- **配信区分**：billing-line専用。編集はできるが「billing-line専用。schedule / proposal では参照しません」と画面に注記

## 退塾処理
- **行の削除機能は作らない**。Students の在籍フラグを FALSE にすることで退塾を表す
- 画面にも「退塾は在籍フラグをFALSEにする」旨を注記

## 安全面
- 既存データを壊さない。**保存は該当行のみ更新**し、他の行には触れない
  - 既存行の更新は**値が実際に変わったセルだけ**を書き込む（未編集セルは元の値・型のまま温存）
  - 新規の家族・生徒は末尾に**追記**
- **家族IDが既存と重複／生徒IDが既存と重複**する場合は保存前に警告（画面内の生徒ID重複も警告）
- 保存前に確認ダイアログを出す

## 実装上の判断（要確認・ふくちさんの指示で変更可）
1. **新規追加時のチェックボックス既定**：配信有効フラグ・在籍フラグとも**既定TRUE（チェック済み）**で開く。
   「不要なら外す」運用。FALSE既定が良ければ変更する。
2. **保存時の書き込み粒度**：既存行は「値が変わったセルのみ」書き込む方式にした
   （未編集の 登録日 等が日付型のまま温存され、取り違え・型変化を防ぐため）。

## 環境情報
### リポジトリ
- URL：https://github.com/k-acdm/recipients-admin
- ブランチ：dev / main（dev で作業 → main にマージ）

### GASプロジェクト
- 名前：recipients-admin
- スクリプトID：`10Q23fyoO7SuOTJYrPKYwNikTQ9Glig9saliW6Gp6D7T8JPPHA4kZNkcw`
- エディタURL：https://script.google.com/d/10Q23fyoO7SuOTJYrPKYwNikTQ9Glig9saliW6Gp6D7T8JPPHA4kZNkcw/edit
- clasp ログインアカウント：kasukabe.academy@gmail.com
- ⚠️ schedule-line（`1XahVQ…`）/ proposal-line（`1q8QyOBA…`）とは**別プロジェクト**。
  `src/gas/.clasp.json` の scriptId を必ず確認してから push すること。

### clasp 構成
- `.clasp.json` は `src/gas/` に配置（rootDir="" = src/gas がソースルート）
- clasp コマンドは `~/recipients-admin/src/gas` で実行する
- ソースファイル：`コード.js`（サーバー）/ `admin.html`（画面）/ `appsscript.json`

### スクリプトプロパティ
ふくちさんがGASエディタ（プロジェクトの設定 → スクリプト プロパティ）で入力する。
| キー | 必須 | 値 |
|---|---|---|
| `RECIPIENTS_SPREADSHEET_ID` | ✅必須 | 共有シート line-recipients のID（**schedule-line / proposal-line と同じ値**） |

### oauthScopes（appsscript.json）
- `https://www.googleapis.com/auth/spreadsheets`（line-recipients の読み書き）

## 重要な注意（schedule-line から引き継ぎ）
1. **GASエディタは編集後F5リロードしないと旧コードを掴む**（デプロイ前に必ずリロード）
2. **`clasp push` 成功表示でもリモートHEADが旧版に戻ることがある**
   - 疑わしいときは一時フォルダへ `clasp pull` して中身を検証（※本プロジェクトの作業では clasp pull は使用禁止）
3. **clasp 3.x の `clasp create` は appsscript.json を既定版で上書きする**
   - 作成後に Asia/Tokyo・ANYONE_ANONYMOUS・oauthScopes を復元すること（本プロジェクトでも実施済み）
4. **デプロイは「既存デプロイの編集 → 新バージョン」**（新規デプロイはURLが変わる）
5. **Webアプリ設定「アクセスできるユーザー：全員」必須**（`webapp.access: "ANYONE_ANONYMOUS"` を維持）

## 運用ルール（billing-line / schedule-line と共通）
### ⚠️ git add の注意
- `git add .` は必ず **`~/recipients-admin` ルート**で実行する

### dev/main 切替
- **再開時**：`git checkout dev` → `git pull origin dev`
- **終了時**：`git pull origin dev` → `git checkout main` → `git merge dev` → `git push origin main` → `git checkout dev`

### 本番反映
1. `git pull origin dev`
2. `git checkout main` → `git merge dev` → `git push origin main`
3. `clasp push`（`~/recipients-admin/src/gas` で実行）
4. GASエディタをF5リロード →「デプロイを管理」→ 既存デプロイを編集 →「新バージョン」→ デプロイ
