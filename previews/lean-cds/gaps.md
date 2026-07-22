# Gaps / ギャップ

## Gap 1 / ギャップ 1

- Topic / トピック
  - JA: 標準回帰ゲートの最新実行
  - EN: Fresh standard regression run
- Checked / 確認済み
  - JA: 利用可能なLeanで、共有知識と各シナリオをメモリ上で結合した6組を読み取り専用で型検査しました。Pythonアプリ依存関係は現在の実行環境にありませんでした。
  - EN: Using the available Lean compiler, the shared knowledge and each scenario were combined in memory and all six pairs were typechecked read\-only\. Python app dependencies were absent from the current environment\.
- Action / 対応
  - JA: プロジェクトローカル依存関係を準備した環境で追跡済み回帰ハーネスを1回実行し、終了コードと6件の判定を保存してください。
  - EN: Run the tracked regression harness once in an environment with project\-local dependencies, then retain the exit code and all six verdicts\.

## Gap 2 / ギャップ 2

- Topic / トピック
  - JA: CIによる継続検証
  - EN: Continuous verification in CI
- Checked / 確認済み
  - JA: 追跡済みファイル一覧、マニフェスト、回帰スクリプトを確認しましたが、CI設定は見つかりませんでした。
  - EN: The tracked file list, manifest, and regression script were checked, but no CI configuration was found\.
- Action / 対応
  - JA: CIが別管理なら設定場所を示してください。なければ、回帰ゲートを実行する最小ジョブを追加してください。
  - EN: Identify the CI location if managed elsewhere; otherwise add a minimal job that runs the regression gate\.

## Gap 3 / ギャップ 3

- Topic / トピック
  - JA: 臨床原典への忠実性と日英同等性
  - EN: Clinical source fidelity and JA/EN equivalence
- Checked / 確認済み
  - JA: Lean公理、日英シナリオ文、追跡済みロードマップを確認しました。ロードマップ自身が忠実性を中核の信頼ギャップと記録しています。
  - EN: The Lean axioms, JA/EN scenario prose, and tracked roadmap were checked\. The roadmap itself records fidelity as the core trust gap\.
- Action / 対応
  - JA: 対象ガイドラインの専門家が各公理を原典節と照合し、日英の適応条件、禁忌条件、閾値を承認してください。
  - EN: Have a guideline expert compare every axiom with its source section and approve the JA/EN indications, contraindications, and thresholds\.

## Gap 4 / ギャップ 4

- Topic / トピック
  - JA: 現在進行中の項目
  - EN: Current in\-progress item
- Checked / 確認済み
  - JA: ロードマップにはForwardとBacklogがありますが、所有者や進行中マーカーはありません。
  - EN: The roadmap has Forward and Backlog sections but no owner or in\-progress marker\.
- Action / 対応
  - JA: 1項目だけを進行中として指定するか、現在はなしと明記してください。
  - EN: Mark exactly one item as in progress, or state that none is active\.
