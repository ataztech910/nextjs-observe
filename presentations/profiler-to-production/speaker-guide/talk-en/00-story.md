# The story running through the talk

**Thread:** the report is green, but the user loses. And the report is telling the truth.

This happens twice, and both times we follow the same path:

1. The standard tool says everything is fine.
2. We ask: what was the user waiting for?
3. We open a tool that can see it, and locate the work.
4. A simple mark or counter explains the cause.
5. One line fixes it.
6. A CI check stops it from coming back.

## Acts

| Act | Slides | What happens in the story |
| --- | --- | --- |
| Opening | 1–3 | Lighthouse 100, a button clicked, nothing happens. No answer yet. Who I am and why this interests me. |
| Why this happens | 4–8 | “Fast” has three meanings. Each number answers its own question. The order we will follow in our investigation. |
| Web: the button is there, the code is not | 9–18 | We solve the opening puzzle. The cause is in the second part of the page, which the user was not even waiting for. |
| Bridge | 19–20 | On the web, it was visible but did not work. On mobile, the opposite: the screen is gone, but the work continues. |
| RN: the screen is gone, the work continues | 21–26 | React Profiler shows no screen renders, Hermes shows sorting, a counter reveals thirty subscriptions. |
| Keeping the bugs out | 27–29 | A profile explains the cause once; a check catches its return on every PR. |
| Resolution | 30–32 | Back to the opening: neither the report nor the user was wrong. We asked the wrong question. How to choose a tool for the question. |

## Writing rules

- **Tell a story, rather than quoting the slides.** Each slide moves the plot forward. It has someone involved—the shopper, the team, me—something happening, and a consequence: something we learn, or something that is still wrong.
- Work the card’s points into the action. Instead of “number X means Y,” say “the team opens X and sees Y.”
- Test each paragraph: if it stands alone without the previous slide and does not move the story forward, it is a retelling of the card. Rewrite it.
- The card is an illustration. The audience can see it themselves.
- End each slide with a question or unresolved point that the next slide addresses.
- Use only numbers from the cards and research. Do not round them in our favour.
- Avoid stock phrases: “let’s dive in,” “key,” “truly,” “magic,” “not just X but Y,” “imagine.”
