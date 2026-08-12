import mongoose from 'mongoose';
import TranslationRecord from '../../models/TranslationRecord.js';
import TranslationVersion from '../../models/TranslationVersion.js';
import TranslationAuditLog from '../../models/TranslationAuditLog.js';
import TranslationJob from '../../models/TranslationJob.js';
import TranslationProposal from '../../models/TranslationProposal.js';
import TranslationUsageEvent from '../../models/TranslationUsageEvent.js';
import TranslationReviewTask from '../../models/TranslationReviewTask.js';
import Listing from '../../models/Listing.js';
import User from '../../models/User.js';
import Category from '../../models/Category.js';
import Blog from '../../models/Blog.js';
import Faq from '../../models/Faq.js';
import AboutPage from '../../models/About.js';
import { Footer } from '../../models/Footer.js';
import HowItWork from '../../models/howItWork.js';
import {
  BUSINESS_OBJECT_TYPES,
  getCmsPageDefinition,
} from '../../config/businessObjectRegistry.js';
import { getSourceContentForObject } from './translationSourceContentService.js';
import { resolvePublishingPolicy } from './publishingWorkflowService.js';
import { listApplicableTerminology } from './translationTerminologyService.js';
import { getActiveEditLock } from './translationLockService.js';

const objectId = (value) => mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(value) : null;
const supportedTypes = new Set(Object.values(BUSINESS_OBJECT_TYPES));
const cmsPages = ['about', 'footer', 'how-it-works'];

const displayText = (record) =>
  Object.values(record.content || {}).find((value) => typeof value === 'string') ||
  (typeof record.content?.content === 'string' ? record.content.content : null);

const resolveMasterSummary = async (type, id) => {
  const models = {
    listing: Listing,
    creatorProfile: User,
    category: Category,
    blog: Blog,
    faq: Faq,
  };
  if (type === BUSINESS_OBJECT_TYPES.CMS) {
    for (const cmsKey of cmsPages) {
      const page = getCmsPageDefinition(cmsKey);
      const model = { AboutPage, Footer, HowItWork }[page.modelName];
      const document = await model.findById(id).select('_id pageName updatedAt').lean();
      if (document) return { id: document._id, label: page.label, cmsKey, modelName: page.modelName, updatedAt: document.updatedAt };
    }
    return null;
  }
  const document = await models[type]?.findById(id).lean();
  if (!document) return null;
  const label = type === 'creatorProfile'
    ? document.profile?.displayName || document.profile?.businessName || `${document.firstName || ''} ${document.lastName || ''}`.trim()
    : document.title || document.question || document.slug || String(document._id);
  return { id: document._id, label, slug: document.slug || null, updatedAt: document.updatedAt, creatorId: document.creatorId || (type === 'creatorProfile' ? document._id : null) };
};

const recordProjection = async (record) => {
  const master = await resolveMasterSummary(record.businessObjectType, record.businessObjectId);
  return {
    translationRecordId: record._id,
    businessObjectType: record.businessObjectType,
    businessObjectId: record.businessObjectId,
    languageCode: record.languageCode,
    translationStatus: record.translationStatus,
    publicationStatus: record.publicationStatus,
    reviewLevel: record.reviewLevel,
    updatedAt: record.updatedAt,
    displayText: displayText(record),
    master,
    creatorId: master?.creatorId || null,
  };
};

