# Live execution proof

Recorded on 2026-09-10 against KeeperHub and Base mainnet.

## Successful swap

- KeeperHub workflow: `9lwespmlwr5ti4xyx817j`
- KeeperHub execution: `cgxl31n4l3sns4zy15pqc`
- Transaction: [BaseScan](https://basescan.org/tx/0x79ab494c3f0f65c63986c1410a503e0167c94f3175492e263b81035e8eac10cd)
- Transaction hash: `0x79ab494c3f0f65c63986c1410a503e0167c94f3175492e263b81035e8eac10cd`
- Chain: Base mainnet, chain ID `8453`
- Block: `51108406`
- Receipt status: success
- KeeperHub receipt verification: `verified=true`
- Execution trace: `trigger-1 → bal-1 → cond-bal → quote-1 → cond-quote → swap-1 → tg-ok`

The balance node read `0.002925144547693724 ETH`. The balance condition passed its fixed
`0.0025 ETH` floor. The workflow quoted `4.922114 USDC` for `0.002 ETH`, above the fixed
`4.774984 USDC` minimum. The swap sent `0.002 ETH` and the wallet received `4.922114 USDC`.

KeeperHub sponsored the gas. The receipt reports `165265` gas units and
`998240759395` wei as the gas cost. The workflow finished in 5.955 seconds. Its final Telegram
node returned `messageId: 7` and included the transaction hash.

Wallet balances recorded through Base RPC:

| Asset | Before | After |
| --- | ---: | ---: |
| ETH | `0.002925144547693724` | `0.000925144547693724` |
| USDC | not recorded before the run | `4.922114` |

## Live refusal proof

- KeeperHub execution: `enykq0mq4ejhy1055wbm4`
- Result: success, no transaction hashes
- Execution trace: `trigger-1 → bal-1 → cond-bal → tg-skip-bal`
- Balance read: `0.000925144547693724 ETH`
- Condition result: false
- Telegram result: `messageId: 8`

The second run stopped before the quote and swap because the wallet balance sat below the fixed
`0.0025 ETH` guard. KeeperHub created no transaction and reported no gas use.

## Live bridge proof

The current Worker was deployed at
`https://elfa-keeperhub-bridge.meanwhile-waittime.workers.dev` and reported:

- version: `1.0.0`
- bridge enabled: `true`
- configured routes: `1`
- malformed routes: `0`

The short-lived Elfa film plan is active and routed:

- Elfa query: `b814b6e5-097e-41b4-a93b-73169661ba53`
- condition: BTC price on Hyperliquid crosses above `78250`
- KeeperHub workflow: `9lwespmlwr5ti4xyx817j`

The deterministic CLI sent requests with Elfa's documented signature headers and exact HMAC
contract to the live Worker:

| Event | HTTP result | Audit result | KeeperHub effect |
| --- | --- | --- | --- |
| `e2e-20260910-valid2` | `200 forwarded:ok` | `forwarded:ok` | Execution `ux12mjb6qkrnyret2k37w` |
| same event ID again | `200 dropped:duplicate` | `dropped:duplicate` | No second execution |
| `e2e-20260910-forged` | `401 bad signature` | No row, by design | No execution and no KV write |
| `e2e-20260910-stale` | `401 refused:stale` | `refused:stale` | No execution |
| `e2e-20260910-unrouted` | `200 dropped:unrouted` | `dropped:unrouted` | No execution |

Execution `ux12mjb6qkrnyret2k37w` finished successfully in 0.9 seconds. Its trace was
`trigger-1 → bal-1 → cond-bal → tg-skip-bal`. The balance node returned
`0.000925144547693724 ETH`, the condition returned false, Telegram returned `success=true` with
`messageId: 9`, and KeeperHub recorded no transaction hash or gas use.

The first valid harness event, `e2e-20260910-1`, exposed a deployment configuration error:
KeeperHub returned `410 Workflow is disabled`. The bridge recorded
`forwarded:permanent_error`, and the repeat was dropped as a duplicate. The workflow was enabled
through KeeperHub's documented update contract before the fresh `valid2` event was sent. This
failure and recovery remain visible in `/audit` as operational evidence.

The price plan did not emit a market-triggered webhook. Its first evaluation reported that a price
preview was unavailable before execution, and it later expired with no condition execution.

At expiry, Elfa emitted a genuine signed lifecycle webhook with event ID
`3e191c8a-3ee6-4a5c-a91c-840d5551ccc1`. The deployed Worker accepted the signature and safely
dropped the event as unrouted because this lifecycle payload carried its query ID in the
top-level canonical position rather than `data.queryId`.

That observation exposed a defense-in-depth gap: the query builders had set
`allNotifications: true`, opting the execution endpoint into `expired`, `failed`, and
`run-failed` notifications. The builders now set it to false. The Worker also understands both
documented query-ID positions and explicitly returns `dropped:lifecycle` for any status other than
`triggered`, even if an operator later creates a misconfigured query outside the CLI. Mutation
tests prove that setting `allNotifications` back to true or removing the lifecycle gate fails the
suite.

Version `1.0.1` was then deployed with standing funding plan
`d3564e99-ac6b-495a-9880-81f020c423d7` active and routed. Live lifecycle probe
`e2e-20260910-lifecycle-v101` used the top-level query ID and status `expired`; the Worker returned
`200 dropped:lifecycle`, recorded that decision, and made no KeeperHub call.

Fresh valid event `e2e-20260910-v101-valid` returned `200 forwarded:ok`. Its repeat returned
`200 dropped:duplicate`. KeeperHub created exactly one execution, `7c6xsp26ijw29w5laz3cq`, with
trace `trigger-1 → bal-1 → cond-bal → tg-skip-bal`. It read
`0.000925144547693724 ETH`, evaluated the balance condition false, delivered Telegram message 10,
and produced no transaction hash or gas use.

The signed harness proves the live Worker-to-KeeperHub path using the same HMAC headers and body
contract, but it is not presented as an Elfa-emitted market trigger.

## Scope of this proof

Together, these runs prove the KeeperHub workflow, Base transaction, live Worker deployment,
genuine Elfa signed delivery, signature contract, routing, duplicate guard, lifecycle guard,
refusal ladder, balance guard, and Telegram notification.

The live price-floor refusal still needs a funded balance above `0.0025 ETH`. The test suite pins
the quote condition and swap minimum to the same fixed value and fails if either value changes.
The live balance refusal above proves that a false condition selects a notification branch without
reaching the swap.

KeeperHub's workflow simulator reported zero simulated nodes because it supports the generic
`web3/transfer-funds`, `web3/transfer-token`, and `web3/write-contract` actions, not the
protocol-specific `uniswap/swap-exact-input` node. The successful receipt provides the execution
evidence for this action.
