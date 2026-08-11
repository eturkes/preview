# Gaps / ギャップ

## Gap 1 / ギャップ 1

- Topic / トピック
  - JA: 稼働中の導入状態
  - EN: Live deployment state
- Checked / 確認済み
  - JA: ローカルのREADME、アーキテクチャ、プラグインプロトコル、セキュリティモデル、パッケージスクリプト、統合ソースを確認しました。静的根拠は契約を示しますが、稼働中ホストは示しません。
  - EN: Reviewed the local README, architecture, plugin protocol, security model, package scripts, and integration source\. Static evidence describes the contract but not a running host instance\.
- Action / 対応
  - JA: 信頼環境で選択した設定を起動し、pnpm checkを実行して、ループバックまたはプライベート接続とインストール済みプラグインマニフェストを確認してください。
  - EN: Start the selected configuration in its trusted environment, run pnpm check, and verify loopback or private access plus installed plugin manifests\.
