"""Per-token pricing.

Free-proxy models cost $0 but tokens are still metered so the cost
dashboard and budget caps (P7) behave identically once paid models
are routed in. Prices are USD per 1M tokens (input, output).
"""

PRICES: dict[str, tuple[float, float]] = {
    "claude-sonnet": (3.00, 15.00),
    "claude-haiku": (1.00, 5.00),
}


def cost_usd(model: str, tokens_in: int, tokens_out: int) -> float:
    for prefix, (price_in, price_out) in PRICES.items():
        if model.startswith(prefix):
            return (tokens_in * price_in + tokens_out * price_out) / 1_000_000
    return 0.0
