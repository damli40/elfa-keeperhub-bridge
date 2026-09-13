# Demo storyboard, short cut (drafted 2026-09-12)

Target: 95 seconds. Screen capture with on-screen captions; narration optional. Product on screen
by 0:20. Fact table and "claims to avoid" in `video/STORYBOARD.md` still govern every number.
Hide `.env`, shell history and any response body with account metadata.

Why this cut: judges want something working inside 90 seconds, no login or setup flows, and a
visible resolution to the problem you opened with. Problem gets ~30 seconds, product gets the rest.

| Time | Picture | Caption (on screen) |
| --- | --- | --- |
| 0:00–0:08 | Elfa Auto plan editor, condition in plain words | "Elfa watches the market. It fires a webhook when the condition is true." |
| 0:08–0:20 | Elfa docs, Agent Runner page; then KeeperHub webhook trigger showing the Bearer requirement | "Elfa says: run execution yourself. KeeperHub needs a header Elfa cannot send. Nothing connects them." |
| 0:20–0:30 | `docs/architecture.html`, one slow pan | "The bridge: verify, dedupe, forward once. Amount, token, chain fixed in KeeperHub." |
| 0:30–0:42 | KeeperHub workflow canvas, cursor on balance → quote → floor → swap → Telegram | "0.002 ETH → USDC on Base. Two guards. No number comes from the webhook." |
| 0:42–0:55 | Terminal: one `bridge fire`, then `/audit?format=html` | "Signed harness event. Forwarded once. Duplicate dropped. Forged request never written." Fire the same ID twice, then one forged. |
| 0:55–1:10 | KeeperHub execution `cgxl31n4l3sns4zy15pqc`, then BaseScan `0x79ab494c…10cd` | "Proof run: 0.002 ETH → 4.922114 USDC. Gas sponsored by KeeperHub." Hash stays on screen 5 s. |
| 1:10–1:22 | KeeperHub execution `enykq0mq4ejhy1055wbm4`, Telegram skip message | "Second run: 0.000925 ETH, under the guard. Stopped before the swap. Told the operator why." |
| 1:22–1:30 | `/audit` row for the genuine Elfa expiry event, then `npm test` tail: 166 passed | "One real Elfa event arrived. It was a lifecycle notice. The Worker dropped it." |
| 1:30–1:35 | Title card | "Elfa decides when. KeeperHub decides how much." |

## Rules for this cut

- Never caption a harness event as an Elfa market trigger. The only genuine Elfa delivery on
  screen is the expiry row at 1:22.
- The swap at 0:55 was a direct KeeperHub proof run. Caption it "proof run", nothing more.
- Do not show a price-floor refusal. None exists on mainnet.
- Re-run `npm test` right before recording and match the count in the caption.
- Export as unlisted YouTube, marked "not for kids", or host on own Cloudflare as with Commons.

## Built 2026-09-13 (HyperFrames)

- Source: `video/demo/index.html`, design tokens in `video/demo/design.md`, output `video/demo/demo.mp4`
  (1920×1080, 95 s, silent, 27.9 MB). Rebuild: `cd video/demo && npx hyperframes check && npx hyperframes render --output demo.mp4`.
- Captures in `video/demo/assets/`: Elfa home + Agent Runner docs + audit page (headless, 1920×1080);
  KeeperHub canvas, Run #1 steps, Run #1 swap output, Run #4 balance stop, BaseScan transfers (Chrome, 1374×868).
- Changes from the shot list above: scene 1 uses the Elfa home page instead of the plan editor (no Elfa
  app login captured). Scene 5's terminal is a typed replay of the four real audit rows from Sep 10, labelled
  as harness events. No Telegram screen; the skip is shown from the KeeperHub run trace instead.
- Not done: no voiceover, no music, nothing uploaded. Wallet still 0.000925 ETH, so no fresh run was filmed.

## Narration (revised 2026-09-13, take 2)

Take 1 (nine separate clips, spelled-out letters, "Sentinel Narrator" voice) sounded stiff. Take 2 is one
continuous read of the whole script so the delivery flows: ElevenLabs `eleven_v3`, stock voice "Brian"
(`Gubgw9l4dtIoQA9YZHgx`), stability 0.5, similarity 0.8, style 0, speaker boost on. Script in
`video/demo/vo/script-v2.txt`, audio `vo/take-v3.mp3` (120 s), word alignment `vo/take-v3.align.json`.
Scene boundaries were set from that alignment: 0 / 11.9 / 32.1 / 43.3 / 60.7 / 77.3 / 92.2 / 102.9 / 116.5 /
121.5 s. Voice enters at 0.6 s. Music `assets/music-the-mountain.mp3` at -9 dB, ducked 6:1 under speech,
faded out over the last 4 s. Speech -16 LUFS. Total 2:01.

Numbers are said the way a person would say them: "two thousandths of an ETH", "four ninety-two in USDC",
"a hundred and sixty-six tests". The exact figures stay on screen. Fact rows per line are unchanged from
the table below; line 1 cites Elfa's trade-removal post for 3.83M API requests.

| Scene | Spoken line (numbers spelled for the voice) | Fact row |
| --- | --- | --- |
| 1 | Elfa watches the market. Over three point eight million API requests in August. Elfa decides when. It doesn't execute. | FACTS 6, Elfa blog re-read 2026-09-13 |
| 2 | Elfa now tells users to run execution themselves. That runner is the dangerous piece: it double-fires on a retry, or acts on a forged request. And KeeperHub's webhook needs a bearer header Elfa can't send. | FACTS 1 |
| 3 | So the bridge sits between them. A Cloudflare Worker proves who sent the event, proves it isn't a repeat, and forwards it once. | spec §4.2 |
| 4 | The KeeperHub workflow is where every number lives. Balance check, live Uniswap quote, price floor, then a fixed swap of 0.002 ETH into USDC on Base. The webhook can't change any of it. | workflow JSON, spec §6.2 |
| 5 | The live Worker, hit with signed harness events. The first one forwards. The same event again is dropped as a duplicate. A forged signature is refused and never written. Every decision lands in a public audit log. | FACTS 14, 15 |
| 6 | The proof run, launched directly on KeeperHub. Seven steps, all green. 0.002 ETH became 4.92 USDC. KeeperHub sponsored the gas. The receipt is on BaseScan. | FACTS 12 (4.922114 rounded in speech, exact on screen) |
| 7 | A later run found under a thousandth of an ETH in the wallet, below the guard. It stopped before the quote, moved nothing, and still told the operator why. | FACTS 13, 17 (0.000925 ETH) |
| 8 | One honest note. Only one real Elfa event has reached the bridge so far, an expiry notice, and the Worker dropped it. 166 tests pin every money value. | FACTS 16; vitest run 2026-09-13 |
| 9 | Elfa decides when. KeeperHub decides how much. | |
