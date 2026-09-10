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

## Scope of this proof

These executions prove the KeeperHub workflow, Base transaction, balance refusal, and Telegram
notification. Task 11 must add evidence for the Elfa-to-Worker path.

The live price-floor refusal still needs a funded balance above `0.0025 ETH`. The test suite pins
the quote condition and swap minimum to the same fixed value and fails if either value changes.
The live balance refusal above proves that a false condition selects a notification branch without
reaching the swap.

KeeperHub's workflow simulator reported zero simulated nodes because it supports the generic
`web3/transfer-funds`, `web3/transfer-token`, and `web3/write-contract` actions, not the
protocol-specific `uniswap/swap-exact-input` node. The successful receipt provides the execution
evidence for this action.
