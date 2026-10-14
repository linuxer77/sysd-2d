/** Every technical word the game uses, explained in plain language. */
export interface GlossaryEntry { readonly term: string; readonly meaning: string }

export const GLOSSARY: readonly GlossaryEntry[] = [
  { term: "Request", meaning: "One visitor asking your system for something, such as opening a short link or creating a new one." },
  { term: "Lookup", meaning: "A request that only reads information that already exists, such as following a short link. In this game, about 100 out of every 101 requests are lookups." },
  { term: "Save", meaning: "A request that creates something new, such as making a new short link. Saving is more work for the database than looking something up." },
  { term: "Capacity", meaning: "How much work a piece can finish every second. Past this point, it starts turning requests away." },
  { term: "How full", meaning: "How much of a piece's capacity is being used. Below 80 percent is comfortable. Above 100 percent, requests are being turned away." },
  { term: "Delay", meaning: "How long a visitor waits for an answer, measured in milliseconds. A millisecond is one thousandth of a second." },
  { term: "The slowest one in a hundred", meaning: "If 100 visitors arrive, this is how long the slowest one waits. Good systems keep even this fast, because real people notice the slow ones." },
  { term: "Timeout", meaning: "How long a visitor waits before giving up on a request and treating it as failed." },
  { term: "Retry", meaning: "Trying a failed request again. Helpful when a failure is brief, harmful when the system is already overloaded, because retries add even more work." },
  { term: "Retry storm", meaning: "When failures cause retries, retries cause more work, and more work causes more failures. It feeds itself until the system collapses." },
  { term: "Circuit breaker", meaning: "A safety switch that stops retrying when too many requests are failing, giving the system room to recover. Named after the switch in a home fuse box." },
  { term: "Bottleneck", meaning: "The one piece that is too small for the traffic. The whole system can only go as fast as its bottleneck." },
  { term: "Cache hit and cache miss", meaning: "A hit means the cache already had the answer. A miss means it did not, so the request had to continue on to the database." },
  { term: "Backlog", meaning: "Work that has been accepted but not finished yet, waiting in line." },
  { term: "Out of date copy", meaning: "A read replica that has not yet received the latest change, so it briefly shows older information." },
  { term: "Error budget", meaning: "How many failed or slow requests your service is allowed before it has broken its promise to visitors. In this game it is your health bar: every failed or slow request spends some of it, and when it reaches zero you lose." },
  { term: "Requests per second", meaning: "How many requests arrive every second. Your busiest moments are called the peak." },
  { term: "Peak", meaning: "The busiest time. Systems must be built for the peak, not the average." },
];
