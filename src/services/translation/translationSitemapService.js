import Blog from '../../models/Blog.js';
import LanguageConfiguration from '../../models/LanguageConfiguration.js';
import Listing from '../../models/Listing.js';
import TranslationRecord from '../../models/TranslationRecord.js';
import User from '../../models/User.js';
import AboutPage from '../../models/About.js';
import HowItWork from '../../models/howItWork.js';

const definitions = Object.freeze({
  listing: { Model: Listing, filter: { status: 'approved' }, segment: 'listings' },
  blog: { Model: Blog, filter: { status: 'published' }, segment: 'blogs' },
  creatorProfile: { Model: User, filter: { role: 'creator', status: 'active' }, segment: 'profile' },
});

export const getPublicTranslationSitemap = async () => {
  const publishedLanguages = await LanguageConfiguration.find({ status: 'published' })
    .select('code isSource')
    .lean();
  const localizedCodes = publishedLanguages.filter(({ isSource }) => !isSource).map(({ code }) => code);
  if (!localizedCodes.length) return [];

  const records = await TranslationRecord.find({
    businessObjectType: { $in: [...Object.keys(definitions), 'cms'] },
    languageCode: { $in: localizedCodes },
    publicationStatus: 'published',
    businessObjectDeletedAt: null,
    slug: { $type: 'string', $ne: '' },
  }).select('businessObjectType businessObjectId languageCode slug updatedAt').lean();

  const publicIdsByType = new Map();
  await Promise.all(Object.entries(definitions).map(async ([type, { Model, filter }]) => {
    const ids = [...new Set(records.filter((record) => record.businessObjectType === type)
      .map((record) => record.businessObjectId))];
    const objects = ids.length ? await Model.find({ _id: { $in: ids }, ...filter }).select('_id').lean() : [];
    publicIdsByType.set(type, new Set(objects.map(({ _id }) => String(_id))));
  }));

  const cmsRecords = records.filter(({ businessObjectType }) => businessObjectType === 'cms');
  const [aboutIds, howPages] = await Promise.all([
    AboutPage.find({ _id: { $in: cmsRecords.map(({ businessObjectId }) => businessObjectId) } }).select('_id').lean(),
    HowItWork.find({ _id: { $in: cmsRecords.map(({ businessObjectId }) => businessObjectId) } }).select('_id pageName').lean(),
  ]);
  const cmsPaths = new Map(aboutIds.map(({ _id }) => [String(_id), 'about-us']));
  for (const page of howPages) cmsPaths.set(String(page._id), page.pageName || 'how-it-works');

  return records.flatMap((record) => {
    if (record.businessObjectType === 'cms') {
      const cmsPath = cmsPaths.get(String(record.businessObjectId));
      return cmsPath ? [{ path: `/${record.languageCode}/${cmsPath}`, locale: record.languageCode,
        objectType: 'cms', lastModified: record.updatedAt }] : [];
    }
    const definition = definitions[record.businessObjectType];
    if (!definition || !publicIdsByType.get(record.businessObjectType)?.has(String(record.businessObjectId))) return [];
    return [{
      path: `/${record.languageCode}/${definition.segment}/${record.slug}`,
      locale: record.languageCode,
      objectType: record.businessObjectType,
      lastModified: record.updatedAt,
    }];
  });
};