const buildSearchFilter = async ({ businessObjectType, languageCode, creatorId, translationStatus, publicationStatus, search }) => {
  const filter = {};
  if (businessObjectType && supportedTypes.has(businessObjectType)) filter.businessObjectType = businessObjectType;
  if (languageCode) filter.languageCode = String(languageCode).toLowerCase();
  if (translationStatus) filter.translationStatus = translationStatus;
  if (publicationStatus) filter.publicationStatus = publicationStatus;
  if (creatorId) {
    const id = objectId(creatorId);
    if (!id) return { _id: null };
    const listingIds = await Listing.find({ creatorId: id }).distinct('_id');
    filter.$or = [
      { businessObjectType: BUSINESS_OBJECT_TYPES.LISTING, businessObjectId: { $in: listingIds } },
      { businessObjectType: BUSINESS_OBJECT_TYPES.CREATOR_PROFILE, businessObjectId: id },
    ];
  }
  if (search?.trim()) {
    const id = objectId(search.trim());
    if (id) {
      filter.$and = [...(filter.$and || []), { $or: [{ _id: id }, { businessObjectId: id }] }];
    } else {
      const regex = new RegExp(search.trim(), 'i');
      const stringFields = ['content.title', 'content.description', 'content.name', 'content.bio', 'content.content', 'slug'];
      const textFilter = { $or: stringFields.map((field) => ({ [field]: regex })) };
      // CMS may only inspect direct string children of content.content; nested values are deliberately excluded.
      const cmsFilter = {
        businessObjectType: BUSINESS_OBJECT_TYPES.CMS,
        $expr: {
          $gt: [{ $size: { $filter: { input: { $objectToArray: { $ifNull: ['$content.content', {}] } }, as: 'entry', cond: { $and: [{ $eq: [{ $type: '$$entry.v' }, 'string'] }, { $regexMatch: { input: '$$entry.v', regex: search.trim(), options: 'i' } }] } } } }, 0],
        },
      };
      filter.$and = [...(filter.$and || []), { $or: [textFilter, cmsFilter] }];
    }
  }
  return filter;
};

