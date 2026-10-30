"""The contest-results JSON format shared by 2022 history and 2026 election night.

It mirrors the VEC media feed (AEC mediafeed / EML schema) one-to-one, so the
same booth map and result panels read both:

  feed                                    JSON
  ----                                    ----
  Contest / PollingDistrictIdentifier  -> contest {district, name, enrolment, declared}
  FirstPreferences/Candidate           -> candidates[] {id, name, party, party_name,
                                          ballot_position, independent, elected}
                                          first_preferences {candidates, by_type, formal, informal, total}
  TwoCandidatePreferred                -> tcp {candidates, by_type}
  (not in the feed)                    -> distribution {candidates}: final count after preferences, or null
  PollingPlaces/PollingPlace           -> polling_places[] {id, name, classification, lat, lon,
                                          first_preferences, formal, informal, total, tcp}
  VotesByType/Votes@Type               -> by_type keys: Ordinary, EVCEarly, MobileVotingEarly,
                                          Early, Postal, Absent, MarkedAsVoted, Provisional

Candidate and polling-place ids are strings: feed ids where the feed provides
them, otherwise stable ids built by the importer. Vote maps are keyed by
candidate id. Anything the source doesn't publish is null or absent.
"""
FORMAT = "vec-contest-v1"

VOTE_TYPES = ["Ordinary", "EVCEarly", "MobileVotingEarly", "Early", "Postal", "Absent", "MarkedAsVoted", "Provisional"]

# Polling place classifications as the feed writes them
CLASSIFICATIONS = {
    "voting centre": "VotingCentre",
    "early voting centre": "EarlyVotingCentre",
    "election office": "ElectionOffice",
    "mobile voting": "MobileVoting",
}

# Party name (feed RegisteredName or VEC report label) -> site party code. First keyword match wins.
PARTY_KEYWORDS = [
    ("libertarian", "LBT"), ("liberal democrat", "LBT"), ("liberal", "LIB"), ("national", "NAT"),
    ("green", "GRN"), ("one nation", "ONP"), ("victorian socialists", "VS"), ("socialist alliance", "SAL"),
    ("animal justice", "AJP"), ("family first", "FF"), ("legalise cannabis", "LCV"), ("shooters", "SFF"),
    ("labour dlp", "DLP"), ("democratic labour", "DLP"), ("sustainable", "SUS"), ("new democrats", "ND"),
    ("west party", "WEST"), ("labor", "ALP"),
]

SCHEMA = {
    "description": "Contest results in the 'vec-contest-v1' format: the VEC media-feed structure (AEC mediafeed/EML) as JSON, so 2022 history and 2026 election-night results share one shape. See scripts/results_format.py.",
    "fields": {
        "format": "Always 'vec-contest-v1'",
        "event": "{name, date, source}",
        "phase": "final (2022) | ElectionNight | PostElection (feed phases)",
        "updated": "When the source was produced",
        "contest": "{district (site id), name, enrolment, declared}",
        "candidates": "[{id, name ('SURNAME, Given' as the VEC writes it), party (site code), party_name, ballot_position, independent, elected}]",
        "first_preferences": "{candidates: {id: votes}, by_type: {type: {id: votes}}, formal, informal, total}",
        "tcp": "Two-candidate-preferred (the VEC's indicative count, also published by polling place): {candidates: {id: votes}, by_type: {type: {id: votes}}}, or null before the 2CP count or when withheld",
        "distribution": "Final result after the full distribution of preferences: {candidates: {id: votes}} for the last two candidates, or null when not yet available (the media feed doesn't carry it). Its pair can differ from tcp's",
        "polling_places": "[{id, name, classification, lat, lon, first_preferences: {id: votes}, formal, informal, total, tcp: {id: votes} | null}]",
        "swing": "2022 only: change since the notional 2018 result (2021 boundaries), percentage points: {source, first_preferences: {id: pts}, tcp: {id: pts}}",
    },
}


def party_code(label, independent=False):
    if independent or not (label or "").strip():
        return "IND"
    low = label.lower()
    if "independent" in low:
        return "IND"
    return next((code for word, code in PARTY_KEYWORDS if word in low), "OTH")
