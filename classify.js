const SN_PATTERNS = [
  { type: "RITM", regex: /^RITM\d+$/i },
  { type: "REQ", regex: /^REQ\d+$/i },
  { type: "INC", regex: /^INC\d+$/i },
  { type: "SCTASK", regex: /^SCTASK\d+$/i },
];

export function classifyScan(raw, logic) {
  const original = String(raw || "");
  const compact = original.trim().replace(/\s+/g, "");
  const upper = compact.toUpperCase();

  for (const p of SN_PATTERNS) {
    if (p.regex.test(upper)) {
      return {
        profileId: "auto",
        type: p.type,
        normalized: upper,
        modeLabel: p.type,
        source: "auto",
      };
    }
  }

  const piFull = logic.convert(upper, "FULL") || logic.normalize(upper);
  if (logic.validate(piFull, "FULL")) {
    return {
      profileId: "auto",
      type: "PI",
      normalized: piFull,
      piMode: "FULL",
      modeLabel: "PI",
      source: "auto",
    };
  }

  const piShort = logic.convert(upper, "SHORT") || logic.normalize(upper);
  if (logic.validate(piShort, "SHORT")) {
    return {
      profileId: "auto",
      type: "PI",
      normalized: piShort,
      piMode: "SHORT",
      modeLabel: "PI",
      source: "auto",
    };
  }

  return {
    profileId: "auto",
    type: "QR",
    normalized: original.trim(),
    modeLabel: "QR",
    source: "auto",
  };
}

export function classifyManualProfile(raw, profileId, logic) {
  const upper = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (profileId === "pi_full") {
    const normalized = logic.convert(upper, "FULL") || logic.normalize(upper);
    return { profileId, type: "PI", normalized, piMode: "FULL" };
  }
  if (profileId === "pi_short") {
    const normalized = logic.convert(upper, "SHORT") || logic.normalize(upper);
    return { profileId, type: "PI", normalized, piMode: "SHORT" };
  }

  const byProfile = {
    sn_ritm: "RITM",
    sn_req: "REQ",
    sn_inc: "INC",
    sn_sctask: "SCTASK",
    qr: "QR",
    test: "TEST",
  };

  const type = byProfile[profileId] || "QR";
  const normalized = type === "QR" ? String(raw || "").trim() : upper;
  return { profileId, type, normalized, piMode: "N/A" };
}
