# Passport

**An on-chain record of what an AI agent actually does.**

An operator registers an agent — an HTTPS endpoint — and a few claims from a closed
list: which model family answers, what it can do, whether it ignores instructions
smuggled into its input. Anybody can ask for an inspection. Five validators each
send the agent the same public battery, independently, and judge every claim with
one of three words: `matches`, `contradicts`, `inconclusive`. A passport is issued
only when every validator saw every claim hold. A refusal is stored too, with the
reason, and is as readable as an issue.

This is not a proof of which model sits behind an endpoint — no such proof exists.
It is five independent observers agreeing on behaviour, and it says
*inconclusive* whenever the behaviour did not settle the question.

Built for the GenLayer Agent Tank hackathon, September 2026. Work in progress;
evidence and the full write-up land with the deployment.
