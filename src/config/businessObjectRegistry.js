export const BUSINESS_OBJECT_TYPES = Object.freeze({
  LISTING: 'listing',
  CREATOR_PROFILE: 'creatorProfile',
  CATEGORY: 'category',
  COLLECTION: 'collection',
  BLOG: 'blog',
  FAQ: 'faq',
  CMS: 'cms',
});

const defineObject = (definition) =>
  Object.freeze({
    ...definition,
    translatableFields: Object.freeze([...definition.translatableFields]),
    fixedFields: Object.freeze([...definition.fixedFields]),
    fieldAliases: Object.freeze({ ...definition.fieldAliases }),
  });

export const BUSINESS_OBJECT_REGISTRY = Object.freeze({
  [BUSINESS_OBJECT_TYPES.LISTING]: defineObject({
    modelNames: ['Listing'],
    translatableFields: ['title', 'description'],
    fixedFields: ['country', 'region', 'tradition', 'culturalTags', 'category'],
    fieldAliases: { title: 'title', description: 'description', slug: 'slug' },
    supportsLocalizedSlug: true,
    ownerPath: 'creatorId',
  }),
  [BUSINESS_OBJECT_TYPES.CREATOR_PROFILE]: defineObject({
    modelNames: ['User'],
    translatableFields: ['name', 'description', 'bio'],
    fixedFields: ['firstName', 'lastName', 'email', 'phone', 'country', 'countryCode', 'city'],
    fieldAliases: {
      name: ['profile.displayName', 'profile.businessName'],
      description: 'profile.bio',
      bio: 'profile.bio',
      slug: 'slug',
    },
    supportsLocalizedSlug: true,
    ownerPath: '_id',
  }),
  [BUSINESS_OBJECT_TYPES.CATEGORY]: defineObject({
    modelNames: ['Category'],
    translatableFields: ['title'],
    fixedFields: ['order'],
    fieldAliases: { title: 'title', slug: 'slug' },
    supportsLocalizedSlug: true,
    ownerPath: null,
  }),
  [BUSINESS_OBJECT_TYPES.COLLECTION]: defineObject({
    modelNames: ['Collection'],
    translatableFields: ['name', 'description'],
    fixedFields: ['key', 'listingIds', 'displayOrder', 'isActive'],
    fieldAliases: { name: 'name', description: 'description', slug: 'slug' },
    supportsLocalizedSlug: true,
    ownerPath: null,
  }),
  [BUSINESS_OBJECT_TYPES.BLOG]: defineObject({
    modelNames: ['Blog'],
    translatableFields: ['title', 'description'],
    fixedFields: ['author', 'category', 'tags', 'content', 'image', 'createdBy', 'status'],
    fieldAliases: { title: 'title', description: 'description', slug: 'slug' },
    supportsLocalizedSlug: true,
    ownerPath: null,
  }),
  [BUSINESS_OBJECT_TYPES.FAQ]: defineObject({
    modelNames: ['Faq'],
    translatableFields: ['title', 'description'],
    fixedFields: ['category', 'isActive'],
    fieldAliases: { title: 'question', description: 'answer' },
    supportsLocalizedSlug: false,
    ownerPath: null,
  }),
  [BUSINESS_OBJECT_TYPES.CMS]: defineObject({
    modelNames: ['AboutPage', 'Footer', 'HowItWork', 'CmsPage'],
    translatableFields: ['title', 'name', 'description', 'content'],
    fixedFields: ['href', 'styleSettings', 'image', 'images', 'order', 'rawHtml'],
    fieldAliases: {},
    supportsLocalizedSlug: true,
    ownerPath: null,
    allowedPageKeys: Object.freeze([
      'about',
      'footer',
      'how-it-works',
      'privacy-policy',
      'terms-and-conditions',
      'cookie-policy',
    ]),
  }),
});

export const getBusinessObjectDefinition = (businessObjectType) =>
  BUSINESS_OBJECT_REGISTRY[businessObjectType] || null;

export const isSupportedBusinessObjectType = (businessObjectType) =>
  Boolean(getBusinessObjectDefinition(businessObjectType));

export const validateTranslatableContent = (businessObjectType, content) => {
  const definition = getBusinessObjectDefinition(businessObjectType);

  if (!definition) {
    return {
      valid: false,
      invalidFields: [],
      invalidValues: [],
      reason: 'Unsupported business object type',
    };
  }

  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return {
      valid: false,
      invalidFields: [],
      invalidValues: [],
      reason: 'Content must be an object',
    };
  }

  const contentFields = Object.keys(content);

  if (!contentFields.length) {
    return {
      valid: false,
      invalidFields: [],
      invalidValues: [],
      reason: 'Content must not be empty',
    };
  }

  const invalidFields = contentFields.filter(
    (field) => !definition.translatableFields.includes(field)
  );

  const invalidValues = contentFields.filter((field) => {
    const value = content[field];

    if (businessObjectType === BUSINESS_OBJECT_TYPES.CMS && field === 'content') {
      return value === null || typeof value !== 'object';
    }

    return typeof value !== 'string' || !value.trim();
  });

  return {
    valid: invalidFields.length === 0 && invalidValues.length === 0,
    invalidFields,
    invalidValues,
    reason: invalidFields.length
      ? 'Content contains non-translatable fields'
      : invalidValues.length
        ? 'Translated fields must contain valid values'
        : null,
  };
};
