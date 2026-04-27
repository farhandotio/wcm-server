import axios from 'axios';

// EU Countries Standard VAT Rates (2026 data based on OSS rules)
const EU_VAT_DATA = {
  AT: 20,
  BE: 21,
  BG: 20,
  CY: 19,
  CZ: 21,
  DE: 19,
  DK: 25,
  EE: 22,
  EL: 24,
  ES: 21,
  FI: 24,
  FR: 20,
  HR: 25,
  HU: 27,
  IE: 23,
  IT: 22,
  LT: 21,
  LU: 17,
  LV: 21,
  MT: 18,
  NL: 21,
  PL: 23,
  PT: 23,
  RO: 19,
  SE: 25,
  SI: 22,
  SK: 20,
};

const EU_COUNTRIES = Object.keys(EU_VAT_DATA);

export const calculateVAT = (countryCode, isBusiness, isValidVAT) => {
  const country = countryCode?.toUpperCase() || 'FR'; // সেফটি ডিফল্ট

  // Rule 1: France Creator (Always 20%)
  if (country === 'FR') {
    return { rate: 20, type: 'FRANCE_VAT' };
  }

  // Rule 2: EU Business with Valid VAT (Reverse Charge - 0%)
  if (EU_COUNTRIES.includes(country) && isBusiness && isValidVAT) {
    return { rate: 0, type: 'REVERSE_CHARGE' };
  }

  // Rule 3: EU Individual (VAT of their country via OSS)
  if (EU_COUNTRIES.includes(country)) {
    const rate = EU_VAT_DATA[country] || 20; 
    return { rate, type: 'EU_OSS' };
  }

  // Rule 4: Outside EU (No EU VAT)
  return { rate: 0, type: 'NON_EU' };
};

export const validateVatWithVIES = async (vatNumber) => {
  if (!vatNumber) return false;
  try {
    const response = await axios.get(`https://api.vatcomply.com/vat?vat_number=${vatNumber}`);
    return response.data.valid;
  } catch (error) {
    console.error('VAT Validation Error:', error.message);
    return false;
  }
};

