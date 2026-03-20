// EU Countries List (Simplified for check)
const EU_COUNTRIES = [
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'EL',
  'ES',
  'FI',
  'FR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
];

export const calculateVAT = (countryCode, isBusiness, isValidVAT) => {
  const country = countryCode?.toUpperCase();

  // Rule 1: France Creator
  if (country === 'FR') {
    return { rate: 20, type: 'FRANCE_VAT' };
  }

  // Rule 2: EU Business with Valid VAT (Reverse Charge)
  if (EU_COUNTRIES.includes(country) && isBusiness && isValidVAT) {
    return { rate: 0, type: 'REVERSE_CHARGE' };
  }

  // Rule 3: EU Individual (In production, you'd need a table of EU VAT rates)
  if (EU_COUNTRIES.includes(country)) {
    // For now using a placeholder or a specific country rate lookup
    // Client said: VAT of their country (Via OSS)
    return { rate: 21, type: 'EU_OSS' }; // Example: 21% average or lookup
  }

  // Rule 4: Non-EU
  return { rate: 0, type: 'NON_EU' };
};
