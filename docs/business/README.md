# Business

Vibe Business's own go-to-market and business-building documentation.

Vibe Business is its own first customer, so the work of turning this product
into a business is documented here rather than left implicit — positioning,
ICP, pricing, GTM, SEO, paid acquisition, experiments and unit economics.

The reason is not tidiness. Every manual business task done here is potential
product discovery: the question asked each time is whether Vibe Business could
later do this for a customer. See
[PROJECT_HISTORY_AND_LEARNINGS.md](../PROJECT_HISTORY_AND_LEARNINGS.md) §31–§34.

Documents are added when there is something real to record. This directory is
deliberately empty until then — a placeholder file for every planned topic
would be a list of intentions pretending to be documentation.

## Documents

- [CREDIT_ECONOMICS.md](CREDIT_ECONOMICS.md) — Credit scale, margin analysis and
  pricing policy for Vibe's *predictable* operations, from real cost data.
- [ECONOMY_MODEL.md](ECONOMY_MODEL.md) — measured unit economics of **agentic
  execution**, from the runs that exist, plus the **Economy Intelligence** layer
  that predicts what the next one will cost and measures how wrong it was.
  Replaces the modelled Agent figures in CREDIT_ECONOMICS.md and corrects two of
  its claims. Analysis only; nothing in it is implemented as pricing.
- [CREDIT_PRICING_V1.md](CREDIT_PRICING_V1.md) — the sellable Product Unit, the
  execution-class model, and rate-card simulations. Design and simulation only;
  no rate card is activated by it.
- [CREDIT_RATE_CARD_LAUNCH_V1.md](CREDIT_RATE_CARD_LAUNCH_V1.md) — **the rate
  card that is live.** The full derivation of `launch-v1` from production usage
  data, the two stated assumptions behind it, the reservation maxima, what it
  deliberately did not change, and the six things it is not confident about.
  Unlike the three above, this one is activated: see
  [ADR 0061](../decisions/0061-launch-v1-operation-rate-card.md).

