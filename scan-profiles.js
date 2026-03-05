function normalizeSimple(raw) {
  return String(raw || "").trim().replace(/\s+/g, " ");
}

export function createScanProfiles(logic) {
  return [
    {
      id: "pi_full",
      label: "PI FULL",
      shortLabel: "PI-F",
      type: "PI",
      normalize(raw) {
        const normalized = logic.normalize(raw);
        const converted = logic.convert(normalized, "FULL");
        return converted || normalized;
      },
      validate(raw) {
        return logic.validate(raw, "FULL");
      },
      sample() {
        return `${logic.settings.fullPrefix}123456700`;
      },
    },
    {
      id: "pi_short",
      label: "PI SHORT",
      shortLabel: "PI-S",
      type: "PI",
      normalize(raw) {
        const normalized = logic.normalize(raw);
        const converted = logic.convert(normalized, "SHORT");
        return converted || normalized;
      },
      validate(raw) {
        return logic.validate(raw, "SHORT");
      },
      sample() {
        return `${logic.settings.shortPrefix}1234567`;
      },
    },
    {
      id: "sn_ritm",
      label: "ServiceNow RITM",
      shortLabel: "RITM",
      type: "RITM",
      normalize(raw) {
        return String(raw || "").toUpperCase().replace(/\s+/g, "");
      },
      validate(raw) {
        return /^RITM\d{7}$/.test(raw);
      },
      sample() {
        return "RITM1234567";
      },
    },
    {
      id: "sn_req",
      label: "ServiceNow REQ",
      shortLabel: "REQ",
      type: "REQ",
      normalize(raw) {
        return String(raw || "").toUpperCase().replace(/\s+/g, "");
      },
      validate(raw) {
        return /^REQ\d{7}$/.test(raw);
      },
      sample() {
        return "REQ1234567";
      },
    },
    {
      id: "sn_inc",
      label: "ServiceNow INC",
      shortLabel: "INC",
      type: "INC",
      normalize(raw) {
        return String(raw || "").toUpperCase().replace(/\s+/g, "");
      },
      validate(raw) {
        return /^INC\d{7}$/.test(raw);
      },
      sample() {
        return "INC1234567";
      },
    },
    {
      id: "sn_sctask",
      label: "ServiceNow SCTASK",
      shortLabel: "SCTASK",
      type: "SCTASK",
      normalize(raw) {
        return String(raw || "").toUpperCase().replace(/\s+/g, "");
      },
      validate(raw) {
        return /^SCTASK\d{7}$/.test(raw);
      },
      sample() {
        return "SCTASK1234567";
      },
    },
    {
      id: "qr",
      label: "QR Generic",
      shortLabel: "QR",
      type: "QR",
      normalize(raw) {
        return normalizeSimple(raw);
      },
      validate(raw) {
        return raw.length > 0;
      },
      sample() {
        return "https://example.com/qr/sample";
      },
    },
    {
      id: "api",
      label: "API Scan",
      shortLabel: "API",
      type: "API",
      normalize(raw) {
        return normalizeSimple(raw);
      },
      validate(raw) {
        return raw.length > 0;
      },
      sample() {
        return `API-SAMPLE-${Date.now().toString().slice(-6)}`;
      },
      async apiAction(normalized, apiSettings) {
        if (!apiSettings.enabled) {
          return { ok: false, reason: "api_disabled" };
        }
        if (!apiSettings.endpoint) {
          return { ok: false, reason: "missing_endpoint" };
        }

        const timeoutMs = Math.max(500, Math.min(15000, Number(apiSettings.timeoutMs || 4000)));
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const headers = {
            "Content-Type": "application/json",
          };
          if (apiSettings.token) {
            headers.Authorization = `Bearer ${apiSettings.token}`;
          }

          const response = await fetch(apiSettings.endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({ value: normalized, scannedAt: new Date().toISOString() }),
            signal: controller.signal,
          });

          const responseText = await response.text();
          return {
            ok: response.ok,
            status: response.status,
            body: responseText.slice(0, 300),
          };
        } catch (error) {
          return { ok: false, reason: error.name === "AbortError" ? "timeout" : "network_error" };
        } finally {
          clearTimeout(timer);
        }
      },
    },
    {
      id: "test",
      label: "Test Scan",
      shortLabel: "TEST",
      type: "TEST",
      normalize(raw) {
        return String(raw || "").trim();
      },
      validate(raw) {
        return /^TEST-[A-Z0-9-]{4,}$/.test(raw.toUpperCase());
      },
      sample() {
        return `TEST-${Date.now().toString(36).toUpperCase()}`;
      },
    },
  ];
}
