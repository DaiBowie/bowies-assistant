# Security

If you find a security problem, please report it privately, not in a public issue:

**Security tab → Report a vulnerability** (GitHub's private reporting).

## How this repository is protected

- **Everything is encrypted.** Every file except the automation files is encrypted with git-crypt (AES-256). The key is only in GitHub's encrypted Actions secrets and a separate private vault.
- **Fresh history.** The repository was restarted from a single encrypted commit, so no earlier readable version is published.
- **No secrets in the code.** Tokens live only in GitHub's encrypted Actions secrets. Push protection and secret scanning block anything that looks like one.
- **Sealed backups, sealed twice.** Server backups and archives are sealed with RSA-OAEP (SHA-256) and AES-256-GCM before they are committed, then encrypted again with everything else.
- **Locked-down automation.** Every GitHub Action is pinned to an exact commit, checked by actionlint and zizmor, and runs with the least permissions it needs. Credentials are never kept on disk between steps; the unlock key file is deleted straight after use.
- **Constant checking.** OpenSSF Scorecard, Dependabot, gitleaks and a token scan run on every change.