export const searchTranslationRecords = async (query) => {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 20, 1), 100);
  const sortMap = { updatedAt: { updatedAt: -1 }, oldest: { updatedAt: 1 }, language: { languageCode: 1, updatedAt: -1 } };
  const filter = await buildSearchFilter(query);
  const [total, records] = await Promise.all([
    TranslationRecord.countDocuments(filter),
    TranslationRecord.find(filter).sort(sortMap[query.sort] || sortMap.updatedAt).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  return { records: await Promise.all(records.map(recordProjection)), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

export const getTranslationRecordsForBulk = async (query, { limit = 5_001 } = {}) => {
  const filter = await buildSearchFilter(query);
  return TranslationRecord.find(filter)
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();
};

export const getTranslationDashboard = async () => {
  const [records, jobs, failures, usage] = await Promise.all([
    TranslationRecord.aggregate([{
      $facet: {
        byStatus: [{ $group: { _id: '$translationStatus', count: { $sum: 1 } } }],
        byPublication: [{ $group: { _id: '$publicationStatus', count: { $sum: 1 } } }],
        byReview: [{ $group: { _id: '$reviewLevel', count: { $sum: 1 } } }],
        byProvider: [{ $group: { _id: '$metadata.provider', count: { $sum: 1 } } }],
        memoryHits: [{ $group: { _id: '$metadata.memoryHit', count: { $sum: 1 } } }],
        confidence: [{
          $bucket: {
            groupBy: '$metadata.confidence',
            boundaries: [0, 0.5, 0.8, 1.000001],
            default: 'unavailable',
            output: { count: { $sum: 1 } },
          },
        }],
      },
    }]),
    TranslationJob.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    TranslationAuditLog.find({ outcome: 'failure' }).sort({ createdAt: -1 }).limit(10).lean(),
    TranslationUsageEvent.aggregate([{ $group: { _id: '$outcome', events: { $sum: 1 }, inputTokens: { $sum: '$inputTokens' }, outputTokens: { $sum: '$outputTokens' }, totalTokens: { $sum: '$totalTokens' }, averageLatencyMs: { $avg: '$latencyMs' }, memoryHits: { $sum: { $cond: ['$memoryHit', 1, 0] } } } }]),
  ]);
  return { records: records[0] || {}, jobs, recentFailures: failures, usage, cost: { available: false, value: null } };
};

export const getBulkOperationSummary = async (bulkOperationId) => {
  const jobFilter = { 'context.bulkOperationId': bulkOperationId };
  const [summary, jobIds] = await Promise.all([
    TranslationJob.aggregate([
      { $match: jobFilter },
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          failures: [{
            $match: { status: { $in: ['failed', 'dead_letter'] } },
          }, {
            $group: { _id: '$failure.code', count: { $sum: 1 } },
          }],
          total: [{ $count: 'count' }],
        },
      },
    ]),
    TranslationJob.find(jobFilter).distinct('jobId'),
  ]);
  const usage = jobIds.length
    ? await TranslationUsageEvent.aggregate([
      { $match: { jobId: { $in: jobIds } } },
      {
        $group: {
          _id: '$outcome',
          events: { $sum: 1 },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          totalTokens: { $sum: '$totalTokens' },
          averageLatencyMs: { $avg: '$latencyMs' },
        },
      },
    ])
    : [];
  const aggregate = summary[0] || {};
  return {
    bulkOperationId,
    total: aggregate.total?.[0]?.count || 0,
    byStatus: aggregate.byStatus || [],
    failures: aggregate.failures || [],
    usage,
  };
};

export const listBulkOperationJobs = async (bulkOperationId, query = {}) => {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 50, 1), 100);
  const filter = {
    'context.bulkOperationId': bulkOperationId,
    ...(query.status ? { status: query.status } : {}),
  };
  const [total, jobs] = await Promise.all([
    TranslationJob.countDocuments(filter),
    TranslationJob.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);
  return { jobs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

export const getTranslationOperationalExportData = async (query) => {
  const records = await getTranslationRecordsForBulk(query, { limit: 50_001 });
  if (records.length > 50_000) {
    const error = new Error('Translation export is limited to 50,000 records');
    error.code = 'TRANSLATION_EXPORT_LIMIT_EXCEEDED';
    throw error;
  }
  const objectIds = records.map((record) => record.businessObjectId);
  const [jobs, usage] = objectIds.length
    ? await Promise.all([
      TranslationJob.find({ businessObjectId: { $in: objectIds } }).sort({ createdAt: -1 }).lean(),
      TranslationUsageEvent.find({ businessObjectId: { $in: objectIds } }).sort({ createdAt: -1 }).lean(),
    ])
    : [[], []];
  return { records, jobs, usage };
};

export const getTranslationRecordDetails = async (translationRecordId) => {
  const id = objectId(translationRecordId);
  const record = id && await TranslationRecord.findById(id).lean();
  if (!record) { const error = new Error('Translation record not found'); error.code = 'TRANSLATION_NOT_FOUND'; throw error; }
  const [versions, audit, jobs, proposals, master, source, policy, terminology, editLock, reviewTasks] = await Promise.all([
    TranslationVersion.find({ translationRecordId: id }).sort({ versionNumber: -1 }).lean(),
    TranslationAuditLog.find({ translationRecordId: id }).sort({ createdAt: -1 }).lean(),
    TranslationJob.find({ businessObjectType: record.businessObjectType, businessObjectId: record.businessObjectId, targetLanguageCode: record.languageCode }).sort({ createdAt: -1 }).lean(),
    TranslationProposal.find({ translationRecordId: id }).sort({ createdAt: -1 }).lean(),
    resolveMasterSummary(record.businessObjectType, record.businessObjectId),
    getSourceContentForObject({
      businessObjectType: record.businessObjectType,
      businessObjectId: record.businessObjectId,
    }).catch(() => null),
    resolvePublishingPolicy({
      businessObjectType: record.businessObjectType,
      languageCode: record.languageCode,
    }),
    listApplicableTerminology({ sourceLanguageCode: 'en', targetLanguageCode: record.languageCode }),
    getActiveEditLock({ translationRecordId: id }),
    TranslationReviewTask.find({ translationRecordId: id }).sort({ createdAt: -1 }).populate('assignee completedBy', 'firstName lastName email').lean(),
  ]);
  const usage = await TranslationUsageEvent.find({ jobId: { $in: jobs.map((job) => job.jobId) } }).sort({ createdAt: -1 }).lean();
  return {
    record,
    master,
    versions,
    audit,
    jobs,
    usage,
    proposals,
    sourceContent: source?.sourceContent || null,
    sourceVersion: source?.sourceVersion || null,
    policy,
    terminology,
    editLock,
    reviewTasks,
  };
};
