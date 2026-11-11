# Bowie's Assistant

A private Discord assistant for one friends' server: a security and admin bot, and a friend to talk to. **Everything in this repository is encrypted** (git-crypt, AES-256): the code, its settings, its word lists, its records and its history. Only the automation files GitHub needs to run it stay readable.

To anyone else, the files are unreadable. The key lives in GitHub's encrypted Actions secrets and in the owner's private vault, nowhere else.

## What it does, in short

- **Protects the server:** scam links and fake verification tricks, slurs and hate, raids, account takeovers ("nukes"), spam, impersonators, a honeypot for spam bots, and a ladder of consequences that gets firmer each time.
- **Looks after itself:** it tests itself every morning and before every update goes live, saves a database restore point, and rolls a bad update back by itself.
- **Gets better on its own:** nightly training on its own chats, a weekly exam on a research test set, and lessons from the server's staff.
- **Keeps things private:** everything about a person is encrypted with their own key; private chats are never read by anyone else.

It runs entirely on free plans (Cloudflare Workers and GitHub Actions) and open-source tools.

## Built with open-source work

Thank you to everyone whose work this bot stands on:

- **HateCheck**, Röttger et al. (2021), [paul-rottger/hatecheck-data](https://github.com/paul-rottger/hatecheck-data), CC BY 4.0: the weekly exam.
- **antislop-sampler**, Sam Paech, [sam-paech/antislop-sampler](https://github.com/sam-paech/antislop-sampler), Apache-2.0: the list of phrases that make writing sound machine-made.
- **Surge AI profanity list**, [surge-ai/profanity](https://github.com/surge-ai/profanity), MIT.
- **Discord scam domain lists**: [nikolaischunk/discord-phishing-links](https://github.com/nikolaischunk/discord-phishing-links) (MIT), [DevSpen/scam-links](https://github.com/DevSpen/scam-links) and [BuildBot42/discord-scam-links](https://github.com/BuildBot42/discord-scam-links) (public domain).
- **OpenPhish community feed**, [openphish/public_feed](https://github.com/openphish/public_feed), free for non-commercial use under [its terms](https://openphish.com/terms.html).
- **NSFWJS**, Infinite Red, [infinitered/nsfwjs](https://github.com/infinitered/nsfwjs), MIT: the backup picture check.
- **Unicode confusables** (UTS #39), [unicode.org](https://www.unicode.org/Public/security/latest/confusables.txt), Unicode License.
- **sinking.yachts** scam database, **GamerPower** free games and **The Space Devs** Launch Library.
- Open-source AI models on Cloudflare Workers AI (Llama, Llama Guard, Gemma, Qwen, Whisper, BGE and others), each under its own licence.

Found a security problem? See [SECURITY.md](SECURITY.md).
