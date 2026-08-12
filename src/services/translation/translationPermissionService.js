import TranslationRole, { TRANSLATION_PERMISSIONS, TRANSLATION_ROLE_PRESETS } from '../../models/TranslationRole.js';

export const getTranslationPermissionsForUser = async (user) => {
  if (user?.role === 'admin') return [...TRANSLATION_PERMISSIONS];
  if (!user?._id) return [];
  const roles = await TranslationRole.find({ members: user._id, isActive: true }).select('permissions').lean();
  return [...new Set(roles.flatMap((role) => role.permissions || []))];
};

export const userHasTranslationPermission = async (user, permission) =>
  (await getTranslationPermissionsForUser(user)).includes(permission);

export const ensureTranslationRolePresets = async (adminId) => {
  if (!adminId) return [];
  return Promise.all(Object.entries(TRANSLATION_ROLE_PRESETS).map(([name, permissions]) =>
    TranslationRole.findOneAndUpdate(
      { name },
      { $setOnInsert: { name, permissions, createdBy: adminId, updatedBy: adminId } },
      { returnDocument: 'after', upsert: true, runValidators: true }
    )
  ));
};
