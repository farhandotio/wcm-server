import crypto from 'crypto';
import TranslationAuditLog from '../../models/TranslationAuditLog.js';

export const recordTranslationEvent = (event, { session = null } = {}) =>
  TranslationAuditLog.create(
    [
      {
        eventId: event.eventId || crypto.randomUUID(),
        eventType: event.eventType,
        outcome: event.outcome,
        businessObjectType: event.businessObjectType,
        businessObjectId: event.businessObjectId,
        languageCode: event.languageCode,
        translationRecordId: event.translationRecordId || null,
        translationVersionId: event.translationVersionId || null,
        actorType: event.actorType || 'system',
        actor: event.actor || null,
        actorSnapshot: event.actorSnapshot || { role: event.actorType || 'system' },
        requestId: event.requestId || null,
        jobId: event.jobId || null,
        ipAddress: event.ipAddress || null,
        userAgent: event.userAgent || null,
        details: event.details || {},
        businessObjectDeletedAt: event.businessObjectDeletedAt || null,
      },
    ],
    { session }
  ).then(([created]) => created);
