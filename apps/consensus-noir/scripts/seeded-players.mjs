/*
 * The two seeded players used to pre-fill a rolling case.
 *
 * These players are positional, not tied to any particular wallet: the
 * caller resolves account names from the environment and pairs them by
 * index, so nothing here depends on one person's keychain.
 *
 * Shared by prepare_rolling_case.mjs (which enters them) and
 * reveal_seeded.mjs (which reveals them), so the commitment and the reveal
 * can never drift apart.
 */

/* Two seeded players who are wrong in different ways, so a visitor who reads
 * the file carefully can out-earn them rather than merely tie. */
export const SEEDED = {
  pressroom: [
    {
      suspect: "SUSPECT-A",
      picks: ["EVIDENCE-04", "EVIDENCE-02", "EVIDENCE-05"],
      salt: "a".repeat(32),
      theory:
        "The night editor has no one to vouch for her. The wire room ledger carries no entry " +
        "between 03:20 and 04:15, which is precisely the window in which the plate was pulled, " +
        "and she is the last person recorded handling it. The loading bay opens only from the " +
        "pressroom floor, so whoever left with the parcel was inside the building rather than " +
        "arriving at it. Read together with the empty car outside, the simplest account is that " +
        "the person who signed the plate off is the person who removed it, and that the fault " +
        "story was assembled afterwards to cover a gap she could not otherwise explain.",
    },
    {
      suspect: "SUSPECT-C",
      picks: ["EVIDENCE-05", "EVIDENCE-02", "EVIDENCE-04"],
      salt: "b".repeat(32),
      theory:
        "The aide's account is the only one the records flatly contradict. He places himself in " +
        "the publisher's car until four, yet the vehicle log has that car parked and empty from " +
        "half past three. Somebody opened the loading bay from the inside at 03:41 and a courier " +
        "took an unlisted parcel at 04:06, which is exactly the errand an aide who carries " +
        "messages nobody writes down would be asked to run. The editor's missing ledger entry is " +
        "suggestive but it places her nowhere in particular, whereas the aide has both a broken " +
        "alibi and an obvious reason to be moving a parcel before dawn.",
    },
  ],
  glasshouse: [
    {
      suspect: "SUSPECT-A",
      picks: ["EVIDENCE-02", "EVIDENCE-05", "EVIDENCE-01"],
      salt: "a".repeat(32),
      theory:
        "The night curator knows the building better than anyone and the latch released from the " +
        "inside, which limits this to somebody already past the doors. The badge event in the east " +
        "corridor and the radio request from that same corridor both describe movement away from " +
        "the glasshouse rather than towards it, and the curator is the person whose duties put her " +
        "on that route at that hour. The maintenance window on the cameras is too convenient to be " +
        "coincidence, and she is the one who would know when it fell.",
    },
    {
      suspect: "SUSPECT-C",
      picks: ["EVIDENCE-02", "EVIDENCE-05", "EVIDENCE-03"],
      salt: "b".repeat(32),
      theory:
        "The security liaison places herself in the archive corridor, which is exactly where the " +
        "badge and the radio traffic put activity at 02:26. Somebody who is already stationed in a " +
        "corridor does not need to request passage through it, and that request is the detail her " +
        "account cannot absorb. The reflected repair case is suggestive of the restoration lead but " +
        "a reflection is a weaker record than an access log, so the access trail should carry more " +
        "weight than the camera here.",
    },
  ],
};
