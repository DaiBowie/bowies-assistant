# Ziggy's home server kit

Built 12 Nov 2026, so that when the hardware arrives "it's done and ready" (Dai). Works on a **Raspberry Pi 5** or a
**mini PC**, Arm or Intel/AMD, with 8 GB of memory or more (16 GB recommended). Buying it is Dai's decision.

## What it does
- **Everyday chat at home, unlimited.** No daily allowance. Cloudflare's free AI is kept for the hardest calls.
- **Voice and hearing at home:** Ziggy's own voice: a blend of Kokoro's British male voices (`bm_george` 70%, `bm_fable` 30% to start), paced by mood (slower late at night), a faint starry shimmer and names said right, all set in `profiles.json` → `voice.ziggy` (Dai, 13 Nov 2026: "A nod to Ziggy"; never made from any real person's recordings) and Whisper.
- **Nightly training at home** with the sharper brain.
- **Backup safety checks** for pictures and text while Cloudflare's AI is out (moved off GitHub).
- **Companion mode** for other servers can be switched on once this is running.

Cloudflare always stays the front door: the Protector, honeypot, raid shield and self-tests never depend on the home
server. If it's off, slow or broken, Cloudflare answers within seconds. The Discord token never lives on it.

## Setting it up (one place at a time)

**1. On the new machine.** Install **Raspberry Pi OS (64-bit)** with Raspberry Pi Imager, or Debian/Ubuntu on a mini
PC. Connect it to the internet, ideally by cable, with an SSD.

**2. In Workspace HQ on your iPhone.** Open **Home server**, then tap **Make the pairing line**. Tap **Copy the
line**. It works once, for 30 minutes.

**3. Back on the machine.** Open the Terminal, paste the line and press Enter. It takes 30–90 minutes on a Pi (it builds
the engines for that exact processor and downloads about 20 GB of models). You can leave it.

**4. In Workspace HQ.** When Home server shows **Online**, switch on **Use the home server**. That's it.

## What gets installed (all free, all open source)
| Part | Software | Licence |
|---|---|---|
| Brains | llama.cpp, built on the machine | MIT |
| Quick brain | Qwen3 0.6B | Apache-2.0 |
| Everyday chat | Qwen3 4B Instruct 2507 (16 GB) · Qwen3 30B-A3B Instruct 2507 (32 GB+) | Apache-2.0 |
| Sharper brain | Qwen3 30B-A3B Instruct 2507 (wakes 03:15–05:30 UK for training on 16 GB machines) | Apache-2.0 |
| Hearing | whisper.cpp with Whisper base/small | MIT |
| Voice | Kokoro-82M through kokoro-onnx | Apache-2.0 / MIT |
| Safety checks | Transformers.js with toxic-bert and a ViT NSFW detector | Apache-2.0 |
| Tunnel | cloudflared quick tunnel (no account, no open ports at home) | Apache-2.0 |

Profiles are picked by memory: `small` (8–11 GB), `pi16` (12–27 GB), `big` (28 GB+). See `profiles.json`.

## Speed
- The gateway keeps the bot's long instructions cached between replies (llama.cpp `cache_prompt` and `--cache-reuse`).
  This is the biggest speed-up on a small computer.
- Quick yes/no checks use the tiny brain; models stay loaded all the time.
- Run a **speed test** from Workspace HQ. The real numbers are measured on the day, not guessed.

## On the machine itself
`ziggy status` · `ziggy logs` · `ziggy restart` · `ziggy bench` · `ziggy update` · `ziggy uninstall`

## Optional: Tailscale (Dai's decision, his sign-up)
`sudo bash /opt/ziggy/kit/addons/tailscale.sh` lets the iPhone's Tailscale app open the home server's own status page
(`http://<machine>:8788`, user `ziggy`; save the password it prints in Apple Passwords). The plan is free for up to 6
users. The bot itself never needs it.

## Honest catches, to check on the day
- **Quick tunnel:** Cloudflare's free quick tunnels have no uptime promise and get a new address when they restart. The
  agent tells the bot the new address within a minute. A named tunnel (free with Dai's Cloudflare account) gives a fixed
  address and can replace it later.
- **Speeds and timings** (build time, words a second, voice speed) are only known once it runs on the real hardware.
- The picture-check model and Kokoro's Arm wheels are set up by the installer. If either won't install on the chosen
  hardware, the installer says so and the bot keeps using Cloudflare for that part.
