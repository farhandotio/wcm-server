export const STATIC_PAGE_REGISTRY = Object.freeze({
  'advertising-policy': Object.freeze({ label: 'Advertising Policy' }),
  'boost-terms-and-ppc': Object.freeze({ label: 'Boost Terms & PPC' }),
  'creator-terms-and-conditions': Object.freeze({ label: 'Creator Terms & Conditions' }),
  'privacy-policy': Object.freeze({ label: 'Privacy Policy' }),
  'terms-and-conditions': Object.freeze({ label: 'Terms & Conditions' }),
  'cookie-policy': Object.freeze({ label: 'Cookie Policy' }),
});

export const getStaticPageDefinition = (pageKey) => STATIC_PAGE_REGISTRY[pageKey] || null;

export const listStaticPageDefinitions = () => Object.entries(STATIC_PAGE_REGISTRY)
  .map(([pageKey, definition]) => ({ pageKey, label: definition.label }));
