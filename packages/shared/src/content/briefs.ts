import type { PartId } from "@sysd/sim";

export interface Requirement {
  /** what the real-world problem statement asks for, in plain words */
  readonly need: string;
  /** what that means for the pieces you place */
  readonly meaning: string;
  /** which components are worth considering */
  readonly helpedBy: readonly PartId[];
  /** how the game checks it */
  readonly howItIsScored: string;
}

export interface Brief {
  readonly id: string;
  readonly title: string;
  readonly story: string;
  /** the single sentence a newcomer should hold on to */
  readonly yourGoal: string;
  readonly howToPlay: readonly string[];
  readonly requirements: readonly Requirement[];
  /** honesty about what this version does not test */
  readonly notScoredHere: string;
}

export const LINKSMASH_BRIEF: Brief = {
  id: "linksmash",
  title: "Linksmash: build a short link service",
  story:
    "People paste a long web address into your service and get back a short one. When anyone opens the short link, " +
    "your service looks up the original address and sends them there. " +
    "Your service has just become popular: about 100 million people open short links every day, " +
    "while only about 1 million new links are created. At its busiest moment, traffic is five times higher than average.",
  yourGoal:
    "Place and connect pieces so that short links can be created, opened quickly, and keep working when things go wrong, " +
    "all without spending more than your budget.",
  howToPlay: [
    "Drag a piece from the list on the left onto the board. Each piece costs money, and your budget is limited.",
    "Click one piece, then click another, to draw a line between them. Requests travel along these lines, starting from the visitors.",
    "Watch the coach on the right. It reads your design and tells you, in plain words, what is missing or risky.",
    "Press the test button to try an attack on your own design and see where it breaks. Breaking things in practice is the fastest way to learn.",
    "When you are ready, lock in your design. Then you and your opponent take turns attacking each other. The last service standing wins.",
  ],
  requirements: [
    {
      need: "People can create new short links.",
      meaning: "Creating a link means saving something new. Saved links must end up in a database, so every design needs one.",
      helpedBy: ["APP", "DB", "QUEUE", "WORKER"],
      howItIsScored: "Saving requests are tracked separately from lookups. If they cannot reach a database, they fail.",
    },
    {
      need: "People can open short links, and it is fast.",
      meaning: "Opening a link is a lookup, and lookups are about 100 times more common than saving. Answering them from memory is far faster than asking the database every time.",
      helpedBy: ["CACHE", "CDN", "REPLICA"],
      howItIsScored: "99 out of every 100 visitors must get an answer in under 100 milliseconds. Slower answers count as failures.",
    },
    {
      need: "It handles the busiest moments, five times the average.",
      meaning: "A system must be built for its peak, not its average. A crowd that is too big for any one piece makes that piece the bottleneck.",
      helpedBy: ["LB", "APP", "CACHE", "CDN"],
      howItIsScored: "The traffic spike attack sends 1.8 times your peak traffic for 30 seconds.",
    },
    {
      need: "It stays up when something breaks.",
      meaning: "Any single piece can crash. If one crash stops everything, that piece is a single point of failure. Spare copies remove it.",
      helpedBy: ["APP", "REPLICA", "LB"],
      howItIsScored: "The server crash attack takes down a piece your opponent chooses.",
    },
    {
      need: "Saved links are never lost.",
      meaning: "A database keeps data permanently. A waiting line holds work temporarily, so it must be emptied faster than it fills.",
      helpedBy: ["DB", "QUEUE", "WORKER"],
      howItIsScored: "If a waiting line overflows, the lost work is counted as damage.",
    },
  ],
  notScoredHere:
    "A real short link service also has to decide how to generate unique short codes, how to expire old links, and how to store " +
    "five years of history. Those are important, but they are software and storage details rather than the shape of your architecture, " +
    "so this game does not test them. It tests the part that makes or breaks a service under pressure: how the pieces are arranged.",
};
