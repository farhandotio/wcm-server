import Listing from '../../models/Listing.js';
import User from '../../models/User.js';
import Category from '../../models/Category.js';
import Blog from '../../models/Blog.js';
import Faq from '../../models/Faq.js';
import AboutPage from '../../models/About.js';
import { Footer } from '../../models/Footer.js';
import HowItWork from '../../models/howItWork.js';
import { BUSINESS_OBJECT_TYPES, getCmsPageDefinition } from '../../config/businessObjectRegistry.js';
import { buildCmsTranslatableContent } from './cmsTranslationTrigger.js';

const sourceNotFound = () => {
  const error = new Error('Translation source object not found');
  error.code = 'TRANSLATION_SOURCE_NOT_FOUND';
  return error;
};

const serializeSource = (document, sourceContent, extra = {}) => ({
  sourceContent,
  sourceVersion: document.updatedAt?.getTime(),
  ...extra,
});

const resolveCmsDocument = async (businessObjectId) => {
  const cmsPages = ['about', 'footer', 'how-it-works'];
  for (const cmsKey of cmsPages) {
    const definition = getCmsPageDefinition(cmsKey);
    const model = { AboutPage, Footer, HowItWork }[definition.modelName];
    const document = await model.findById(businessObjectId).lean();
    if (document) return { document, cmsKey };
  }
  return null;
};

export const getSourceContentForObject = async ({ businessObjectType, businessObjectId }) => {
  if (businessObjectType === BUSINESS_OBJECT_TYPES.LISTING) {
    const document = await Listing.findById(businessObjectId).lean();
    if (!document) throw sourceNotFound();
    return serializeSource(document, { title: document.title, description: document.description });
  }
  if (businessObjectType === BUSINESS_OBJECT_TYPES.CREATOR_PROFILE) {
    const document = await User.findById(businessObjectId).lean();
    if (!document) throw sourceNotFound();
    return serializeSource(document, {
      name: document.profile?.displayName || document.profile?.businessName,
      bio: document.profile?.bio,
    });
  }
  if (businessObjectType === BUSINESS_OBJECT_TYPES.CATEGORY) {
    const document = await Category.findById(businessObjectId).lean();
    if (!document) throw sourceNotFound();
    return serializeSource(document, { title: document.title });
  }
  if (businessObjectType === BUSINESS_OBJECT_TYPES.BLOG) {
    const document = await Blog.findById(businessObjectId).lean();
    if (!document) throw sourceNotFound();
    return serializeSource(document, { title: document.title, description: document.description });
  }
  if (businessObjectType === BUSINESS_OBJECT_TYPES.FAQ) {
    const document = await Faq.findById(businessObjectId).lean();
    if (!document) throw sourceNotFound();
    return serializeSource(document, { title: document.question, description: document.answer });
  }
  if (businessObjectType === BUSINESS_OBJECT_TYPES.CMS) {
    const resolved = await resolveCmsDocument(businessObjectId);
    if (!resolved) throw sourceNotFound();
    return serializeSource(resolved.document, buildCmsTranslatableContent(resolved.document), { cmsKey: resolved.cmsKey });
  }
  const error = new Error('Unsupported translation source object');
  error.code = 'UNSUPPORTED_BUSINESS_OBJECT';
  throw error;
};
