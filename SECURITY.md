# Security

If you find a security problem, please report it privately, not in a public issue:

**Security tab → Report a vulnerability** (GitHub's private reporting).

## How this repository is protected

- **Everything is encrypted.** Every file except the automation files is encrypted with git-crypt (AES-256). The key is only in GitHub's encrypted Actions secrets and a separate private vault.
- **Fresh history.** The repository was restarted from a single encrypted commit, so no earlier readable version is published.
- **No secrets in the code.** Tokens live only in GitHub's encrypted Actions secrets. Push protection and secret scanning block anything that looks like one.
- **Sealed backups, sealed twice.** Server backups and archives are sealed with RSA-OAEP (SHA-256) and AES-256-GCM before they are committed, then encrypted again with everything else.
- **Encrypted at rest in the bot too.** Everything the bot remembers about a person, every safety record and the 30-day message log are encrypted (AES-256-GCM) with a key made for that person from a master key that only ever exists inside Cloudflare. The bot's own working notes are encrypted the same way. Only IDs, times and counts the bot needs to run stay unencrypted, inside Cloudflare's database (which Cloudflare also encrypts at rest).
- **Locked-down automation.** Every GitHub Action is pinned to an exact commit, checked by actionlint and zizmor, and runs with the least permissions it needs. Credentials are never kept on disk between steps; the unlock key file is deleted straight after use.
- **Safe updates.** Before every update a database restore point is saved; after it, the bot runs its full self-test and real example messages on the new version and rolls back by itself if something important broke.
- **Constant checking.** CodeQL, OpenSSF Scorecard, Dependabot, gitleaks and a token scan run on every change, and a red-team test suite has to pass before anything is deployed.
