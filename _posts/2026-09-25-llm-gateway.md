---
layout: post
title: "The LLM gateway behind a voice-and-text assistant"
lede: "An assistant that talks, summarizes, extracts and searches makes very different model calls. Here's the gateway they all go through, and what running it taught me."
description: "A model policy per job, fallbacks you've actually tested, a check for the backups nobody calls, and two guardrails: a hard budget and no personal data leaving."
tags: [ai-architecture, llm]
image: /assets/img/og-llm-layer.png
---

Our assistant talks to people by voice and by text. Behind that, it
summarizes conversations, pulls structured data out of documents, sorts
requests, and searches by meaning. Every one of those is a model call, and
they want very different things from it.

Voice wants the fastest possible first word. Extraction wants JSON that
always parses. Summaries want long context and a low bill. Embeddings want
something none of the others care about: never changing.

Picking good models is the easy part. The interesting decisions are in the
gateway between the product and the models: how each job gets the right one,
what happens when it fails, and what the gateway refuses to do.

![Every use case goes through one gateway, which picks a model per job and checks the spares](/assets/img/llm-layer.svg)

## One door, one policy per job

Every model call in the product goes through a single gateway. Application
code never talks to a provider directly, and only one file knows which
libraries sit underneath. That boundary cost almost nothing to draw on day
one, and it's the reason switching providers later was a config change
instead of a refactor.

Behind the gateway there's a small registry. Each job gets its own policy: a
first-choice model, a list of fallbacks, a timeout, and a daily spending cap.
Put side by side, the policies show how differently the jobs behave:

```python
POLICIES = {
    # Tool calls must parse, Turkish must read well. Seconds are fine.
    CHAT: Policy(
        primary="provider-a/balanced-model",
        fallbacks=["provider-c/free-router", "provider-d/large-open-model"],
        timeout_s=45, daily_cap_usd=1.00,
    ),
    # The first word matters most. Predictable first, fastest second.
    VOICE_TURN: Policy(
        primary="provider-a/small-fast-model",
        fallbacks=["provider-b/fastest-model", "provider-c/free-router"],
        timeout_s=20, daily_cap_usd=1.00,
    ),
    # Background work: long context, low cost, plenty of time.
    SUMMARIZE: Policy(
        primary="provider-a/long-context-model",
        fallbacks=["provider-c/free-router"],
        timeout_s=60, daily_cap_usd=0.50,
    ),
    # Output must validate against a schema. Retries are cheap here.
    EXTRACT: Policy(
        primary="provider-a/balanced-model",
        fallbacks=["provider-c/free-router"],
        timeout_s=60, daily_cap_usd=0.50,
    ),
    # Small, cheap and consistent.
    CLASSIFY: Policy(
        primary="provider-a/small-fast-model",
        fallbacks=["provider-c/free-router"],
        timeout_s=30, daily_cap_usd=0.25,
    ),
    # No fallback: a second model means a second vector space.
    EMBED: Policy(
        primary="provider-a/embedding-model",
        fallbacks=[],
        timeout_s=30, daily_cap_usd=0.25,
    ),
}
```

Code that needs a model names the job, never the model:

```python
reply = await gateway.complete(CHAT, messages, tools=assistant_tools)
invoice = await gateway.complete(EXTRACT, messages, response_format=Invoice)
```

Changing a model is now a one-line pull request. I use LiteLLM underneath so
I don't have to write retries and fallbacks for every provider myself, but the
important part isn't the library. It's that the policy belongs to the job.

## A fallback is a promise. Test it.

It's easy to write a fallback list from reputation: "if this one fails, that
one is good too." I learned not to trust mine until I'd run it.

For voice, one provider was several times faster to the first word than
anything else, so it was the obvious first choice. Then its free tier ran out
of daily tokens in the middle of a real day, and every turn after that wasted
time on a doomed attempt before falling back. For a voice assistant,
predictable beats fast. The fast provider moved to second place, where it's
still useful.

When I had to replace a model, I didn't pick the one with the best
benchmark. I tried the candidates through our own code and checked the three
things that job actually needs: how fast the first word comes, whether the
Turkish reads naturally, and whether tool calls come back in a shape we can
parse. The fastest candidate failed the last one. Another answered quickly
but leaked its reasoning into the reply, which is exactly what a user would
have seen.

Embeddings taught me the opposite lesson: some jobs shouldn't have a
fallback at all. A backup chat model says the same thing in different words.
A backup embedding model puts your data in a different space. Nothing
crashes; searches just quietly stop finding things. So embeddings get one
model, and we store which model made each vector.

## The backup you never use is the one that's broken

Here's the uncomfortable part about fallbacks: the second model only runs
when the first one fails. So you find out it's gone on exactly the day you
need it.

Providers retire and rename models all the time. When I finally checked every
model in every chain, several had quietly disappeared, including one that
wasn't a backup at all. Our monitoring hadn't noticed, because monitoring
only sees calls that happen, and nobody was calling those models.

Now a small job checks every model on every list: first by asking the
provider what it serves, then with a real one-token request, because a model
can appear in the list and still refuse your account. And it treats "the
network hiccupped" differently from "the model is gone". A check that cries
wolf gets turned off.

## Two lines I don't cross

**Money.** Every job has a daily cap. When it's hit, the call fails loudly.
It doesn't quietly switch to a cheaper model, because that turns a cost
problem into a quality problem, and quality problems take much longer to
notice. Every call also records its tokens and cost into the same dashboards
as everything else, so spend sits right next to latency.

**Personal data.** Many apps handle foreign AI providers with a checkbox: "I
agree that my data may be processed abroad." Under Turkish data protection
law, that's a weak basis for something that happens on every single upload,
and consent that the app can't work without isn't really consent. So I made
it an architecture rule instead: what reaches a model abroad isn't personal
data. Names, ID numbers, phone numbers and addresses are removed before the
call, and anything that maps them back stays at home. A feature that can't
work that way doesn't ship.

## What I'd tell myself at the start

Put one door in front of your models on day one. Give each job its own
policy, and let the job decide what "best" means. Test your fallbacks like
you test your code, and check the backups nobody calls. And decide where your users' data is allowed to go
before the first feature needs an answer.
