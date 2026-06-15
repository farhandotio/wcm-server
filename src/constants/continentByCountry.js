const isoToContinent = {

    // ── Asia ──────────────────────────────────────────────
    AF: 'asia', AM: 'asia', AZ: 'asia', BD: 'asia', BT: 'asia',
    BN: 'asia', KH: 'asia', CN: 'asia', GE: 'asia', IN: 'asia',
    ID: 'asia', JP: 'asia', KZ: 'asia', KG: 'asia', LA: 'asia',
    MY: 'asia', MV: 'asia', MN: 'asia', MM: 'asia', NP: 'asia',
    PK: 'asia', PH: 'asia', RU: 'asia', SG: 'asia', LK: 'asia',
    TW: 'asia', TJ: 'asia', TH: 'asia', TL: 'asia', TM: 'asia',
    UZ: 'asia', VN: 'asia', KP: 'asia', KR: 'asia', HK: 'asia',
    MO: 'asia', CC: 'asia', CX: 'asia', IO: 'asia',

    // ── Middle East ───────────────────────────────────────
    BH: 'middle-east', CY: 'middle-east', EG: 'middle-east', IR: 'middle-east', IQ: 'middle-east',
    IL: 'middle-east', JO: 'middle-east', KW: 'middle-east', LB: 'middle-east', OM: 'middle-east',
    PS: 'middle-east', QA: 'middle-east', SA: 'middle-east', SY: 'middle-east', AE: 'middle-east',
    YE: 'middle-east', TR: 'middle-east',

    // ── Europe ────────────────────────────────────────────
    AL: 'europe', AD: 'europe', AT: 'europe', BY: 'europe', BE: 'europe',
    BA: 'europe', BG: 'europe', HR: 'europe', CZ: 'europe', DK: 'europe',
    EE: 'europe', FI: 'europe', FR: 'europe', DE: 'europe', GR: 'europe',
    HU: 'europe', IS: 'europe', IE: 'europe', IT: 'europe', XK: 'europe',
    LV: 'europe', LI: 'europe', LT: 'europe', LU: 'europe', MT: 'europe',
    MD: 'europe', MC: 'europe', ME: 'europe', NL: 'europe', MK: 'europe',
    NO: 'europe', PL: 'europe', PT: 'europe', RO: 'europe', SM: 'europe',
    RS: 'europe', SK: 'europe', SI: 'europe', ES: 'europe', SE: 'europe',
    CH: 'europe', UA: 'europe', GB: 'europe', VA: 'europe', AX: 'europe',
    GI: 'europe', FO: 'europe', SJ: 'europe', JE: 'europe', GG: 'europe',
    IM: 'europe', BV: 'europe', GS: 'europe',

    // ── Africa ────────────────────────────────────────────
    DZ: 'africa', AO: 'africa', BJ: 'africa', BW: 'africa', BF: 'africa',
    BI: 'africa', CV: 'africa', CM: 'africa', CF: 'africa', TD: 'africa',
    KM: 'africa', CG: 'africa', CD: 'africa', DJ: 'africa', ER: 'africa',
    SZ: 'africa', ET: 'africa', GA: 'africa', GM: 'africa', GH: 'africa',
    GN: 'africa', GW: 'africa', CI: 'africa', KE: 'africa', LS: 'africa',
    LR: 'africa', LY: 'africa', MG: 'africa', MW: 'africa', ML: 'africa',
    MR: 'africa', MU: 'africa', MA: 'africa', MZ: 'africa', NA: 'africa',
    NE: 'africa', NG: 'africa', RW: 'africa', ST: 'africa', SN: 'africa',
    SL: 'africa', SO: 'africa', ZA: 'africa', SS: 'africa', SD: 'africa',
    TZ: 'africa', TG: 'africa', TN: 'africa', UG: 'africa', ZM: 'africa',
    ZW: 'africa', EH: 'africa', RE: 'africa', YT: 'africa', SH: 'africa',
    TF: 'africa', GQ: 'africa',

    // ── North America ─────────────────────────────────────
    AG: 'north-america', BS: 'north-america', BB: 'north-america', BZ: 'north-america', CA: 'north-america',
    CR: 'north-america', CU: 'north-america', DM: 'north-america', DO: 'north-america', SV: 'north-america',
    GD: 'north-america', GT: 'north-america', HT: 'north-america', HN: 'north-america', JM: 'north-america',
    MX: 'north-america', NI: 'north-america', PA: 'north-america', KN: 'north-america', LC: 'north-america',
    VC: 'north-america', TT: 'north-america', US: 'north-america', AI: 'north-america', AW: 'north-america',
    BM: 'north-america', BQ: 'north-america', CW: 'north-america', GL: 'north-america', GP: 'north-america',
    KY: 'north-america', MQ: 'north-america', MS: 'north-america', PR: 'north-america', SX: 'north-america',
    TC: 'north-america', VG: 'north-america', VI: 'north-america', PM: 'north-america', MF: 'north-america',
    BL: 'north-america', UM: 'north-america',

    // ── Latin America ─────────────────────────────────────
    AR: 'latin-america', BO: 'latin-america', BR: 'latin-america', CL: 'latin-america', CO: 'latin-america',
    EC: 'latin-america', GY: 'latin-america', PY: 'latin-america', PE: 'latin-america', SR: 'latin-america',
    UY: 'latin-america', VE: 'latin-america', FK: 'latin-america', GF: 'latin-america',

    // ── Oceania ───────────────────────────────────────────
    AU: 'oceania', FJ: 'oceania', KI: 'oceania', MH: 'oceania', FM: 'oceania',
    NR: 'oceania', NZ: 'oceania', PW: 'oceania', PG: 'oceania', WS: 'oceania',
    SB: 'oceania', TO: 'oceania', TV: 'oceania', VU: 'oceania', AS: 'oceania',
    CK: 'oceania', GU: 'oceania', MP: 'oceania', NC: 'oceania', NF: 'oceania',
    NU: 'oceania', PF: 'oceania', PN: 'oceania', TK: 'oceania', WF: 'oceania',
    HM: 'oceania', AQ: 'oceania',

};

export const getContinentByIsoCode = (isoCode) => {
    if (!isoCode) return 'asia';
    return isoToContinent[isoCode.toUpperCase()] ?? 'asia';
};