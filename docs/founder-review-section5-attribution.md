# Founder decision needed: 4 quarantined knowledge-base rows

**For:** Ali (with Marty on the commercial framing)
**Status:** these 4 rows are currently **silent** — Jackie will not use them for any claim
**Decision needed before:** they can be used in answers at all

## What happened

We added source-class licensing to the company/founder corpus so the agent can only
make a specific factual claim about Ali or Paramount when the retrieved chunk's class
licenses that kind of claim. Every founder chunk now carries one of four classes:

| Class | Means | Can it assert a delivered outcome? |
|---|---|---|
| `paramount-positioning` | general firm/founder capability and identity | No — needs a case citation |
| `paramount-delivery-outcome` | Paramount's own metric bullets from public profiles | No, deliberately non-assertable |
| `ali-personal-contract` | Ali's independent 2025–2026 engagements | Only when attributed to Ali personally |
| `ali-prior-employment` | Jazz, Bykea, Daraz, Bore & Bore | Only when attributed to Ali personally |

35 of 39 founder rows are now classified. **4 could not be classified safely**, so they
stay unclassified and quarantined. Unclassified means excluded from retrieval entirely —
fail-closed. Nothing wrong can ship from them; the cost is that Jackie has no access to
this material until you rule on it.

## The 4 rows

All four are from knowledge-base section 5, "ALI'S MAJOR ENTERPRISE AND
INVESTMENT-FIRM CONTEXT". The section title is the problem: it does not say whether
these are **Paramount's client references** or **Ali's personal engagement context**,
and the two get very different licensing.

| Row | Content is | Question |
|---|---|---|
| Battery Ventures | VC/PE firm profile (founded 1983, tech-focused) | Paramount relationship, or industry context? |
| Donaldson | Company profile (~$3.7B revenue, filtration) | Firm client, or backdrop for Ali's contract? |
| Ecolab | Company profile (sustainability/water/hygiene, scale figures) | Firm client, or industry context? |
| Waters Corp + BD Biosciences | Corporate combination announcement | Firm client, or market context? |

### The question, per row

> Is this row here because **Paramount has a relationship with this company**, or because
> it is **context for Ali's personal work / the market we sell into**?

- **Paramount client reference** → it belongs in the case corpus with a proper case
  record, not in the company corpus. It stays quarantined here.
- **Ali's personal engagement context** → class it `ali-personal-contract`, and Jackie
  will attribute it to Ali, never to the firm.
- **Neutral industry/market context, no engagement implied** → class it
  `paramount-positioning`, usable as general background.

## Two specific notes

**Battery Ventures — we checked, and it is cleaner than we assumed.** We searched the
entire case corpus (`CaseStudy` titles, descriptions, client names, overviews, and all
`CaseChunk` content) for all four company names. **Zero hits.** None of these companies
appear in the case corpus. So this is not a suspected case-study leak; it is a normal
"what is this row for" question.

One caveat worth knowing: cases are anonymized, so the absence of a company *name*
does not prove the absence of a *relationship*. If any of these four is the real client
behind an anonymized case, only you would know. That is precisely why we did not
auto-classify them.

**Donaldson appears twice, in two different classes.** Worth looking at as a pair:

| Chunk | Class | State |
|---|---|---|
| Section-5 Donaldson company profile (~$3.7B revenue) | unclassified | quarantined, silent |
| LinkedIn role: Independent Consultant — AI & Engineering | `ali-personal-contract` | active, attributed to Ali |

Today only the second is live, and it correctly reads as Ali's personal contract. If you
classify the first as usable, both could surface in the same answer — company financials
next to Ali's engagement. That is fine if Donaldson is a cleared, nameable reference. It
is not fine if Donaldson is also the client behind a confidential case, because the two
together would identify it. Your call, but decide these two as a set.

## Separately: one config flag still needs your position

`SUPPRESS_UNCLEARED_CLIENT_METRICS` currently defaults to **on** (conservative).

With it on, Jackie will not repeat the public Jazz (~$2M savings, 70M users) or Bykea
(~$4M margin) figures from Ali's LinkedIn, even though they are public and correctly
attributed to Ali. With it off, those figures can ship when attributed to Ali personally —
firm framing and case de-anonymization stay blocked either way.

This is a commercial/confidentiality judgment, not a technical one. It stays conservative
until you say otherwise.

## What we need back

1. For each of the 4 rows: client reference, Ali's personal context, or neutral background?
2. For Donaldson specifically: is it a nameable reference, or connected to a confidential case?
3. `SUPPRESS_UNCLEARED_CLIENT_METRICS`: stay on, or turn off?
