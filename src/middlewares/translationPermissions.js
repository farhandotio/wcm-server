import { getTranslationPermissionsForUser } from '../services/translation/translationPermissionService.js';

export const requireTranslationPermission = (permission) => async (req, res, next) => {
  try {
    const permissions = await getTranslationPermissionsForUser(req.user);
    if (!permissions.includes(permission)) {
      return res.status(403).json({ success: false, code: 'TRANSLATION_PERMISSION_DENIED', message: 'Translation Centre permission denied.' });
    }
    req.translationPermissions = permissions;
    return next();
  } catch (error) {
    return next(error);
  }
};
