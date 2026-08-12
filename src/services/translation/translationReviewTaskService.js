import TranslationReviewTask from '../../models/TranslationReviewTask.js';
import TranslationRecord from '../../models/TranslationRecord.js';
import { recordTranslationEvent } from './translationAuditService.js';
import TranslationRole from '../../models/TranslationRole.js';
import { queueTranslationNotification } from './translationNotificationService.js';

const openStatuses = ['pending', 'assigned', 'in_review', 'returned_for_modification'];
const notFound = () => Object.assign(new Error('Translation review task not found'), { code: 'TRANSLATION_REVIEW_TASK_NOT_FOUND' });
export const resolveReviewTaskAuditActor = (actor) => ({
  actorType: actor ? 'admin' : 'system',
  actor: actor || null,
  actorSnapshot: { role: actor ? 'admin' : 'system' },
});

const audit = (task, actor, eventType, details, session) => recordTranslationEvent({
  eventType, outcome: 'success', businessObjectType: task.businessObjectType,
  businessObjectId: task.businessObjectId, languageCode: task.languageCode,
  translationRecordId: task.translationRecordId, ...resolveReviewTaskAuditActor(actor), details,
}, { session });

const notifyRoleMembers = async (task, eventType, payload, session) => {
  const roles = await TranslationRole.find({ isActive: true, permissions: 'translation.centre.read' }).select('members').session(session).lean();
  const recipients = [...new Set(roles.flatMap((role) => role.members.map(String)))];
  await Promise.all(recipients.map((recipient) => queueTranslationNotification({
    recipient, eventType, businessObjectType: task.businessObjectType, businessObjectId: task.businessObjectId,
    languageCode: task.languageCode, translationRecordId: task.translationRecordId, payload,
  }, { session })));
};

export const createOrReopenManualReviewTask = async ({ record, policy, actor = null, comment = null }, { session = null } = {}) => {
  if (policy?.publicationMode !== 'manual_review') return null;
  let task = await TranslationReviewTask.findOne({ translationRecordId: record._id, status: { $in: openStatuses } }).session(session);
  if (task) return task;
  task = new TranslationReviewTask({
    translationRecordId: record._id, businessObjectType: record.businessObjectType,
    businessObjectId: record.businessObjectId, languageCode: record.languageCode,
    policySnapshot: { version: policy.version, publicationMode: policy.publicationMode },
    status: 'pending', history: [{ action: 'submitted', actor, comment }],
    businessObjectDeletedAt: record.businessObjectDeletedAt || null,
  });
  await task.save({ session });
  await audit(task, actor, 'translation.review_task_created', { taskId: task._id, policyVersion: policy.version }, session);
  await notifyRoleMembers(task, 'review_requested', { taskId: task._id }, session);
  return task;
};

export const listManualReviewTasks = async (query = {}) => {
  const filter = query.includeCompleted === 'true' ? {} : { status: { $in: openStatuses } };
  if (query.status) filter.status = query.status;
  if (query.assignee) filter.assignee = query.assignee;
  const tasks = await TranslationReviewTask.find(filter).sort({ updatedAt: -1 }).populate('assignee', 'firstName lastName email').lean();
  return tasks;
};

export const assignTranslationReviewTask = async ({ taskId, assigneeId, actorId }, { session = null } = {}) => {
  const task = await TranslationReviewTask.findById(taskId).session(session);
  if (!task) throw notFound();
  if (!openStatuses.includes(task.status)) throw Object.assign(new Error('Completed review task cannot be assigned'), { code: 'TRANSLATION_REVIEW_TASK_CLOSED' });
  task.assignee = assigneeId;
  task.status = 'assigned';
  task.history.push({ action: 'assigned', actor: actorId });
  await task.save({ session });
  await audit(task, actorId, 'translation.review_assigned', { taskId: task._id, assigneeId }, session);
  await queueTranslationNotification({ recipient: assigneeId, eventType: 'review_assigned', businessObjectType: task.businessObjectType, businessObjectId: task.businessObjectId, languageCode: task.languageCode, translationRecordId: task.translationRecordId, payload: { taskId: task._id } }, { session });
  return task;
};

export const claimTranslationReviewTask = async ({ taskId, actorId }, options) => {
  const task = await assignTranslationReviewTask({ taskId, assigneeId: actorId, actorId }, options);
  task.status = 'in_review'; task.history.push({ action: 'claimed', actor: actorId });
  await task.save({ session: options?.session || null });
  return task;
};

export const completeTranslationReviewTask = async ({ taskId, actorId, outcome, comment = null }, { session = null } = {}) => {
  const task = await TranslationReviewTask.findById(taskId).session(session);
  if (!task) throw notFound();
  if (!openStatuses.includes(task.status)) throw Object.assign(new Error('Review task is already closed'), { code: 'TRANSLATION_REVIEW_TASK_CLOSED' });
  task.status = outcome; task.completedBy = actorId; task.completedAt = new Date();
  task.history.push({ action: outcome, actor: actorId, comment });
  await task.save({ session });
  await audit(task, actorId, `translation.review_${outcome}`, { taskId: task._id, comment }, session);
  if (task.assignee && String(task.assignee) !== String(actorId)) await queueTranslationNotification({ recipient: task.assignee, eventType: 'review_outcome', businessObjectType: task.businessObjectType, businessObjectId: task.businessObjectId, languageCode: task.languageCode, translationRecordId: task.translationRecordId, payload: { taskId: task._id, outcome } }, { session });
  return task;
};

export const reopenReviewTaskForRecord = async ({ translationRecordId, actorId, comment = null }, { session = null } = {}) => {
  const task = await TranslationReviewTask.findOne({ translationRecordId }).sort({ updatedAt: -1 }).session(session);
  if (!task) return null;
  task.status = 'pending'; task.assignee = null; task.completedBy = null; task.completedAt = null;
  task.history.push({ action: 'reopened', actor: actorId, comment });
  await task.save({ session });
  await audit(task, actorId, 'translation.review_reopened', { taskId: task._id }, session);
  return task;
};
